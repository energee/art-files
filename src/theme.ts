/** Appearance preference: dark, light, or follow the OS.
 *
 *  All the palette work happens in CSS (index.css uses `light-dark()` against
 *  the `color-scheme` on :root). This module only records which of the three
 *  the user picked and stamps `data-theme` on <html> — "system" means no
 *  attribute at all, so the OS setting comes through untouched and changes to
 *  it apply live with no listener.
 *
 *  Persisted as localStorage["theme"] = "light" | "dark"; absent = system.
 *  index.html stamps the same attribute before first paint, so this module
 *  reads what is already on the element rather than re-deriving it. */
import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "theme";

/** Whatever index.html stamped, i.e. the persisted choice. */
const current = (): Theme => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
};

/** Every mounted useTheme, re-read after a change: the Settings switch and
 *  the View → Appearance checks must agree about the current theme. */
const readers = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  readers.add(onChange);
  return () => { readers.delete(onChange); };
};

/** Apply and persist a preference, then tell every reader. The DOM and
 *  localStorage are written here rather than in an effect: this is the only
 *  moment the preference changes, and an effect would rewrite storage on
 *  every mount — the switcher lives in a panel that remounts on selection. */
function setTheme(t: Theme) {
  if (t === "system") {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(KEY);
  } else {
    document.documentElement.dataset.theme = t;
    localStorage.setItem(KEY, t);
  }
  for (const read of readers) read();
}

/** Current preference plus a setter that applies and persists it; every
 *  caller sees a change made through any of them. */
export function useTheme(): [Theme, (t: Theme) => void] {
  return [useSyncExternalStore(subscribe, current), setTheme];
}
