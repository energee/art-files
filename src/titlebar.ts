// titlebar.ts — the macOS overlay title bar (tauri.conf.json: titleBarStyle
// "Overlay"). The webview runs under a transparent title bar, so only in the
// desktop app on macOS the layout makes room for the traffic lights: the
// Layers sidebar keeps a strip for them, a collapsed sidebar pads the header
// clear of them, and the header drags the window. initTitlebar() marks <html>
// data-titlebar="overlay" (and data-fullscreen while the lights are gone);
// index.css's `titlebar:` variant keys on those, so a browser, Windows and
// Linux lay out exactly as before. It also marks data-glass: the same window
// carries macOS Liquid Glass (tauri.conf.json windowEffects), and index.css
// lets the chrome show it.
import { isTauri } from "@tauri-apps/api/core";
import { isMacOS } from "@/keys";

/** Whether this window has the overlay title bar: the Tauri desktop app on macOS. */
export const overlayTitlebar = (): boolean => isTauri() && isMacOS();

/** Mark <html> for the `titlebar:` variant when the overlay applies; call once at startup. */
export function initTitlebar(root: HTMLElement = document.documentElement): void {
  if (!overlayTitlebar()) return;
  root.dataset.titlebar = "overlay";
  root.dataset.glass = "";
  // Full screen has no traffic lights, so the room kept for them goes away.
  // The glass tints by the WINDOW's appearance, which follows the OS, so a
  // pinned theme (data-theme, src/theme.ts) pins the window too, or dark text
  // would sit on dark glass; no attribute hands it back to the OS (null). A
  // failure here reaches UncaughtErrors and leaves the lights' room in place.
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    const pin = () => {
      const t = root.dataset.theme;
      return win.setTheme(t === "light" || t === "dark" ? t : null);
    };
    new MutationObserver(() => void pin()).observe(root, { attributeFilter: ["data-theme"] });
    // A resize burst puts several reads in flight and IPC replies can land out
    // of order, so only the newest read may set the attribute.
    let newest = 0;
    const sync = async () => {
      const read = ++newest;
      const fullscreen = await win.isFullscreen();
      if (read === newest) root.toggleAttribute("data-fullscreen", fullscreen);
    };
    await win.onResized(sync);
    await Promise.all([sync(), pin()]);
  });
}
