// main.rs — Label Lab's desktop shell and writable preset storage.
// Prevents an additional console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::ErrorKind, path::PathBuf};
use tauri::Manager;

// Deliberately the repo library rather than `{}`: a fresh desktop install is
// seeded with the presets committed at build time, where the browser dev
// endpoint starts empty and lets normalizePresets (src/presets.ts) fill
// defaults.
const DEFAULT_PRESETS: &str = include_str!("../../presets.json");

fn presets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("presets.json"))
        .map_err(|error| format!("could not locate application data: {error}"))
}

#[tauri::command]
async fn load_presets(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let body = match fs::read_to_string(presets_path(&app)?) {
        Ok(body) => body,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return serde_json::from_str(DEFAULT_PRESETS)
                .map_err(|error| format!("could not parse presets: {error}"));
        }
        Err(error) => return Err(format!("could not read presets: {error}")),
    };
    serde_json::from_str(&body).map_err(|error| format!("could not parse presets: {error}"))
}

#[tauri::command]
async fn save_presets(app: tauri::AppHandle, presets: serde_json::Value) -> Result<(), String> {
    let path = presets_path(&app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "invalid presets path".to_owned())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("could not create application data: {error}"))?;

    let body = serde_json::to_string_pretty(&presets)
        .map_err(|error| format!("could not encode presets: {error}"))?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, format!("{body}\n"))
        .map_err(|error| format!("could not write presets: {error}"))?;
    if let Err(error) = fs::rename(&temporary_path, &path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("could not save presets: {error}"));
    }
    Ok(())
}

/** Release builds set the public updater key at compile time. Local builds do
 * not need signing credentials and leave automatic update checks disabled. */
#[tauri::command]
fn updater_enabled() -> bool {
    option_env!("TAURI_UPDATER_PUBLIC_KEY").is_some()
}

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

fn main() {
    let builder = tauri::Builder::default();
    // Tauri rejects an updater plugin with no `plugins.updater` config. Keep
    // it entirely out of keyless local builds; the release workflow supplies
    // both this compile-time flag and the signed updater configuration.
    let builder = if option_env!("TAURI_UPDATER_PUBLIC_KEY").is_some() {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };

    builder
        .invoke_handler(tauri::generate_handler![
            load_presets,
            save_presets,
            updater_enabled,
            relaunch_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
