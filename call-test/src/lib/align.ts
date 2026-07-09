import type { Segment } from '@/lib/types';

export interface CompareRow {
  startMs: number;
  /** One entry per column; null when that provider has nothing at this moment. */
  cells: (Segment | null)[];
}

/**
 * Align N transcripts on a shared timeline.
 *
 * Each pass picks the earliest unconsumed segment across all columns (the
 * "anchor") and opens a row at its start. Every other column contributes its
 * next segment to that row iff that segment *overlaps the anchor's time span*;
 * otherwise the column is left blank and keeps its segment for a later row.
 *
 * The anchor always overlaps itself, so at least one segment is consumed per
 * pass — the loop is guaranteed to terminate.
 */
export function alignByTime(columns: Segment[][]): CompareRow[] {
  const cursors = columns.map(() => 0);
  const rows: CompareRow[] = [];

  const head = (i: number): Segment | undefined => columns[i][cursors[i]];

  while (columns.some((_, i) => head(i) !== undefined)) {
    let anchorStart = Number.POSITIVE_INFINITY;
    let anchorEnd = 0;

    for (let i = 0; i < columns.length; i++) {
      const seg = head(i);
      if (seg && seg.startMs < anchorStart) {
        anchorStart = seg.startMs;
        anchorEnd = Math.max(seg.endMs, seg.startMs + 1);
      }
    }

    const cells: (Segment | null)[] = columns.map((_, i) => {
      const seg = head(i);
      if (seg && seg.startMs < anchorEnd) {
        cursors[i]++;
        return seg;
      }
      return null;
    });

    rows.push({ startMs: anchorStart, cells });
  }

  return rows;
}
