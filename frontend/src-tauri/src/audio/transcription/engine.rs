// audio/transcription/engine.rs
//
// TranscriptionEngine enum and provider initialization/validation logic.
// API-only build: the engine always wraps an ApiTranscriptionProvider.

use super::api_provider::ApiTranscriptionProvider;
use super::provider::TranscriptionProvider;
use log::{info, warn};
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

// ============================================================================
// TRANSCRIPTION ENGINE ENUM
// ============================================================================

// Transcription engine abstraction (trait-based providers only)
pub enum TranscriptionEngine {
    Provider(Arc<dyn TranscriptionProvider>),
}

impl TranscriptionEngine {
    /// Check if the engine has a model loaded
    pub async fn is_model_loaded(&self) -> bool {
        match self {
            Self::Provider(provider) => provider.is_model_loaded().await,
        }
    }

    /// Get the current model name
    pub async fn get_current_model(&self) -> Option<String> {
        match self {
            Self::Provider(provider) => provider.get_current_model().await,
        }
    }

    /// Get the provider name for logging
    pub fn provider_name(&self) -> &str {
        match self {
            Self::Provider(provider) => provider.provider_name(),
        }
    }
}

// ============================================================================
// MODEL VALIDATION AND INITIALIZATION
// ============================================================================

/// Validate that transcription is ready before starting recording.
///
/// API-only build: no local model to check, but the configured cloud
/// provider must have an API key saved — fail early with a clear message
/// instead of erroring on every audio chunk mid-meeting.
pub async fn validate_transcription_model_ready<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    let provider = ApiTranscriptionProvider::from_saved_config(app).await?;
    if !provider.has_api_key() {
        warn!(
            "❌ No API key saved for transcription provider '{}'",
            provider.provider_id()
        );
        return Err(format!(
            "No API key configured for '{}'. Add it in Settings → Transcription before recording.",
            provider.provider_id()
        ));
    }
    info!(
        "✅ Cloud transcription provider '{}' is configured",
        provider.provider_id()
    );
    Ok(())
}

/// Get or initialize the transcription engine based on provider configuration.
/// Always returns an API-backed provider in this build.
pub async fn get_or_init_transcription_engine<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<TranscriptionEngine, String> {
    let provider = ApiTranscriptionProvider::from_saved_config(app).await?;
    info!(
        "🌐 Initializing cloud transcription provider '{}'",
        provider.provider_id()
    );
    Ok(TranscriptionEngine::Provider(Arc::new(provider)))
}
