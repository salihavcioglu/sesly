import { readFile, readdir } from 'node:fs/promises';

const directory = new URL('../src/renderer/src/i18n/locales/', import.meta.url);
function flatten(value, prefix = '', output = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') output[path] = child;
    else flatten(child, path, output);
  }
  return output;
}
const english = flatten(JSON.parse(await readFile(new URL('en.json', directory), 'utf8')));
const missing = {};
const namespaces = {};
for (const file of (await readdir(directory)).filter(
  (name) => name.endsWith('.json') && name !== 'en.json',
)) {
  const translated = flatten(JSON.parse(await readFile(new URL(file, directory), 'utf8')));
  missing[file.slice(0, -5)] = Object.keys(english).filter((key) => !(key in translated));
  for (const key of missing[file.slice(0, -5)]) {
    const namespace = key.split('.')[0];
    namespaces[namespace] = (namespaces[namespace] ?? 0) + 1;
  }
}
const missingEntries = Object.values(missing).reduce((sum, keys) => sum + keys.length, 0);
console.log(
  JSON.stringify(
    {
      missingEntries,
      byNamespace: Object.fromEntries(Object.entries(namespaces).sort((a, b) => b[1] - a[1])),
      ...(process.argv.includes('--details') ? { missing } : {}),
    },
    null,
    2,
  ),
);
if (missingEntries > 0) process.exitCode = 1;
