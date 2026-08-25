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

/** The .label paths the OS handed us — macOS via its open-document Apple
 * event (Finder double-click, Open With, Dock drop), Windows/Linux via argv
 * (directly at launch, or forwarded from a second instance by the
 * single-instance plugin). A QUEUE, not a slot: deliveries can outpace the
 * webview's async take_opened_file round-trips (two rapid double-clicks, or
 * several files opened at once), and a slot would drop all but the last.
 * Held in state rather than emitted directly: a launch-by-file delivers
 * before the webview is listening, so the frontend drains the queue once
 * ready and again on each "project-file-opened" emit. */
struct OpenedFile(Mutex<Vec<PathBuf>>);

impl OpenedFile {
    /** Pop the oldest queued path — FIFO, so files open in the order the
     * OS delivered them. Plain method (not the command) so tests reach it. */
    fn take(&self) -> Option<String> {
        let mut queue = self.0.lock().unwrap();
        if queue.is_empty() {
            return None;
        }
        Some(queue.remove(0).to_string_lossy().into_owned())
    }
}

/** Every .label path among command-line arguments — how Windows and Linux
 * deliver file-association opens (multi-select Open delivers several). The
 * extension match is the filter: it skips the exe path in args[0] and any
 * stray flags alike. */
fn label_paths_from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<PathBuf> {
    args.into_iter()
        .map(PathBuf::from)
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("label"))
        })
        .collect()
}

/** Hand an OS-provided .label path to the frontend. Queue FIRST, then the
 * emit — the webview may not be listening yet, and OpenedFile's doc explains
 * the pull-based contract. Both delivery paths (macOS Apple events, the
 * Windows/Linux single-instance forward) go through here so the ordering
 * cannot drift between them. */
fn deliver_opened_file(app: &tauri::AppHandle, path: PathBuf) {
    use tauri::Emitter;
    app.state::<OpenedFile>().0.lock().unwrap().push(path);
    let _ = app.emit("project-file-opened", ());
}

/** Pop the oldest queued path; the frontend calls this in a loop until it
 * returns null, so one emit can drain several deliveries. */
#[tauri::command]
fn take_opened_file(state: tauri::State<OpenedFile>) -> Option<String> {
    state.take()
}

fn main() {
    let builder = tauri::Builder::default();
    // Single-instance must be the FIRST plugin registered: on Windows/Linux a
    // second launch (Explorer or a file manager opening another .label while
    // the app runs) forwards its argv here and exits, so the running window
    // receives the file — the same behavior macOS gets from Apple events.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        for path in label_paths_from_args(args) {
            // Relative argv paths (a shell `label-lab foo.label`) are
            // relative to the SECOND instance's cwd, not this process's —
            // resolve against the forwarded cwd before delivering.
            let path = if path.is_relative() {
                std::path::Path::new(&cwd).join(path)
            } else {
                path
            };
            deliver_opened_file(app, path);
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

    // A Windows/Linux launch-by-file arrives as plain argv on THIS process
    // (relative paths are naturally relative to this process's cwd). No
    // platform gate: macOS argv never carries a .label path (Finder sends
    // Apple events, handled in run() below), so the scan is a no-op there.
    let opened_at_launch = label_paths_from_args(std::env::args());

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
                // Every URL, not just the first: Finder sends one event for
                // a multi-file "Open With", and each file gets its own tab.
                for path in urls.into_iter().filter_map(|url| url.to_file_path().ok()) {
                    deliver_opened_file(app, path);
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn argv_filter_collects_every_label_path_in_order() {
        let paths = label_paths_from_args(args(&[
            "/usr/bin/label-lab", // argv[0]: no .label extension, skipped
            "--flag",
            "/beers/a.label",
            "/beers/b.label",
        ]));
        assert_eq!(
            paths,
            vec![PathBuf::from("/beers/a.label"), PathBuf::from("/beers/b.label")]
        );
    }

    #[test]
    fn argv_filter_matches_the_extension_case_insensitively() {
        let paths = label_paths_from_args(args(&["exe", "/x/BEER.LABEL", "/x/Mixed.Label"]));
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn argv_filter_yields_nothing_without_label_paths() {
        assert!(label_paths_from_args(args(&["exe", "--flag", "notes.txt"])).is_empty());
    }

    #[test]
    fn opened_file_queue_is_fifo_and_drains_to_none() {
        let state = OpenedFile(Mutex::new(vec![
            PathBuf::from("/a.label"),
            PathBuf::from("/b.label"),
        ]));
        state.0.lock().unwrap().push(PathBuf::from("/c.label"));
        assert_eq!(state.take().as_deref(), Some("/a.label"));
        assert_eq!(state.take().as_deref(), Some("/b.label"));
        assert_eq!(state.take().as_deref(), Some("/c.label"));
        assert_eq!(state.take(), None);
    }
}
