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
    /// Break the file into pieces at these times, in seconds.
    Split { points: Vec<f64> },
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
pub(crate) fn find_ffmpeg() -> Option<String> {
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

/// How new files are named when the user has not picked a pattern.
/// It gives names like talk-clean.wav, talk-enhanced.wav and talk-part1.wav.
const DEFAULT_PATTERN: &str = "{name}-{tool}";

/// Fill in a name pattern. {name} is the input's name without its extension,
/// {tool} is what we did to it and {n} is a number. The window fills in {date}
/// before it sends the pattern, since it knows the local date.
fn render_name(pattern: &str, stem: &str, tool: &str, n: Option<usize>) -> String {
    let mut pattern = pattern.to_string();
    // An empty token takes the dash next to it along, so "{name}-{tool}" gives "talk", not "talk-".
    for (token, empty) in [("{tool}", tool.is_empty()), ("{n}", n.is_none())] {
        if !empty {
            continue;
        }
        for sep in ["-", "_", " ", "."] {
            pattern = pattern.replace(&format!("{sep}{token}"), "").replace(&format!("{token}{sep}"), "");
        }
    }
    let n = n.map(|n| n.to_string()).unwrap_or_default();
    let name = pattern.replace("{name}", stem).replace("{tool}", tool).replace("{n}", &n);
    // A file name can't hold folder breaks.
    let name: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':') || c.is_control() { '-' } else { c })
        .collect();
    if name.trim().is_empty() {
        stem.to_string()
    } else {
        name
    }
}

/// Split writes many files, so each needs a number. Add one if the pattern has no way to tell them apart.
fn split_pattern(pattern: &str) -> String {
    if pattern.contains("{n}") || pattern.contains("{tool}") {
        pattern.to_string()
    } else {
        format!("{pattern}-{{n}}")
    }
}

