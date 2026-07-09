# Call Test

A deliberately small, local-only web app for one question:

> **Is cloud ASR good enough on real Mongolian phone-call audio?**

Drop in a call recording (carrier 3-way conference capture), get a speaker-labeled
Mongolian transcript and a loan-retention summary, listen while you read, and run the
same audio through a second provider to compare them side by side.

This is a **test bench, not a product**. No auth, no deployment, one laptop, `localhost`.
The transcription/summary logic is written to be lifted into "Meeting Hub" later —
that's why the provider seam and the prompt are clean; the UI is not.

---

## Setup

```bash
pnpm install
cp .env.local.example .env.local   # then fill in the keys
pnpm dev                           # http://localhost:3200
```

`pnpm install` compiles `better-sqlite3`'s native binding. pnpm 10 blocks build
scripts by default; this is pre-approved via `pnpm.onlyBuiltDependencies` in
`package.json`, so it just works.

**`.env.local`** (never committed; never exposed to the browser):

| Variable | Needed for | Notes |
|---|---|---|
| `ELEVENLABS_API_KEY` | `scribe` provider | Required to transcribe anything. |
| `ANTHROPIC_API_KEY` | summaries | Required for the summary step. |
| `CUSTOM_ASR_BASE_URL` | `custom` provider | Any OpenAI-compatible `/v1`. Optional. |
| `CUSTOM_ASR_API_KEY` | `custom` provider | Optional; sent as `Authorization: Bearer`. |
| `CUSTOM_ASR_MODEL` | `custom` provider | Defaults to `whisper-1`. |
| `CHIMEGE_TOKEN` | `chimege` provider | Unused until the provider is implemented. |
| `ELEVENLABS_BASE_URL` | tests only | Point Scribe at a local fake. Leave unset. |

`ffprobe` (from ffmpeg) is used to measure call duration. It's optional — without it the
duration column falls back to the last transcript segment's end time.

### Trying it without any API keys

```bash
pnpm mock-asr    # OpenAI-compatible ASR on http://127.0.0.1:3399/v1, canned Mongolian
```

Set `CUSTOM_ASR_BASE_URL=http://127.0.0.1:3399/v1`, upload a file (the Scribe step will
fail cleanly with "ELEVENLABS_API_KEY is not set"), then hit **Re-transcribe with custom**.

---

## Where things live

| What | Where |
|---|---|
| Uploaded audio | `data/audio/<uuid><ext>` — the original bytes, never re-encoded |
| SQLite database | `data/call-test.db` (WAL mode) |
| Both | `data/` — **gitignored**. Delete it to reset everything. |

Audio is served through `/api/calls/[id]/audio`, **not** from `public/`, so recordings
never enter the build output. That route supports byte ranges, so the player can seek.

Filenames on disk are generated UUIDs; the original name is only a DB column. A crafted
upload filename cannot escape `data/audio/`.

---

## How it works

```
upload ──▶ 201 immediately          (worker runs detached; the UI polls)
             │
             ├─▶ transcribe (scribe)  ──▶ segments
             └─▶ summarize (claude)   ──▶ markdown
```

**Statuses:** `pending → transcribing → summarizing → done`, or `failed`.

**Crash safety.** If the process dies mid-job, the audio file is untouched and the row
would otherwise be stuck at `transcribing` forever. On the first DB import in a fresh
process, `reapStaleJobs()` marks every in-flight job `failed` + retryable. **Retry**
then resumes from the original upload. (This is deliberately *not* in
`instrumentation.ts` — see the comment in `src/lib/db.ts`.)

**Re-transcribe** adds an *additional* transcription to the same call; it never replaces
the existing one or its summary. Once a call has 2+ completed transcriptions, the
**Compare** view opens.

**Summaries** are built from the first successful transcription. *Re-summarize from
provider X* rebuilds from that provider's transcript instead.

---

## Providers

The whole seam is one interface:

```ts
transcribe(filePath, { language, numSpeakers }) => {
  provider, model?, segments: [{ speaker, startMs, endMs, text }], raw?, durationMs?
}
```

