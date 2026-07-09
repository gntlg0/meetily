import 'server-only';

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { AUDIO_DIR } from '@/lib/db';
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES } from '@/lib/storage.client';

export { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES };

export class UploadError extends Error {}

/**
 * Browsers report wildly inconsistent MIME types for these (m4a in particular
 * often arrives as `audio/x-m4a`, `audio/mp4`, or ``), so we gate on extension.
 */
export function assertAllowedExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new UploadError(
      `Unsupported file type "${ext || '(none)'}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
    );
  }
  return ext;
}

/**
 * Writes the upload under data/audio/<uuid><ext>. The stored name is generated,
 * never derived from user input, so a crafted filename cannot escape AUDIO_DIR.
 */
export async function saveUpload(file: File): Promise<{ storedPath: string; sizeBytes: number }> {
  const ext = assertAllowedExtension(file.name);

  if (file.size <= 0) throw new UploadError('File is empty.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }

  await fs.mkdir(AUDIO_DIR, { recursive: true });
  const storedPath = path.join(AUDIO_DIR, `${randomUUID()}${ext}`);
  await fs.writeFile(storedPath, Buffer.from(await file.arrayBuffer()));

  return { storedPath, sizeBytes: file.size };
}

/** Defense in depth for the audio route: never serve a path outside AUDIO_DIR. */
export function assertInsideAudioDir(storedPath: string): void {
  const resolved = path.resolve(storedPath);
  const root = path.resolve(AUDIO_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Refusing to serve a file outside the audio directory.');
  }
}
