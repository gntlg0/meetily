/// Application configuration constants
///
/// Centralized definitions for default models and settings.
/// Used across database initialization, import, and retranscription.

/// Default Whisper model for transcription when no preference is configured.
/// This build defaults to the Mongolian fine-tune (see NOTES-MN.md); the stock
/// models remain available in the catalog below.
pub const DEFAULT_WHISPER_MODEL: &str = "mn-large-v2-q5_0";

/// Default Parakeet model for transcription when no preference is configured.
/// This is the quantized version optimized for speed.
pub const DEFAULT_PARAKEET_MODEL: &str = "parakeet-tdt-0.6b-v3-int8";

/// Default transcription provider when no transcript_settings row exists.
/// Parakeet is English-only, so this Mongolian build defaults to local Whisper.
pub const DEFAULT_TRANSCRIPTION_PROVIDER: &str = "localWhisper";

/// Default transcription language (ISO 639-1, or "auto"/"auto-translate").
/// Whisper language auto-detection misfires on low-resource languages, so this
/// build pins Mongolian by default; it stays user-configurable in the UI.
pub const DEFAULT_TRANSCRIPTION_LANGUAGE: &str = "mn";

/// Default (provider, model) pair used by every "no transcript config yet"
/// fallback, so provider routing is decided in one place.
pub fn default_provider_and_model() -> (&'static str, &'static str) {
    match DEFAULT_TRANSCRIPTION_PROVIDER {
        "parakeet" => (DEFAULT_TRANSCRIPTION_PROVIDER, DEFAULT_PARAKEET_MODEL),
        _ => (DEFAULT_TRANSCRIPTION_PROVIDER, DEFAULT_WHISPER_MODEL),
    }
}

/// Whisper model catalog with metadata for all supported models.
/// Used by both WhisperEngine::discover_models() and discover_models_standalone().
///
/// Format: (name, filename, size_mb, accuracy, speed, description)
pub const WHISPER_MODEL_CATALOG: &[(&str, &str, u32, &str, &str, &str)] = &[
    // Standard f16 models (full precision)
    ("tiny", "ggml-tiny.bin", 74, "Decent", "Very Fast", "Fastest processing, good for real-time use"),
    ("base", "ggml-base.bin", 142, "Good", "Fast", "Good balance of speed and accuracy"),
    ("small", "ggml-small.bin", 466, "Good", "Medium", "Better accuracy, moderate speed"),
    ("medium", "ggml-medium.bin", 1463, "High", "Slow", "High accuracy for professional use"),
    ("large-v3-turbo", "ggml-large-v3-turbo.bin", 1549, "High", "Medium", "Best accuracy with improved speed"),
    ("large-v3", "ggml-large-v3.bin", 2951, "High", "Slow", "Most Accurate, latest large model"),

    // Q5_1 quantized models (balanced speed/accuracy, slightly better quality than Q5_0)
    ("tiny-q5_1", "ggml-tiny-q5_1.bin", 31, "Decent", "Very Fast", "Quantized tiny model, ~50% faster processing"),
    ("base-q5_1", "ggml-base-q5_1.bin", 57, "Good", "Fast", "Quantized base model, good speed/accuracy balance"),
    ("small-q5_1", "ggml-small-q5_1.bin", 181, "Good", "Fast", "Quantized small model, faster than f16 version"),

    // Q5_0 quantized models (balanced speed/accuracy)
    ("medium-q5_0", "ggml-medium-q5_0.bin", 514, "High", "Medium", "Quantized medium model, professional quality"),
    ("large-v3-turbo-q5_0", "ggml-large-v3-turbo-q5_0.bin", 547, "High", "Medium", "Quantized large model, best balance"),
    ("large-v3-q5_0", "ggml-large-v3-q5_0.bin", 1031, "High", "Slow", "Quantized large model, high accuracy"),

    // Mongolian fine-tune (bayartsogt/whisper-large-v2-mn-13, ~20 WER on Common Voice mn).
    // Converted locally to GGML — no download URL; see NOTES-MN.md for how to produce these files.
    ("mn-large-v2-q5_0", "ggml-mn-large-v2-q5_0.bin", 1030, "High (Mongolian)", "Slow", "Mongolian fine-tuned large-v2, quantized Q5_0 — recommended for Mongolian meetings"),
    ("mn-large-v2-f16", "ggml-mn-large-v2-f16.bin", 2950, "High (Mongolian)", "Very Slow", "Mongolian fine-tuned large-v2, full precision — for quality comparison"),
];
