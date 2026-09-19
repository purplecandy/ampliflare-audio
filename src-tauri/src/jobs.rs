//! Each job takes one input file and writes one output file.
//! Heavy work runs in two outside programs:
//!   deep-filter  removes noise (bundled as a sidecar)
//!   ffmpeg       decodes, encodes, cuts and normalizes
//! This file only builds the command lines, runs them and reports progress.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{process::Command, ShellExt};

/// What the user asked to do with a file.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    /// Remove background noise. `strength` is 0 to 100.
    Denoise { strength: u8 },
    /// Change the file format, for example mp3 to wav.
    Convert { format: String, bitrate: Option<String> },
    /// Keep only the part between `start` and `end` seconds.
    Cut { start: f64, end: Option<f64> },
    /// Even out the volume and remove low rumble.
    Enhance { target_lufs: f64 },
}

/// Sent to the window while a job runs.
#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub id: String,
    pub step: String,
}

/// Which tools we can find on this machine.
#[derive(Debug, Clone, Serialize)]
pub struct Tools {
    pub deep_filter: bool,
    pub ffmpeg: Option<String>,
}

const AUDIO_EXTS: &[&str] = &["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif", "wma"];

fn report(app: &AppHandle, id: &str, step: &str) {
    let _ = app.emit("job-progress", Progress { id: id.to_string(), step: step.to_string() });
}

