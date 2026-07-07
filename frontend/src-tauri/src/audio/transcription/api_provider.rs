// audio/transcription/api_provider.rs
//
// Cloud ASR providers. All transcription call sites (live capture, import,
// retranscription) route through ApiTranscriptionProvider, which dispatches
// on the provider string saved in transcript_settings:
//   - "openai"     → api.openai.com/v1/audio/transcriptions (gpt-4o-transcribe, whisper-1)
//   - "groq"       → api.groq.com/openai/v1/audio/transcriptions (whisper-large-v3)
//   - "elevenLabs" → api.elevenlabs.io/v1/speech-to-text (scribe_v1)
//   - "deepgram"   → api.deepgram.com/v1/listen (nova-2, ...)
//
// Audio arrives as 16 kHz mono f32 and is uploaded as 16-bit PCM WAV.

use async_trait::async_trait;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

use super::provider::{TranscriptionError, TranscriptionProvider, TranscriptResult};
use crate::database::repositories::setting::SettingsRepository;
use crate::state::AppState;

const SAMPLE_RATE: u32 = 16_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Encode 16 kHz mono f32 samples as an in-memory 16-bit PCM WAV file.
fn to_wav_bytes(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let num_samples = samples.len() as u32;
    let data_len = num_samples * 2; // 16-bit mono
    let byte_rate = sample_rate * 2;

    let mut buf = Vec::with_capacity(44 + data_len as usize);
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_len).to_le_bytes());
    buf.extend_from_slice(b"WAVE");
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
    buf.extend_from_slice(&1u16.to_le_bytes()); // mono
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&2u16.to_le_bytes()); // block align
    buf.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_len.to_le_bytes());
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        buf.extend_from_slice(&v.to_le_bytes());
    }
    buf
}

/// Map the app language preference to an ISO-639-1 hint for the API.
/// "auto" / "auto-translate" / empty → None (provider-side detection).
fn language_hint(language: Option<&str>) -> Option<String> {
    match language {
        Some("auto") | Some("auto-translate") | Some("") | None => None,
        Some(code) => Some(code.to_string()),
    }
}

/// Prompt used to steer the model toward a language when the API rejects the
/// ISO code itself (OpenAI gates `language` to a subset — Mongolian is
/// excluded for both whisper-1 and gpt-4o-transcribe).
///
/// Whisper-family models bias their output language toward the language the
/// prompt itself is written in, so the hint must be written IN the target
/// language — an English "The audio is in Mongolian." makes whisper-1 decode
/// gibberish, while a native-language sentence anchors the decoder.
fn language_prompt(code: &str) -> String {
    match code {
        "mn" => "Энэ бол монгол хэлээр ярьсан хурлын бичлэг юм.".to_string(),
        "ru" => "Это запись разговора на русском языке.".to_string(),
        "kk" => "Бұл қазақ тіліндегі әңгіме жазбасы.".to_string(),
        "en" => "This is a recording of a conversation in English.".to_string(),
        other => format!("The audio is in the language with ISO code '{}'.", other),
    }
}

pub struct ApiTranscriptionProvider {
    provider: String,
    model: String,
    api_key: Option<String>,
    client: reqwest::Client,
    // Set once the API rejects our language code (OpenAI's endpoint gates
    // `language` to a subset that excludes e.g. Mongolian, for both whisper-1
    // and gpt-4o-transcribe). Subsequent segments then skip the doomed
    // attempt and hint the language via the prompt field directly.
    language_param_rejected: AtomicBool,
}

impl ApiTranscriptionProvider {
    pub fn new(
        provider: impl Into<String>,
        model: impl Into<String>,
        api_key: Option<String>,
    ) -> Self {
        Self {
            provider: provider.into(),
            model: model.into(),
            api_key,
            client: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("failed to build HTTP client"),
            language_param_rejected: AtomicBool::new(false),
        }
    }

