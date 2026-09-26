// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extractWordScript } from './script-import';

describe('local Word import', () => {
  it.each(['doc', 'docx'])('extracts text from %s without Office', async (ext) => {
    const data = new Uint8Array(
      await readFile(new URL(`./fixtures/sample.${ext}`, import.meta.url)),
    );
    expect(await extractWordScript({ name: `sample.${ext}`, data })).toContain(
      'A second test of reviewing',
    );
  });
  it('rejects malformed documents and invalid payloads', async () => {
    await expect(
      extractWordScript({ name: 'broken.doc', data: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow();
    await expect(extractWordScript({ name: 'test.doc', data: 'not bytes' })).rejects.toThrow();
  });
});
