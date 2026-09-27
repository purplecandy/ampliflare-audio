mod analyze;
mod jobs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            jobs::check_tools,
            jobs::is_audio_file,
            jobs::run_job,
            jobs::dev_start,
            analyze::analyze_audio
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
