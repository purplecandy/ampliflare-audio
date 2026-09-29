//! Free use is for personal work and allows FREE_WEEKLY_FILES files a week.
//! A license key from Dodo Payments allows commercial use and has no limit.
//! No tool is locked either way.
//!
//! The week's count and the license are saved twice: in a file in the app's
//! data folder, and on macOS and Windows in the system keychain too, which
//! stays when the app is removed. Reading merges the two copies so that
//! deleting one does not reset the week. Someone who deletes both can reset
//! it, so this is a nudge, not a lock.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// How many files free use can process in a week. The site says the same
/// number in site/src/consts.ts, so change both together.
pub const FREE_WEEKLY_FILES: u32 = 20;

const WEEK: u64 = 7 * 24 * 60 * 60;

/// Ampliflare's product on Dodo. Release builds refuse a key bought for a
/// different product. Test mode has its own product ids, so debug builds skip it.
const PRODUCT_ID: &str = "pdt_0NobndRz8QFm6LfKHxgdr";

/// Debug builds use Dodo's test mode, so test keys work while developing.
/// AMPLIFLARE_DODO_URL can point them somewhere else.
fn dodo_url() -> String {
    if cfg!(debug_assertions) {
        std::env::var("AMPLIFLARE_DODO_URL").unwrap_or_else(|_| "https://test.dodopayments.com".into())
    } else {
        "https://live.dodopayments.com".into()
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
struct Usage {
    /// When this week began, in seconds since 1970. 0 means no file yet.
    week_start: u64,
    used: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct License {
    key: String,
    instance_id: String,
    /// The last time Dodo said the key is good, in seconds since 1970.
    checked_at: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Saved {
    usage: Usage,
    license: Option<License>,
}

/// What the window shows.
#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub licensed: bool,
    /// The last four characters of the key, to tell keys apart.
    pub key_end: Option<String>,
    pub used: u32,
    pub limit: u32,
    /// When the count goes back to zero, in seconds since 1970. None until
    /// the first file of a new week.
    pub resets_at: Option<u64>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The count for the week that holds `now`. A week starts with its first file.
/// If the clock moves back, the week carries on rather than starting over.
fn this_week(u: Usage, now: u64) -> Usage {
    if u.week_start == 0 || now >= u.week_start + WEEK {
        Usage::default()
    } else {
        u
    }
}

/// Join the file copy and the keychain copy. The newer week wins, and within
/// the same week the higher count wins. A license in either copy counts.
fn merge(a: Saved, b: Saved) -> Saved {
    let usage = match a.usage.week_start.cmp(&b.usage.week_start) {
        std::cmp::Ordering::Greater => a.usage,
        std::cmp::Ordering::Less => b.usage,
        std::cmp::Ordering::Equal => Usage { used: a.usage.used.max(b.usage.used), ..a.usage },
    };
    Saved { usage, license: a.license.or(b.license) }
}

fn status_of(s: &Saved) -> Status {
    let week = this_week(s.usage, now());
    Status {
        licensed: s.license.is_some(),
        key_end: s.license.as_ref().map(|l| l.key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect()),
        used: week.used,
        limit: FREE_WEEKLY_FILES,
        resets_at: (week.week_start > 0).then_some(week.week_start + WEEK),
    }
}

// Saving. One lock keeps a read and the write after it together.

static LOCK: Mutex<()> = Mutex::new(());

fn file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("license.json"))
}

fn read_file(path: &Option<PathBuf>) -> Option<Saved> {
    serde_json::from_slice(&std::fs::read(path.as_ref()?).ok()?).ok()
}

fn write_file(path: &Option<PathBuf>, s: &Saved) {
    let Some(path) = path else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_vec_pretty(s) {
        let _ = std::fs::write(path, text);
    }
}

// Debug builds skip the keychain. An unsigned build changes with every
// compile, so macOS would ask for permission each time.
#[cfg(any(target_os = "macos", windows))]
fn keychain() -> Option<keyring::Entry> {
    if cfg!(debug_assertions) {
        return None;
    }
    keyring::Entry::new("com.ampliflare.audio", "license").ok()
}

#[cfg(any(target_os = "macos", windows))]
fn read_keychain() -> Option<Saved> {
    serde_json::from_str(&keychain()?.get_password().ok()?).ok()
}

#[cfg(any(target_os = "macos", windows))]
fn write_keychain(s: &Saved) {
    if let (Some(entry), Ok(text)) = (keychain(), serde_json::to_string(s)) {
        let _ = entry.set_password(&text);
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn read_keychain() -> Option<Saved> {
    None
}

#[cfg(not(any(target_os = "macos", windows)))]
fn write_keychain(_: &Saved) {}

fn load(app: &AppHandle) -> Saved {
    let file = read_file(&file_path(app)).unwrap_or_default();
    let keychain = read_keychain().unwrap_or_default();
    merge(file, keychain)
}

fn store(app: &AppHandle, s: &Saved) {
    write_file(&file_path(app), s);
    write_keychain(s);
}

/// Change what is saved and write both copies.
fn update(app: &AppHandle, change: impl FnOnce(&mut Saved)) -> Saved {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = load(app);
    change(&mut s);
    store(app, &s);
    s
}

// The weekly count, called by run_job.

/// Refuse a file when free use has had its week's worth.
pub fn check_quota(app: &AppHandle) -> Result<(), String> {
    let s = load(app);
    let st = status_of(&s);
    if st.licensed || st.used < st.limit {
        return Ok(());
    }
    Err(format!(
        "Free use allows {} files a week and they are used up. A license removes the limit.",
        st.limit
    ))
}

/// Count one finished file. Licensed use is not counted.
pub fn count_file(app: &AppHandle) {
    update(app, |s| {
        if s.license.is_some() {
            return;
        }
        let mut week = this_week(s.usage, now());
        if week.week_start == 0 {
            week.week_start = now();
        }
        week.used += 1;
        s.usage = week;
    });
}

// Dodo Payments. The license endpoints are public, so no secret is built into the app.

async fn post(path: &str, body: Value) -> Result<(u16, Value), String> {
    // reqwest is built without a crypto provider. Use ring, as the updater does.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Could not start a connection: {e}"))?;
    let res = client
        .post(format!("{}{path}", dodo_url()))
        .json(&body)
        .send()
        .await
        .map_err(|_| "Could not reach the license server. Check your internet connection.".to_string())?;
    let code = res.status().as_u16();
    let value = res.json().await.unwrap_or(Value::Null);
    Ok((code, value))
}

/// Dodo shows each activation by name. A plain name keeps the computer's own name private.
fn device_name() -> String {
    let os = match std::env::consts::OS {
        "macos" => "Mac",
        "windows" => "Windows PC",
        _ => "Linux PC",
    };
    format!("Ampliflare Audio on a {os}")
}

#[tauri::command]
pub fn license_status(app: AppHandle) -> Status {
    status_of(&load(&app))
}

#[tauri::command]
pub async fn activate_license(app: AppHandle, key: String) -> Result<Status, String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Paste your license key first.".into());
    }
    let (code, body) = post("/licenses/activate", json!({ "license_key": key, "name": device_name() })).await?;
    match code {
        200..=299 => {}
        403 => return Err("This key is not active. It may have been refunded or turned off.".into()),
        404 => return Err("That key was not found. Check it and try again.".into()),
        422 => {
            return Err("This key is already on as many computers as it allows. Remove it from one of them first.".into())
        }
        _ => return Err(format!("The license server had a problem ({code}). Try again later.")),
    }
    let instance_id = body["id"].as_str().ok_or("The license server sent an odd reply.")?.to_string();

    if !cfg!(debug_assertions) {
        if body["product"]["product_id"].as_str() != Some(PRODUCT_ID) {
            let _ = post("/licenses/deactivate", json!({ "license_key": key, "license_key_instance_id": instance_id })).await;
            return Err("This key is for a different product.".into());
        }
    }

    let license = License { key, instance_id, checked_at: now() };
    Ok(status_of(&update(&app, |s| s.license = Some(license))))
}

/// Ask Dodo whether the saved key is still good. Offline, the saved answer stands.
#[tauri::command]
pub async fn refresh_license(app: AppHandle) -> Status {
    let Some(license) = load(&app).license else {
        return license_status(app);
    };
    let body = json!({ "license_key": license.key, "license_key_instance_id": license.instance_id });
    let answer = match post("/licenses/validate", body).await {
        Ok((200..=299, v)) => v["valid"].as_bool(),
        _ => None,
    };
    let s = update(&app, |s| match answer {
        Some(true) => {
            if let Some(l) = s.license.as_mut() {
                l.checked_at = now();
            }
        }
        // Refunded, turned off or expired.
        Some(false) => s.license = None,
        None => {}
    });
    status_of(&s)
}

/// Free this computer's activation so the key can move to another one.
#[tauri::command]
pub async fn deactivate_license(app: AppHandle) -> Result<Status, String> {
    let Some(license) = load(&app).license else {
        return Ok(license_status(app));
    };
    let body = json!({ "license_key": license.key, "license_key_instance_id": license.instance_id });
    let (code, _) = post("/licenses/deactivate", body).await.map_err(|_| {
        "Could not reach the license server, so the key is still on this computer. Try again when you are online.".to_string()
    })?;
    // 403 and 404 mean Dodo no longer has this activation, which is the goal anyway.
    if !(200..=299).contains(&code) && code != 403 && code != 404 {
        return Err(format!("The license server had a problem ({code}). Try again later."));
    }
    Ok(status_of(&update(&app, |s| s.license = None)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 24 * 60 * 60;

    #[test]
    fn a_week_runs_seven_days_from_its_first_file() {
        let u = Usage { week_start: 1000, used: 5 };
        assert_eq!(this_week(u, 1000 + 6 * DAY), u);
        assert_eq!(this_week(u, 1000 + 7 * DAY), Usage::default());
        assert_eq!(this_week(Usage::default(), 50), Usage::default());
    }

    #[test]
    fn moving_the_clock_back_does_not_reset_the_week() {
        let u = Usage { week_start: 10 * DAY, used: 20 };
        assert_eq!(this_week(u, 3 * DAY), u);
    }

    #[test]
    fn deleting_one_copy_does_not_reset_the_count() {
        let used = Saved { usage: Usage { week_start: 100, used: 20 }, license: None };
        assert_eq!(merge(used.clone(), Saved::default()), used);
        assert_eq!(merge(Saved::default(), used.clone()), used);

        let lower = Saved { usage: Usage { week_start: 100, used: 3 }, license: None };
        assert_eq!(merge(lower, used.clone()).usage.used, 20);
    }

    #[test]
    fn a_newer_week_wins() {
        let old = Saved { usage: Usage { week_start: 100, used: 20 }, license: None };
        let new = Saved { usage: Usage { week_start: 100 + WEEK, used: 1 }, license: None };
        assert_eq!(merge(old, new.clone()).usage, new.usage);
    }

    #[test]
    fn shows_the_end_of_the_key() {
        let s = Saved {
            usage: Usage::default(),
            license: Some(License { key: "ABCD-1234-WXYZ".into(), instance_id: "lki_1".into(), checked_at: 0 }),
        };
        let st = status_of(&s);
        assert!(st.licensed);
        assert_eq!(st.key_end.as_deref(), Some("WXYZ"));
        assert_eq!(st.resets_at, None);
    }
}

/// Talks to Dodo's test server, so it only runs when asked:
/// cargo test reaches_dodo -- --ignored
#[cfg(test)]
mod network_probe {
    #[test]
    #[ignore]
    fn reaches_dodo() {
        let r = tauri::async_runtime::block_on(super::post("/licenses/validate", serde_json::json!({"license_key": "not-a-real-key"})));
        println!("{r:?}");
        assert!(r.is_ok());
    }
}
