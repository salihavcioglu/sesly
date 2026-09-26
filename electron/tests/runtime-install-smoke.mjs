// Explicit integration check: installs real Python dependencies into an isolated directory.
// Not part of the unit suite. SESLY_RUNTIME_TEST_DIR and SESLY_UV are required.
import { installRuntime, runtimeReady } from '../src/main/runtime-project.ts';
import { spawn, execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const project = process.env.SESLY_RUNTIME_TEST_DIR;
const uv = process.env.SESLY_UV;
assert(project && uv, 'Set an isolated runtime directory and the uv executable explicitly');
assert(!existsSync(join(project, '.venv')), 'This check requires a fresh environment');
mkdirSync(project, { recursive: true });
const log = join(project, 'install-test.log');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
const run = (command, args, cwd, env) =>
  new Promise((accept, reject) => {
    console.log('Running:', command, args.join(' '));
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
        HF_HUB_OFFLINE: '1',
        HF_HUB_CACHE: join(project, '.empty-hf-cache'),
      },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32')
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {}
      }
    };
    controller.signal.addEventListener('abort', stop, { once: true });
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data) => appendFileSync(log, data));
    child.once('error', reject);
    child.once('close', (code) => {
      controller.signal.removeEventListener('abort', stop);
      if (code === 0) accept();
      else reject(new Error(`Command exited ${code}; details: ${log}`));
    });
  });
const bundle = resolve('electron/release/win-unpacked/resources');
await installRuntime(bundle, project, uv, run, controller.signal);
assert(await runtimeReady(bundle, project));
console.log('PASS: fresh runtime dependency installation and import verification;', project);
