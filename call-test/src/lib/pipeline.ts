import 'server-only';

import { getProvider } from '@/lib/providers';
import * as repo from '@/lib/repo';
import { SUMMARY_MODEL, summarizeCall } from '@/lib/summarize';
import type { CallRow, ProviderName } from '@/lib/types';

/**
 * One in-flight job per call, tracked in-process. Two workers writing segments
 * for the same call would interleave status updates; the routes turn a hit here
 * into a 409 instead.
 *
 * This is process-local by design: the same guarantee after a crash comes from
 * `reapStaleJobs()` in db.ts, not from this Set.
 */
const globalRef = globalThis as unknown as { __callTestRunning?: Set<string> };
const running: Set<string> = (globalRef.__callTestRunning ??= new Set());

export const isRunning = (callId: string): boolean => running.has(callId);

export class BusyError extends Error {
  constructor(callId: string) {
    super(`Call ${callId} already has a job running.`);
    this.name = 'BusyError';
  }
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Fire-and-forget: the HTTP handler returns immediately, the UI polls status. */
function spawn(callId: string, job: () => Promise<void>): void {
  running.add(callId);
  void (async () => {
    try {
      await job();
    } catch (e) {
      console.error(`[call-test] call ${callId} failed:`, e);
      repo.failCall(callId, errText(e));
    } finally {
      running.delete(callId);
    }
  })();
}

async function transcribeStep(call: CallRow, transcriptionId: string): Promise<void> {
  repo.setCallStatus(call.id, 'transcribing');
  repo.setTranscriptionStatus(transcriptionId, 'running');

  const tr = repo.getTranscription(transcriptionId)!;
  const provider = getProvider(tr.provider);

  try {
    const result = await provider.transcribe(call.stored_path, {
      language: call.language_mode,
      numSpeakers: call.num_speakers,
    });

    if (result.segments.length === 0) {
      throw new Error(`${tr.provider} returned no speech segments.`);
    }

    repo.completeTranscription(transcriptionId, result.segments, result.model, result.raw);

    const durationMs =
      result.durationMs ?? result.segments[result.segments.length - 1]?.endMs ?? 0;
    if (durationMs > 0) repo.setCallDuration(call.id, durationMs);
  } catch (e) {
    repo.failTranscription(transcriptionId, errText(e));
    throw e;
  }
}

async function summarizeStep(call: CallRow, transcriptionId: string): Promise<void> {
  repo.setCallStatus(call.id, 'summarizing');
  const summary = repo.insertSummary(call.id, transcriptionId, SUMMARY_MODEL);

  try {
    const segments = repo.listSegments(transcriptionId);
    const { markdown, model } = await summarizeCall(segments, {
      language: call.language_mode,
      note: call.note,
    });
    repo.completeSummary(summary.id, markdown, model);
  } catch (e) {
    repo.failSummary(summary.id, errText(e));
    throw e;
  }
}

/**
 * Transcribe with `provider`, optionally summarizing afterwards.
 * Re-transcription (`thenSummarize: false`) leaves the existing summary alone —
 * it stays attached to the transcription it was built from.
 */
export function kickTranscribe(
  callId: string,
  provider: ProviderName,
  opts: { thenSummarize: boolean },
): string {
  if (isRunning(callId)) throw new BusyError(callId);
  const call = repo.getCall(callId);
  if (!call) throw new Error(`No such call: ${callId}`);

  const tr = repo.insertTranscription(callId, provider);

  spawn(callId, async () => {
    await transcribeStep(call, tr.id);
    if (opts.thenSummarize) await summarizeStep(call, tr.id);
    repo.setCallStatus(callId, 'done');
  });

  return tr.id;
}

export function kickSummarize(callId: string, transcriptionId: string): void {
  if (isRunning(callId)) throw new BusyError(callId);
  const call = repo.getCall(callId);
  if (!call) throw new Error(`No such call: ${callId}`);

  const tr = repo.getTranscription(transcriptionId);
  if (!tr || tr.call_id !== callId) throw new Error(`No such transcription: ${transcriptionId}`);
  if (tr.status !== 'done') throw new Error('Cannot summarize an unfinished transcription.');

  spawn(callId, async () => {
    await summarizeStep(call, transcriptionId);
    repo.setCallStatus(callId, 'done');
  });
}

/**
 * Resume a failed call. Picks up wherever it broke: if nothing transcribed
 * cleanly we re-run the last attempted provider, otherwise we only re-run the
 * summary. The audio file was never touched, so this works after a crash too.
 */
export function kickRetry(callId: string): void {
  if (isRunning(callId)) throw new BusyError(callId);
  const call = repo.getCall(callId);
  if (!call) throw new Error(`No such call: ${callId}`);

  const done = repo.firstDoneTranscription(callId);

  if (!done) {
    const attempts = repo.listTranscriptions(callId);
    const provider: ProviderName = attempts[attempts.length - 1]?.provider ?? 'scribe';
    kickTranscribe(callId, provider, { thenSummarize: true });
    return;
  }

  kickSummarize(callId, done.id);
}
