import { NextResponse } from 'next/server';

import type { CallDetail } from '@/lib/dto';
import { isRunning } from '@/lib/pipeline';
import * as repo from '@/lib/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const call = repo.getCall(id);
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const summary = repo.latestSummary(id);

  const detail: CallDetail = {
    id: call.id,
    filename: call.filename,
    createdAt: call.created_at,
    durationMs: call.duration_ms,
    languageMode: call.language_mode,
    numSpeakers: call.num_speakers,
    note: call.note,
    status: call.status,
    error: call.error,
    retryable: call.retryable === 1,
    busy: isRunning(id),
    transcriptions: repo.listTranscriptions(id).map((t) => ({
      id: t.id,
      provider: t.provider,
      model: t.model,
      status: t.status,
      error: t.error,
      createdAt: t.created_at,
      segments: t.status === 'done' ? repo.listSegments(t.id) : [],
    })),
    summary: summary
      ? {
          id: summary.id,
          transcriptionId: summary.transcription_id,
          markdown: summary.markdown,
          model: summary.model,
          status: summary.status,
          error: summary.error,
        }
      : null,
  };

  return NextResponse.json(detail);
}
