# Mongolian transcription build (`mongolian-asr` branch)

This fork adds Mongolian speech-to-text to Meetily using
[`bayartsogt/whisper-large-v2-mn-13`](https://huggingface.co/bayartsogt/whisper-large-v2-mn-13)
(a Whisper large-v2 fine-tune, ~20 WER / 6.6 CER on Common Voice Mongolian),
converted to whisper.cpp GGML format and run fully locally through Meetily's
existing whisper-rs engine.

## What changed (all additive)

| Area | File | Change |
|---|---|---|
| Model catalog | `frontend/src-tauri/src/config.rs` | Added `mn-large-v2-q5_0` (recommended) and `mn-large-v2-f16` entries to `WHISPER_MODEL_CATALOG`; `DEFAULT_WHISPER_MODEL` → `mn-large-v2-q5_0` |
| Provider default | `frontend/src-tauri/src/config.rs` | New `DEFAULT_TRANSCRIPTION_PROVIDER = "localWhisper"` + `default_provider_and_model()`; all "no config yet" fallbacks (`audio/transcription/engine.rs`, `api/api.rs`) now use it instead of hardcoded Parakeet (Parakeet is English-only) |
| Language default | `frontend/src-tauri/src/config.rs`, `lib.rs` | New `DEFAULT_TRANSCRIPTION_LANGUAGE = "mn"`; the global language preference defaults to it instead of `auto-translate` (which would translate Mongolian meetings into English). Still user-configurable in the UI. |
| Download UX | `frontend/src-tauri/src/whisper_engine/whisper_engine.rs` | The two MN models have no hosted GGML; clicking Download shows a message pointing here instead of "Unsupported model" |
| Import/Retranscribe language list | `frontend/src/constants/languages.ts` | Added Mongolian (`mn`) — the truncated list used by the Import & Retranscribe dialogs was missing it (the live-recording `LanguageSelection.tsx` already had it) |
| Frontend defaults | `frontend/src/constants/modelDefaults.ts`, `frontend/src/contexts/ConfigContext.tsx` | Default provider `localWhisper`, default model `mn-large-v2-q5_0`, default language `mn` (localStorage/DB-saved settings always win) |
| DB seeding | `frontend/src-tauri/src/database/commands.rs`, `onboarding.rs` | Fresh-install and onboarding-completion both hardcoded a `parakeet` row into `transcript_settings`, silently overriding every code-level default — now they use `default_provider_and_model()`. If you ran an unfixed build once, delete the row (`DELETE FROM transcript_settings;` in `meeting_minutes.sqlite`) or just pick the model in Settings. |
| Onboarding download gate | `frontend/src/components/onboarding/steps/DownloadProgressStep.tsx` | Onboarding force-downloaded Parakeet (~670 MB) and blocked Continue on it. When the build's default provider is local Whisper, the step now just verifies the default Whisper model file is installed (instant) and never starts the Parakeet download. The summary-model download still runs (needed for local AI summaries) but continues in the background. |
| Recording readiness gate | `frontend/src/hooks/useRecordingStart.ts` | Start-recording always checked *Parakeet* readiness regardless of provider, so live capture refused to start on machines without Parakeet. Now checks the configured provider (Whisper model availability for `localWhisper`; cloud providers skip local checks). |
| Pipeline test | `frontend/src-tauri/tests/mongolian_import_pipeline.rs` | Integration test driving the same decode → VAD → per-segment Whisper path as Import & Enhance |
| Conversion script | `scripts/convert_mongolian_model.sh` | Reproducible HF → GGML f16 → Q5_0 pipeline |

Auto-detect (`auto`) is deliberately **not** the default: Whisper language
auto-detection misfires badly on low-resource languages. `mn` is pinned as the
default but remains a normal dropdown selection everywhere.

## Getting the model files

Meetily cannot download these (no hosted GGML). Produce them locally:

```sh
./scripts/convert_mongolian_model.sh /path/to/workdir
cp /path/to/workdir/ggml-mn-large-v2-*.bin \
   "$HOME/Library/Application Support/com.meetily.ai/models/"
```

The models directory is `app_data_dir()/models` — on macOS
`~/Library/Application Support/com.meetily.ai/models/` (both in dev and
production; the older `frontend/models/` convention in CLAUDE.md no longer
applies — `lib.rs` sets the app-data path unconditionally on startup).

## Build notes (macOS, Apple Silicon)

- Prereqs: Xcode CLT, Rust, pnpm, cmake. Metal GPU acceleration is enabled
  automatically on macOS (`platform-default` cargo feature).
- `pnpm install --frozen-lockfile` fails: the upstream lockfile is out of sync
  with `package.json`. Use `pnpm install --no-frozen-lockfile`.
- whisper.cpp's quantize tool target is named `whisper-quantize` (not
  `quantize` as older docs say).
