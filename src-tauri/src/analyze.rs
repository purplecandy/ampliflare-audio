//! Builds a small spectrogram of a file so the UI can draw it.
//!
//! ffmpeg decodes the file to raw mono samples at 16 kHz and streams them to us.
//! We slide a 512 sample window over the stream, run an FFT on each window,
//! and keep the loudness of 128 frequency bands per step. The result is a
//! grid of bytes, one byte per band per step, sent to the UI as base64.
//! 16 kHz means the picture shows 0 to 8 kHz, which covers speech well.

use base64::Engine;
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

const RATE: usize = 16_000;
const WINDOW: usize = 512;
const BINS: usize = 128;
const TARGET_STEPS: usize = 1600;
const FLOOR_DB: f32 = 80.0;

#[derive(Debug, Clone, Serialize)]
pub struct Analysis {
    /// Length of the file in seconds.
    pub duration: f64,
    /// How many time steps the picture has.
    pub steps: usize,
    /// How many frequency bands each step has.
    pub bins: usize,
    /// Seconds between two steps.
    pub step_seconds: f64,
    /// steps * bins bytes, base64. Step first, then band from low to high. 255 is loudest.
    pub spectrogram: String,
    /// Loudest sample in each step, 0 to 1. Handy for a waveform.
    pub peaks: Vec<f32>,
}

#[tauri::command]
pub async fn analyze_audio(path: String) -> Result<Analysis, String> {
    tauri::async_runtime::spawn_blocking(move || analyze(Path::new(&path)))
        .await
        .map_err(|e| format!("Analysis crashed: {e}"))?
}

fn analyze(input: &Path) -> Result<Analysis, String> {
    let ffmpeg = crate::jobs::find_ffmpeg().ok_or("ffmpeg was not found")?;
    let duration = duration_seconds(&ffmpeg, input)?;

    // Pick a step size so the picture has about TARGET_STEPS columns.
    let total_samples = (duration * RATE as f64) as usize;
    let hop = (total_samples / TARGET_STEPS).max(WINDOW / 4);
    let need = hop.max(WINDOW);

    let mut child = Command::new(&ffmpeg)
        .args(["-nostdin", "-loglevel", "error", "-i"])
        .arg(input)
        .args(["-f", "f32le", "-ac", "1", "-ar", &RATE.to_string(), "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg failed to start: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("ffmpeg gave no output")?;

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(WINDOW);
    let hann: Vec<f32> = (0..WINDOW)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / WINDOW as f32).cos())
        .collect();

    let mut samples: Vec<f32> = Vec::with_capacity(need * 2);
    let mut leftover: Vec<u8> = Vec::new();
    let mut raw = vec![0u8; 1 << 16];
    let mut scratch = vec![Complex::new(0.0f32, 0.0); WINDOW];
    let mut db: Vec<f32> = Vec::with_capacity(TARGET_STEPS * BINS);
    let mut peaks: Vec<f32> = Vec::with_capacity(TARGET_STEPS);

    let step = |samples: &[f32], scratch: &mut Vec<Complex<f32>>, db: &mut Vec<f32>, peaks: &mut Vec<f32>| {
        let peak = samples[..hop.min(samples.len())].iter().fold(0.0f32, |m, s| m.max(s.abs()));
        peaks.push(peak.min(1.0));
        for i in 0..WINDOW {
            let s = samples.get(i).copied().unwrap_or(0.0);
            scratch[i] = Complex::new(s * hann[i], 0.0);
        }
        fft.process(scratch);
        // Bins 1..=256 cover 0 to 8 kHz. Merge pairs so we keep 128 bands.
        for b in 0..BINS {
            let a = scratch[1 + 2 * b].norm();
            let c = scratch[2 + 2 * b].norm();
            db.push(20.0 * (a.max(c) + 1e-9).log10());
        }
    };

    loop {
        let n = stdout.read(&mut raw).map_err(|e| format!("Read from ffmpeg failed: {e}"))?;
        if n == 0 {
            break;
        }
        leftover.extend_from_slice(&raw[..n]);
        let whole = leftover.len() / 4 * 4;
        for chunk in leftover[..whole].chunks_exact(4) {
            samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }
        leftover.drain(..whole);
        while samples.len() >= need {
            step(&samples, &mut scratch, &mut db, &mut peaks);
            samples.drain(..hop);
        }
    }
    if !samples.is_empty() {
        step(&samples, &mut scratch, &mut db, &mut peaks);
    }

    let status = child.wait().map_err(|e| format!("ffmpeg did not finish: {e}"))?;
    if !status.success() {
        let mut err = String::new();
        if let Some(mut e) = child.stderr.take() {
            let _ = e.read_to_string(&mut err);
        }
        return Err(format!("ffmpeg failed: {}", err.trim()));
    }

    // Scale so the loudest point is 255 and anything FLOOR_DB quieter is 0.
    let top = db.iter().cloned().fold(f32::MIN, f32::max);
    let bytes: Vec<u8> = db
        .iter()
        .map(|v| (((v - (top - FLOOR_DB)) / FLOOR_DB).clamp(0.0, 1.0) * 255.0) as u8)
        .collect();

    Ok(Analysis {
        duration,
        steps: peaks.len(),
        bins: BINS,
        step_seconds: hop as f64 / RATE as f64,
        spectrogram: base64::engine::general_purpose::STANDARD.encode(&bytes),
        peaks,
    })
}

