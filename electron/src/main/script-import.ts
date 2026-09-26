import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

// Avoid colliding with the CommonJS shim injected into the ESM build.
const scriptRequire = createRequire(import.meta.url);
const MAX_BYTES = 16 * 1024 * 1024;

/** Isolate document parsing so malformed files cannot freeze the desktop shell. */
export function extractWordScript(raw: unknown): Promise<string> {
  const input = raw as { name?: unknown; data?: unknown } | null;
  if (
    !input ||
    typeof input.name !== 'string' ||
    !/\.docx?$/i.test(input.name) ||
    !(input.data instanceof Uint8Array) ||
    !input.data.length ||
    input.data.byteLength > MAX_BYTES
  ) {
    return Promise.reject(new Error('Invalid document input'));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      const Extractor = require(workerData.modulePath);
      new Extractor().extract(Buffer.from(workerData.data)).then(doc => {
        const text = doc.getBody();
        if (!text.trim() || text.length > 1000000) throw Error('No usable text');
        parentPort.postMessage({ text });
      }).catch(() => parentPort.postMessage({ error: true }));
    `,
      {
        eval: true,
        workerData: { modulePath: scriptRequire.resolve('word-extractor'), data: input.data },
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      },
    );
    const finish = () => {
      clearTimeout(timer);
      void worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Document parsing timed out'));
    }, 15000);
    worker.once('message', (message: { text?: string }) => {
      finish();
      if (typeof message.text === 'string') resolve(message.text);
      else reject(new Error('Could not read document'));
    });
    worker.once('error', () => {
      finish();
      reject(new Error('Could not read document'));
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error('Document parser stopped'));
      }
    });
  });
}