    /// Build a provider from the saved transcript_settings row (provider,
    /// model, and its API key). This is the single config-resolution point
    /// shared by live capture, import, and retranscription.
    pub async fn from_saved_config<R: Runtime>(
        app: &AppHandle<R>,
    ) -> Result<Self, String> {
        let state = app
            .try_state::<AppState>()
            .ok_or_else(|| "App state not available".to_string())?;
        let pool = state.db_manager.pool();

        let (provider, model) = match SettingsRepository::get_transcript_config(pool).await {
            Ok(Some(cfg)) => (cfg.provider, cfg.model),
            _ => {
                let (p, m) = crate::config::default_provider_and_model();
                (p.to_string(), m.to_string())
            }
        };

        let api_key = SettingsRepository::get_transcript_api_key(pool, &provider)
            .await
            .map_err(|e| format!("Failed to read API key for '{}': {}", provider, e))?
            .filter(|k| !k.trim().is_empty());

        Ok(Self::new(provider, model, api_key))
    }

    pub fn has_api_key(&self) -> bool {
        self.api_key.is_some()
    }

    pub fn provider_id(&self) -> &str {
        &self.provider
    }

    fn require_key(&self) -> Result<&str, TranscriptionError> {
        self.api_key.as_deref().ok_or_else(|| {
            TranscriptionError::EngineFailed(format!(
                "No API key configured for '{}'. Add it in Settings → Transcription.",
                self.provider
            ))
        })
    }

    async fn transcribe_openai_compatible(
        &self,
        endpoint: &str,
        wav: Vec<u8>,
        language: Option<String>,
    ) -> Result<String, TranscriptionError> {
        // If a previous segment already learned that this endpoint rejects
        // our language code, go straight to the prompt-hint form.
        let use_prompt = language.is_some() && self.language_param_rejected.load(Ordering::Relaxed);

        let (status, body) = self
            .openai_request(endpoint, wav.clone(), language.clone(), use_prompt)
            .await?;

        if status.is_success() {
            let text = parse_text_field(&body)?;
            return Ok(if use_prompt {
                strip_prompt_echo(text, language.as_deref())
            } else {
                text
            });
        }

        // OpenAI gates the `language` param to a supported subset (Mongolian
        // is excluded for both whisper-1 and gpt-4o-transcribe, with error
        // codes unsupported_language / invalid_value). Retry once with the
        // language hinted through the prompt field instead, and remember the
        // rejection so later segments skip the doomed attempt.
        if !use_prompt && language.is_some() && is_language_param_error(&body) {
            log::warn!(
                "{} rejected language code {:?}; retrying with a prompt hint",
                self.provider,
                language
            );
            self.language_param_rejected.store(true, Ordering::Relaxed);
            let (status2, body2) = self
                .openai_request(endpoint, wav, language.clone(), true)
                .await?;
            if status2.is_success() {
                return parse_text_field(&body2).map(|t| strip_prompt_echo(t, language.as_deref()));
            }
            return Err(api_error(&self.provider, status2, &body2));
        }

        Err(api_error(&self.provider, status, &body))
    }

    async fn openai_request(
        &self,
        endpoint: &str,
        wav: Vec<u8>,
        language: Option<String>,
        language_as_prompt: bool,
    ) -> Result<(reqwest::StatusCode, String), TranscriptionError> {
        let key = self.require_key()?;
        let part = reqwest::multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
        let mut form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", self.model.clone())
            .text("response_format", "json");
        if let Some(lang) = language {
            if language_as_prompt {
                form = form.text("prompt", language_prompt(&lang));
            } else {
                form = form.text("language", lang);
            }
        }

        let resp = self
            .client
            .post(endpoint)
            .bearer_auth(key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(format!("request failed: {}", e)))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
        Ok((status, body))
    }

