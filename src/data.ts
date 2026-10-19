import { decodeRows, shardForName, type Holding, type NameEntry } from './holdings.mjs';

export type DataMeta = { baseDate: string; collectedAt: string; etfCount: number; stockCount: number };
export type DataIndex = { meta: DataMeta; names: NameEntry[] };

// One source per build keeps the index and every shard in the same snapshot.
const configuredSource = import.meta.env.VITE_DATA_URL?.trim();
const dataRoot = configuredSource ? `${configuredSource.replace(/\/+$/, '')}/` : `${import.meta.env.BASE_URL}data/`;
const shards = new Map<string, Record<string, unknown>>();

async function readJson(file: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${dataRoot}${file}`, { signal: controller.signal });
    if (!response.ok) throw new Error('데이터를 불러오지 못했어요.');
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('연결이 지연되고 있어요. 다시 시도해 주세요.');
    throw new Error('데이터를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
  } finally {
    window.clearTimeout(timer);
  }
}

export async function loadIndex(): Promise<DataIndex> {
  const [rawMeta, rawNames] = await Promise.all([readJson('meta.json'), readJson('names.json')]);
  const meta = rawMeta as DataMeta;
  if (!meta || !/^\d{4}-\d{2}-\d{2}$/.test(meta.baseDate) || typeof meta.collectedAt !== 'string'
    || !Number.isInteger(meta.etfCount) || !Number.isInteger(meta.stockCount)
    || !Array.isArray(rawNames) || !rawNames.every((entry) => Array.isArray(entry) && entry.length === 2
      && typeof entry[0] === 'string' && Number.isInteger(entry[1]))) {
    throw new Error('데이터 형식을 확인할 수 없어요. 다시 시도해 주세요.');
  }
  return { meta, names: rawNames as NameEntry[] };
}

export async function loadHoldings(name: string): Promise<Holding[]> {
  const key = shardForName(name);
  let shard = shards.get(key);
  if (!shard) {
    const raw = await readJson(`shard/${key}.json`);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('보유 데이터 형식을 확인할 수 없어요.');
    shard = raw as Record<string, unknown>;
    shards.set(key, shard);
  }
  return decodeRows(Object.hasOwn(shard, name) ? shard[name] : []);
}