| Provider | Status | What it does |
|---|---|---|
| `scribe` | ✅ | ElevenLabs Scribe v2, whole file, `diarize: true`, word-level timestamps. |
| `custom` | ✅ | OpenAI-compatible `/v1/audio/transcriptions`. No diarization assumed. |
| `chimege` | ❌ stub | Throws `NotImplementedError`. |

### Scribe: how diarization becomes speaker turns

ElevenLabs returns a flat `words[]` array, not turns. Each entry is a `word`, a `spacing`
(the whitespace between words), or an `audio_event` (`"(laughter)"`). Only `word` entries
carry a `speaker_id`, and **that id can be `null`** when diarization declines to guess.

`src/lib/scribe-grouping.ts` collapses that stream into turns:

- a new turn opens only when a **`word`** reports a different `speaker_id`;
- `spacing` never opens a turn (it would create an empty leading turn);
- `audio_event` attaches to the open turn and never switches speaker;
- `null` speaker ids bucket to `speaker_unknown` rather than silently merging into the
  previous speaker's turn — misattributed speech is worse than an unknown label.

It's a pure function with no runtime imports, precisely so it stays easy to test and to
port into Meeting Hub.

We send `tag_audio_events=false` (event tags are noise in a word-accuracy bake-off) and
leave `detect_speaker_roles` **off** — ElevenLabs can label `agent`/`customer` directly,
but we want Claude to infer the agent from content so summaries stay provider-neutral.

### Language modes

`language_code` accepts ISO-639-1 *or* ISO-639-3.

| Mode | Sent to Scribe | Why |
|---|---|---|
| `mn` (default) | `mon` | Force Mongolian. |
| `en` | `eng` | Force English; the summary is still written in Mongolian. |
| `mixed` | `mon` | A *hint*, not a filter. Leaving it null lets autodetect drift to English on English-heavy stretches; the hint biases Mongolian without suppressing English tokens. |

`mn` and `mixed` are identical at the ASR call. They differ downstream: `mixed` tells the
summary prompt to expect code-switching.

---

## Adding Chimege later

**One file: `src/lib/providers/chimege.ts`.**

Implement `transcribe` to return a `TranscribeResult`. Nothing else changes — the DB,
the call page, the compare view, and the provider dropdown already route through the
`Provider` interface, and `chimege` is already registered in
`src/lib/providers/index.ts`.

Notes left in that file:

- Chimege's long-audio endpoint wants **16 kHz mono PCM/WAV**; uploads are m4a/mp3, so
  transcode first (`ffmpeg -ac 1 -ar 16000 -f s16le`).
- Auth is a `Token: <CHIMEGE_TOKEN>` header, **not** `Authorization: Bearer`.
- No diarization? Emit one segment with `speaker: 'speaker_0'` — the compare view handles
  single-speaker columns.
- Timings are milliseconds; `startMs`/`endMs` are what the compare view aligns on.

Docs: <https://docs.api.chimege.com>

---

## The summary

Anthropic `claude-sonnet-4-6`, `max_tokens: 2000`. Non-text content blocks in the
response are filtered out rather than assumed away, so a `thinking` block can't crash it.

The prompt (`src/lib/prompts.ts`) is Mongolian and produces five fixed headings:

```
## Дуудлагын хураангуй   ## Харилцагчийн байдал   ## Амлалт
## Дараагийн алхам       ## Анхааруулга
```

Claude is given only `Яригч 1..N` and works out which speaker is the agent from content.
The headings are load-bearing — summaries are compared across ASR providers, so the shape
must not drift.

---

## Compare view

Transcripts are aligned on a shared timeline (`src/lib/align.ts`): each pass anchors on
the earliest unconsumed segment and pulls in any column whose next segment *overlaps* that
anchor's span. A blank cell means "no speech overlapping that moment", **not** "missed
words". Below the timeline there's a plain full-text side-by-side, which is the honest
fallback when a provider returns no timings at all.

---

## Non-goals

No auth, users, permissions, deployment, folder watching, Teams integration,
phone-number metadata, retention jobs, or design polish. On purpose.
