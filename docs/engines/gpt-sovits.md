# Sesly — GPT-SoVITS Engine

GPT-SoVITS (RVC-Boss) is one of the most popular open-source voice-cloning
systems (57k+ GitHub stars, MIT-licensed). It does zero-shot and few-shot
cloning with excellent naturalness in Chinese, English, Japanese, Cantonese,
and Korean, and it is very fast (RTF ~0.014 on suitable hardware).

Unlike Sesly's other engines, GPT-SoVITS does not run inside the app.
It ships as a standalone API server, and Sesly connects to it over
HTTP.

## When to pick it

- You already run (or want to run) a GPT-SoVITS server, e.g. with few-shot
  fine-tuned voices.
- You need fast, natural cloning in zh/en/ja/yue/ko.

## Setup

1. Install and start the GPT-SoVITS API server (upstream project):

   ```bash
   cd GPT-SoVITS
   python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
   ```

   Sesly speaks the **api_v2** protocol (`POST /tts`); the older
   `api.py` (v1) server does not expose that route and is incompatible.
   To use fine-tuned weights, point the `custom` section of
   `tts_infer.yaml` at your `GPT_weights*/…ckpt` and `SoVITS_weights*/…pth`.

2. Select the engine via **Model Catalogue** (TTS tab → **Use**) or
   `OMNIVOICE_TTS_BACKEND=gpt-sovits`.

Sesly marks the engine available only when the server responds
(2-second reachability probe).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OMNIVOICE_GPTSOVITS_URL` | `http://127.0.0.1:9880` | API server URL |
| `OMNIVOICE_GPTSOVITS_REF_AUDIO` | (unset) | Default reference clip (3–10 s, path readable by the server) used when a request carries no voice profile |
| `OMNIVOICE_GPTSOVITS_REF_TEXT` | (unset) | Verbatim transcript of that clip |
| `OMNIVOICE_GPTSOVITS_REF_LANG` | `auto` | Language of the clip (`zh`/`en`/`ja`/`yue`/`ko`) |
| `OMNIVOICE_TRUSTED_NETWORKS` | (unset) | Required to allow a non-loopback server |

**Remote servers:** by default Sesly only talks to loopback addresses
— part of the local-first guarantee. To point at a server on another
machine (e.g. a GPU box on your LAN), add its network to
`OMNIVOICE_TRUSTED_NETWORKS`; otherwise the connection is refused as an
untrusted endpoint.

Prefer `https://` (or a private tunnel such as Tailscale/WireGuard) for any
non-loopback server: with plain `http://` the text you synthesize and the
audio that comes back cross the network unencrypted. Sesly does not
disable certificate verification, so a TLS endpoint needs a certificate the
system trusts.

## Behaviour notes

- Output is 32 kHz mono (server output is resampled if needed).
- Requests are sent unsplit (`text_split_method: cut0`); Sesly chunks long
  text itself. Server-side punctuation splitting (`cut5`) produces short
  fragments that the GPT stage sometimes ends early, dropping clauses.
- api_v2 needs a reference clip for **every** request (it has no built-in
  default voice). A voice profile supplies one; plain TTS without a profile
  uses `OMNIVOICE_GPTSOVITS_REF_AUDIO` / `_REF_TEXT`, and fails with a
  message naming those variables when neither is set.
- Cloning passes your reference clip path and optional transcript to the
  server; the reference path must be readable **by the server process**, so
  remote servers need the clip on their own filesystem. A clip that ends in
  silence, or a transcript that does not match it, makes the server emit a
  fraction of a second of near-silence.
- Speed control is forwarded as the server's `speed_factor`.
- The GPU is whatever the GPT-SoVITS server itself uses (CUDA preferred);
  Sesly's side is just an HTTP client.

## Known limits

- Five languages only; for broader coverage use
  [OmniVoice](omnivoice.md) ([languages.md](../languages.md)).
- No voice design; server availability is your responsibility — if the
  server stops, generations fail with a "server not reachable" error.

## Troubleshooting

- "GPT-SoVITS server not reachable": start the server with the command
  above, or fix `OMNIVOICE_GPTSOVITS_URL`. The probe is a validator-only
  `GET /tts?text=&text_lang=en&prompt_lang=en`; api_v2's own answers to it
  (400, and 200/405 on other builds) count as reachable. A 404 means the
  endpoint does not expose `/tts`: check for an `api.py` (v1) server or a
  proxy/route mismatch. Other HTTP errors report their status and mark the
  engine unavailable. Redirects are rejected without following them and
  appear as unreachable; configure the server's direct origin.
- "endpoint is outside loopback or OMNIVOICE_TRUSTED_NETWORKS": see
  Configuration above.
- Other issues: [install/troubleshooting.md](../install/troubleshooting.md).

See also: [benchmarks.md](../benchmarks.md),
[expressive-speech.md](../expressive-speech.md).

Reference transcripts from saved profiles and uploaded clips use api_v2's
`auto` language detection, independently of the output language. An English
reference can therefore produce Japanese speech without being interpreted as
Japanese. The configured default clip also uses `auto` unless
`OMNIVOICE_GPTSOVITS_REF_LANG` specifies its language; that setting never
applies to a different, explicitly supplied clip.
