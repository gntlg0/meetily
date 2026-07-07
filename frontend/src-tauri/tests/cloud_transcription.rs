//! End-to-end test of the cloud ASR pipeline: decode -> VAD -> per-segment
//! transcription via ApiTranscriptionProvider — the same stages the Import &
//! Enhance flow runs.
//!
//! Makes a real (paid) API call, so it is `#[ignore]`d by default. Run with:
//!
//! ```sh
//! MEETILY_TEST_AUDIO=/path/to/audio.wav \
//! MEETILY_TEST_ASR_PROVIDER=openai \
//! MEETILY_TEST_ASR_MODEL=gpt-4o-transcribe \
//! MEETILY_TEST_ASR_KEY=sk-... \
//! MEETILY_TEST_LANGUAGE=mn \
//! cargo test --test cloud_transcription -- --ignored --nocapture
//! ```

use std::path::PathBuf;

use app_lib::audio::decoder::decode_audio_file;
use app_lib::audio::transcription::{ApiTranscriptionProvider, TranscriptionProvider};
use app_lib::audio::vad::get_speech_chunks;

const VAD_REDEMPTION_TIME_MS: u32 = 2000;

#[test]
#[ignore = "makes a real cloud ASR API call; needs MEETILY_TEST_ASR_* env vars"]
fn transcribes_audio_through_cloud_provider() {
    let audio_path = PathBuf::from(
        std::env::var("MEETILY_TEST_AUDIO").expect("set MEETILY_TEST_AUDIO to an audio file"),
    );
    let provider_id =
        std::env::var("MEETILY_TEST_ASR_PROVIDER").unwrap_or_else(|_| "openai".to_string());
    let model =
        std::env::var("MEETILY_TEST_ASR_MODEL").unwrap_or_else(|_| "gpt-4o-transcribe".to_string());
    let api_key = std::env::var("MEETILY_TEST_ASR_KEY").expect("set MEETILY_TEST_ASR_KEY");
    let language = std::env::var("MEETILY_TEST_LANGUAGE").ok();

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");

    rt.block_on(async move {
        let decoded = decode_audio_file(&audio_path).expect("decode audio file");
        let samples = decoded.to_whisper_format();
        let audio_secs = samples.len() as f64 / 16000.0;

        let segments =
            get_speech_chunks(&samples, VAD_REDEMPTION_TIME_MS).expect("VAD segmentation");
        assert!(!segments.is_empty(), "VAD detected no speech in test audio");
        println!("decoded {:.1}s, VAD found {} segments", audio_secs, segments.len());

        let provider = ApiTranscriptionProvider::new(&provider_id, &model, Some(api_key));

        let mut transcript = String::new();
        for (i, segment) in segments.iter().enumerate() {
            if segment.samples.len() < 1600 {
                continue;
            }
            let result = provider
                .transcribe(segment.samples.clone(), language.clone())
                .await
                .unwrap_or_else(|e| panic!("transcription failed on segment {}: {}", i, e));
            println!("segment {}: {}", i, result.text);
            if !result.text.is_empty() {
                transcript.push_str(&result.text);
                transcript.push(' ');
            }
        }

        println!("full transcript:\n{}", transcript.trim());
        assert!(
            !transcript.trim().is_empty(),
            "cloud provider returned an empty transcript"
        );
    });
}
