/**
 * Default transcription configuration.
 *
 * This build is API-only: no local models (Whisper/Parakeet/Ollama) exist.
 * Transcription goes through the configured cloud ASR provider (see
 * NOTES.md); summaries go through cloud LLM APIs (Anthropic by default).
 *
 * IMPORTANT: Keep in sync with Rust constants in src-tauri/src/config.rs
 */
export const DEFAULT_TRANSCRIPTION_PROVIDER = 'elevenLabs';
export const DEFAULT_TRANSCRIPTION_MODEL = 'scribe_v1';

/**
 * Default summary provider/model (Anthropic API).
 */
export const DEFAULT_SUMMARY_PROVIDER = 'claude';
export const DEFAULT_SUMMARY_MODEL = 'claude-sonnet-4-5-20250929';
