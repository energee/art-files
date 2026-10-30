// main.rs — Label Lab's desktop shell: the updater gate, the OS
// file-open delivery (.label paths from Finder / Explorer / argv), and the
// macOS app-quit hook (terminate.rs).
// Prevents an additional console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod menu_symbols;
mod terminate;

use std::{
    collections::VecDeque,
    ffi::OsString,
    path::PathBuf,
    sync::{Mutex, PoisonError},
};
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
struct OpenedFile(Mutex<VecDeque<String>>);

impl OpenedFile {
    /** Seed the queue from the paths argv carried at launch. */
    fn new(paths: impl IntoIterator<Item = PathBuf>) -> Self {
        let queue = Self(Mutex::new(VecDeque::new()));
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
     * The path is canonicalised first (dunce, so Windows keeps plain
     * `C:\` paths rather than `\\?\`), so a relative argv path or a
     * `./..` spelling of an open file matches the tab's filePath instead of
     * opening a duplicate. A path that cannot be canonicalised (missing,
     * unreadable) is queued as given, and the open reports the error.
     *
     * Returns whether it was queued. Plain method so tests reach it.
     *
     * Both push and take read through a poisoned lock (a panic elsewhere
     * while it was held) rather than aborting the app: every mutation is a
     * single VecDeque push/pop, so the queue is never left half-written. */
    fn push(&self, path: PathBuf) -> bool {
        let path = dunce::canonicalize(&path).unwrap_or(path);
        match path.into_os_string().into_string() {
            Ok(path) => {
                self.0
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push_back(path);
                true
            }
            Err(_) => false,
        }
    }

    /** Pop the oldest queued path — FIFO, so files open in the order the
     * OS delivered them. Plain method (not the command) so tests reach it. */
    fn take(&self) -> Option<String> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .pop_front()
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

/** The argv filter's test for "this is ours". macOS opens skip it: the
 * frontend rejects their non-.label paths with a message (see the Opened
 * handler in main()). */
fn is_label_path(path: &std::path::Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("label"))
}

/** Hand an OS-provided path to the frontend. Queue FIRST, then the
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
        .plugin(tauri_plugin_fs::init())
        // Only the reveal-in-folder call is used; the plugin's injected click
        // handler for external `<a>` links is not (the app has no links).
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        );
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
            take_opened_file,
            terminate::set_unsaved,
            menu_symbols::set_menu_symbols
        ])
        // macOS: Dock → Quit, logout and AppleScript `quit` bypass the
        // window close flow; route them through it (see terminate.rs).
        .setup(|app| {
            terminate::install(app.handle());
            Ok(())
        })
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
                // No extension filter here, unlike argv (where it skips the
                // exe and flags): every path Finder sends is one the user
                // chose, so a non-.label one (Open With, or a .label symlink
                // LaunchServices resolved to its target) reaches the
                // frontend, which names it in an error instead of opening
                // nothing (#554). The frontend checks the canonical path
                // OpenedFile::push queues, so a link is judged by its target.
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
            vec![
                PathBuf::from("/beers/a.label"),
                PathBuf::from("/beers/b.label")
            ]
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

    /** A panic while the queue lock was held poisons it; opening files
     *  must keep working instead of aborting the app on every later open. */
    #[test]
    fn opened_file_queue_survives_a_poisoned_lock() {
        let state = OpenedFile::new([PathBuf::from("/x/a.label")]);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = state.0.lock().unwrap();
            panic!("poison the queue lock");
        }));
        assert!(state.0.is_poisoned());
        assert!(state.push(PathBuf::from("/x/b.label")));
        assert_eq!(state.take().as_deref(), Some("/x/a.label"));
        assert_eq!(state.take().as_deref(), Some("/x/b.label"));
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

    /** A relative argv path and a `..` spelling of the same file resolve to
     *  one canonical path, so opening it twice does not open two tabs. */
    #[test]
    fn opened_file_queue_canonicalises_relative_and_dotdot_paths() {
        let dir = std::env::temp_dir().join(format!("label-lab-canon-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        let file = dir.join("beer.label");
        std::fs::write(&file, b"").unwrap();
        let canonical = dunce::canonicalize(&file)
            .unwrap()
            .into_os_string()
            .into_string()
            .unwrap();

        let relative = relative_to_cwd(&file);
        let dotdot = dir.join("sub").join("..").join("beer.label");
        let state = OpenedFile::new([relative, dotdot]);
        assert_eq!(state.take().as_deref(), Some(canonical.as_str()));
        assert_eq!(state.take().as_deref(), Some(canonical.as_str()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /** A path that cannot be canonicalised (it does not exist) is queued
     *  as given rather than dropped — the frontend reports the open error. */
    #[test]
    fn opened_file_queue_keeps_a_missing_path_as_given() {
        let state = OpenedFile::new([PathBuf::from("/no/such/dir/x.label")]);
        assert_eq!(state.take().as_deref(), Some("/no/such/dir/x.label"));
    }

    /** `file` spelled relative to the test process's cwd: one `..` per cwd
     *  directory up to the root, then the file's directories. Only Normal
     *  components are counted, so a Windows `C:` prefix and the root are
     *  skipped (both paths must be on the same drive there). */
    fn relative_to_cwd(file: &std::path::Path) -> PathBuf {
        use std::path::Component::Normal;
        let cwd = dunce::canonicalize(std::env::current_dir().unwrap()).unwrap();
        let file = dunce::canonicalize(file).unwrap();
        let mut rel = PathBuf::new();
        for _ in cwd.components().filter(|c| matches!(c, Normal(_))) {
            rel.push("..");
        }
        rel.extend(file.components().filter(|c| matches!(c, Normal(_))));
        assert!(rel.is_relative());
        rel
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
