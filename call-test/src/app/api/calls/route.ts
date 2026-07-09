import { NextResponse } from 'next/server';

import type { CallListItem } from '@/lib/dto';
import { probeDurationMs } from '@/lib/duration';
import { LANGUAGE_MODES } from '@/lib/language';
import { kickTranscribe } from '@/lib/pipeline';
import * as repo from '@/lib/repo';
import { MAX_UPLOAD_BYTES, UploadError, saveUpload } from '@/lib/storage';
import type { LanguageMode } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const items: CallListItem[] = repo.listCalls().map((c) => ({
    id: c.id,
    filename: c.filename,
    createdAt: c.created_at,
    durationMs: c.duration_ms,
    status: c.status,
    providers: repo.doneProviders(c.id),
    note: c.note,
    error: c.error,
    retryable: c.retryable === 1,
  }));
  return NextResponse.json({ calls: items });
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing "file".' }, { status: 400 });
    }

    const rawMode = String(form.get('languageMode') ?? 'mn');
    if (!LANGUAGE_MODES.includes(rawMode as LanguageMode)) {
      return NextResponse.json({ error: `Bad languageMode: ${rawMode}` }, { status: 400 });
    }
    const languageMode = rawMode as LanguageMode;

    const numSpeakers = Number.parseInt(String(form.get('numSpeakers') ?? '2'), 10);
    if (!Number.isInteger(numSpeakers) || numSpeakers < 1 || numSpeakers > 32) {
      return NextResponse.json({ error: 'numSpeakers must be 1-32.' }, { status: 400 });
    }

    const noteRaw = String(form.get('note') ?? '').trim();
    const note = noteRaw.length > 0 ? noteRaw.slice(0, 500) : null;

    const { storedPath, sizeBytes } = await saveUpload(file);
    const durationMs = await probeDurationMs(storedPath);

    const call = repo.insertCall({
      filename: file.name,
      storedPath,
      mime: file.type || 'application/octet-stream',
      sizeBytes,
      durationMs,
      languageMode,
      numSpeakers,
      note,
    });

    // Returns immediately; the worker runs in the background and the UI polls.
    kickTranscribe(call.id, 'scribe', { thenSummarize: true });

    return NextResponse.json({ id: call.id }, { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    // Body-size overruns surface here as a stream error, not an UploadError.
    const status = /body|size|large/i.test(msg) ? 413 : 500;
    console.error('[call-test] upload failed:', e);
    return NextResponse.json(
      { error: status === 413 ? `Upload exceeds ${MAX_UPLOAD_BYTES} bytes.` : msg },
      { status },
    );
  }
}