- Dev run: `cd frontend && ./clean_run.sh` (or `pnpm run tauri:dev`).
- Production build: `cd frontend && ./clean_build.sh` (or `pnpm run tauri:build`).
- The `llama-helper` sidecar must exist before any cargo build:
  `cd llama-helper && cargo build --release --features metal`, then copy
  `target/release/llama-helper` to
  `frontend/src-tauri/binaries/llama-helper-aarch64-apple-darwin`
  (`frontend/build-gpu.sh` automates this).
- `tauri build` produces and signs `meetily.app` fine, but the final DMG step
  (`bundle_dmg.sh`) fails when run from a non-GUI shell (it drives Finder via
  AppleScript). The .app in `target/release/bundle/macos/` is fully usable;
  run the build from a normal terminal if you need the DMG.
- CoreML builds are safe for the MN models: whisper-rs sets
  `WHISPER_COREML_ALLOW_FALLBACK`, so without a CoreML encoder
  (`*-encoder.mlmodelc`) they just run on Metal.

## Measured performance (Apple M2 Max, 64 GB RAM, Metal)

Validation audio: 40.2 s of Common Voice Mongolian (8 concatenated sentences,
reference transcripts in `references.tsv` next to the test clips).

| Metric | `mn-large-v2-q5_0` | `mn-large-v2-f16` |
|---|---|---|
| File size | 1.0 GB | 3.1 GB |
| whisper-cli, 40.2 s clip | 9.0 s (~4.5× real-time) | 9.3 s (~4.3× real-time) |
| In-app pipeline test (decode+VAD+transcribe) | 8.6 s (~4.7× real-time) | — |
| Model load time | 0.35–0.6 s | ~1 s |
| Peak RSS (whole test process) | ~5.3 GB | — |
| Transcript quality | Several sentences verbatim vs reference; errors consistent with ~20 WER | Near-identical output to q5_0 |

Interpretation: large-v2 q5_0 is comfortably faster than real-time on Apple
Silicon with Metal, so both live capture and batch import are fine on this
hardware — no need for the smaller `Cafet/whisper-meduim-mongolian` fallback.
On weaker laptops (Intel/no GPU) expect ~10× slower; revisit the medium
fine-tune there. f16 and q5_0 produced near-identical transcripts on the test
set — use q5_0 day-to-day.

## Test procedure

### Launch (dev)
```sh
cd frontend
pnpm install                # once ('--frozen-lockfile' also works after the lockfile fix)
pnpm run tauri:dev          # auto-detects CoreML/Metal; first compile takes ~10 min
```
Production bundle: `pnpm run tauri:build` → `frontend/src-tauri/target/release/bundle/`
(`macos/meetily.app`, `dmg/meetily_*.dmg`).

### One-time setup
1. Make sure the converted models are installed:
   `ls "$HOME/Library/Application Support/com.meetily.ai/models/"` should list
   `ggml-mn-large-v2-q5_0.bin` (and optionally the f16). If not, run
   `scripts/convert_mongolian_model.sh` and copy them there.
2. First launch runs onboarding (it downloads Parakeet + a summary model —
   unrelated to Mongolian STT; you can let it finish or skip).
