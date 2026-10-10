// recent.ts — File → Open Recent: the desktop's last ten .label paths, most
// recent first, kept in localStorage like the render settings (settings.ts).
// TabsShell records a path whenever a tab binds to one (a successful open or
// a Save As) and registers the opener; AppMenu lists the paths in the native
// menu and asks for an open here, because its props come from the editor.
import { readJson } from "@/settings";

const KEY = "labellab.recent";
const MAX = 10;

let listeners: (() => void)[] = [];
let opener: ((path: string) => void) | null = null;

/** The remembered paths, most recent first; [] when none or unreadable. */
export function recentLabels(): string[] {
  const raw = readJson(KEY);
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
}

function write(list: string[]) {
  // A failed write (no localStorage, quota) only loses the menu entry.
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* see above */ }
  for (const listener of listeners) listener();
}

/** Move `path` to the top, dropping the oldest past ten. */
export function rememberRecent(path: string) {
  write([path, ...recentLabels().filter((p) => p !== path)].slice(0, MAX));
}

export function forgetRecent(path: string) {
  write(recentLabels().filter((p) => p !== path));
}

export function clearRecent() {
  write([]);
}

/** Calls `listener` after every change; returns the unsubscribe. */
export function subscribeRecent(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => { listeners = listeners.filter((l) => l !== listener); };
}

/** TabsShell's open routing; returns the unregister. */
export function setRecentOpener(open: (path: string) => void): () => void {
  opener = open;
  return () => { if (opener === open) opener = null; };
}

/** Open a remembered path the way a Finder open does. */
export function openRecent(path: string) {
  opener?.(path);
}

/** Menu titles: the file name, plus its folder when two names match (native
 *  menu rows have no room for the full path). */
export function recentTitles(paths: string[]): string[] {
  const parts = paths.map((p) => p.split(/[\\/]/));
  const names = parts.map((segs) => segs[segs.length - 1]);
  return names.map((name, i) => names.indexOf(name) !== names.lastIndexOf(name)
    ? `${name} — ${parts[i][parts[i].length - 2] ?? ""}` : name);
}
