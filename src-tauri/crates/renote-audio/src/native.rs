//! The real `cpal`-backed capture, compiled only on Linux/BSD — see the crate root doc comment
//! for why.

use std::io::Cursor;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

#[derive(Debug, thiserror::Error)]
pub enum AudioCaptureError {
    #[error("no input (microphone) device is available")]
    NoInputDevice,
    #[error("failed to read the input device's default config: {0}")]
    DefaultConfig(#[from] cpal::DefaultStreamConfigError),
    #[error("failed to build the input stream: {0}")]
    BuildStream(#[from] cpal::BuildStreamError),
    #[error("failed to start the input stream: {0}")]
    PlayStream(#[from] cpal::PlayStreamError),
    #[error("input device reports an unsupported sample format: {0:?}")]
    UnsupportedSampleFormat(cpal::SampleFormat),
    #[error("failed to encode captured audio as WAV: {0}")]
    Wav(#[from] hound::Error),
}

/// An in-progress capture: the live `cpal::Stream` plus the samples its audio-thread callback is
/// writing into. There is no explicit "stop" call on `cpal::Stream` itself — dropping it (which
/// [`AudioCapture::finish`] does) is what stops capture.
pub struct AudioCapture {
    stream: cpal::Stream,
    samples: Arc<Mutex<Vec<f32>>>,
    channels: u16,
    sample_rate: u32,
}

// cpal's `Stream` is `!Send` on every backend as a blanket, portability-driven choice (some
// backends, e.g. CoreAudio, genuinely can't support moving it across threads) — not because
// ALSA specifically can't. ALSA's `snd_pcm_t` handle (`StreamInner::channel` inside cpal's own
// alsa backend) has no single-thread-affinity requirement; the only real constraint is "never
// touched from two threads at once", which `AudioCaptureState`'s `Mutex` already guarantees
// (`start()` creates it on one Tauri command-pool thread, `finish()` consumes/drops it on
// whichever thread the matching `stop_native_audio_capture` call happens to land on — never
// concurrently). Tauri's managed state requires `Send`, so this crate needs the same guarantee
// cpal itself declines to make portable.
unsafe impl Send for AudioCapture {}

impl AudioCapture {
    /// Opens the default input device at its default config and starts capturing immediately.
    pub fn start() -> Result<Self, AudioCaptureError> {
        let host = cpal::default_host();
        let device = host.default_input_device().ok_or(AudioCaptureError::NoInputDevice)?;
        let supported_config = device.default_input_config()?;
        let sample_format = supported_config.sample_format();
        let config: cpal::StreamConfig = supported_config.into();
        let channels = config.channels;
        let sample_rate = config.sample_rate.0;

        let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
        let samples_for_callback = Arc::clone(&samples);
        // The callback itself cannot return a `Result` — this is the one place a capture
        // failure *after* `start()` has already returned successfully can only be logged, not
        // surfaced to the caller. `finish()` still returns whatever was captured before the
        // failure, which for a mid-recording device hiccup is more useful than losing everything.
        let on_stream_error = |err: cpal::StreamError| {
            eprintln!("renote-audio: input stream error: {err}");
        };

        let stream = match sample_format {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    push_samples(&samples_for_callback, data.iter().copied());
                },
                on_stream_error,
                None,
            )?,
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    push_samples(
                        &samples_for_callback,
                        data.iter().map(|&sample| sample as f32 / i16::MAX as f32),
                    );
                },
                on_stream_error,
                None,
            )?,
            cpal::SampleFormat::U16 => device.build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    push_samples(
                        &samples_for_callback,
                        data.iter().map(|&sample| (sample as f32 / u16::MAX as f32) * 2.0 - 1.0),
                    );
                },
                on_stream_error,
                None,
            )?,
            other => return Err(AudioCaptureError::UnsupportedSampleFormat(other)),
        };
        stream.play()?;

        Ok(Self { stream, samples, channels, sample_rate })
    }

    /// Stops capture and encodes everything captured so far as a WAV file's raw bytes.
    pub fn finish(self) -> Result<Vec<u8>, AudioCaptureError> {
        drop(self.stream);
        let samples = Arc::try_unwrap(self.samples)
            .unwrap_or_else(|shared| {
                Mutex::new(shared.lock().expect("sample buffer mutex poisoned").clone())
            })
            .into_inner()
            .expect("sample buffer mutex poisoned");
        encode_wav(&samples, self.channels, self.sample_rate)
    }
}

fn push_samples(buffer: &Arc<Mutex<Vec<f32>>>, samples: impl Iterator<Item = f32>) {
    buffer.lock().expect("sample buffer mutex poisoned").extend(samples);
}

/// Encodes `samples` (interleaved if `channels > 1`) as a WAV file's raw bytes. Free function,
/// independent of any live `cpal::Stream`, so it's testable without a real input device.
///
/// 16-bit integer PCM, not 32-bit float: float WAV (format code 3) needs a decoder that not
/// every GStreamer install actually has, and playback (WebKitGTK's `<audio>`, on the very same
/// Linux boxes this crate's doc comment already flags as unreliable for codecs) failed with a
/// GStreamer `FormatError` against float-encoded recordings. 16-bit int PCM (format code 1) is
/// the one WAV variant every decoder — GStreamer included — has always supported.
fn encode_wav(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
) -> Result<Vec<u8>, AudioCaptureError> {
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        for sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            writer.write_sample((clamped * i16::MAX as f32) as i16)?;
        }
        writer.finalize()?;
    }
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_wav_round_trips_samples_through_hound() {
        let samples = [0.0_f32, 0.5, -0.5, 1.0, -1.0];
        let bytes = encode_wav(&samples, 1, 48_000).expect("encode_wav");

        let mut reader = hound::WavReader::new(Cursor::new(bytes)).expect("valid wav");
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.spec().sample_rate, 48_000);
        assert_eq!(reader.spec().bits_per_sample, 16);
        assert_eq!(reader.spec().sample_format, hound::SampleFormat::Int);
        let read_back: Vec<i16> = reader.samples::<i16>().map(|s| s.expect("sample")).collect();
        for (expected, actual) in samples.iter().zip(read_back.iter()) {
            let expected_i16 = (expected.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            assert_eq!(expected_i16, *actual);
        }
    }

    #[test]
    fn encode_wav_of_an_empty_buffer_is_still_a_valid_wav() {
        let bytes = encode_wav(&[], 2, 44_100).expect("encode_wav");
        let reader = hound::WavReader::new(Cursor::new(bytes)).expect("valid wav");
        assert_eq!(reader.spec().channels, 2);
        assert_eq!(reader.duration(), 0);
    }
}
