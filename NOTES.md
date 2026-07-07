# API-only build — what was removed and where things stand

This fork is **API-only**: cloud ASR for transcription, cloud LLM APIs
(Anthropic by default) for summaries. No local Whisper, no Parakeet, no
Ollama, no bundled llama.cpp. The removal was done in three layers, one
commit each, on the `api-only` branch.

## Current state (read this first)

- **Recording, import, meeting list, transcript/summary display, and API-key
  settings all work.** Audio capture and file import run end-to-end up to the
  transcription call.
- **Transcription is live.** Every transcription call site (live capture,
  import, retranscription) routes through `ApiTranscriptionProvider` in
  `frontend/src-tauri/src/audio/transcription/api_provider.rs`, which
  dispatches on the provider saved in `transcript_settings`:
  **openai** (gpt-4o-transcribe / whisper-1), **groq** (whisper-large-v3),
  **elevenLabs** (scribe_v1), **deepgram** (nova-2). Audio is uploaded as
  16 kHz 16-bit WAV; the language preference is passed as a hint (with a
  prompt-hint fallback for models that reject rare ISO codes — e.g.
  gpt-4o-transcribe does not accept `mn` as a language code). If the selected
  provider has no API key saved, recording/import fails fast with a clear
  message. Verified end-to-end against the OpenAI API with Mongolian audio
  (`tests/cloud_transcription.rs`, env-driven, ignored by default since it
  makes a paid call). A Chimege provider would be one more dispatch arm here.
- **Summaries work** once an Anthropic API key is set (onboarding step 2 or
  Settings). Groq/OpenAI/OpenRouter/custom OpenAI-compatible endpoints also
  remain available.
- Defaults live in `frontend/src-tauri/src/config.rs` and
  `frontend/src/constants/modelDefaults.ts`: transcription
  `elevenLabs`/`scribe_v1`, summaries `claude`/`claude-sonnet-4-5-20250929`,
  language `mn`. The active provider is whatever is saved in Settings →
  Transcription.

## Removed — UI/onboarding (commit "refactor(ui): …")

- Onboarding steps for model downloads (SetupOverview + DownloadProgress) and
  all Parakeet/summary-model download logic in `OnboardingContext`. Onboarding
  is now Welcome → **API Keys** (new `ApiKeysStep`) → Permissions (macOS).
- Model-management UI: `WhisperModelManager`, `ParakeetModelManager`,
  `BuiltInModelManager`, Ollama endpoint/model UI in `ModelSettingsModal`,
  `OllamaDownloadContext`, download-progress toasts, `useTranscriptionModels`.
- Provider options `localWhisper`/`parakeet` (transcription) and
  `ollama`/`builtin-ai` (summaries) across settings, dialogs, and types.
- API wrappers `lib/whisper.ts`, `lib/parakeet.ts`, `lib/builtin-ai.ts`,
  `lib/onboarding-summary-model.ts`.
- Local-model readiness gates in `useRecordingStart` and summary generation.

## Removed — Rust core (commit "refactor(rust): …")

- `whisper_engine/` (whisper-rs/whisper.cpp), `parakeet_engine/` (ONNX/ort),
  `ollama/`, `summary/summary_engine/` (llama-helper sidecar: process
  management, GGUF model manager, qwen/gemma catalogs) — and the ~50 Tauri
  commands they registered (`whisper_*`, `parakeet_*`, `*_ollama_*`,
  `builtin_ai_*`, parallel-processor commands).
- `TranscriptionEngine` reduced to a single trait-based `Provider` variant;
  `WhisperProvider`/`ParakeetProvider` deleted; live capture, import, and
  retranscription all call `transcribe_via_api`.
- Summary `LLMProvider::{Ollama, BuiltInAI}` variants and dispatch; the
  Ollama metadata cache; sidecar startup/shutdown hooks.
- Local model catalogs/defaults in `config.rs` (`WHISPER_MODEL_CATALOG`,
  Mongolian fine-tune entries, Parakeet default).
- Dead legacy files (`lib_old_complex.rs`, `audio/stt.rs`, `audio/*-old.rs`).
- **Migration:** on startup (and on legacy-DB import), provider rows in
  existing databases referencing removed providers are rewritten to the API
  defaults (`database/commands.rs::migrate_legacy_local_providers`). Legacy
  provider strings in the API-key store are handled gracefully.

## Removed — build system / CI (commit "build: …")

- Cargo: whisper-rs (all platforms), ort, GPU feature flags
  (metal/coreml/cuda/vulkan/hipblas/openblas/openmp); `llama-helper/` crate,
  workspace member, and committed sidecar binary; GPU detection in build.rs.
- Scripts: `build-gpu.*`, `dev-gpu.*`, `scripts/tauri-auto.js`,
  `scripts/auto-detect-gpu.js`, GPU package.json script variants,
  `scripts/convert_mongolian_model.sh` (Mongolian GGML conversion pipeline).
- `backend/` — the entire archived Python/FastAPI + whisper-server stack.
- Tauri config: llama-helper externalBin; Ollama/whisper-server CSP entries.
- CI: llama-helper build steps, whisper GPU feature selection, Vulkan SDK
  installs, OpenBLAS packages, `ACCELERATION_GUIDE.md`. FFmpeg bundling stays
  (audio decode for import).

## Kept intact

Audio capture/mixing/VAD pipeline (silero VAD still segments speech — useful
to send only speech to a metered cloud ASR), recording saver, meeting
list/DB, transcript & summary display, Import & Enhance flow (up to the
transcription call), API-key settings, FFmpeg sidecar, summary prompt
templates (`frontend/src-tauri/src/summary/processor.rs`,
`frontend/src-tauri/templates/*.json`).

## Notes for the cloud ASR implementation (next step)

1. Implement `TranscriptionProvider` for the chosen API next to
   `api_provider.rs`; construct it in
   `audio/transcription/engine.rs::get_or_init_transcription_engine` based on
   the saved provider string.
2. Batch paths (`audio/import.rs`, `audio/retranscription.rs`) call the free
   function `transcribe_via_api(samples, language)` — route it to the same
   provider (or refactor them to use the engine).
3. API keys are already saved per provider in `transcript_settings`
   (`deepgramApiKey`/`elevenLabsApiKey`/`groqApiKey`/`openaiApiKey` columns);
   fetch via `SettingsRepository::get_transcript_api_key`.
4. Audio arrives as 16 kHz mono f32 — most cloud ASR APIs want WAV/FLAC or
   16-bit PCM; encode before upload (see `audio/encode.rs`).
5. The language preference (default `mn`) is plumbed through every call site —
   pass it to the provider (Chimege is Mongolian-only; ElevenLabs Scribe takes
   a language hint).
