import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const directory = new URL('../src/renderer/src/i18n/locales/', import.meta.url);
const rendererDirectory = new URL('../src/renderer/src/', import.meta.url);
const failures = [];
const english = JSON.parse(await readFile(new URL('en.json', directory), 'utf8'));
const placeholders = (text) =>
  [...text.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((match) => match[1]).sort();
const protectedNames = [
  'Sesly',
  'Hugging Face',
  'OmniVoice',
  'Faster-Whisper',
  'NLLB',
  'Codex',
  'Claude Code',
  'OpenCode',
];
function inspect(value, path, source) {
  if (typeof value === 'string') {
    if (
      /\?{3,}|\uFFFD|Error 500 \(Server Error\)|There was an error\. Please try again later|<span\s+data-ph=|ZXQPH\d+QXZ/.test(
        value,
      )
    ) {
      failures.push(path);
    }
    if (typeof source === 'string' && !source.includes('?') && value.includes('?')) {
      const trimmed = value.trim();
      const loneSentenceQuestion =
        (trimmed.match(/\?/g) ?? []).length === 1 &&
        trimmed.endsWith('?') &&
        !source.trim().endsWith('…');
      if (!loneSentenceQuestion) failures.push(path);
    }
    if (typeof source === 'string') {
      for (const name of protectedNames) {
        if (source.includes(name) && !value.includes(name)) failures.push(path);
      }
      // A localized zero plural may say "none" without printing the count.
      const tokens = (text) =>
        placeholders(text).filter((token) => !path.endsWith('_zero') || token !== 'count');
      assert.deepEqual(
        tokens(value),
        tokens(source),
        `${path}: interpolation differs from English`,
      );
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) inspect(child, `${path}.${key}`, source?.[key]);
}
const files = (await readdir(directory)).filter((name) => name.endsWith('.json'));
for (const file of files) {
  const locale = JSON.parse(await readFile(new URL(file, directory), 'utf8'));
  inspect(locale, file, english);
  for (const key of ['uninstall_confirm_title', 'uninstall_confirm_body']) {
    assert.equal(typeof locale.settings?.[key], 'string', `${file}: missing settings.${key}`);
  }
  for (const key of ['profile_name_required', 'saved_profile', 'save_failed']) {
    assert.equal(typeof locale.clone?.[key], 'string', `${file}: missing clone.${key}`);
  }
  for (const namespace of ['backend', 'engines', 'recording', 'nav', 'player', 'tts']) {
    for (const key of Object.keys(english[namespace])) {
      assert.equal(
        typeof locale[namespace]?.[key],
        'string',
        `${file}: missing ${namespace}.${key}`,
      );
    }
  }
}
assert.deepEqual(failures, [], 'Locale strings contain damaged Unicode or provider artifacts');

async function rendererFiles(current) {
  const entries = await readdir(current, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, current);
    if (entry.isDirectory()) {
      if (url.pathname.includes('/i18n/locales/')) continue;
      found.push(...(await rendererFiles(url)));
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      found.push(url);
    }
  }
  return found;
}

const sourceFailures = [];
const mojibake = /(?:Â[^\p{L}\p{N}]|Ã.|â(?:€|™|œ|€¦|€”|€“)|\uFFFD)/gu;
for (const file of await rendererFiles(rendererDirectory)) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(mojibake)) {
    const line = source.slice(0, match.index).split('\n').length;
    sourceFailures.push(`${file.pathname.split('/src/renderer/src/')[1]}:${line}`);
  }
}
assert.deepEqual(sourceFailures, [], 'Renderer source contains damaged Unicode');
console.log(`Locale encoding and interpolation: ${files.length} files passed`);
