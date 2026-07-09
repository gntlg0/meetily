import { NextResponse } from 'next/server';

import { BusyError, kickSummarize } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Re-summarize from a specific transcription (i.e. "from provider X"). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let transcriptionId: unknown;
  try {
    ({ transcriptionId } = (await req.json()) as { transcriptionId?: unknown });
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (typeof transcriptionId !== 'string' || !transcriptionId) {
    return NextResponse.json({ error: 'Missing "transcriptionId".' }, { status: 400 });
  }

  try {
    kickSummarize(id, transcriptionId);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (e) {
    if (e instanceof BusyError) return NextResponse.json({ error: e.message }, { status: 409 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
