// audio/transcription/engine.rs
//
// TranscriptionEngine enum and provider initialization/validation logic.
// API-only build: the engine always wraps an ApiTranscriptionProvider.

use super::api_provider::ApiTranscriptionProvider;
use super::provider::TranscriptionProvider;
use log::{info, warn};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

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

/// Read the transcript config, falling back to the compile-time defaults.
async fn read_transcript_config<R: Runtime>(
    app: &AppHandle<R>,
) -> crate::api::api::TranscriptConfig {
    match crate::api::api::api_get_transcript_config(app.clone(), app.clone().state(), None).await
    {
        Ok(Some(config)) => {
            info!(
                "📝 Found transcript config - provider: {}, model: {}",
                config.provider, config.model
            );
            config
        }
        Ok(None) => {
            let (provider, model) = crate::config::default_provider_and_model();
            info!("📝 No transcript config found, defaulting to {}", provider);
            crate::api::api::TranscriptConfig {
                provider: provider.to_string(),
                model: model.to_string(),
                api_key: None,
            }
        }
        Err(e) => {
            let (provider, model) = crate::config::default_provider_and_model();
            warn!(
                "⚠️ Failed to get transcript config: {}, defaulting to {}",
                e, provider
            );
            crate::api::api::TranscriptConfig {
                provider: provider.to_string(),
                model: model.to_string(),
                api_key: None,
            }
        }
    }
}

/// Validate that transcription is ready before starting recording.
///
/// API-only build: cloud providers need no local model, so recording/capture
/// is never blocked here regardless of the configured provider.
pub async fn validate_transcription_model_ready<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    let config = read_transcript_config(app).await;
    info!(
        "✅ Using cloud transcription provider {} (integration pending) — no local model to validate",
        config.provider
    );
    Ok(())
}

/// Get or initialize the transcription engine based on provider configuration.
/// Always returns an API-backed provider in this build.
pub async fn get_or_init_transcription_engine<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<TranscriptionEngine, String> {
    let config = read_transcript_config(app).await;
    info!(
        "🌐 Initializing cloud transcription provider '{}' (model '{}')",
        config.provider, config.model
    );
    Ok(TranscriptionEngine::Provider(Arc::new(
        ApiTranscriptionProvider::new(config.provider, config.model),
    )))
}
