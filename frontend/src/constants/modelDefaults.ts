/**
 * Default model names for transcription engines.
 * IMPORTANT: Keep in sync with Rust constants in src-tauri/src/config.rs
 */

/**
 * Default Whisper model for transcription when no preference is configured.
 * This build defaults to the Mongolian fine-tune (see NOTES-MN.md).
 */
export const DEFAULT_WHISPER_MODEL = 'mn-large-v2-q5_0';

/**
 * Default transcription provider for this build. Parakeet is English-only,
 * so the Mongolian build routes to local Whisper by default.
 * IMPORTANT: Keep in sync with DEFAULT_TRANSCRIPTION_PROVIDER in src-tauri/src/config.rs
 */
export const DEFAULT_TRANSCRIPTION_PROVIDER = 'localWhisper';

/**
 * Default Parakeet model for transcription when no preference is configured.
 * This is the quantized version optimized for speed.
 */
export const DEFAULT_PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3-int8';

/**
 * Model defaults by provider type
 */
export const MODEL_DEFAULTS = {
  whisper: DEFAULT_WHISPER_MODEL,
  localWhisper: DEFAULT_WHISPER_MODEL,
  parakeet: DEFAULT_PARAKEET_MODEL,
} as const;
