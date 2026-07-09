import type { CallStatus, JobStatus, LanguageMode, ProviderName, Segment } from '@/lib/types';

export interface CallListItem {
  id: string;
  filename: string;
  createdAt: string;
  durationMs: number | null;
  status: CallStatus;
  /** Providers with a completed transcript, in the order they finished. */
  providers: ProviderName[];
  note: string | null;
  error: string | null;
  retryable: boolean;
}

export interface TranscriptionDto {
  id: string;
  provider: ProviderName;
  model: string | null;
  status: JobStatus;
  error: string | null;
  createdAt: string;
  segments: Segment[];
}

export interface SummaryDto {
  id: string;
  transcriptionId: string;
  markdown: string | null;
  model: string;
  status: JobStatus;
  error: string | null;
}

export interface CallDetail {
  id: string;
  filename: string;
  createdAt: string;
  durationMs: number | null;
  languageMode: LanguageMode;
  numSpeakers: number;
  note: string | null;
  status: CallStatus;
  error: string | null;
  retryable: boolean;
  busy: boolean;
  transcriptions: TranscriptionDto[];
  summary: SummaryDto | null;
}