/// Find ffmpeg. Apps opened from Finder get a tiny PATH, so check the usual spots too.
fn find_ffmpeg() -> Option<String> {
    let candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
    for c in candidates {
        if Path::new(c).is_file() {
            return Some(c.to_string());
        }
    }
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join("ffmpeg");
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn ffmpeg(app: &AppHandle) -> Result<Command, String> {
    let bin = find_ffmpeg().ok_or("ffmpeg was not found. Install it with: brew install ffmpeg")?;
    // -y overwrites, -nostdin stops it waiting for a keypress, -loglevel error keeps output small.
    Ok(app.shell().command(bin).args(["-y", "-nostdin", "-loglevel", "error"]))
}

async fn run(cmd: Command, what: &str) -> Result<(), String> {
    let out = cmd.output().await.map_err(|e| format!("{what} failed to start: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let err = err.trim();
    let err = if err.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { err.to_string() };
    Err(format!("{what} failed: {err}"))
}

fn stem_and_ext(input: &Path) -> Result<(String, String), String> {
    let stem = input.file_stem().and_then(|s| s.to_str()).ok_or("Bad file name")?.to_string();
    let ext = input.extension().and_then(|s| s.to_str()).unwrap_or("wav").to_lowercase();
    Ok((stem, ext))
}

/// Pick a spot for the output so we never overwrite the input.
fn output_path(out_dir: &Path, stem: &str, suffix: &str, ext: &str) -> PathBuf {
    let mut p = out_dir.join(format!("{stem}{suffix}.{ext}"));
    let mut n = 2;
    while p.exists() {
        p = out_dir.join(format!("{stem}{suffix}-{n}.{ext}"));
        n += 1;
    }
    p
}

/// Encoder settings ffmpeg needs for lossy formats. Lossless formats need none.
fn encode_args(ext: &str, bitrate: Option<&str>) -> Vec<String> {
    let br = bitrate.unwrap_or("192k").to_string();
    match ext {
        "mp3" => vec!["-c:a".into(), "libmp3lame".into(), "-b:a".into(), br],
        "m4a" | "aac" => vec!["-c:a".into(), "aac".into(), "-b:a".into(), br],
        "ogg" => vec!["-c:a".into(), "libvorbis".into(), "-b:a".into(), br],
        "opus" => vec!["-c:a".into(), "libopus".into(), "-b:a".into(), br],
        _ => vec![],
    }
}

#[tauri::command]
pub fn check_tools(app: AppHandle) -> Tools {
    let deep_filter = app.shell().sidecar("deep-filter").is_ok();
    Tools { deep_filter, ffmpeg: find_ffmpeg() }
}

#[tauri::command]
pub fn is_audio_file(path: String) -> bool {
    Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Run one action on one file. Returns the path of the new file.
#[tauri::command]
pub async fn run_job(
    app: AppHandle,
    id: String,
    input: String,
    output_dir: String,
    action: Action,
) -> Result<String, String> {
    let input = PathBuf::from(input);
    let out_dir = PathBuf::from(output_dir);
    if !input.is_file() {
        return Err("Input file does not exist".into());
    }
    tokio::fs::create_dir_all(&out_dir).await.map_err(|e| format!("Cannot create output folder: {e}"))?;
    let (stem, ext) = stem_and_ext(&input)?;

    match action {
        Action::Denoise { strength } => denoise(&app, &id, &input, &out_dir, &stem, &ext, strength).await,
        Action::Convert { format, bitrate } => {
            report(&app, &id, "Converting");
            let fmt = format.to_lowercase();
            let out = output_path(&out_dir, &stem, "", &fmt);
            let cmd = ffmpeg(&app)?
                .args(["-i", &input.to_string_lossy()])
                .args(encode_args(&fmt, bitrate.as_deref()))
                .arg(&out);
            run(cmd, "ffmpeg").await?;
            Ok(out.to_string_lossy().to_string())
        }
        Action::Cut { start, end } => {
            report(&app, &id, "Cutting");
            let out = output_path(&out_dir, &stem, "-cut", &ext);
            let mut cmd = ffmpeg(&app)?.args(["-i", &input.to_string_lossy(), "-ss", &start.to_string()]);
            if let Some(end) = end {
                cmd = cmd.args(["-to", &end.to_string()]);
            }
            let cmd = cmd.args(encode_args(&ext, None)).arg(&out);
            run(cmd, "ffmpeg").await?;
            Ok(out.to_string_lossy().to_string())
        }
        Action::Enhance { target_lufs } => {
            report(&app, &id, "Enhancing");
            let out = output_path(&out_dir, &stem, "-enhanced", &ext);
            // highpass drops rumble under 80 Hz. loudnorm brings speech to a standard level.
            let filter = format!("highpass=f=80,loudnorm=I={target_lufs}:TP=-1.5:LRA=11");
            let cmd = ffmpeg(&app)?
                .args(["-i", &input.to_string_lossy(), "-af", &filter])
                .args(encode_args(&ext, None))
                .arg(&out);
            run(cmd, "ffmpeg").await?;
            Ok(out.to_string_lossy().to_string())
        }
    }
}

/// Noise removal is three steps:
/// 1. ffmpeg turns the input into a 48 kHz wav, which is what deep-filter reads.
/// 2. deep-filter cleans it.
/// 3. ffmpeg writes the result back in the input's format.
async fn denoise(
    app: &AppHandle,
    id: &str,
    input: &Path,
    out_dir: &Path,
    stem: &str,
    ext: &str,
    strength: u8,
) -> Result<String, String> {
    let work = std::env::temp_dir().join("ampliflare").join(id);
    let df_out = work.join("out");
    tokio::fs::create_dir_all(&df_out).await.map_err(|e| format!("Cannot create temp folder: {e}"))?;
    let wav_in = work.join("in.wav");
    let wav_clean = df_out.join("in.wav");

    report(app, id, "Preparing audio");
    let cmd = ffmpeg(app)?
        .args(["-i", &input.to_string_lossy(), "-ar", "48000", "-c:a", "pcm_s16le"])
        .arg(&wav_in);
    run(cmd, "ffmpeg").await?;

    report(app, id, "Removing noise");
    // deep-filter's limit is in dB. 100 means take out as much noise as it can.
    let atten = strength.min(100).to_string();
    let cmd = app
        .shell()
        .sidecar("deep-filter")
        .map_err(|e| format!("deep-filter is missing: {e}"))?
        .args(["-D", "-a", &atten, "-o"])
        .arg(&df_out)
        .arg(&wav_in);
    run(cmd, "deep-filter").await?;
    if !wav_clean.is_file() {
        return Err("deep-filter did not write an output file".into());
    }

    report(app, id, "Saving");
    let out = output_path(out_dir, stem, "-clean", ext);
    if ext == "wav" {
        tokio::fs::copy(&wav_clean, &out).await.map_err(|e| format!("Cannot save output: {e}"))?;
    } else {
        let cmd = ffmpeg(app)?
            .args(["-i", &wav_clean.to_string_lossy()])
            .args(encode_args(ext, None))
            .arg(&out);
        run(cmd, "ffmpeg").await?;
    }

    let _ = tokio::fs::remove_dir_all(&work).await;
    Ok(out.to_string_lossy().to_string())
}
