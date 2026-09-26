import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  packageLinuxLibraries,
  parseLibraries,
  verifyLinuxLibraries,
} from '../native-linux-libraries.mjs';

test('missing libraries fail packaging instead of silently producing a broken installer', () => {
  assert.throws(() => parseLibraries('libxdo.so.3 => not found'), /Missing native dependency/);
  assert.deepEqual(parseLibraries('libc.so.6 => /lib/libc.so.6 (0x1234)'), []);
});

test(
  'relocated helper loads bundled direct and transitive libraries without the build host',
  {
    skip: process.platform !== 'linux',
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'vs-native-libs-'));
    try {
      const build = join(root, 'build');
      const packaged = join(root, 'package');
      mkdirSync(build);
      mkdirSync(packaged);
      mkdirSync(join(build, 'lib'));
      writeFileSync(join(build, 'leaf.c'), 'int leaf(void) { return 42; }');
      writeFileSync(
        join(build, 'parent.c'),
        'extern int leaf(void); int parent(void) { return leaf(); }',
      );
      writeFileSync(
        join(build, 'main.c'),
        'extern int parent(void); int main(void) { return parent() != 42; }',
      );
      const cc = (args) => execFileSync('cc', args, { cwd: build });
      cc(['-shared', '-fPIC', 'leaf.c', '-Wl,-soname,libvsleaf.so.1', '-o', 'lib/libvsleaf.so.1']);
      cc([
        '-shared',
        '-fPIC',
        'parent.c',
        '-Llib',
        '-l:libvsleaf.so.1',
        '-Wl,-soname,libvsparent.so.1',
        '-o',
        'lib/libvsparent.so.1',
      ]);
      // Use the exact linker arguments from the helper's build script.
      cc([
        'main.c',
        '-Llib',
        '-l:libvsparent.so.1',
        '-Wl,-rpath-link,lib',
        '-Wl,--disable-new-dtags,-rpath,$ORIGIN/lib',
        '-o',
        'helper',
      ]);
      const binary = join(packaged, 'helper');
      copyFileSync(join(build, 'helper'), binary);
      assert.throws(() => execFileSync(binary, { stdio: 'pipe' }), /shared libraries/);
      await packageLinuxLibraries(join(build, 'helper'), binary);
      rmSync(build, { recursive: true });
      execFileSync(binary);
      await verifyLinuxLibraries(binary);
      rmSync(join(packaged, 'lib/libvsleaf.so.1'));
      await assert.rejects(verifyLinuxLibraries(binary), /Missing native dependency/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
