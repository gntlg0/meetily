import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import * as repo from '@/lib/repo';
import { assertInsideAudioDir } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_BY_EXT: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.caf': 'audio/x-caf',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.amr': 'audio/amr',
  '.3gp': 'audio/3gpp',
};

const toWeb = (stream: Readable) =>
  Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;

/**
 * Serves the original upload with byte-range support, so the <audio> element can
 * seek — essential when you're scrubbing to check a mistranscribed word.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const call = repo.getCall(id);
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  assertInsideAudioDir(call.stored_path);

  let size: number;
  try {
    size = (await fs.stat(call.stored_path)).size;
  } catch {
    return NextResponse.json({ error: 'Audio file is missing on disk.' }, { status: 410 });
  }

  const contentType =
    MIME_BY_EXT[path.extname(call.stored_path).toLowerCase()] ?? 'application/octet-stream';

  const range = req.headers.get('range');
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) {
    return new NextResponse(toWeb(createReadStream(call.stored_path)), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  }

  const [, rawStart, rawEnd] = match;
  let start = rawStart === '' ? NaN : Number(rawStart);
  let end = rawEnd === '' ? size - 1 : Number(rawEnd);

  if (Number.isNaN(start)) {
    // Suffix form: `bytes=-N` means the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  }

  if (!Number.isFinite(end) || end >= size) end = size - 1;

  if (start > end || start >= size) {
    return new NextResponse(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }

  return new NextResponse(toWeb(createReadStream(call.stored_path, { start, end })), {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}
