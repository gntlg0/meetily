'use client';

import { stamp } from '@/lib/duration.client';
import { speakerLabel, speakerLabelMap } from '@/lib/speakers';
import type { Segment } from '@/lib/types';

export function Transcript({ segments }: { segments: Segment[] }) {
  const labels = speakerLabelMap(segments);

  if (segments.length === 0) return <p className="muted">No segments.</p>;

  return (
    <div>
      {segments.map((s, i) => (
        <p className="turn" key={i}>
          <span className="who">{speakerLabel(labels, s.speaker)}</span>{' '}
          <span className="ts">{stamp(s.startMs)}</span>
          <br />
          {s.text}
        </p>
      ))}
    </div>
  );
}
