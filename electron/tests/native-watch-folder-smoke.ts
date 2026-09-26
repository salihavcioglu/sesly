import { mkdtemp, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { DictationOutputClient } from '../src/main/dictation-output';
const folder = await mkdtemp(join(tmpdir(), 'sesly-watch-'));
const bytes = Buffer.from('disposable watch upload fixture');
await writeFile(join(folder, 'sample.mp4'), bytes);
const helper = new DictationOutputClient(
  process.env.SESLY_NATIVE_HELPER ||
    resolve(
      'native/desktop-bridge/target/debug/sesly-desktop-bridge' +
        (process.platform === 'win32' ? '.exe' : ''),
    ),
);
let uploaded = false;
const server = createServer(async (req, res) => {
  assert.equal(req.url, '/batch/enqueue');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.authorization, 'Bearer fixture-session');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  assert.ok(body.includes(bytes));
  assert.ok(body.includes(Buffer.from('name="langs"\r\n\r\nes,fr')));
  assert.ok(body.includes(Buffer.from('name="voice_id"\r\n\r\nfixture-voice')));
  uploaded = true;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"id":"fixture-job"}');
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
try {
  const selected = (await helper.request({ method: 'watch_register', path: folder })) as {
    token: string;
  };
  const entries = (await helper.request({ method: 'watch_scan', token: selected.token })) as {
    name: string;
    size: number;
    mtime: number;
  }[];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'sample.mp4');
  const port = (server.address() as { port: number }).port;
  const command = {
    method: 'watch_enqueue' as const,
    backend_url: `http://127.0.0.1:${port}`,
    authorization: 'Bearer fixture-session',
    token: selected.token,
    name: entries[0].name,
    expected_size: entries[0].size,
    expected_mtime: entries[0].mtime,
    langs: ['es', 'fr'],
    voice_id: 'fixture-voice',
    preserve_bg: true,
  };
  await assert.rejects(
    helper.request({ ...command, name: '../escape.mp4' }),
    /Invalid watch-folder/,
  );
  assert.equal(uploaded, false);
  const reply = (await helper.request(command)) as { status: number };
  assert.equal(reply.status, 200);
  assert.equal(uploaded, true);
  await rename(folder, folder + '-moved');
  await assert.rejects(
    helper.request({ method: 'watch_scan', token: selected.token }),
    /no longer accessible/,
  );
  await helper.request({ method: 'watch_forget', token: selected.token });
  await assert.rejects(
    helper.request({ method: 'watch_scan', token: selected.token }),
    /not authorized/,
  );
  console.log(
    'Native watch: confined scan, streamed multipart upload, rename detection and revocation passed.',
  );
} finally {
  helper.close();
  await new Promise<void>((done) => server.close(() => done()));
}
