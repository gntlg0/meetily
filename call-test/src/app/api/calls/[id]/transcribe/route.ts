import { NextResponse } from 'next/server';

import { BusyError, kickTranscribe } from '@/lib/pipeline';
import { isProviderName } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Re-transcribe the same audio with another provider, as an ADDITIONAL attempt. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let provider: unknown;
  try {
    ({ provider } = (await req.json()) as { provider?: unknown });
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  if (typeof provider !== 'string' || !isProviderName(provider)) {
    return NextResponse.json({ error: `Unknown provider: ${String(provider)}` }, { status: 400 });
  }

  try {
    const transcriptionId = kickTranscribe(id, provider, { thenSummarize: false });
    return NextResponse.json({ transcriptionId }, { status: 202 });
  } catch (e) {
    if (e instanceof BusyError) return NextResponse.json({ error: e.message }, { status: 409 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
