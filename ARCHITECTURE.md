# Architecture — how this app actually works now

A handoff/reference for anyone (human or AI) picking up this codebase. This is
a **fork of Meetily** turned **API-only**: no local AI models. It records
meetings, transcribes them via a cloud speech-to-text API, stores everything in
a local SQLite DB, and generates Mongolian meeting-note summaries via the
Anthropic API. Branch: `api-only` (on the `gntlg0/meetily` fork).

For *what was removed* to get here, see `NOTES.md`. For build/setup, see
`docs/BUILDING.md`. This file is about *how the running system works*.

---

## 1. Tech stack

| Layer | Tech |
|---|---|
| Shell | **Tauri 2.x** desktop app (macOS/Windows/Linux), single binary |
| Backend | **Rust** crate `app_lib` (`frontend/src-tauri/src`) |
| Frontend | **Next.js 14** + React 18 + TypeScript + Tailwind (`frontend/src`), static-exported and served inside the Tauri webview |
| IPC | Tauri **commands** (frontend → Rust `invoke`) and **events** (Rust → frontend `emit`/`listen`) |
| DB | **SQLite** via `sqlx` — `~/Library/Application Support/com.meetily.ai/meeting_minutes.sqlite` (macOS) |
| Audio capture | `cpal` (mic), ScreenCaptureKit (macOS system audio) / WASAPI (Windows) |
| Audio decode (import) | `symphonia` + bundled **FFmpeg sidecar** (`binaries/ffmpeg`, for mkv/webm/wma) |
| VAD | `silero_rs` (Silero voice-activity detection) |
| Transcription | **Cloud ASR API** — OpenAI / Groq / ElevenLabs / Deepgram (HTTP, `reqwest`) |
| Summaries | **Cloud LLM API** — Anthropic (default), OpenAI, Groq, OpenRouter, custom OpenAI-compatible |

**No local inference.** whisper.cpp/whisper-rs, Parakeet/ONNX, Ollama, and the
llama.cpp `llama-helper` sidecar were all deleted. There are no GPU build
features; the build is a plain `cargo build` / `pnpm run tauri:build`.

---

## 2. Repo layout (the parts that matter)

```
frontend/
  src/                         # Next.js UI
    app/                       # pages: home (recording), meeting-details, settings
    components/                # SummaryPanel, TranscriptSettings, ModelSettingsModal, onboarding/…
    contexts/ConfigContext.tsx # global config (provider/model/language/devices)
    hooks/meeting-details/     # useSummaryGeneration, useTemplates, useModelConfiguration
    constants/                 # modelDefaults.ts, languages.ts  (mirror Rust config.rs)
  src-tauri/
    src/
      lib.rs                   # Tauri entry point, command registration, app state
      config.rs                # DEFAULT_* constants (transcription/summary provider, model, language)
      audio/
        recording_commands.rs  # start/stop recording Tauri commands
        pipeline.rs            # mic+system mixing + VAD (live path)
        decoder.rs             # file decode → 16 kHz mono f32 (import path)
        vad.rs                 # Silero VAD segmentation
        import.rs              # Import & Enhance: decode → VAD → transcribe → save
        retranscription.rs     # re-run transcription on an existing meeting
        transcription/
          provider.rs          # TranscriptionProvider trait + TranscriptResult/Error
          api_provider.rs      # ★ ApiTranscriptionProvider — the cloud ASR implementation
          engine.rs            # TranscriptionEngine::Provider + validate/init from saved config
          worker.rs            # live-capture worker: VAD chunks → provider.transcribe → emit events
      summary/
        service.rs             # orchestration, summary-language resolution, DB writes
        processor.rs           # ★ chunk→combine→final-report prompts + translation pass
        llm_client.rs          # ★ LLMProvider dispatch (Claude/OpenAI/Groq/OpenRouter/custom)
        templates/             # template loader + built-in registry (defaults.rs)
      database/                # sqlx repositories, migrations, provider-default seeding
      api/api.rs               # config get/save Tauri commands (transcript + model config)
      anthropic/ openai/ groq/ openrouter/   # "list models" commands per cloud provider
    templates/                 # *.json meeting-note templates (bundled as Tauri resources)
```

★ = the files you most likely need to touch.

---

## 3. End-to-end data flow

### A. Live recording
1. `start_recording` (Tauri command, `lib.rs` → `audio/recording_commands.rs`) opens
   mic + system-audio streams (`cpal` / ScreenCaptureKit).
2. `audio/pipeline.rs` mixes the two streams (RMS ducking) for the saved recording,
   and in parallel runs **Silero VAD** to cut speech segments.
