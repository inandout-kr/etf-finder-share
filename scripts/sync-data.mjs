import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeRows, shardForName } from '../src/holdings.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(projectRoot, process.argv[2] ?? '../etf-finder/dist');
const target = path.join(projectRoot, 'public', 'data');
const identifier = randomUUID();
const staging = path.join(projectRoot, `.data-sync-${identifier}`);
const backup = path.join(projectRoot, `.data-sync-old-${identifier}`);

function checkedWorkspacePath(candidate) {
  const absolute = path.resolve(candidate);
  const relative = path.relative(projectRoot, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside this project: ${absolute}`);
  }
  return absolute;
}

// Every move/delete destination is resolved and checked before any mutation.
[target, staging, backup].forEach(checkedWorkspacePath);
if (source === target || source.startsWith(`${target}${path.sep}`)) throw new Error('Source must be a separate read-only snapshot.');
let backedUp = false;
let installed = false;
try {
  await mkdir(path.join(staging, 'shard'), { recursive: true });
  await Promise.all(['meta.json', 'names.json'].map((file) => copyFile(path.join(source, file), path.join(staging, file))));
  await Promise.all(Array.from({ length: 256 }, (_, i) => {
    const file = `${i.toString(16).padStart(2, '0')}.json`;
    return copyFile(path.join(source, 'shard', file), path.join(staging, 'shard', file));
  }));
  const meta = JSON.parse(await readFile(path.join(staging, 'meta.json'), 'utf8'));
  const names = JSON.parse(await readFile(path.join(staging, 'names.json'), 'utf8'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.baseDate) || !Array.isArray(names) || names.length !== meta.stockCount) {
    throw new Error('Snapshot metadata and index do not match.');
  }
  const shards = new Map(await Promise.all(Array.from({ length: 256 }, async (_, i) => {
    const key = i.toString(16).padStart(2, '0');
    return [key, JSON.parse(await readFile(path.join(staging, 'shard', `${key}.json`), 'utf8'))];
  })));
  for (const [name, expectedCount] of names) {
    if (typeof name !== 'string' || !Number.isInteger(expectedCount)
      || decodeRows(shards.get(shardForName(name))[name]).length !== expectedCount) {
      throw new Error(`Invalid stock index: ${name}`);
    }
  }
  await mkdir(path.dirname(target), { recursive: true });
  if (await stat(target).then(() => true).catch((error) => { if (error.code === 'ENOENT') return false; throw error; })) {
    await rename(checkedWorkspacePath(target), checkedWorkspacePath(backup));
    backedUp = true;
  }
  await rename(checkedWorkspacePath(staging), checkedWorkspacePath(target));
  installed = true;
  if (backedUp) await rm(checkedWorkspacePath(backup), { recursive: true });
  console.log(`Copied ${meta.baseDate}: ${meta.etfCount} ETFs, ${names.length} stock names, 256 shards.`);
  console.log(`Source was read only: ${source}`);
} catch (error) {
  if (backedUp && !installed) await rename(checkedWorkspacePath(backup), checkedWorkspacePath(target));
  throw error;
} finally {
  if (!installed) await rm(checkedWorkspacePath(staging), { recursive: true, force: true });
}
