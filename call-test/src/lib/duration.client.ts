/** Formatting helpers usable from both the browser and the server. */

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `[m:ss]` stamp used in the transcript and compare views. */
export function stamp(ms: number): string {
  return `[${formatDuration(ms)}]`;
}
