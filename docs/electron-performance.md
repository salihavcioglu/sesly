# Electron compute and performance settings

Settings > Compute device exposes the existing device override, the torch.compile workaround, generation time budgets, and hardware readouts.

Device choices come from the backend's detected families plus Auto. The chosen preference and currently active family are displayed separately. Environment-pinned choices are disabled, an ignored unavailable override is explained, and a changed preference shows its actual restart requirement. Failed saves keep the last confirmed state. Nothing automatically restarts the backend or changes the active model.

The torch.compile workaround matches Tauri: since #2135 it is selectable on every platform, because the compile failures it works around are not Windows-only. Generation budgets preserve separate GPU and CPU limits, validate the existing positive/21600-second range, and keep edits during refetches. An externally overridden budget reports that fact instead of implying the saved value will take effect after restart. Hardware RAM/VRAM readouts poll only while this view is mounted.

During synthesis, the fixed-width primary action polls the existing model-status contract and names the active runtime phase: starting the AI runtime, loading weights, warming speech recognition, optimizing the model, generating, or receiving audio. Model-load percentage and elapsed time share the reserved status line, and the progress track switches from model loading to streamed audio delivery without moving the controls.

The backend publishes explicit model lifecycle transitions to the renderer event stream. Engine Ready refreshes immediately from those events and keeps one-second polling only while work is active; idle model, worker, batch, performance-profile and diarisation checks back off to bounded 15–30 second recovery intervals.

`electron/tests/performance-settings-smoke.mjs` checks saved/active separation, failed saves, environment pinning, unavailable devices, the platform guard, budget validation and external overrides with mocked contracts. Live read-only checks verified the compute, compile and hardware response schemas. Tests did not change the user's device, optimization or timeout preferences. Native hardware behavior on macOS/Linux still requires platform verification.

## Speed and quality presets

The engine sidebar and Performance settings expose Fast, Balanced, Quality and Max. A global choice resets family overrides; a family choice overrides the global preference. Changes are blocked while foreground or batch work is active. Choosing a preset never downloads weights or activates cloud providers. A ready network translator remains authoritative when explicitly selected; if that provider becomes unavailable, profile reconciliation recovers to the tier-appropriate installed local translator instead of leaving translation unusable.

Currently connected controls are OmniVoice sampling (8/16/32/64 steps), Faster-Whisper decoding search (1/3/5/8), Sherpa transducer dictation search (greedy through 8-path modified beam search), local NLLB beam search (1/3/5/8), and the installed diarisation runtimes. Clone, Dubbing, Batch, Voice Conversion, Stories and Audiobook all resolve untouched TTS controls through this shared contract; an explicit Production override still wins. Dictation keeps the selected language model and rebuilds its warm recognizer after a tier change. When both diarisation choices are installed, Fast/Balanced select native audio.cpp Sortformer and Quality/Max select pyannote; with only one runtime, its family control stays unavailable rather than accepting a no-op preference. Max selects the strongest already-installed compatible Faster-Whisper, dictation and NLLB choices without downloading anything. LLM remains unavailable until the selected runtime exposes a meaningful comparable effort control. The API reports only implemented targets.

Performance Settings presents each family as a discrete Fast/Balanced/Quality/Max control and identifies the effective local model, runtime, and decoding effort beneath it. A choice is persisted before any optional renderer-side synchronization and receives explicit applied or failed feedback, so a cold engine catalogue cannot make the control appear inert. Families without an installed compatible target stay disabled, name the required engine, and link to its Models view; an engine with no comparable effort contract explains that limitation. The compact sidebar keeps the slider form of the same setting.

Settings > Models turns those tiers into one-click, target-aware model packs. Each pack previews its exact compatible models, installed size, remaining download and aggregate progress before starting the existing resumable installer. Fast installs the smallest local ASR and dictation set; Balanced selects the faster Whisper Turbo and Parakeet set; Quality and Max add Whisper large-v3 and local NLLB. The saved tier is reconciled after every successful model download, so newly available engines become active without another selection or restart. Diarisation stays explicit because native audio.cpp setup and gated pyannote access require separate consent; LLM stays explicit because it has no common local performance target.

Backend startup was checked live after the lifecycle changes: OmniVoice loaded successfully and the performance-profile endpoint responded. This does not establish the cause of historical native crashes or verify recovery from every stall.

Crash-isolated Faster-Whisper receives the same ASR decoding preset with each transcription request. The parent snapshots the selected beam/best-of values; the child validates them before loading the model. Existing callers without decoding options retain their original defaults, and changing a preset does not require restarting the child.

## Reference transcription

Uploaded voice references use the selected ASR engine through the shared transcribe endpoint's reference mode. This skips word alignment, checks locally installed models before loading, and never enables LLM refinement. Dictation selection remains independent. Missing models leave the optional transcript editable and retryable; asynchronous results do not overwrite manual edits or a subsequently selected saved voice.

Reference mode fails closed if local installation cannot be verified, including unknown model selections and preflight errors. The loader rechecks the actual selected engine and every fallback immediately before loading, bypassing stale positive cache entries.
