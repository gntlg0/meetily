import 'server-only';

import { randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import type {
  CallRow,
  CallStatus,
  JobStatus,
  LanguageMode,
  ProviderName,
  Segment,
  SegmentRow,
  SummaryRow,
  TranscriptionRow,
} from '@/lib/types';

const now = () => new Date().toISOString();

/* ------------------------------- calls ---------------------------------- */

export function insertCall(input: {
  filename: string;
  storedPath: string;
  mime: string;
  sizeBytes: number;
  durationMs: number | null;
  languageMode: LanguageMode;
  numSpeakers: number;
  note: string | null;
}): CallRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO calls (id, filename, stored_path, mime, size_bytes, duration_ms,
                        language_mode, num_speakers, note, status, retryable, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
  ).run(
    id,
    input.filename,
    input.storedPath,
    input.mime,
    input.sizeBytes,
    input.durationMs,
    input.languageMode,
    input.numSpeakers,
    input.note,
    now(),
  );
  return getCall(id)!;
}

export function getCall(id: string): CallRow | undefined {
  return db.prepare('SELECT * FROM calls WHERE id = ?').get(id) as CallRow | undefined;
}

export function listCalls(): CallRow[] {
  return db.prepare('SELECT * FROM calls ORDER BY created_at DESC').all() as CallRow[];
}

export function setCallStatus(id: string, status: CallStatus): void {
  db.prepare('UPDATE calls SET status = ?, error = NULL, retryable = 0 WHERE id = ?').run(
    status,
    id,
  );
}

export function failCall(id: string, error: string): void {
  db.prepare(
    "UPDATE calls SET status = 'failed', error = ?, retryable = 1 WHERE id = ?",
  ).run(error, id);
}

export function setCallDuration(id: string, durationMs: number): void {
  db.prepare('UPDATE calls SET duration_ms = ? WHERE id = ? AND duration_ms IS NULL').run(
    durationMs,
    id,
  );
}

/* ---------------------------- transcriptions ---------------------------- */

export function insertTranscription(callId: string, provider: ProviderName): TranscriptionRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO transcriptions (id, call_id, provider, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`,
  ).run(id, callId, provider, now());
  return getTranscription(id)!;
}

export function getTranscription(id: string): TranscriptionRow | undefined {
  return db.prepare('SELECT * FROM transcriptions WHERE id = ?').get(id) as
    | TranscriptionRow
    | undefined;
}

/** Oldest first — "the FIRST successful transcription" depends on this order. */
export function listTranscriptions(callId: string): TranscriptionRow[] {
  return db
    .prepare('SELECT * FROM transcriptions WHERE call_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(callId) as TranscriptionRow[];
}

export function firstDoneTranscription(callId: string): TranscriptionRow | undefined {
  return listTranscriptions(callId).find((t) => t.status === 'done');
}

export function setTranscriptionStatus(id: string, status: JobStatus): void {
  db.prepare('UPDATE transcriptions SET status = ? WHERE id = ?').run(status, id);
}

export function failTranscription(id: string, error: string): void {
  db.prepare("UPDATE transcriptions SET status = 'failed', error = ? WHERE id = ?").run(
    error,
    id,
  );
}

export function completeTranscription(
  id: string,
  segments: Segment[],
  model: string | undefined,
  raw: unknown,
): void {
  const insertSeg = db.prepare(
    `INSERT INTO segments (transcription_id, idx, speaker, start_ms, end_ms, text)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    db.prepare('DELETE FROM segments WHERE transcription_id = ?').run(id);
    segments.forEach((s, i) => {
      insertSeg.run(id, i, s.speaker, s.startMs, s.endMs, s.text);
    });
    db.prepare(
      `UPDATE transcriptions
          SET status = 'done', error = NULL, model = ?, raw_json = ?, completed_at = ?
        WHERE id = ?`,
    ).run(model ?? null, raw === undefined ? null : JSON.stringify(raw), now(), id);
  })();
}

/* ------------------------------ segments -------------------------------- */

export function listSegments(transcriptionId: string): Segment[] {
  const rows = db
    .prepare('SELECT * FROM segments WHERE transcription_id = ? ORDER BY idx ASC')
    .all(transcriptionId) as SegmentRow[];
  return rows.map((r) => ({
    speaker: r.speaker,
    startMs: r.start_ms,
    endMs: r.end_ms,
    text: r.text,
  }));
}

/* ------------------------------ summaries ------------------------------- */

export function insertSummary(
  callId: string,
  transcriptionId: string,
  model: string,
): SummaryRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO summaries (id, call_id, transcription_id, model, status, created_at)
     VALUES (?, ?, ?, ?, 'running', ?)`,
  ).run(id, callId, transcriptionId, model, now());
  return db.prepare('SELECT * FROM summaries WHERE id = ?').get(id) as SummaryRow;
}

export function completeSummary(id: string, markdown: string, model: string): void {
  db.prepare(
    "UPDATE summaries SET status = 'done', markdown = ?, model = ?, error = NULL WHERE id = ?",
  ).run(markdown, model, id);
}

export function failSummary(id: string, error: string): void {
  db.prepare("UPDATE summaries SET status = 'failed', error = ? WHERE id = ?").run(error, id);
}

/** Newest summary for the call, whatever its status. */
export function latestSummary(callId: string): SummaryRow | undefined {
  return db
    .prepare(
      'SELECT * FROM summaries WHERE call_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    )
    .get(callId) as SummaryRow | undefined;
}

/** Provider names that already have a completed transcript for this call. */
export function doneProviders(callId: string): ProviderName[] {
  return listTranscriptions(callId)
    .filter((t) => t.status === 'done')
    .map((t) => t.provider);
}