3. `audio/transcription/worker.rs` takes each speech segment, gets the engine from
   `get_or_init_transcription_engine` (always a `TranscriptionEngine::Provider`
   wrapping `ApiTranscriptionProvider`), calls `provider.transcribe(samples, language)`,
   and `emit`s `transcript-update` events to the UI. Transcripts are persisted to the DB.

### B. Import & Enhance (batch — `audio/import.rs`)
1. Decode the file → 16 kHz mono f32 (`audio/decoder.rs`; `WHISPER_SAMPLE_RATE = 16000`,
   resampled from source; FFmpeg used for mkv/webm/wma).
2. Silero VAD → speech segments (long segments split at silence, ~25 s max).
3. Build `ApiTranscriptionProvider::from_saved_config(app)` **once**; if it has no API
   key, fail fast with a clear message.
4. For each segment: `provider.transcribe(samples, language)` → assemble segments with
   timestamps → write meeting + transcripts to the DB. Retranscription mirrors this.

### C. Summary (`summary/service.rs` + `processor.rs` + `llm_client.rs`)
Triggered from the meeting page (`useSummaryGeneration.ts` → `api_process_transcript`).
1. Resolve the **summary output language** (frontend `resolveSummaryLanguage`): per-meeting
   pin → global default → **`mn`** (Mongolian is the build default; no per-meeting picker UI).
2. Chunk the transcript (threshold ~100k tokens; ~40k-char chunks) → per-chunk summary →
   combine → **final templated report**, all produced in English first
   (`ENGLISH_BASE_SUMMARY_INSTRUCTION`).
3. If the target language ≠ English (i.e. Mongolian), run a **translation pass**
   (`translation_system_prompt`) that converts the English report to Mongolian while
   keeping English technical terms in English and using natural Mongolian style.
4. Save the summary to the DB and `emit` completion; the UI renders the Markdown.

---

## 4. Transcription subsystem (the cloud ASR detail)

**One class does it all:** `audio/transcription/api_provider.rs::ApiTranscriptionProvider`
implements the `TranscriptionProvider` trait. `from_saved_config` reads the active
provider/model/API key from the `transcript_settings` DB row. `transcribe`:

1. Encodes 16 kHz mono f32 → **16-bit PCM WAV** in memory (`to_wav_bytes`).
2. Maps the language preference to a hint (`"auto"`/empty → none; else the ISO code).
3. Dispatches on the provider string:
   - **openai** → `POST api.openai.com/v1/audio/transcriptions` (multipart; models
     `gpt-4o-transcribe`, `whisper-1`).
   - **groq** → `POST api.groq.com/openai/v1/audio/transcriptions` (`whisper-large-v3`).
   - **elevenLabs** → `POST api.elevenlabs.io/v1/speech-to-text` (`scribe_v1`/`scribe_v2`,
     `language_code` hint, `xi-api-key` header).
   - **deepgram** → `POST api.deepgram.com/v1/listen` (raw WAV body, returns confidence).

**Language-code quirk (OpenAI):** OpenAI's endpoint rejects `mn` as a `language`
value. The provider detects a `language`-param error in the JSON body, then retries
once hinting the language via the `prompt` field (written *in* the target language,
e.g. Mongolian, because Whisper-family models bias output toward the prompt's
language). The rejection is cached so long imports don't retry every segment.

**Current runtime config** (in the DB on this machine): `elevenLabs` / `scribe_v2`,
language `mn`. Defaults live in `config.rs` + `frontend/src/constants/modelDefaults.ts`.

**Known limitation:** the app sends **one request per VAD segment**. On short segments,
provider-side `auto` detection can misfire (Russian/Korean), which is why the language
is pinned to `mn`. The higher-accuracy design (send the whole file / large chunks to
Scribe in one request, like the ElevenLabs website) is not yet implemented.

---

## 5. Summary subsystem (the LLM detail)

- **`summary/llm_client.rs`** — `LLMProvider` enum (OpenAI, Claude, Groq, OpenRouter,
  CustomOpenAI). Claude → `POST api.anthropic.com/v1/messages` with `x-api-key` +
  `anthropic-version: 2023-06-01`. **`max_tokens` for Claude = 16384** (a full Mongolian
  note exceeds the old 2048 cap and got truncated). Response parsing tolerates
  non-text content blocks (reasoning models like `claude-sonnet-5` return a `thinking`
  block before the text block).
