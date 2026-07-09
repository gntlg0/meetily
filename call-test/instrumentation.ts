/**
 * Next.js runs `register()` exactly once, on server boot, before any request is
 * served. That is the correct place to recover jobs orphaned by a crash.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reapStaleJobsOnce } = await import('./src/lib/db');
  reapStaleJobsOnce();
}
