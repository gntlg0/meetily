import { NextResponse } from 'next/server';

import { BusyError, kickRetry } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    kickRetry(id);
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (e) {
    if (e instanceof BusyError) return NextResponse.json({ error: e.message }, { status: 409 });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
