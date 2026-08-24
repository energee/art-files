// main.rs — Label Lab's desktop shell and writable preset storage.
// Prevents an additional console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::ErrorKind, path::PathBuf, sync::Mutex};
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

/** The .label path the OS handed us — macOS via its open-document Apple
 * event (Finder double-click, Open With, Dock drop), Windows/Linux via argv
 * (directly at launch, or forwarded from a second instance by the
 * single-instance plugin). Held in state rather than emitted directly: a
 * launch-by-file delivers the path before the webview is listening, so the
 * frontend pulls it once ready and again on each "project-file-opened"
 * emit. */
struct OpenedFile(Mutex<Option<PathBuf>>);

/** The .label path among command-line arguments, if any — how Windows and
 * Linux deliver file-association opens. Matching on the extension rather
 * than taking args[1] blindly keeps stray flags out. */
#[cfg(not(target_os = "macos"))]
fn label_path_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<PathBuf> {
    args.into_iter().map(PathBuf::from).find(|path| {
        path.extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("label"))
    })
}

#[tauri::command]
fn take_opened_file(state: tauri::State<OpenedFile>) -> Option<String> {
    let path = state.0.lock().unwrap().take()?;
    Some(path.to_string_lossy().into_owned())
}

fn main() {
    let builder = tauri::Builder::default();
    // Single-instance must be the FIRST plugin registered: on Windows/Linux a
    // second launch (Explorer or a file manager opening another .label while
    // the app runs) forwards its argv here and exits, so the running window
    // receives the file — the same behavior macOS gets from Apple events.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        use tauri::Emitter;
        if let Some(path) = label_path_from_args(args.into_iter().skip(1)) {
            *app.state::<OpenedFile>().0.lock().unwrap() = Some(path);
            let _ = app.emit("project-file-opened", ());
        }
    }));
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());
    // Tauri rejects an updater plugin with no `plugins.updater` config. Keep
    // it entirely out of keyless local builds; the release workflow supplies
    // both this compile-time flag and the signed updater configuration.
    let builder = if option_env!("TAURI_UPDATER_PUBLIC_KEY").is_some() {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };

    // A Windows/Linux launch-by-file arrives as plain argv on THIS process;
    // macOS seeds the state from the Opened event in run() below instead.
    #[cfg(not(target_os = "macos"))]
    let opened_at_launch = label_path_from_args(std::env::args().skip(1));
    #[cfg(target_os = "macos")]
    let opened_at_launch = None;

    builder
        .manage(OpenedFile(Mutex::new(opened_at_launch)))
        .invoke_handler(tauri::generate_handler![
            load_presets,
            save_presets,
            updater_enabled,
            relaunch_app,
            take_opened_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS delivers file opens as Apple events, never argv — the
            // Windows/Linux equivalents are the argv seed and single-instance
            // callback in main() above.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                use tauri::Emitter;
                if let Some(path) = urls.into_iter().find_map(|url| url.to_file_path().ok()) {
                    *app.state::<OpenedFile>().0.lock().unwrap() = Some(path);
                    let _ = app.emit("project-file-opened", ());
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
