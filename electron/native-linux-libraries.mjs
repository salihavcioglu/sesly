import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, cp, mkdir, realpath, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const exec = promisify(execFile);
// The loader and glibc must come from the host as a matching pair.
const hostLibrary = /^(?:lib(?:c|m|pthread|dl|rt|resolv|util|anl)\.so\.|ld-linux|ld64)/;

export function parseLibraries(output) {
  const libraries = [];
  for (const line of output.split('\n')) {
    if (/=>\s+not found/.test(line)) throw new Error(`Missing native dependency: ${line.trim()}`);
    const match = line.match(/^\s*(\S+)\s+=>\s+(\/.*?)\s+\(0x[\da-f]+\)/i);
    if (match && !hostLibrary.test(basename(match[1]))) {
      if (match[1].includes('/')) throw new Error(`Non-relocatable native dependency: ${match[1]}`);
      libraries.push({ name: match[1], source: match[2] });
    }
  }
  return libraries;
}

async function dependencies(binary) {
  // Only inspect our own compiled executable, never an untrusted downloaded file.
  const { stdout } = await exec('ldd', [binary], { env: { ...process.env, LC_ALL: 'C' } });
  return parseLibraries(stdout);
}

export async function verifyLinuxLibraries(binary) {
  const directory = await realpath(join(dirname(binary), 'lib'));
  for (const { name, source } of await dependencies(binary)) {
    if ((await realpath(source)) !== (await realpath(join(directory, name)))) {
      throw new Error(`Native dependency escapes the package: ${name} (${source})`);
    }
  }
}

export async function packageLinuxLibraries(source, binary) {
  const libraries = await dependencies(source);
  const directory = join(dirname(binary), 'lib');
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const { name, source: library } of libraries) {
    // Dereference distribution symlinks and retain the exact required SONAME.
    await copyFile(library, join(directory, name));
  }
  await verifyLinuxLibraries(binary);
}

/** Retain distribution copyright notices in the Ubuntu-built release artifacts. */
export async function packageLinuxLibraryNotices(source, binary) {
  if (!existsSync('/var/lib/dpkg/status')) return; // Non-Debian development host.
  const directory = join(dirname(binary), 'licenses');
  await mkdir(directory, { recursive: true });
  for (const { source: library } of await dependencies(source)) {
    const canonical = await realpath(library);
    let owner;
    for (const candidate of new Set([
      library,
      canonical,
      canonical.replace(/^\/usr\/lib\//, '/lib/'),
    ])) {
      try {
        const { stdout } = await exec('dpkg-query', ['-S', candidate]);
        owner = stdout.split(': ')[0].replace(/:[^:]+$/, '');
        break;
      } catch {
        /* Try merged-/usr's alternate package path. */
      }
    }
    if (!owner || !/^[a-z0-9][a-z0-9+.-]*$/.test(owner)) {
      throw new Error(`Cannot locate native library copyright: ${library}`);
    }
    await copyFile(`/usr/share/doc/${owner}/copyright`, join(directory, `${owner}.copyright`));
  }
  // Debian copyright files reference these shared license texts.
  await cp('/usr/share/common-licenses', join(directory, 'common-licenses'), {
    recursive: true,
    dereference: true,
  });
}
