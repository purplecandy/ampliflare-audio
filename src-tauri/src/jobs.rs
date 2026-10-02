//! Each job takes one input file and writes one output file.
//! Heavy work runs in two outside programs:
//!   deep-filter  removes noise (bundled as a sidecar)
//!   ffmpeg       decodes, encodes, cuts and normalizes
//! This file only builds the command lines, runs them and reports progress.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// The program each job is running right now, so Stop can end it.
static RUNNING: LazyLock<Mutex<HashMap<String, CommandChild>>> = LazyLock::new(Default::default);
/// Jobs the user stopped. Checked before each step, so a stopped job never starts its next one.
static STOPPED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// The error a stopped job returns. The window checks for this exact text.
const STOPPED_MSG: &str = "Stopped";

fn is_stopped(id: &str) -> bool {
    STOPPED.lock().unwrap().contains(id)
}

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
    /// 0 to 100, when we know how long the step is.
    pub percent: Option<f64>,
}

/// Which tools we can find on this machine.
#[derive(Debug, Clone, Serialize)]
pub struct Tools {
    pub deep_filter: bool,
    pub ffmpeg: Option<String>,
}

const AUDIO_EXTS: &[&str] = &[
    "wav",
    "mp3",
    "m4a",
    "aac",
    "flac",
    "ogg",
    "oga",
    "opus",
    "wma",
    "aiff",
    "aif",
    "aifc",
    "caf",
    "au",
    "snd",
    "w64",
    "amr",
    "awb",
    "3ga",
    "mp2",
    "mp1",
    "mka",
    "weba",
    "spx",
    "ac3",
    "eac3",
    "dts",
    "m4b",
    "m4r",
    "wv",
    "ape",
    "tta",
    "tak",
    "mpc",
    "dsf",
    "mlp",
    "thd",
    "voc",
    "gsm",
    "oma",
    "at3",
    "ra",
];

fn report(app: &AppHandle, id: &str, step: &str, percent: Option<f64>) {
    let _ = app.emit("job-progress", Progress { id: id.to_string(), step: step.to_string(), percent });
}

/// Find ffmpeg. Apps opened from Finder get a tiny PATH, so check the usual spots too.
/// The ffmpeg bundled with the app, which Tauri puts next to its executable,
/// then one installed on the system.
pub(crate) fn find_ffmpeg() -> Option<String> {
    let bundled = if cfg!(windows) { "ampliflare-ffmpeg.exe" } else { "ampliflare-ffmpeg" };
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        let p = dir.join(bundled);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    let candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
    for c in candidates {
        if Path::new(c).is_file() {
            return Some(c.to_string());
        }
    }
    let path = std::env::var_os("PATH")?;
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    for dir in std::env::split_paths(&path) {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn ffmpeg(app: &AppHandle) -> Result<Command, String> {
    let bin = find_ffmpeg().ok_or("ffmpeg is missing from the app. Reinstall Ampliflare Audio.")?;
    // -y overwrites, -nostdin stops it waiting for a keypress, -loglevel error keeps output small.
    // -progress pipe:1 prints how far it has got, which run() turns into a percent.
    Ok(app.shell().command(bin).args(["-y", "-nostdin", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]))
}

/// How long the input is, so a step can say how far along it is. None if ffmpeg can't tell.
async fn length_of(input: &Path) -> Option<f64> {
    let ffmpeg = find_ffmpeg()?;
    let input = input.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || crate::analyze::duration_seconds(&ffmpeg, &input).ok())
        .await
        .ok()
        .flatten()
        .filter(|s| *s > 0.0)
}

/// One step of a job: run a program and report its progress as it goes.
/// `seconds` is how much audio the step writes, for the percent.
/// `out` is the file the step writes. A stopped step deletes it, since it is only half done.
async fn run(
    app: &AppHandle,
    id: &str,
    cmd: Command,
    what: &str,
    label: &str,
    seconds: Option<f64>,
    out: Option<&Path>,
) -> Result<(), String> {
    if is_stopped(id) {
        return Err(STOPPED_MSG.into());
    }
    report(app, id, label, seconds.map(|_| 0.0));
    let (mut events, child) = cmd.spawn().map_err(|e| format!("{what} failed to start: {e}"))?;
    RUNNING.lock().unwrap().insert(id.to_string(), child);

    let mut stderr: Vec<String> = Vec::new();
    let mut stdout: Vec<String> = Vec::new();
    let mut code = None;
    let mut last = -1.0;
    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let line = String::from_utf8_lossy(&line).trim().to_string();
                if let Some(us) = line.strip_prefix("out_time_us=") {
                    if let (Some(total), Ok(us)) = (seconds, us.parse::<f64>()) {
                        let percent = (us / 1e6 / total * 100.0).clamp(0.0, 100.0).floor();
                        if percent != last {
                            last = percent;
                            report(app, id, label, Some(percent));
                        }
                    }
                } else if !line.contains('=') && !line.is_empty() {
                    stdout.push(line);
                }
            }
            CommandEvent::Stderr(line) => stderr.push(String::from_utf8_lossy(&line).trim().to_string()),
            CommandEvent::Error(e) => stderr.push(e),
            CommandEvent::Terminated(payload) => code = payload.code,
            _ => {}
        }
    }
    RUNNING.lock().unwrap().remove(id);

    if is_stopped(id) {
        if let Some(out) = out {
            let _ = tokio::fs::remove_file(out).await;
        }
        return Err(STOPPED_MSG.into());
    }
    if code == Some(0) {
        return Ok(());
    }
    let lines = if stderr.iter().any(|l| !l.is_empty()) { stderr } else { stdout };
    let tail = lines.len().saturating_sub(20);
    Err(format!("{what} failed: {}", lines[tail..].join("\n").trim()))
}

