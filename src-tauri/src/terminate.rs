// terminate.rs — macOS app-level quit (Dock → Quit, logout / shutdown,
// AppleScript `quit`) runs the unsaved-tabs prompt instead of exiting (#151).
//
// Those paths send NSApp `terminate:`. tao's app delegate has no
// `applicationShouldTerminate:`, so AppKit quits at once with no window
// CloseRequested (⌘Q sidesteps this with a custom menu item, #80). install()
// ADDS that selector with class_addMethod, which never replaces a method:
// tao's delegate stays intact, and a future tao implementing it wins. With
// unsaved work the quit is cancelled and handed to the window's close sweep;
// otherwise it proceeds, so logout is never interrupted needlessly. A second
// quit within REPEAT_QUIT of a cancelled one always proceeds: a hung webview
// never answers the close sweep, and without that escape hatch every Dock
// Quit and logout would be cancelled forever.

// Only macOS installs the hook; elsewhere the decision helper is test-only.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/** NSApplicationTerminateReply values (AppKit's NSUInteger enum). */
const TERMINATE_CANCEL: usize = 0;
const TERMINATE_NOW: usize = 1;

/** How soon a repeated quit must follow a cancelled one to force through. */
const REPEAT_QUIT: Duration = Duration::from_secs(5);

/** Whether any tab has unsaved work — written by the frontend (TabsShell)
 *  whenever that changes, read by the terminate hook. */
static UNSAVED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn set_unsaved(unsaved: bool) {
    UNSAVED.store(unsaved, Ordering::Relaxed);
}

/** The hook's answer. Cancel only when there is unsaved work AND a window
 *  to run the prompt in — with no window, cancelling would make the app
 *  unquittable — AND the last cancel was not within REPEAT_QUIT: a repeated
 *  quit means the prompt never appeared (hung webview), so let it go. */
fn terminate_reply(unsaved: bool, has_window: bool, recently_cancelled: bool) -> usize {
    if unsaved && has_window && !recently_cancelled {
        TERMINATE_CANCEL
    } else {
        TERMINATE_NOW
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{terminate_reply, Ordering, REPEAT_QUIT, TERMINATE_CANCEL, UNSAVED};
    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::{class, ffi, msg_send, sel};
    use std::sync::{Mutex, OnceLock, PoisonError};
    use std::time::Instant;
    use tauri::Manager;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    /** When the hook last cancelled a quit — feeds the repeated-quit hatch. */
    static LAST_CANCEL: Mutex<Option<Instant>> = Mutex::new(None);

    /** `- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender` */
    extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: *mut AnyObject) -> usize {
        let window = APP.get().and_then(|app| app.get_webview_window("main"));
        let mut last_cancel = LAST_CANCEL.lock().unwrap_or_else(PoisonError::into_inner);
        let recently_cancelled = last_cancel.is_some_and(|at| at.elapsed() < REPEAT_QUIT);
        let reply = terminate_reply(
            UNSAVED.load(Ordering::Relaxed),
            window.is_some(),
            recently_cancelled,
        );
        if reply == TERMINATE_CANCEL {
            *last_cancel = Some(Instant::now());
            // close() emits CloseRequested like the red button, so the
            // frontend's sweep prompts for each unsaved tab.
            if let Some(window) = window {
                let _ = window.close();
            }
        }
        reply
    }

    /** Add the hook to NSApp's delegate class. Main thread, after tao has
     *  installed its delegate (tauri's setup hook satisfies both). */
    pub fn install(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            let Some(delegate) = delegate.as_ref() else {
                return;
            };
            let imp: extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize =
                should_terminate;
            // Encoding: returns NSUInteger (Q), takes self (@), _cmd (:),
            // and the sender (@).
            ffi::class_addMethod(
                delegate.class() as *const _ as *mut _,
                sel!(applicationShouldTerminate:),
                std::mem::transmute::<_, Imp>(imp),
                c"Q@:@".as_ptr(),
            );
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::install;

/** Elsewhere there is no app-level quit to hook. The app's own Quit and the
 *  window's close button go through the window close flow, but on Windows
 *  logout / shutdown does NOT: tao answers WM_ENDSESSION with
 *  process::exit(0), so the unsaved-tabs prompt never runs and recovery
 *  snapshots are the only safety net. */
#[cfg(not(target_os = "macos"))]
pub fn install(_: &tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clean_workspace_terminates_now() {
        assert_eq!(terminate_reply(false, true, false), TERMINATE_NOW);
        assert_eq!(terminate_reply(false, false, false), TERMINATE_NOW);
    }

    #[test]
    fn unsaved_work_cancels_and_hands_the_quit_to_the_window() {
        assert_eq!(terminate_reply(true, true, false), TERMINATE_CANCEL);
    }

    /** No window to run the prompt in: cancelling would leave the app
     *  unquittable, so let it go. */
    #[test]
    fn unsaved_without_a_window_still_terminates() {
        assert_eq!(terminate_reply(true, false, false), TERMINATE_NOW);
    }

    /** A hung webview never answers the close sweep, so a second quit soon
     *  after a cancelled one must get through (the escape hatch). */
    #[test]
    fn a_repeated_quit_after_a_cancel_terminates() {
        assert_eq!(terminate_reply(true, true, true), TERMINATE_NOW);
    }
}
