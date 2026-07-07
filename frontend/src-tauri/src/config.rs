/// Application configuration constants
///
/// This build is API-only: no local models (Whisper/Parakeet/Ollama/llama.cpp).
/// Transcription goes through the configured cloud ASR provider (the
/// call sites route through audio::transcription::ApiTranscriptionProvider), and
/// summaries go through cloud LLM APIs.
///
/// IMPORTANT: Keep in sync with frontend/src/constants/modelDefaults.ts

/// Default transcription provider when no transcript_settings row exists.
pub const DEFAULT_TRANSCRIPTION_PROVIDER: &str = "elevenLabs";

/// Default transcription model for the default provider.
pub const DEFAULT_TRANSCRIPTION_MODEL: &str = "scribe_v2";

/// Default transcription language (ISO 639-1, or "auto"/"auto-translate").
/// "auto" lets the cloud provider detect the language — appropriate for
/// ElevenLabs Scribe (strong low-resource detection) and for mixed
/// Mongolian/English meetings where a single forced code isn't ideal.
pub const DEFAULT_TRANSCRIPTION_LANGUAGE: &str = "auto";

/// Default summary provider/model (Anthropic API).
pub const DEFAULT_SUMMARY_PROVIDER: &str = "claude";
pub const DEFAULT_SUMMARY_MODEL: &str = "claude-sonnet-4-5-20250929";

/// Default (provider, model) pair used by every "no transcript config yet"
/// fallback, so provider routing is decided in one place.
pub fn default_provider_and_model() -> (&'static str, &'static str) {
    (DEFAULT_TRANSCRIPTION_PROVIDER, DEFAULT_TRANSCRIPTION_MODEL)
}
