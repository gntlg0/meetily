'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { StatusPill } from '@/components/StatusPill';
import type { CallListItem } from '@/lib/dto';
import { formatDuration } from '@/lib/duration.client';

const POLL_MS = 3000;

export function CallsTable() {
  const [calls, setCalls] = useState<CallListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch('/api/calls', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET /api/calls -> ${res.status}`);
        const json = (await res.json()) as { calls: CallListItem[] };
        if (!cancelled) {
          setCalls(json.calls);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!calls) return <p className="muted">Loading…</p>;
  if (calls.length === 0) return <p className="muted">No calls yet. Upload one above.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>File</th>
          <th>Uploaded</th>
          <th>Duration</th>
          <th>Status</th>
          <th>Providers</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {calls.map((c) => (
          <tr key={c.id}>
            <td>
              <Link href={`/calls/${c.id}`}>{c.filename}</Link>
            </td>
            <td className="muted">{new Date(c.createdAt).toLocaleString()}</td>
            <td>{formatDuration(c.durationMs)}</td>
            <td>
              <StatusPill status={c.status} />
              {c.status === 'failed' && c.error && (
                <div className="error" style={{ fontSize: '0.75rem' }}>
                  {c.error.slice(0, 120)}
                </div>
              )}
            </td>
            <td>
              {c.providers.length > 0 ? c.providers.join(', ') : <span className="muted">—</span>}
            </td>
            <td className="muted">{c.note ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
