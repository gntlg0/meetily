export type LanguageMode = 'mn' | 'en' | 'mixed';

export type ProviderName = 'scribe' | 'chimege' | 'custom';

export const PROVIDERS: ProviderName[] = ['scribe', 'chimege', 'custom'];

/** Pipeline status for a call as a whole. `done` and `failed` are terminal. */
export type CallStatus =
  | 'pending'
  | 'transcribing'
  | 'summarizing'
  | 'done'
  | 'failed';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Segment {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscribeOptions {
  language: LanguageMode;
  numSpeakers: number;
}

export interface TranscribeResult {
  provider: ProviderName;
  model?: string;
  segments: Segment[];
  /** Provider-native payload, kept verbatim so we can re-parse without re-billing. */
  raw?: unknown;
  durationMs?: number;
}

export interface Provider {
  name: ProviderName;
  transcribe(filePath: string, opts: TranscribeOptions): Promise<TranscribeResult>;
}

/** Thrown by providers that exist as a seam but have no implementation yet. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export interface CallRow {
  id: string;
  filename: string;
  stored_path: string;
  mime: string;
  size_bytes: number;
  duration_ms: number | null;
  language_mode: LanguageMode;
  num_speakers: number;
  note: string | null;
  status: CallStatus;
  error: string | null;
  retryable: 0 | 1;
  created_at: string;
}

export interface TranscriptionRow {
  id: string;
  call_id: string;
  provider: ProviderName;
  model: string | null;
  status: JobStatus;
  error: string | null;
  raw_json: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SegmentRow {
  id: number;
  transcription_id: string;
  idx: number;
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface SummaryRow {
  id: string;
  call_id: string;
  transcription_id: string;
  markdown: string | null;
  model: string;
  status: JobStatus;
  error: string | null;
  created_at: string;
}
