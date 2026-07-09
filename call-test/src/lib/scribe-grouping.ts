import type { Segment } from '@/lib/types';

/** Speaker bucket for words ElevenLabs could not attribute. */
export const UNKNOWN_SPEAKER = 'speaker_unknown';

export interface ScribeWord {
  text: string;
  start: number | null;
  end: number | null;
  type: 'word' | 'spacing' | 'audio_event';
  speaker_id: string | null;
}

const secToMs = (s: number | null | undefined): number | null =>
  typeof s === 'number' && Number.isFinite(s) ? Math.round(s * 1000) : null;

/**
 * Collapse ElevenLabs' word-level stream into speaker turns.
 *
 * The `words` array interleaves three entry types:
 *   - `word`        — carries text + timings + speaker_id
 *   - `spacing`     — carries the whitespace between words; NEVER starts a turn
 *   - `audio_event` — e.g. "(laughter)"; attached to the open turn, never a switch
 *
 * A new turn opens whenever a `word` reports a different `speaker_id` than the
 * one currently open. `speaker_id` may be null (diarization declined to guess),
 * which we bucket under UNKNOWN_SPEAKER rather than silently merging into the
 * previous speaker's turn.
 *
 * Kept free of runtime imports so it can be unit-tested in isolation — this is
 * the load-bearing bit of the Scribe integration.
 */
export function groupWordsIntoTurns(words: ScribeWord[]): Segment[] {
  const turns: Segment[] = [];

  let speaker: string | null = null;
  let parts: string[] = [];
  let startMs = 0;
  let endMs = 0;

  const flush = () => {
    if (speaker === null) return;
    const text = parts.join('').replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      turns.push({ speaker, startMs, endMs: Math.max(endMs, startMs), text });
    }
    speaker = null;
    parts = [];
  };

  for (const w of words) {
    if (w.type === 'spacing') {
      if (speaker !== null) parts.push(w.text ?? ' ');
      continue;
    }

    if (w.type === 'audio_event') {
      if (speaker !== null) {
        parts.push(` ${w.text} `);
        endMs = Math.max(endMs, secToMs(w.end) ?? endMs);
      }
      continue;
    }

    const id = w.speaker_id ?? UNKNOWN_SPEAKER;
    const ws = secToMs(w.start);
    const we = secToMs(w.end);

    if (speaker !== id) {
      flush();
      speaker = id;
      parts = [w.text];
      startMs = ws ?? endMs;
      endMs = we ?? startMs;
    } else {
      parts.push(w.text);
      if (we !== null) endMs = Math.max(endMs, we);
    }
  }

  flush();
  return turns;
}