/// End a running job now. The program is killed and its half-written file deleted.
#[tauri::command]
pub fn stop_job(id: String) {
    STOPPED.lock().unwrap().insert(id.clone());
    if let Some(child) = RUNNING.lock().unwrap().remove(&id) {
        let _ = child.kill();
    }
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
        "ogg" | "oga" => vec!["-c:a".into(), "libvorbis".into(), "-b:a".into(), br],
        "wma" => vec!["-c:a".into(), "wmav2".into(), "-b:a".into(), br],
        "ac3" => vec!["-c:a".into(), "ac3".into(), "-b:a".into(), br],
        "mp2" => vec!["-c:a".into(), "mp2".into(), "-b:a".into(), br],
        // WavPack's encoder fails on the odd frame sizes mp3 and ogg decode to.
        "wv" => vec!["-frame_size".into(), "4096".into()],
        "mka" => vec!["-c:a".into(), "flac".into()],
        "opus" => vec!["-c:a".into(), "libopus".into(), "-b:a".into(), br],
        _ => vec![],
    }
}

#[tauri::command]
pub fn check_tools(app: AppHandle) -> Tools {
    let deep_filter = app.shell().sidecar("deep-filter").is_ok();
    Tools { deep_filter, ffmpeg: find_ffmpeg() }
}

/// Files bigger than this are streamed from disk instead of read into memory.
const MAX_PLAY_BYTES: u64 = 300 * 1024 * 1024;

