import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveDialogEsm(frontendRoot) {
  return [
    path.resolve(frontendRoot, 'node_modules/@tauri-apps/plugin-dialog/dist-js/index.js'),
    path.resolve(frontendRoot, '../node_modules/@tauri-apps/plugin-dialog/dist-js/index.js'),
  ].find(existsSync);
}
