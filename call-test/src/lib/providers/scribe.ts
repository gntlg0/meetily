import 'server-only';

import { openAsBlob } from 'node:fs';

import { scribeLanguageCode } from '@/lib/language';
import { UNKNOWN_SPEAKER, groupWordsIntoTurns, type ScribeWord } from '@/lib/scribe-grouping';
import type { Provider, TranscribeOptions, TranscribeResult } from '@/lib/types';

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
const MODEL_ID = 'scribe_v2';
const TIMEOUT_MS = 15 * 60 * 1000;

export interface ScribeResponse {
  language_code?: string;
  text?: string;
  words?: ScribeWord[];
  audio_duration_secs?: number | null;
}

const secToMs = (s: number | null | undefined): number | null =>
  typeof s === 'number' && Number.isFinite(s) ? Math.round(s * 1000) : null;

/** Overridable only so tests can point at a local fake; unset in normal use. */
const endpoint = () => process.env.ELEVENLABS_BASE_URL ?? ENDPOINT;

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

  const res = await fetch(endpoint(), {
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
