import 'server-only';

import { NotImplementedError, type Provider } from '@/lib/types';

/**
 * Chimege — Mongolian ASR (https://docs.api.chimege.com).
 *
 * ============================================================================
 * THIS IS THE ONLY FILE YOU NEED TO TOUCH TO ADD CHIMEGE.
 * ============================================================================
 *
 * Implement `transcribe` so it returns a `TranscribeResult`. Everything else —
 * the DB rows, the call page, the compare view — already routes through the
 * `Provider` interface and will pick it up with no other changes.
 *
 * Notes for whoever picks this up:
 *   - Chimege's long-audio endpoint expects 16 kHz mono PCM/WAV. Uploaded calls
 *     are m4a/mp3/etc., so transcode first (ffmpeg: `-ac 1 -ar 16000 -f s16le`)
 *     before POSTing.
 *   - Auth is a `Token: <CHIMEGE_TOKEN>` header, not `Authorization: Bearer`.
 *   - If Chimege returns no diarization, emit a single segment with
 *     `speaker: 'speaker_0'` — the compare view handles single-speaker columns.
 *   - Map their word/segment timings to milliseconds; `startMs`/`endMs` are what
 *     the compare view aligns on.
 */
export const chimegeProvider: Provider = {
  name: 'chimege',
  async transcribe() {
    throw new NotImplementedError(
      'Chimege provider is not implemented yet. ' +
        'See src/lib/providers/chimege.ts and https://docs.api.chimege.com',
    );
  },
};