/// Ask ffmpeg about the file and read the "Duration: 00:05:00.00" line it prints.
pub(crate) fn duration_seconds(ffmpeg: &str, input: &Path) -> Result<f64, String> {
    let out = Command::new(ffmpeg)
        .args(["-nostdin", "-hide_banner", "-i"])
        .arg(input)
        .output()
        .map_err(|e| format!("ffmpeg failed to start: {e}"))?;
    let text = String::from_utf8_lossy(&out.stderr);
    let line = text.lines().find(|l| l.contains("Duration:")).ok_or("Could not read the file length")?;
    let stamp = line.split("Duration:").nth(1).unwrap_or("").trim().split(',').next().unwrap_or("").trim();
    let parts: Vec<f64> = stamp.split(':').filter_map(|p| p.parse().ok()).collect();
    if parts.len() != 3 {
        return Err(format!("Odd duration text: {stamp}"));
    }
    Ok(parts[0] * 3600.0 + parts[1] * 60.0 + parts[2])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Makes a short test tone with ffmpeg, then checks the picture has the right shape.
    #[test]
    fn analyzes_a_short_file() {
        let ffmpeg = crate::jobs::find_ffmpeg().expect("ffmpeg installed");
        let dir = std::env::temp_dir().join("ampliflare-test");
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("tone.wav");
        let ok = Command::new(&ffmpeg)
            .args(["-y", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=1000:duration=3"])
            .arg(&wav)
            .status()
            .unwrap()
            .success();
        assert!(ok);

        let a = analyze(&wav).unwrap();
        assert!((a.duration - 3.0).abs() < 0.05, "duration {}", a.duration);
        assert_eq!(a.bins, BINS);
        assert_eq!(a.peaks.len(), a.steps);
        let bytes = base64::engine::general_purpose::STANDARD.decode(&a.spectrogram).unwrap();
        assert_eq!(bytes.len(), a.steps * a.bins);
        // A 1 kHz tone sits in band 16 (each band is 62.5 Hz). It should be the loudest band.
        let mid = a.steps / 2;
        let row = &bytes[mid * a.bins..(mid + 1) * a.bins];
        let loudest = row.iter().enumerate().max_by_key(|(_, v)| **v).unwrap().0;
        assert!((15..=17).contains(&loudest), "loudest band was {loudest}");
        // ffmpeg makes its test tone at one eighth of full volume.
        assert!(a.peaks[mid] > 0.1 && a.peaks[mid] < 0.2, "peak {}", a.peaks[mid]);
    }
}
