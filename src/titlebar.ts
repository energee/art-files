// titlebar.ts — the macOS overlay title bar (tauri.conf.json: titleBarStyle
// "Overlay"). The webview runs under a transparent title bar, so only in the
// desktop app on macOS the layout makes room for the traffic lights: the
// Layers sidebar keeps a strip for them, a collapsed sidebar pads the header
// clear of them, and the header drags the window. initTitlebar() marks <html>
// data-titlebar="overlay" (and data-fullscreen while the lights are gone);
// index.css's `titlebar:` variant keys on those, so a browser, Windows and
// Linux lay out exactly as before.
import { isTauri } from "@tauri-apps/api/core";
import { isMacOS } from "@/keys";

/** Whether this window has the overlay title bar: the Tauri desktop app on macOS. */
export const overlayTitlebar = (): boolean => isTauri() && isMacOS();

/** Mark <html> for the `titlebar:` variant when the overlay applies; call once at startup. */
export function initTitlebar(root: HTMLElement = document.documentElement): void {
  if (!overlayTitlebar()) return;
  root.dataset.titlebar = "overlay";
  // Full screen has no traffic lights, so the room kept for them goes away. A
  // failure here reaches UncaughtErrors and leaves the lights' room in place.
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    const sync = async () => root.toggleAttribute("data-fullscreen", await win.isFullscreen());
    await win.onResized(sync);
    await sync();
  });
}
