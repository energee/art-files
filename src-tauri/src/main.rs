// main.rs — Label Lab's desktop shell: the updater gate and the OS
// file-open delivery (.label paths from Finder / Explorer / argv).
// Prevents an additional console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{ffi::OsString, path::PathBuf, sync::Mutex};
use tauri::Manager;

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
struct OpenedFile(Mutex<Vec<String>>);

impl OpenedFile {
    /** Seed the queue from the paths argv carried at launch. */
    fn new(paths: impl IntoIterator<Item = PathBuf>) -> Self {
        let queue = Self(Mutex::new(Vec::new()));
        for path in paths {
            queue.push(path);
        }
        queue
    }

    /** Queue a path the OS handed us, or DROP it when it cannot round-trip to
     * a String — the queue holds Strings for that reason, so the rule has one
     * home and both delivery paths (argv, Apple event) inherit it. Mangling
     * instead is not an option: take_opened_file hands the frontend a String,
     * and the tab's filePath — that same string — is what Save writes back
     * through, so a lossy path means a failed open or a save aimed elsewhere.
     * ponytail: dropping is the ceiling — opening these needs an opaque
     * document handle through the whole open/save pipeline.
     *
     * Returns whether it was queued. Plain method so tests reach it. */
    fn push(&self, path: PathBuf) -> bool {
        match path.into_os_string().into_string() {
            Ok(path) => {
                self.0.lock().unwrap().push(path);
                true
            }
            Err(_) => false,
        }
    }

    /** Pop the oldest queued path — FIFO, so files open in the order the
     * OS delivered them. Plain method (not the command) so tests reach it. */
    fn take(&self) -> Option<String> {
        let mut queue = self.0.lock().unwrap();
        if queue.is_empty() {
            return None;
        }
        Some(queue.remove(0))
    }
}

/** Every .label path among command-line arguments — how Windows and Linux
 * deliver file-association opens (multi-select Open delivers several). The
 * extension match is the filter: it skips the exe path in args[0] and any
 * stray flags alike.
 *
 * Item is `Into<OsString>` so std::env::args_os() passes straight in: args()
 * PANICS on a non-Unicode argument (legal on Windows — an unpaired UTF-16
 * surrogate in a path), which would crash the app before its window appeared.
 * A path that survives to here but cannot become a String is dropped later,
 * by OpenedFile::push, which is where that rule lives. */
fn label_paths_from_args<S: Into<OsString>, I: IntoIterator<Item = S>>(args: I) -> Vec<PathBuf> {
    args.into_iter()
        .map(|arg| PathBuf::from(arg.into()))
        .filter(|path| is_label_path(path))
        .collect()
}

/** The one spelling of "this is ours", shared by both delivery paths. */
fn is_label_path(path: &std::path::Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("label"))
}

/** Hand an OS-provided .label path to the frontend. Queue FIRST, then the
 * emit — the webview may not be listening yet, and OpenedFile's doc explains
 * the pull-based contract. Both delivery paths (macOS Apple events, the
 * Windows/Linux single-instance forward) go through here so the ordering
 * cannot drift between them — including the drop of a path that cannot be a
 * String (see OpenedFile::push), which is why a rejected path emits nothing:
 * there would be nothing for the frontend's drain to find. */
fn deliver_opened_file(app: &tauri::AppHandle, path: PathBuf) {
    use tauri::Emitter;
    if app.state::<OpenedFile>().push(path) {
        let _ = app.emit("project-file-opened", ());
    }
}

/** The three window calls raise_window makes — a trait only so a test can
 * record their order without a real window. */
#[cfg(any(test, not(target_os = "macos")))]
trait RaiseWindow {
    fn unminimize(&self) -> tauri::Result<()>;
    fn show(&self) -> tauri::Result<()>;
    fn set_focus(&self) -> tauri::Result<()>;
}

#[cfg(not(target_os = "macos"))]
impl<R: tauri::Runtime> RaiseWindow for tauri::WebviewWindow<R> {
    fn unminimize(&self) -> tauri::Result<()> {
        tauri::WebviewWindow::unminimize(self)
    }
    fn show(&self) -> tauri::Result<()> {
        tauri::WebviewWindow::show(self)
    }
    fn set_focus(&self) -> tauri::Result<()> {
        tauri::WebviewWindow::set_focus(self)
    }
}

