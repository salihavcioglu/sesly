import assert from 'node:assert/strict';

const baseUrl = process.env.SESLY_BACKEND_URL || 'http://127.0.0.1:3900';

async function request(path, init) {
  const response = await fetch(baseUrl + path, init);
  if (!response.ok) {
    throw new Error(
      `${init?.method || 'GET'} ${path} failed (${response.status}): ${await response.text()}`,
    );
  }
  return response;
}

async function selectAsr(backendId, modelId) {
  await request('/engines/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ family: 'asr', backend_id: backendId, model_id: modelId }),
  });
}

async function transcribe(audio, filename) {
  const form = new FormData();
  form.set('audio', audio, filename);
  form.set('mode', 'reference');
  const started = performance.now();
  const result = await (await request('/transcribe', { method: 'POST', body: form })).json();
  return { ...result, elapsed_ms: Math.round(performance.now() - started) };
}

const engines = await (await request('/engines/asr')).json();
const originalEngine = engines.active;
const originalModel = engines.active_model;
assert(originalModel, 'The active ASR engine must expose its installed model');

const profiles = await (await request('/profiles')).json();
const profile = profiles.find((item) => item.kind === 'clone' && item.ref_audio_path);
assert(profile, 'A saved clone profile with reference audio is required');
const audioResponse = await request(`/profiles/${encodeURIComponent(profile.id)}/audio`);
const audio = await audioResponse.blob();
assert(audio.size > 0, 'The saved profile audio must not be empty');

const results = [];
try {
  for (const engine of ['faster-whisper', 'faster-whisper-isolated']) {
    await selectAsr(engine, originalModel);
    results.push({ selected_engine: engine, ...(await transcribe(audio, profile.ref_audio_path)) });
  }
} finally {
  await selectAsr(originalEngine, originalModel);
  const loaded = await (await request('/model/loaded')).json();
  if (loaded.models.some((item) => item.id === 'sidecar:faster-whisper-isolated')) {
    await request('/model/unload/sidecar:faster-whisper-isolated', { method: 'POST' });
  }
}

for (const result of results) {
  assert.equal(result.engine, result.selected_engine);
  assert(result.text?.trim(), `${result.selected_engine} returned no transcript`);
}
const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
assert.equal(
  normalize(results[0].text),
  normalize(results[1].text),
  'The isolated and in-process backends diverged on the same installed model and audio',
);

const restored = await (await request('/engines/asr')).json();
const loaded = await (await request('/model/loaded')).json();
assert.equal(restored.active, originalEngine);
assert.equal(restored.active_model, originalModel);
assert.equal(
  loaded.models.some((item) => item.id === 'sidecar:faster-whisper-isolated'),
  false,
  'The comparison must not leave its sidecar resident',
);

console.log(
  'PASS: in-process and crash-isolated Faster-Whisper agree; selection restored and sidecar unloaded',
);
for (const result of results) {
  console.log(`${result.selected_engine}: ${result.elapsed_ms} ms — ${result.text}`);
}
