# Verified Tesla T4 (16GB) inference notes

Measured on a real NVIDIA Tesla T4 (16GB, Turing/sm_75), driver 550.163.01 (CUDA 12.8), torch
2.8.0+cu128, transformers 5.3.0, Python 3.11.15 (uv-managed). Engine under test: the default
`omnivoice` TTS backend (`OMNIVOICE_TTS_BACKEND=omnivoice`).

## Cold-cache first call can time out at 300s

The first `generate()` call lazily downloads the ~2.3GB `k2-fsa/OmniVoice` checkpoint, and that
download happens *inside* the `OMNIVOICE_GENERATE_TIMEOUT_S` budget (default 300s). On a fresh
install, the very first `POST /v1/audio/speech` can fail like this even though the GPU isn't
actually short on memory:

```
ERROR [omnivoice.openai_compat] OpenAI TTS failed: OpenAI TTS generate exceeded 300s and was
abandoned — the backend is running, but the job was too heavy for the available compute.
... most often the GPU is VRAM-starved ...
```

VRAM sampling during the failure showed a flat ~2GB with 0% GPU utilization for the whole 300s —
consistent with waiting on a download, not compute. Once the checkpoint is cached, the identical
request succeeds in ~1s (reproduced 5x: 1.574s / 1.034s / 1.065s / 0.995s / 0.911s).

**Workaround (no code change needed, both already exist):**
- For headless/API-only setups, pre-fetch the checkpoint before your first real TTS request:
  ```bash
  curl -X POST http://localhost:3900/models/install \
    -H "Content-Type: application/json" \
    -d '{"repo_id": "k2-fsa/OmniVoice"}'
  ```
  (`repo_id` is required — `InstallModelRequest` in `backend/api/schemas.py` rejects a bare/empty
  body — and must match one of the entries in `KNOWN_MODELS`, e.g. the default engine's
  `k2-fsa/OmniVoice`.) Progress streams over the existing `/setup/download-stream` SSE feed.
- Or raise the compute-time budget in **Settings → Performance & Device** for the first
  request (`OMNIVOICE_GENERATE_TIMEOUT_S` does the same thing from the environment, and
  takes precedence over the setting when both are present).

## OpenAI-compatible endpoint doesn't expose `num_step` / `guidance_scale`

`POST /v1/audio/speech`'s request schema doesn't declare `num_step` or `guidance_scale` fields —
sending them in the JSON body returns `200 OK` but they're silently discarded (pydantic's default
`extra=ignore` behavior). The native multipart `POST /generate` endpoint *does* expose both as
explicit form fields, so use that endpoint if you need to control them.

Separately: the app's own default for `num_step` is 16 — half of the model's documented default of
32 (see `docs/generation-parameters.md`, "Use 16 for faster inference"). Not a bug, just not stated
that the app already runs the "fast" preset unless you override it via `/generate`.

## T4 acceleration checklist

| Option | Status |
|---|---|
| dtype | `torch.float16` hardcoded for the `omnivoice` engine (`model_manager.py`) — correct for Turing (no bf16 tensor cores this generation). No env var override for this engine specifically (ASR engines have `ASR_COMPUTE_TYPE`; `dots_tts`/`indextts` have their own precision vars; `omnivoice` doesn't). |
| Attention | `sdpa`, selected automatically since `flash_attn` isn't installed (`_supports_flash_attn_2=True` is declared but the package itself is absent) — safe on T4. |
| int8 | No int8 path for this engine (ASR's CTranslate2 `int8` and `sherpa-onnx`'s int8 ONNX models are separate/unrelated). |
| CUDA Graphs | **Not used on T4 any more (#2135).** Reachable only indirectly via `torch.compile(mode="reduce-overhead")`, which the app used to attempt by default here — and which killed the backend process outright on the first `/generate` (no traceback, no HTTP response). The app now picks the compile mode per GPU and drops to the non-cudagraph `default` mode below sm_80. `OMNIVOICE_FORCE_CUDAGRAPH=1` restores the old behaviour for benchmarking. |
| torch.compile | Still attempted on T4, in `default` mode — compiled Inductor kernels, no graph capture. Disable entirely with Settings → Performance → "Disable torch.compile" or `TORCH_COMPILE_DISABLE=1`. |

## VRAM

Peak measured: 2487 MiB (`nvidia-smi`) / 2.050 GB (`torch.cuda.max_memory_allocated()`) for the
default `omnivoice` engine — comfortably fits even the README's stated "minimum" (4GB) tier.
