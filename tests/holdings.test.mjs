import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeRows, effectiveMode, findNames, normalizeName, rankRows, shardForName } from '../src/holdings.mjs';

const dataUrl = new URL('../public/data/', import.meta.url);
const readData = async (file) => JSON.parse(await readFile(new URL(file, dataUrl), 'utf8'));
const row = (code, weight, count, amount = null) => ({ code, name: code, weight, count, marketSum: 100, amount });

test('search handles Korean spacing and English case without merging source names', () => {
  const names = [['삼성전자우', 25], ['삼성전자', 239], ['NVIDIA CORP', 91], ['NVIDIA Corp', 49], ['NVIDIA', 12]];
  assert.equal(normalizeName(' SK 하이닉스 '), 'sk하이닉스');
  assert.deepEqual(findNames(names, '삼성 전자').map(([name]) => name), ['삼성전자', '삼성전자우']);
  assert.deepEqual(findNames(names, ' nvidia corp ').map(([name]) => name), ['NVIDIA CORP', 'NVIDIA Corp']);
  assert.deepEqual(findNames(names, '   '), []);
  assert.deepEqual(findNames(names, '존재하지않는종목'), []);
});

test('UTF-8 FNV shards resolve every stock in the bundled snapshot', async () => {
  const [meta, names] = await Promise.all([readData('meta.json'), readData('names.json')]);
  const shards = new Map(await Promise.all(Array.from({ length: 256 }, async (_, i) => {
    const key = i.toString(16).padStart(2, '0');
    return [key, await readData(`shard/${key}.json`)];
  })));
  assert.equal(names.length, meta.stockCount);
  assert.equal(new Set(names.map(([name]) => name)).size, names.length);
  for (const [name, expectedCount] of names) {
    const raw = shards.get(shardForName(name))[name];
    assert.ok(raw, `${name} must resolve to its UTF-8 shard`);
    assert.equal(decodeRows(raw).length, expectedCount, `${name} index count must match holdings`);
  }
});

test('missing metrics have no rank while a disclosed zero is preserved', () => {
  const rows = [row('missing', null, 900), row('zero', 0, 10, 0), row('high', 12, 1, 90)];
  assert.deepEqual(rankRows(rows, 'weight').ranked.map((r) => r.code), ['high', 'zero']);
  assert.deepEqual(rankRows(rows, 'weight').missing.map((r) => r.code), ['missing']);
  assert.deepEqual(rankRows(rows, 'amount').ranked.map((r) => r.code), ['high', 'zero']);
  assert.equal(rankRows(rows, 'amount').missing.length, 1);
});

test('all missing weights fall back to CU counts, including signed quantities', () => {
  const rows = [row('short', null, -3), row('long', null, 2), row('unknown', null, null)];
  assert.equal(effectiveMode(rows, 'weight'), 'count');
  assert.equal(effectiveMode(rows, 'amount'), 'amount');
  assert.deepEqual(rankRows(rows, 'count').ranked.map((r) => r.count), [2, -3]);
  assert.equal(rankRows(rows, 'count').missing[0].code, 'unknown');
  assert.equal(effectiveMode([row('zero', 0, 0)], 'weight'), 'weight');
});

test('raw financial values are preserved and malformed rows fail clearly', () => {
  const values = decodeRows([['123456', 'ETF', 110.5, -12.1, 1200, 1326]]);
  assert.equal(values[0].weight, 110.5);
  assert.equal(values[0].count, -12.1);
  assert.throws(() => decodeRows([['bad', 'ETF', '12%', 1, null, null]]));
  assert.throws(() => decodeRows([['bad', 'ETF', NaN, 1, null, null]]));
  assert.throws(() => decodeRows(null));
});

test('actual Samsung holdings rank by the selected metric; NVIDIA has no weight', async () => {
  const samsung = decodeRows((await readData(`shard/${shardForName('삼성전자')}.json`))['삼성전자']);
  assert.ok(rankRows(samsung, 'weight').ranked.every((r, i, sorted) => i === 0 || sorted[i - 1].weight >= r.weight));
  assert.ok(rankRows(samsung, 'amount').ranked.every((r, i, sorted) => i === 0 || sorted[i - 1].amount >= r.amount));
  const nvidia = decodeRows((await readData(`shard/${shardForName('NVIDIA CORP')}.json`))['NVIDIA CORP']);
  assert.ok(nvidia.length > 0);
  assert.equal(effectiveMode(nvidia, 'weight'), 'count');
});
