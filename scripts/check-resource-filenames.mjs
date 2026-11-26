import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkedRoots = ['src', 'public'];
const problems = [];

async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const caseFolded = new Map();
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    const displayPath = relative(root, fullPath).replaceAll('\\', '/');
    if (entry.name !== entry.name.normalize('NFC')) problems.push(`${displayPath}: tên chưa ở dạng Unicode NFC`);
    if (Buffer.from(entry.name, 'utf8').toString('utf8') !== entry.name) problems.push(`${displayPath}: tên không round-trip UTF-8`);
    const folded = entry.name.normalize('NFC').toLocaleLowerCase('en-US');
    const previous = caseFolded.get(folded);
    if (previous) problems.push(`${displayPath}: xung đột tên không phân biệt hoa/thường với ${previous}`);
    else caseFolded.set(folded, displayPath);
    if (entry.isDirectory()) await walk(fullPath);
  }
}

for (const directory of checkedRoots) await walk(join(root, directory));
if (problems.length) {
  console.error('Resource filename validation failed:\n' + problems.map((item) => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Resource filenames are UTF-8 round-trip safe, NFC-normalized, and case-collision free.');
}