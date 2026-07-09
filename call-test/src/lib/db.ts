import 'server-only';

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.join(process.cwd(), 'data');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const DB_PATH = path.join(DATA_DIR, 'call-test.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  stored_path   TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  duration_ms   INTEGER,
  language_mode TEXT NOT NULL,
  num_speakers  INTEGER NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL,
  error         TEXT,
  retryable     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcriptions (
  id           TEXT PRIMARY KEY,
  call_id      TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  model        TEXT,
  status       TEXT NOT NULL,
  error        TEXT,
  raw_json     TEXT,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_transcriptions_call ON transcriptions(call_id);

CREATE TABLE IF NOT EXISTS segments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  transcription_id  TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
  idx               INTEGER NOT NULL,
  speaker           TEXT NOT NULL,
  start_ms          INTEGER NOT NULL,
  end_ms            INTEGER NOT NULL,
  text              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_transcription ON segments(transcription_id, idx);

CREATE TABLE IF NOT EXISTS summaries (
  id               TEXT PRIMARY KEY,
  call_id          TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  transcription_id TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,
  markdown         TEXT,
  model            TEXT NOT NULL,
  status           TEXT NOT NULL,
  error            TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_summaries_call ON summaries(call_id, created_at);
`;

function open(): Database.Database {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const database = new Database(DB_PATH);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(SCHEMA);
  return database;
}

// Next.js re-evaluates modules across dev-mode hot reloads. Hang the handle off
// globalThis so we keep exactly one connection (and run the reaper exactly once)
// per process.
const globalRef = globalThis as unknown as {
  __callTestDb?: Database.Database;
  __callTestReaped?: boolean;
};

export const db: Database.Database = globalRef.__callTestDb ?? (globalRef.__callTestDb = open());

/**
 * Crash recovery. Any job still in a non-terminal state when this process starts
 * has no worker behind it — the process that owned it is gone. Mark it failed +
 * retryable rather than leaving it "transcribing" forever. The audio file on
 * disk is untouched, so Retry re-runs from the original upload.
 *
 * Safe to call more than once: it only ever touches in-flight rows.
 */
export function reapStaleJobs(): number {
  const REASON = 'Interrupted by server restart';

  const reap = db.transaction(() => {
    db.prepare(
      `UPDATE transcriptions SET status = 'failed', error = ?
        WHERE status IN ('pending', 'running')`,
    ).run(REASON);

    db.prepare(
      `UPDATE summaries SET status = 'failed', error = ?
        WHERE status IN ('pending', 'running')`,
    ).run(REASON);

    const res = db
      .prepare(
        `UPDATE calls SET status = 'failed', error = ?, retryable = 1
          WHERE status IN ('pending', 'transcribing', 'summarizing')`,
      )
      .run(REASON);

    return res.changes;
  });

  return reap();
}

export function reapStaleJobsOnce(): void {
  if (globalRef.__callTestReaped) return;
  globalRef.__callTestReaped = true;
  const n = reapStaleJobs();
  if (n > 0) {
    console.warn(`[call-test] Recovered ${n} stale call(s) after restart -> failed, retryable.`);
  }
}

// Reap on first import of this module.
//
// This deliberately does NOT use Next's `instrumentation.ts` register() hook:
// that file pulls better-sqlite3 into a bundle where `serverExternalPackages`
// does not apply, so `next dev` fails to resolve `fs`. It is also silently
// ignored if placed at the project root when a src/ dir exists — a mis-placed
// file would disable crash recovery with no error at all.
//
// Importing this module is a strictly stronger trigger anyway: jobs are only
// ever started from a route handler, and every route handler reaches the DB
// through here. Module init runs before any handler body, so even the very
// first `GET /api/calls` observes already-reaped state. The globalThis guard
// makes it exactly once per process, before any worker can exist.
reapStaleJobsOnce();