    async fn transcribe_elevenlabs(
        &self,
        wav: Vec<u8>,
        language: Option<String>,
    ) -> Result<String, TranscriptionError> {
        let key = self.require_key()?;
        let part = reqwest::multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
        let mut form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model_id", self.model.clone());
        if let Some(lang) = language {
            form = form.text("language_code", lang);
        }

        let resp = self
            .client
            .post("https://api.elevenlabs.io/v1/speech-to-text")
            .header("xi-api-key", key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(format!("request failed: {}", e)))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
        if !status.is_success() {
            return Err(api_error(&self.provider, status, &body));
        }

        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| TranscriptionError::EngineFailed(format!("bad response JSON: {}", e)))?;
        Ok(json["text"].as_str().unwrap_or_default().to_string())
    }

    async fn transcribe_deepgram(
        &self,
        wav: Vec<u8>,
        language: Option<String>,
    ) -> Result<(String, Option<f32>), TranscriptionError> {
        let key = self.require_key()?;
        let mut url = format!(
            "https://api.deepgram.com/v1/listen?model={}&smart_format=true",
            self.model
        );
        match language {
            Some(lang) => url.push_str(&format!("&language={}", lang)),
            None => url.push_str("&detect_language=true"),
        }

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Token {}", key))
            .header("Content-Type", "audio/wav")
            .body(wav)
            .send()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(format!("request failed: {}", e)))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
        if !status.is_success() {
            return Err(api_error(&self.provider, status, &body));
        }

        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| TranscriptionError::EngineFailed(format!("bad response JSON: {}", e)))?;
        let alt = &json["results"]["channels"][0]["alternatives"][0];
        let text = alt["transcript"].as_str().unwrap_or_default().to_string();
        let confidence = alt["confidence"].as_f64().map(|c| c as f32);
        Ok((text, confidence))
    }
}

/// On silent or ambiguous segments Whisper sometimes recites its conditioning
/// prompt instead of transcribing. Remove verbatim echoes of our language
/// hint from the returned text. (Mutated echoes can still slip through — the
/// real fix is a provider that supports the language natively.)
fn strip_prompt_echo(text: String, language: Option<&str>) -> String {
    match language {
        Some(lang) => {
            let hint = language_prompt(lang);
            if text.contains(&hint) {
                text.replace(&hint, " ").split_whitespace().collect::<Vec<_>>().join(" ")
            } else {
                text
            }
        }
        None => text,
    }
}

/// True when an error body pinpoints the `language` parameter (any error
/// code, any JSON formatting) — the signal to retry with a prompt hint.
fn is_language_param_error(body: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(body)
        .map(|v| v["error"]["param"].as_str() == Some("language"))
        .unwrap_or(false)
}

fn parse_text_field(body: &str) -> Result<String, TranscriptionError> {
    let json: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| TranscriptionError::EngineFailed(format!("bad response JSON: {}", e)))?;
    Ok(json["text"].as_str().unwrap_or_default().to_string())
}

fn api_error(provider: &str, status: reqwest::StatusCode, body: &str) -> TranscriptionError {
    let snippet: String = body.chars().take(300).collect();
    TranscriptionError::EngineFailed(format!(
        "{} API returned {}: {}",
        provider, status, snippet
    ))
}

#[async_trait]
impl TranscriptionProvider for ApiTranscriptionProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> Result<TranscriptResult, TranscriptionError> {
        if audio.is_empty() {
            return Ok(TranscriptResult {
                text: String::new(),
                confidence: None,
                is_partial: false,
            });
        }

        let wav = to_wav_bytes(&audio, SAMPLE_RATE);
        let lang = language_hint(language.as_deref());

        let (text, confidence) = match self.provider.as_str() {
            "openai" => (
                self.transcribe_openai_compatible(
                    "https://api.openai.com/v1/audio/transcriptions",
                    wav,
                    lang,
                )
                .await?,
                None,
            ),
            "groq" => (
                self.transcribe_openai_compatible(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    wav,
                    lang,
                )
                .await?,
                None,
            ),
            "elevenLabs" => (self.transcribe_elevenlabs(wav, lang).await?, None),
            "deepgram" => self.transcribe_deepgram(wav, lang).await?,
            other => {
                return Err(TranscriptionError::EngineFailed(format!(
                    "Unsupported transcription provider '{}'. Choose one in Settings → Transcription.",
                    other
                )))
            }
        };

        Ok(TranscriptResult {
            text: text.trim().to_string(),
            confidence,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        true
    }

    async fn get_current_model(&self) -> Option<String> {
        Some(self.model.clone())
    }

    fn provider_name(&self) -> &'static str {
        "cloud-api"
    }
}