/// Read a whole audio file so the window can play it from memory. Streaming it
/// through the asset protocol sends a new request on every seek, which lags.
#[tauri::command]
pub async fn read_audio(path: String) -> Result<tauri::ipc::Response, String> {
    if !is_audio_file(path.clone()) {
        return Err("Not an audio file".into());
    }
    let meta = tokio::fs::metadata(&path).await.map_err(|e| format!("Cannot read file: {e}"))?;
    if meta.len() > MAX_PLAY_BYTES {
        return Err("Too big to load at once".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| format!("Cannot read file: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Which of these files are still on disk. The activity log uses it to know what can be played.
#[tauri::command]
pub fn files_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
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
/// Free use counts each finished file toward its weekly limit. See license.rs.
#[tauri::command]
pub async fn run_job(
    app: AppHandle,
    id: String,
    input: String,
    output_dir: String,
    name_pattern: Option<String>,
    action: Action,
) -> Result<Vec<String>, String> {
    crate::license::check_quota(&app)?;
    STOPPED.lock().unwrap().remove(&id);
    let result = run_action(app.clone(), id.clone(), input, output_dir, name_pattern, action).await;
    STOPPED.lock().unwrap().remove(&id);
    let outputs = result?;
    crate::license::count_file(&app);
    Ok(outputs)
}

async fn run_action(
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
    let length = length_of(&input).await;

    match action {
        Action::Denoise { strength } => {
            let work = std::env::temp_dir().join("ampliflare").join(&id);
            let result = denoise(&app, &id, &input, &work, &out_dir, &pattern, &stem, &ext, strength, length).await;
            let _ = tokio::fs::remove_dir_all(&work).await;
            Ok(vec![result?])
        }
        Action::Convert { format, bitrate } => {
            let fmt = format.to_lowercase();
            let out = output_path(&out_dir, &pattern, &stem, "", None, &fmt);
            let cmd = ffmpeg(&app)?
                .args(["-i", &input.to_string_lossy()])
                .args(encode_args(&fmt, bitrate.as_deref()))
                .arg(&out);
            run(&app, &id, cmd, "ffmpeg", "Converting", length, Some(&out)).await?;
            Ok(vec![out.to_string_lossy().to_string()])
        }
        Action::Cut { start, end } => {
            let out = output_path(&out_dir, &pattern, &stem, "cut", None, &ext);
            let mut cmd = ffmpeg(&app)?.args(["-i", &input.to_string_lossy(), "-ss", &start.to_string()]);
            if let Some(end) = end {
                cmd = cmd.args(["-to", &end.to_string()]);
            }
            let cmd = cmd.args(encode_args(&ext, None)).arg(&out);
            let seconds = end.or(length).map(|e| e - start).filter(|s| *s > 0.0);
            run(&app, &id, cmd, "ffmpeg", "Cutting", seconds, Some(&out)).await?;
            Ok(vec![out.to_string_lossy().to_string()])
        }
        Action::Split { points } => split(&app, &id, &input, &out_dir, &pattern, &stem, &ext, points, length).await,
        Action::Enhance { target_lufs } => {
            let out = output_path(&out_dir, &pattern, &stem, "enhanced", None, &ext);
            // highpass drops rumble under 80 Hz. loudnorm brings speech to a standard level.
            let filter = format!("highpass=f=80,loudnorm=I={target_lufs}:TP=-1.5:LRA=11");
            let cmd = ffmpeg(&app)?
                .args(["-i", &input.to_string_lossy(), "-af", &filter])
                .args(encode_args(&ext, None))
                .arg(&out);
            run(&app, &id, cmd, "ffmpeg", "Enhancing", length, Some(&out)).await?;
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
    length: Option<f64>,
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
        let label = format!("Writing part {} of {pieces}", i + 1);
        let seconds = end.copied().or(length).map(|e| e - start).filter(|s| *s > 0.0);
        let out = output_path(out_dir, &pattern, stem, &format!("part{}", i + 1), Some(i + 1), ext);
        let mut cmd = ffmpeg(app)?.args(["-i", &input.to_string_lossy(), "-ss", &start.to_string()]);
        if let Some(end) = end {
            cmd = cmd.args(["-to", &end.to_string()]);
            start = *end;
        }
        let cmd = cmd.args(encode_args(ext, None)).arg(&out);
        if let Err(e) = run(app, id, cmd, "ffmpeg", &label, seconds, Some(&out)).await {
            // A stopped split leaves no loose parts behind.
            if e == STOPPED_MSG {
                for done in &outs {
                    let _ = tokio::fs::remove_file(done).await;
                }
            }
            return Err(e);
        }
        outs.push(out.to_string_lossy().to_string());
    }
    Ok(outs)
}

/// Noise removal is three steps:
/// 1. ffmpeg turns the input into a 48 kHz wav, which is what deep-filter reads.
/// 2. deep-filter cleans it.
/// 3. ffmpeg writes the result back in the input's format.
/// The caller deletes `work` afterwards, even when a step fails or is stopped.
#[allow(clippy::too_many_arguments)]
async fn denoise(
    app: &AppHandle,
    id: &str,
    input: &Path,
    work: &Path,
    out_dir: &Path,
    pattern: &str,
    stem: &str,
    ext: &str,
    strength: u8,
    length: Option<f64>,
) -> Result<String, String> {
    let df_out = work.join("out");
    tokio::fs::create_dir_all(&df_out).await.map_err(|e| format!("Cannot create temp folder: {e}"))?;
    let wav_in = work.join("in.wav");
    let wav_clean = df_out.join("in.wav");

    let cmd = ffmpeg(app)?
        .args(["-i", &input.to_string_lossy(), "-ar", "48000", "-c:a", "pcm_s16le"])
        .arg(&wav_in);
    run(app, id, cmd, "ffmpeg", "Preparing audio", length, None).await?;

    // deep-filter's limit is in dB. 100 means take out as much noise as it can.
    let atten = strength.min(100).to_string();
    let cmd = app
        .shell()
        .sidecar("deep-filter")
        .map_err(|e| format!("deep-filter is missing: {e}"))?
        .args(["-D", "-a", &atten, "-o"])
        .arg(&df_out)
        .arg(&wav_in);
    run(app, id, cmd, "deep-filter", "Removing noise", None, None).await?;
    if !wav_clean.is_file() {
        return Err("deep-filter did not write an output file".into());
    }

    let out = output_path(out_dir, pattern, stem, "clean", None, ext);
    if ext == "wav" {
        if is_stopped(id) {
            return Err(STOPPED_MSG.into());
        }
        report(app, id, "Saving", None);
        tokio::fs::copy(&wav_clean, &out).await.map_err(|e| format!("Cannot save output: {e}"))?;
    } else {
        let cmd = ffmpeg(app)?
            .args(["-i", &wav_clean.to_string_lossy()])
            .args(encode_args(ext, None))
            .arg(&out);
        run(app, id, cmd, "ffmpeg", "Saving", length, Some(&out)).await?;
    }
    Ok(out.to_string_lossy().to_string())
}

/// Files and tab to open at start. Only works in debug builds and only when
/// AMPLIFLARE_DEV_FILES (paths joined by ":"), AMPLIFLARE_DEV_ACTION or
/// AMPLIFLARE_DEV_LOOK (style/colours/accent, like "mac/dark/blue") is set.
/// Lets us start the app already loaded, which makes testing quick.
#[derive(Debug, Clone, Serialize)]
pub struct DevStart {
    pub files: Vec<String>,
    pub action: Option<String>,
    pub look: Option<String>,
    /// AMPLIFLARE_DEV_MARKS, like "9.5,46": the cut's start and end, or the
    /// split points, for the first file.
    pub marks: Vec<f64>,
}

#[tauri::command]
pub fn dev_start() -> DevStart {
    if !cfg!(debug_assertions) {
        return DevStart { files: vec![], action: None, look: None, marks: vec![] };
    }
    let files = std::env::var("AMPLIFLARE_DEV_FILES")
        .map(|v| v.split(':').filter(|s| !s.is_empty()).map(String::from).collect())
        .unwrap_or_default();
    DevStart {
        files,
        action: std::env::var("AMPLIFLARE_DEV_ACTION").ok(),
        look: std::env::var("AMPLIFLARE_DEV_LOOK").ok(),
        marks: std::env::var("AMPLIFLARE_DEV_MARKS")
            .map(|v| v.split(',').filter_map(|s| s.trim().parse().ok()).collect())
            .unwrap_or_default(),
    }
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
