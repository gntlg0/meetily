import 'server-only';

import { openAsBlob } from 'node:fs';

import { probeDurationMs } from '@/lib/duration';
import { openAiLanguageCode } from '@/lib/language';
import type { Provider, Segment, TranscribeOptions, TranscribeResult } from '@/lib/types';

const TIMEOUT_MS = 15 * 60 * 1000;

interface OpenAiVerboseSegment {
  start?: number;
  end?: number;
  text?: string;
}
interface OpenAiTranscription {
  text?: string;
  duration?: number;
  segments?: OpenAiVerboseSegment[];
}

const secToMs = (s: number | undefined): number =>
  typeof s === 'number' && Number.isFinite(s) ? Math.round(s * 1000) : 0;

async function post(
  url: string,
  filePath: string,
  opts: TranscribeOptions,
  model: string,
  responseFormat: string,
): Promise<Response> {
  const form = new FormData();
  form.append('file', await openAsBlob(filePath));
  form.append('model', model);
  form.append('response_format', responseFormat);

  const lang = openAiLanguageCode(opts.language);
  if (lang) form.append('language', lang);

  const headers: Record<string, string> = {};
  if (process.env.CUSTOM_ASR_API_KEY) {
    headers.Authorization = `Bearer ${process.env.CUSTOM_ASR_API_KEY}`;
  }

  return fetch(url, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Our future self-hosted Mongolian model, behind an OpenAI-compatible
 * `POST {CUSTOM_ASR_BASE_URL}/audio/transcriptions`.
 *
 * No diarization is assumed — everything is attributed to a single speaker.
 * We ask for `verbose_json` first so we get per-segment timings (whisper.cpp,
 * faster-whisper and vLLM all support it), which is what the compare view
 * aligns on. Servers that only speak plain `json` degrade to one big segment.
 */
export const customProvider: Provider = {
  name: 'custom',
  async transcribe(filePath, opts): Promise<TranscribeResult> {
    const base = process.env.CUSTOM_ASR_BASE_URL;
    if (!base) {
      throw new Error(
        'CUSTOM_ASR_BASE_URL is not set. Point it at any OpenAI-compatible ' +
          '/v1 endpoint (e.g. http://127.0.0.1:3399/v1 for `pnpm mock-asr`).',
      );
    }
    const model = process.env.CUSTOM_ASR_MODEL || 'whisper-1';
    const url = `${base.replace(/\/+$/, '')}/audio/transcriptions`;

    let res = await post(url, filePath, opts, model, 'verbose_json');
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      // Server doesn't do verbose_json; fall back to flat text.
      res = await post(url, filePath, opts, model, 'json');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Custom ASR ${res.status} at ${url}: ${body.slice(0, 600)}`);
    }

    const json = (await res.json()) as OpenAiTranscription;

    let segments: Segment[] = (json.segments ?? [])
      .map((s) => ({
        speaker: 'speaker_0',
        startMs: secToMs(s.start),
        endMs: secToMs(s.end),
        text: (s.text ?? '').trim(),
      }))
      .filter((s) => s.text.length > 0);

    if (segments.length === 0) {
      const text = (json.text ?? '').trim();
      if (!text) throw new Error(`Custom ASR at ${url} returned an empty transcript.`);
      const durationMs = secToMs(json.duration) || (await probeDurationMs(filePath)) || 0;
      segments = [{ speaker: 'speaker_0', startMs: 0, endMs: durationMs, text }];
    }

    const durationMs =
      secToMs(json.duration) || segments[segments.length - 1]?.endMs || undefined;

    return { provider: 'custom', model, segments, raw: json, durationMs };
  },
};
