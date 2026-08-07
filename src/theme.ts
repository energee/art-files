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
import { useState } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "theme";

/** Whatever index.html stamped, i.e. the persisted choice. */
const current = (): Theme => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
};

/** Current preference plus a setter that applies and persists it. The DOM and
 *  localStorage are written in the setter rather than an effect: this is the
 *  only moment the preference changes, and an effect would rewrite storage on
 *  every mount — the switcher lives in a panel that remounts on selection. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(current);
  return [theme, (t) => {
    if (t === "system") {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem(KEY);
    } else {
      document.documentElement.dataset.theme = t;
      localStorage.setItem(KEY, t);
    }
    setTheme(t);
  }];
}