3. Settings → **Transcription Model Settings**: provider **Local Whisper** →
   select **mn-large-v2-q5_0**. (Fresh installs already default to it; this
   step matters only if you previously saved another provider/model.)
4. Settings → **Language Settings**: verify **Mongolian (mn)** is selected
   (default in this build). Do not use Auto Detect for Mongolian.

### Import an existing meeting recording
1. Home → **Import audio** (or drag a file in). Accepted: mp3, wav, m4a, mp4,
   flac, ogg, aac, mkv, webm, wma.
2. In the dialog: language **Mongolian**, model **mn-large-v2-q5_0** (both
   pre-selected in this build), set a title → Start import.
3. Progress runs decode → VAD → per-segment transcription; when done the app
   opens the meeting with the transcript. Expect ~1 min of processing per
   ~4–5 min of speech.
4. Quick smoke test: import `../mn-test-audio/mn_combined_48k.wav` (kept next
   to this repo) and compare against `../mn-test-audio/references.tsv`.

### Live capture during a Teams call
1. Meetily captures the mic directly; for the Teams (system) side install
   BlackHole (`brew install blackhole-2ch`) and configure a Multi-Output
   Device (System Settings → Sound) so Teams audio reaches both your ears and
   BlackHole — see BLUETOOTH_PLAYBACK_NOTICE.md and docs/ for the upstream
   guidance.
2. Grant microphone + screen-recording permissions when prompted (both are
   required for system-audio capture on macOS).
3. Pick mic + system devices in the device selector, start recording during
   the call; Mongolian text should stream into the transcript panel a few
   seconds behind speech.
4. Existing English/stock-model workflows are untouched: switch language to
   English or Auto and pick any stock model to go back.

### Re-transcribe an old meeting ("Enhance")
Open a meeting → Retranscribe → language **Mongolian**, model
**mn-large-v2-q5_0** → run. Same engine path as import.

### Automated pipeline test (CI-able)
```sh
cd frontend/src-tauri
MEETILY_TEST_AUDIO=../../../mn-test-audio/mn_combined_48k.wav \
MEETILY_TEST_MODELS_DIR="$HOME/Library/Application Support/com.meetily.ai/models" \
cargo test --release --test mongolian_import_pipeline -- --ignored --nocapture
```


## Where the summarization prompts live (for Mongolian summaries later)

- Prompt construction (Rust): `frontend/src-tauri/src/summary/processor.rs` —
  `english_normalization_system_prompt` (line ~49), `translation_system_prompt`
  (~124), `build_chunk_summary_user_prompt` (~137),
  `build_combine_summary_user_prompt` (~143),
  `build_final_report_system_prompt` (~149), plus inline system prompts around
  lines 388/453/482.
- Meeting-type templates (JSON, embedded at compile time):
  `frontend/src-tauri/templates/*.json`, loaded via
  `frontend/src-tauri/src/summary/templates/defaults.rs`.
- Watch out: `english_normalization_system_prompt` implies an English-centric
  normalization pass — revisit when adding Mongolian summaries via Claude.
- Summary language UI already exists: `frontend/src/lib/summary-languages.ts` /
  `LanguagePickerPopover.tsx` (per-meeting summary language pinning).

## Future ASR provider abstraction

The codebase already routes by a `provider` string (`localWhisper`, `parakeet`,
plus cloud stubs `deepgram`/`elevenLabs`/`groq`/`openai`) persisted in the
`transcript_settings` SQLite table, and dispatches via `TranscriptionEngine`
enum (`frontend/src-tauri/src/audio/transcription/engine.rs`) for live capture
and `use_parakeet` branches in `audio/import.rs` / `audio/retranscription.rs`.
A Chimege/ElevenLabs/own-model provider would slot in as: new provider string →
new `TranscriptionEngine` variant → new arm in those dispatch sites. Nothing in
this branch hardcodes Mongolian into that routing; it only changes defaults and
adds catalog entries.