/// Pick a spot for the output so we never overwrite the input or an older result.
fn output_path(out_dir: &Path, pattern: &str, stem: &str, tool: &str, part: Option<usize>, ext: &str) -> PathBuf {
    let pattern = if pattern.trim().is_empty() { DEFAULT_PATTERN } else { pattern };
    let at = |name: String| out_dir.join(format!("{name}.{ext}"));
    if part.is_none() && pattern.contains("{n}") {
        // The number is part of the name, so count up until the name is free.
        return (1..).map(|n| at(render_name(pattern, stem, tool, Some(n)))).find(|p| !p.exists()).unwrap();
    }
    let base = render_name(pattern, stem, tool, part);
    let first = at(base.clone());
    if !first.exists() {
        return first;
    }
    (2..).map(|n| at(format!("{base}-{n}"))).find(|p| !p.exists()).unwrap()
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

/// Run one action on one file. Returns the paths of the new files.
#[tauri::command]
pub async fn run_job(
    app: AppHandle,
    id: String,
    input: String,
    output_dir: String,
    name_pattern: Option<String>,
    action: Action,
) -> Result<Vec<String>, String> {
    let input = PathBuf::from(input);
    let out_dir = PathBuf::from(output_dir);
    let pattern = name_pattern.unwrap_or_default();
    if !input.is_file() {
        return Err("Input file does not exist".into());
    }
    tokio::fs::create_dir_all(&out_dir).await.map_err(|e| format!("Cannot create output folder: {e}"))?;
    let (stem, ext) = stem_and_ext(&input)?;

    match action {
        Action::Denoise { strength } => {
            let out = denoise(&app, &id, &input, &out_dir, &pattern, &stem, &ext, strength).await?;
            Ok(vec![out])
        }
        Action::Convert { format, bitrate } => {
            report(&app, &id, "Converting");
            let fmt = format.to_lowercase();
            let out = output_path(&out_dir, &pattern, &stem, "", None, &fmt);
            let cmd = ffmpeg(&app)?
                .args(["-i", &input.to_string_lossy()])
                .args(encode_args(&fmt, bitrate.as_deref()))
                .arg(&out);
            run(cmd, "ffmpeg").await?;
            Ok(vec![out.to_string_lossy().to_string()])
        }
        Action::Cut { start, end } => {
            report(&app, &id, "Cutting");
            let out = output_path(&out_dir, &pattern, &stem, "cut", None, &ext);
            let mut cmd = ffmpeg(&app)?.args(["-i", &input.to_string_lossy(), "-ss", &start.to_string()]);
            if let Some(end) = end {
                cmd = cmd.args(["-to", &end.to_string()]);
            }
            let cmd = cmd.args(encode_args(&ext, None)).arg(&out);
            run(cmd, "ffmpeg").await?;
            Ok(vec![out.to_string_lossy().to_string()])
        }
        Action::Split { points } => split(&app, &id, &input, &out_dir, &pattern, &stem, &ext, points).await,
        Action::Enhance { target_lufs } => {
            report(&app, &id, "Enhancing");
            let out = output_path(&out_dir, &pattern, &stem, "enhanced", None, &ext);
            // highpass drops rumble under 80 Hz. loudnorm brings speech to a standard level.
            let filter = format!("highpass=f=80,loudnorm=I={target_lufs}:TP=-1.5:LRA=11");
            let cmd = ffmpeg(&app)?
                .args(["-i", &input.to_string_lossy(), "-af", &filter])
                .args(encode_args(&ext, None))
                .arg(&out);
            run(cmd, "ffmpeg").await?;
            Ok(vec![out.to_string_lossy().to_string()])
        }
    }
}

/// Cut the file at each point. Three points make four pieces.
async fn split(
    app: &AppHandle,
    id: &str,
    input: &Path,
    out_dir: &Path,
    pattern: &str,
    stem: &str,
    ext: &str,
    points: Vec<f64>,
) -> Result<Vec<String>, String> {
    let pattern = split_pattern(if pattern.trim().is_empty() { DEFAULT_PATTERN } else { pattern });
    let mut points: Vec<f64> = points.into_iter().filter(|p| *p > 0.0).collect();
    points.sort_by(|a, b| a.partial_cmp(b).unwrap());
    points.dedup();
    if points.is_empty() {
        return Err("Add at least one split point".into());
    }

    let mut outs = Vec::new();
    let mut start = 0.0;
    let pieces = points.len() + 1;
    for (i, end) in points.iter().map(Some).chain(std::iter::once(None)).enumerate() {
        report(app, id, &format!("Writing part {} of {pieces}", i + 1));
        let out = output_path(out_dir, &pattern, stem, &format!("part{}", i + 1), Some(i + 1), ext);
        let mut cmd = ffmpeg(app)?.args(["-i", &input.to_string_lossy(), "-ss", &start.to_string()]);
        if let Some(end) = end {
            cmd = cmd.args(["-to", &end.to_string()]);
            start = *end;
        }
        let cmd = cmd.args(encode_args(ext, None)).arg(&out);
        run(cmd, "ffmpeg").await?;
        outs.push(out.to_string_lossy().to_string());
    }
    Ok(outs)
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
    pattern: &str,
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
    let out = output_path(out_dir, pattern, stem, "clean", None, ext);
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

/// Files and tab to open at start. Only works in debug builds and only when
/// AMPLIFLARE_DEV_FILES (paths joined by ":") or AMPLIFLARE_DEV_ACTION is set.
/// Lets us start the app already loaded, which makes testing quick.
#[derive(Debug, Clone, Serialize)]
pub struct DevStart {
    pub files: Vec<String>,
    pub action: Option<String>,
}

#[tauri::command]
pub fn dev_start() -> DevStart {
    if !cfg!(debug_assertions) {
        return DevStart { files: vec![], action: None };
    }
    let files = std::env::var("AMPLIFLARE_DEV_FILES")
        .map(|v| v.split(':').filter(|s| !s.is_empty()).map(String::from).collect())
        .unwrap_or_default();
    DevStart { files, action: std::env::var("AMPLIFLARE_DEV_ACTION").ok() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_in_a_pattern() {
        assert_eq!(render_name(DEFAULT_PATTERN, "talk", "clean", None), "talk-clean");
        assert_eq!(render_name("{tool} {name} {n}", "talk", "cut", Some(3)), "cut talk 3");
        assert_eq!(render_name("{name}/{tool}", "talk", "clean", None), "talk-clean");
    }

    #[test]
    fn drops_the_dash_next_to_an_empty_token() {
        assert_eq!(render_name(DEFAULT_PATTERN, "talk", "", None), "talk");
        assert_eq!(render_name("{tool}_{name}", "talk", "", None), "talk");
        assert_eq!(render_name("{name}-{n}", "talk", "clean", None), "talk");
        assert_eq!(render_name("{tool}", "talk", "", None), "talk");
    }

    #[test]
    fn split_always_numbers_its_parts() {
        assert_eq!(split_pattern("{name}"), "{name}-{n}");
        assert_eq!(split_pattern(DEFAULT_PATTERN), DEFAULT_PATTERN);
        assert_eq!(split_pattern("{name} {n}"), "{name} {n}");
    }

    #[test]
    fn never_reuses_a_taken_name() {
        let dir = std::env::temp_dir().join("ampliflare-test-names");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let first = output_path(&dir, "", "talk", "clean", None, "wav");
        assert_eq!(first, dir.join("talk-clean.wav"));
        std::fs::write(&first, b"").unwrap();
        assert_eq!(output_path(&dir, "", "talk", "clean", None, "wav"), dir.join("talk-clean-2.wav"));

        std::fs::write(dir.join("talk-1.wav"), b"").unwrap();
        assert_eq!(output_path(&dir, "{name}-{n}", "talk", "clean", None, "wav"), dir.join("talk-2.wav"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
