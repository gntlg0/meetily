import 'server-only';

import { openAsBlob } from 'node:fs';

import { scribeLanguageCode } from '@/lib/language';
import type { Provider, Segment, TranscribeOptions, TranscribeResult } from '@/lib/types';

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MODEL_ID = 'scribe_v2';
const TIMEOUT_MS = 15 * 60 * 1000;

/** Speaker bucket for words ElevenLabs could not attribute. */
export const UNKNOWN_SPEAKER = 'speaker_unknown';

export interface ScribeWord {
  text: string;
  start: number | null;
  end: number | null;
  type: 'word' | 'spacing' | 'audio_event';
  speaker_id: string | null;
}

export interface ScribeResponse {
  language_code?: string;
  text?: string;
  words?: ScribeWord[];
  audio_duration_secs?: number | null;
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

async function callScribe(
  filePath: string,
  opts: TranscribeOptions,
  apiKey: string,
): Promise<ScribeResponse> {
  const form = new FormData();
  form.append('file', await openAsBlob(filePath));
  form.append('model_id', MODEL_ID);
  form.append('diarize', 'true');
  form.append('timestamps_granularity', 'word');
  // Off for a bake-off: "(laughter)" tags are noise when comparing word accuracy.
  form.append('tag_audio_events', 'false');

  if (opts.numSpeakers >= 1 && opts.numSpeakers <= 32) {
    form.append('num_speakers', String(opts.numSpeakers));
  }

  const lang = scribeLanguageCode(opts.language);
  if (lang) form.append('language_code', lang);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs Scribe ${res.status}: ${body.slice(0, 600)}`);
  }

  return (await res.json()) as ScribeResponse;
}

export const scribeProvider: Provider = {
  name: 'scribe',
  async transcribe(filePath, opts): Promise<TranscribeResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY is not set. Add it to .env.local.');
    }

    const json = await callScribe(filePath, opts, apiKey);
    const words = json.words ?? [];

    let segments = groupWordsIntoTurns(words);

    // Diarization can return nothing useful (single-speaker audio, or the model
    // declined). Fall back to the flat transcript so the run is still usable.
    if (segments.length === 0 && json.text?.trim()) {
      const durMs = secToMs(json.audio_duration_secs) ?? 0;
      segments = [
        { speaker: UNKNOWN_SPEAKER, startMs: 0, endMs: durMs, text: json.text.trim() },
      ];
    }

    return {
      provider: 'scribe',
      model: MODEL_ID,
      segments,
      raw: json,
      durationMs: secToMs(json.audio_duration_secs) ?? undefined,
    };
  },
};