- **`summary/processor.rs`** — builds the prompts. `language_name_from_code` maps ISO
  codes to names used in prompts (**includes `mn` → Mongolian**; if a code is missing
  here it silently normalizes to English — this was the "summaries came out English" bug).
  `translation_system_prompt("Mongolian")` appends Mongolian style rules (keep English
  tech terms, natural connectors, natural past tense, no Google-Translate feel).
- **Templates** (`summary/templates/` + `frontend/src-tauri/templates/*.json`) — JSON with
  `name`, `description`, `sections[{title, instruction, format, item_format}]`. Rendered
  into the final-report prompt (`to_markdown_structure` + `to_section_instructions`).
  Built-ins registered in `templates/defaults.rs`. **Default template: `mongolian_meeting`**
  ("Хурлын тэмдэглэл") — header info table, discussion topics, decisions list, and a
  Даалгавар/хариуцагчид (№/Даалгавар/Хариуцагч/Хугацаа) task table. Default model:
  `claude-sonnet-5`.

---

## 6. Data model (SQLite, `meeting_minutes.sqlite`)

Key tables (see `frontend/src-tauri/migrations/*.sql`):
- `meetings`, `transcripts`, `transcript_chunks`, `meeting_notes` — meeting content.
- `transcript_settings` — **transcription** provider/model + per-provider API keys
  (`deepgramApiKey`, `elevenLabsApiKey`, `groqApiKey`, `openaiApiKey`, `whisperApiKey`).
- `settings` — **summary** model config (provider, model, whisperModel, ollamaEndpoint[legacy], API keys).
- `summary_processes` — async summary job tracking.

On startup and on legacy-DB import, `database/commands.rs::migrate_legacy_local_providers`
rewrites any removed-provider rows (localWhisper/parakeet/ollama/builtin-ai) to the
current cloud defaults, so old databases keep working.

---

## 7. Config & defaults (single source of truth)

Rust `frontend/src-tauri/src/config.rs` (mirrored in `frontend/src/constants/`):
- `DEFAULT_TRANSCRIPTION_PROVIDER = "elevenLabs"`, `DEFAULT_TRANSCRIPTION_MODEL = "scribe_v2"`
- `DEFAULT_TRANSCRIPTION_LANGUAGE = "mn"`
- `DEFAULT_SUMMARY_PROVIDER = "claude"`, `DEFAULT_SUMMARY_MODEL = "claude-sonnet-5"`

The DB row (set in Settings / onboarding) overrides these at runtime. Provider routing
is centralized in `config::default_provider_and_model()`.

**Onboarding** (`frontend/src/components/onboarding/`): Welcome → **API Keys** (Anthropic
key for summaries) → Permissions (macOS only). No model downloads.

---

## 8. Build & run

```bash
cd frontend
pnpm install
pnpm run tauri:dev      # dev
pnpm run tauri:build    # release → target/release/bundle/macos/meetily.app
```

No GPU flags, no sidecar builds (FFmpeg is auto-downloaded by `build.rs`). API keys are
entered in-app (onboarding or Settings), not env vars.

---

## 9. Where to change common things

| Task | Where |
|---|---|
| Add a cloud ASR provider (e.g. Chimege) | new arm in `audio/transcription/api_provider.rs::transcribe` (+ default in `config.rs`, provider option in `TranscriptSettings.tsx`) |
| Change the meeting-note format | edit `frontend/src-tauri/templates/mongolian_meeting.json` |
| Tune Mongolian summary style | `translation_system_prompt` in `summary/processor.rs` |
| Change summary/transcription defaults | `config.rs` + `frontend/src/constants/{modelDefaults,languages}.ts` |
| Add a summary LLM provider | `LLMProvider` in `summary/llm_client.rs` |
| Whole-file (not per-segment) transcription | `audio/import.rs` / `audio/retranscription.rs` + a batch method on the provider |

---

## 10. Known limitations / next steps

1. **Per-segment transcription** limits accuracy and context; whole-file upload to Scribe
   would lower WER and remove the language-misdetection workaround.
2. **Mongolian ASR quality** depends entirely on the provider. OpenAI is weak on Mongolian
   (rejects `mn`, drifts to other scripts); ElevenLabs Scribe supports `mn` natively and is
   the current best cloud option; **Chimege** (Mongolian-specialist) is the intended
   best-quality provider and is a ~1-arm addition.
3. **Summaries are only as complete as the transcript** — a partial/garbled transcript
   yields a thin summary regardless of template.
4. Summary generation summarizes in English then translates to Mongolian (two hops);
   a direct-Mongolian prompt could be tried later for nuance.
