//! End-to-end test of the audio-import transcription pipeline with the
//! Mongolian fine-tuned Whisper model.
//!
//! Exercises the same stages as the Import & Enhance flow (`audio::import`):
//! decode -> 16kHz mono -> VAD -> per-segment Whisper transcription with the
//! configured language — without the Tauri UI/DB layers.
//!
//! Requires the converted model in the models directory, so it is `#[ignore]`d
//! by default. Run with:
//!
//! ```sh
//! MEETILY_TEST_AUDIO=/path/to/audio.wav \
//! MEETILY_TEST_MODELS_DIR=../models \
//! MEETILY_TEST_MODEL=mn-large-v2-q5_0 \
//! MEETILY_TEST_LANGUAGE=mn \
//! cargo test --release --test mongolian_import_pipeline -- --ignored --nocapture
//! ```

use std::path::PathBuf;
use std::time::Instant;

use app_lib::audio::decoder::decode_audio_file;
use app_lib::audio::vad::get_speech_chunks;
use app_lib::whisper_engine::WhisperEngine;

// Same value as audio::import::VAD_REDEMPTION_TIME_MS
const VAD_REDEMPTION_TIME_MS: u32 = 2000;

#[test]
#[ignore = "needs a converted Mongolian model and a test audio file"]
fn transcribes_mongolian_audio_through_import_pipeline() {
    let audio_path = PathBuf::from(
        std::env::var("MEETILY_TEST_AUDIO").expect("set MEETILY_TEST_AUDIO to an audio file"),
    );
    let models_dir = PathBuf::from(
        std::env::var("MEETILY_TEST_MODELS_DIR").unwrap_or_else(|_| "../models".to_string()),
    );
    let model_name =
        std::env::var("MEETILY_TEST_MODEL").unwrap_or_else(|_| "mn-large-v2-q5_0".to_string());
    let language = std::env::var("MEETILY_TEST_LANGUAGE").unwrap_or_else(|_| {
        app_lib::config::DEFAULT_TRANSCRIPTION_LANGUAGE.to_string()
    });

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");

    rt.block_on(async move {
        // Stage 1: decode + resample to 16kHz mono (same as import)
        let t0 = Instant::now();
        let decoded = decode_audio_file(&audio_path).expect("decode audio file");
        let samples = decoded.to_whisper_format();
        let audio_secs = samples.len() as f64 / 16000.0;
        println!(
            "decoded {:.1}s of audio in {:.2}s",
            audio_secs,
            t0.elapsed().as_secs_f64()
        );

        // Stage 2: VAD speech segmentation (same as import)
        let t1 = Instant::now();
        let segments =
            get_speech_chunks(&samples, VAD_REDEMPTION_TIME_MS).expect("VAD segmentation");
        println!(
            "VAD found {} segments in {:.2}s",
            segments.len(),
            t1.elapsed().as_secs_f64()
        );
        assert!(!segments.is_empty(), "VAD detected no speech in test audio");

        // Stage 3: load model + per-segment transcription (same as import)
        let engine =
            WhisperEngine::new_with_models_dir(Some(models_dir)).expect("whisper engine");
        engine.discover_models().await.expect("discover models");
        let t2 = Instant::now();
        engine.load_model(&model_name).await.expect("load model");
        println!("loaded model '{}' in {:.2}s", model_name, t2.elapsed().as_secs_f64());

        let t3 = Instant::now();
        let mut transcript = String::new();
        for (i, segment) in segments.iter().enumerate() {
            if segment.samples.len() < 1600 {
                continue; // same short-segment skip as import
            }
            let (text, conf, _) = engine
                .transcribe_audio_with_confidence(segment.samples.clone(), Some(language.clone()))
                .await
                .unwrap_or_else(|e| panic!("transcription failed on segment {}: {}", i, e));
            println!(
                "segment {} ({:.1}s, conf {:.2}): {}",
                i,
                (segment.end_timestamp_ms - segment.start_timestamp_ms) / 1000.0,
                conf,
                text.trim()
            );
            if !text.trim().is_empty() {
                transcript.push_str(text.trim());
                transcript.push(' ');
            }
        }
        let transcribe_secs = t3.elapsed().as_secs_f64();
        println!(
            "transcribed {:.1}s of audio in {:.2}s ({:.2}x real-time)",
            audio_secs,
            transcribe_secs,
            audio_secs / transcribe_secs
        );
        println!("full transcript:\n{}", transcript.trim());

        assert!(
            !transcript.trim().is_empty(),
            "pipeline produced an empty transcript"
        );
        // Mongolian output must be Cyrillic, not Latin gibberish or English
        let cyrillic = transcript
            .chars()
            .filter(|c| ('\u{0400}'..='\u{04FF}').contains(c))
            .count();
        let letters = transcript.chars().filter(|c| c.is_alphabetic()).count();
        assert!(
            cyrillic * 2 > letters,
            "transcript is not predominantly Cyrillic ({} of {} letters): {}",
            cyrillic,
            letters,
            transcript
        );
    });
}
