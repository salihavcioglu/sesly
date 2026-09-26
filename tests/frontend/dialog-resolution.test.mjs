import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveDialogEsm } from '../../frontend/resolveDialogEsm.mjs';

for (const layout of ['nested', 'hoisted', 'both', 'missing']) {
  test(`dialog ESM resolution with ${layout} dependencies`, (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'vs-dialog-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const frontend = path.join(root, 'frontend');
    const suffix = 'node_modules/@tauri-apps/plugin-dialog/dist-js/index.js';
    const nested = path.join(frontend, suffix);
    const hoisted = path.join(root, suffix);
    const paths = layout === 'both' ? [nested, hoisted]
      : layout === 'nested' ? [nested] : layout === 'hoisted' ? [hoisted] : [];
    for (const entry of paths) {
      mkdirSync(path.dirname(entry), { recursive: true });
      writeFileSync(entry, 'export {};');
    }
    assert.equal(resolveDialogEsm(frontend), paths[0]);
  });
}
