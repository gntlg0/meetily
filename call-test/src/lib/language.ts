import type { LanguageMode } from '@/lib/types';

export const LANGUAGE_MODES: LanguageMode[] = ['mn', 'en', 'mixed'];

export const LANGUAGE_MODE_LABELS: Record<LanguageMode, string> = {
  mn: 'Mongolian (mn)',
  en: 'English (en)',
  mixed: 'Mixed MN/EN (mon hint)',
};

/**
 * ElevenLabs `language_code` accepts ISO-639-1 *or* ISO-639-3.
 *
 * `mixed` sends the ISO-639-3 `mon` as a *hint* rather than omitting the field:
 * Mongolian calls carry English loan words, and leaving language_code null lets
 * autodetect drift to English on English-heavy stretches. The hint biases toward
 * Mongolian without suppressing English tokens.
 *
 * `mn` sends the same code — the two modes differ downstream (the summary prompt
 * is told to expect code-switching), not at the ASR call.
 */
export function scribeLanguageCode(mode: LanguageMode): string | undefined {
  switch (mode) {
    case 'mn':
      return 'mon';
    case 'en':
      return 'eng';
    case 'mixed':
      return 'mon';
  }
}

/** OpenAI-compatible `/v1/audio/transcriptions` wants ISO-639-1. */
export function openAiLanguageCode(mode: LanguageMode): string | undefined {
  switch (mode) {
    case 'mn':
      return 'mn';
    case 'en':
      return 'en';
    case 'mixed':
      return 'mn';
  }
}
