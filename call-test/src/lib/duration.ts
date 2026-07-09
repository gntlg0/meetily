import 'server-only';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export { formatDuration, stamp } from '@/lib/duration.client';

/**
 * Best-effort audio duration via ffprobe. Returns null if ffprobe is missing or
 * the file is unreadable — duration is a nice-to-have column, never a blocker,
 * so this must not throw into the upload path.
 */
export async function probeDurationMs(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { timeout: 15_000 },
    );
    const secs = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(secs) || secs <= 0) return null;
    return Math.round(secs * 1000);
  } catch {
    return null;
  }
}
