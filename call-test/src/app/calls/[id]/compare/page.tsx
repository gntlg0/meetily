import Link from 'next/link';
import { notFound } from 'next/navigation';

import { alignByTime } from '@/lib/align';
import { stamp } from '@/lib/duration.client';
import * as repo from '@/lib/repo';
import { speakerLabel, speakerLabelMap } from '@/lib/speakers';

export const dynamic = 'force-dynamic';

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const call = repo.getCall(id);
  if (!call) notFound();

  const columns = repo
    .listTranscriptions(id)
    .filter((t) => t.status === 'done')
    .map((t) => ({ ...t, segments: repo.listSegments(t.id) }));

  const back = <Link href={`/calls/${id}`}>← Back to call</Link>;

  if (columns.length < 2) {
    return (
      <main>
        <p>{back}</p>
        <h1>Compare</h1>
        <p className="muted">
          This call has {columns.length} completed transcript. Re-transcribe with another provider
          to compare.
        </p>
      </main>
    );
  }

  const rows = alignByTime(columns.map((c) => c.segments));
  const labelMaps = columns.map((c) => speakerLabelMap(c.segments));

  return (
    <main className="wide">
      <p>{back}</p>
      <h1>Compare — {call.filename}</h1>
      <p className="muted">
        Segments aligned on the call timeline. A blank cell means that provider had no speech
        overlapping that moment — not that it missed words.
      </p>

      <table className="compare">
        <thead>
          <tr>
            <th>Time</th>
            {columns.map((c) => (
              <th key={c.id}>
                {c.provider}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {c.model ?? ''} · {c.segments.length} segments
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="time">{stamp(row.startMs)}</td>
              {row.cells.map((cell, j) => (
                <td className="cell" key={columns[j].id}>
                  {cell ? (
                    <>
                      <span className="ts">{speakerLabel(labelMaps[j], cell.speaker)}</span>
                      <br />
                      {cell.text}
                    </>
                  ) : (
                    <span className="gap">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Full text, side by side</h2>
      <p className="muted">
        Useful when a provider returns no timings (one long segment), which makes the aligned view
        above collapse into a single row for that column.
      </p>
      <table className="compare">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id}>{c.provider}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {columns.map((c) => (
              <td className="cell" key={c.id} style={{ verticalAlign: 'top' }}>
                {c.segments.map((s) => s.text).join(' ')}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </main>
  );
}
