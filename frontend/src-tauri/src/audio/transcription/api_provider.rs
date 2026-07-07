// audio/transcription/api_provider.rs
//
// Placeholder cloud ASR provider. Transcription in this build goes through a
// cloud speech-to-text API; the concrete integration (ElevenLabs Scribe /
// Chimege / Deepgram) has not landed yet, so every call returns a clear
// "not configured" error. Implement TranscriptionProvider here (or in a
// sibling module) when adding the real provider.

use async_trait::async_trait;
use super::provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};

/// Single entry point for API-based transcription. All transcription call
/// sites (live capture, import, retranscription) route through this.
pub async fn transcribe_via_api(
    _audio: Vec<f32>,
    _language: Option<String>,
) -> Result<TranscriptResult, TranscriptionError> {
    Err(TranscriptionError::EngineFailed(
        "Cloud transcription is not configured yet. The API-based speech-to-text \
         provider integration is coming; see NOTES.md."
            .to_string(),
    ))
}

pub struct ApiTranscriptionProvider {
    provider: String,
    model: String,
}

impl ApiTranscriptionProvider {
    pub fn new(provider: impl Into<String>, model: impl Into<String>) -> Self {
        Self { provider: provider.into(), model: model.into() }
    }
}

#[async_trait]
impl TranscriptionProvider for ApiTranscriptionProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError> {
        log::warn!(
            "transcribe_via_api called for provider '{}' model '{}' — not yet implemented",
            self.provider, self.model
        );
        transcribe_via_api(audio, language).await
    }
    async fn is_model_loaded(&self) -> bool { true }
    async fn get_current_model(&self) -> Option<String> { Some(self.model.clone()) }
    fn provider_name(&self) -> &'static str { "cloud-api" }
}