/** Bring the window forward when a second launch forwards to this one
 * (#108): a file opened from Explorer while the app sat minimized otherwise
 * lands in a tab nobody can see. Restore and show BEFORE focusing — a
 * minimized or hidden window cannot take focus. Best-effort: a failed call
 * leaves the file queued and opened, just not raised. macOS needs none of
 * this — the OS activates the app itself before delivering the Apple event. */
#[cfg(any(test, not(target_os = "macos")))]
fn raise_window(window: &impl RaiseWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
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
        // Raise even when no .label came along: relaunching the app from
        // its icon should surface the running window, not do nothing.
        if let Some(window) = app.get_webview_window("main") {
            raise_window(&window);
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
    // args_os, not args(): args() panics on non-Unicode argv. The skip rule
    // lives in label_paths_from_args, where it is tested.
    let opened_at_launch = label_paths_from_args(std::env::args_os());

    builder
        .manage(OpenedFile::new(opened_at_launch))
        .invoke_handler(tauri::generate_handler![
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
                // Same extension filter as the argv path: "Open With" points
                // Finder at any file, and a non-.label one would only travel
                // to the frontend to be denied by the fs scope and surface as
                // an open error. Ignoring it there is the argv behaviour.
                for path in urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| is_label_path(path))
                {
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

    #[test]
    fn argv_filter_collects_every_label_path_in_order() {
        let paths = label_paths_from_args([
            "/usr/bin/label-lab", // argv[0]: no .label extension, skipped
            "--flag",
            "/beers/a.label",
            "/beers/b.label",
        ]);
        assert_eq!(
            paths,
            vec![PathBuf::from("/beers/a.label"), PathBuf::from("/beers/b.label")]
        );
    }

    #[test]
    fn argv_filter_matches_the_extension_case_insensitively() {
        let paths = label_paths_from_args(["exe", "/x/BEER.LABEL", "/x/Mixed.Label"]);
        assert_eq!(paths.len(), 2);
    }

    #[test]
    fn argv_filter_yields_nothing_without_label_paths() {
        assert!(label_paths_from_args(["exe", "--flag", "notes.txt"]).is_empty());
    }

    /** A path that cannot be a String is dropped, not mangled — see
     *  OpenedFile::push. Unix bytes stand in for the Windows
     *  unpaired-surrogate case; neither can round-trip. */
    #[test]
    #[cfg(unix)]
    fn opened_file_queue_drops_a_non_unicode_path() {
        use std::os::unix::ffi::OsStringExt;
        let bad = PathBuf::from(OsString::from_vec(b"/x/\xff\xfe.label".to_vec()));
        let state = OpenedFile::new([bad, PathBuf::from("/x/ok.label")]);
        assert_eq!(state.take().as_deref(), Some("/x/ok.label"));
        assert_eq!(state.take(), None);
    }

    /** Records the calls raise_window makes, in order. */
    #[derive(Default)]
    struct FakeWindow(std::cell::RefCell<Vec<&'static str>>);

    impl RaiseWindow for FakeWindow {
        fn unminimize(&self) -> tauri::Result<()> {
            self.0.borrow_mut().push("unminimize");
            Ok(())
        }
        fn show(&self) -> tauri::Result<()> {
            self.0.borrow_mut().push("show");
            Ok(())
        }
        fn set_focus(&self) -> tauri::Result<()> {
            self.0.borrow_mut().push("set_focus");
            Ok(())
        }
    }

    /** #108: a forwarded open must bring a minimized or hidden window back
     *  and focus it — restore first, so focus lands on a visible window. */
    #[test]
    fn raise_window_restores_shows_then_focuses() {
        let window = FakeWindow::default();
        raise_window(&window);
        assert_eq!(*window.0.borrow(), ["unminimize", "show", "set_focus"]);
    }

    #[test]
    fn opened_file_queue_is_fifo_and_drains_to_none() {
        let state = OpenedFile::new([PathBuf::from("/a.label"), PathBuf::from("/b.label")]);
        assert!(state.push(PathBuf::from("/c.label")));
        assert_eq!(state.take().as_deref(), Some("/a.label"));
        assert_eq!(state.take().as_deref(), Some("/b.label"));
        assert_eq!(state.take().as_deref(), Some("/c.label"));
        assert_eq!(state.take(), None);
    }
}
