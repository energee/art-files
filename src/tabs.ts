// tabs.ts — pure workspace-tab logic for the shell (TabsShell.tsx): the
// tab-strip state machine plus the shell/editor contract helpers, all
// plain functions importing no React (like history.ts), so every rule is
// testable without a DOM renderer. The shell owns a TabsState in useState
// and applies the transitions on user events. Editors report TabMeta
// upward through onMeta; the shell never reaches into editor internals.
export type TabMeta = {
  title: string;            // the beer name as typed; "Untitled" while blank
  dirty: boolean;           // the editor's dirty flag (Save enabled)
  edited: boolean;          // any user mutation since mount/open — gates close prompts
  masterUnsaved: boolean;   // the master differs from its last open/save — ⌘S doesn't write it
  filePath: string | null;  // Tauri path identity, for OS-open dedupe
};
export type Tab = TabMeta & { id: number };
export type TabsState = { tabs: Tab[]; active: number; nextId: number };

// dirty starts true, edited false: a fresh default document has Save enabled
// (today's boot state) but closing it must not prompt.
const UNTITLED: TabMeta = {
  title: "Untitled", dirty: true, edited: false, masterUnsaved: false, filePath: null,
};

const fresh = (id: number): Tab => ({ id, ...UNTITLED });

export function initialTabs(): TabsState {
  return { tabs: [fresh(1)], active: 1, nextId: 2 };
}

export function addTab(s: TabsState): TabsState {
  return { tabs: [...s.tabs, fresh(s.nextId)], active: s.nextId, nextId: s.nextId + 1 };
}

export function activateTab(s: TabsState, id: number): TabsState {
  return s.tabs.some((t) => t.id === id) ? { ...s, active: id } : s;
}

export function updateTabMeta(s: TabsState, id: number, meta: Partial<TabMeta>): TabsState {
  const tab = s.tabs.find((t) => t.id === id);
  // Same-value patches return the same state, so a repeated report from an
  // editor costs no re-render.
  if (!tab || (Object.keys(meta) as (keyof TabMeta)[]).every((k) => Object.is(tab[k], meta[k])))
    return s;
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...meta } : t)) };
}

/** Remove a tab. If it was active, the right neighbor takes over (left when
 *  it was last) — browser convention. Closing the only tab replaces it with
 *  a fresh Untitled one: the app always shows a document. */
export function closeTab(s: TabsState, id: number): TabsState {
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return s;
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (tabs.length === 0)
    return { tabs: [fresh(s.nextId)], active: s.nextId, nextId: s.nextId + 1 };
  const active = s.active === id ? tabs[Math.min(i, tabs.length - 1)].id : s.active;
  return { ...s, tabs, active };
}

/** Never been touched and not backed by a file — safe to reuse for an open
 *  and free to close without a prompt. */
export const isPristine = (t: Tab) => !t.edited && !t.filePath;

/** Where an opened .label lands: the tab already holding that path (OS
 *  opens carry one; picker opens without a path skip this), else a pristine
 *  active tab, else a new tab. The ONE spelling of the routing rule — both
 *  of the shell's open entry points go through it.
 *  `busy` marks tabs already spoken for (the shell passes "has a queued
 *  open"): a busy tab is never reused, so two rapid opens can't share one
 *  editor — and a browser handle-open, which leaves no filePath to break
 *  pristineness, still claims its tab.
 *  `queuedPath` exposes the path of a tab's queued-but-uncompleted open:
 *  tab.filePath stays null until the async open finishes, so without it a
 *  re-delivered OS open (the Rust side queues rapid double-clicks) would
 *  mint a second tab editing the same file. */
export type OpenRoute = { focus: number } | { reuse: number } | { open: "new" };
export function routeFileOpen(
  s: TabsState, path?: string, busy?: (id: number) => boolean,
  queuedPath?: (id: number) => string | undefined,
): OpenRoute {
  if (path) {
    const existing = s.tabs.find((t) => t.filePath === path || queuedPath?.(t.id) === path);
    if (existing) return { focus: existing.id };
  }
  const active = s.tabs.find((t) => t.id === s.active);
  if (active && isPristine(active) && !busy?.(active.id)) return { reuse: active.id };
  return { open: "new" };
}

/** Builds DocumentEditor's memo comparator (the editor passes the result
 *  to React.memo): shallow compare, except `ignoredWhenHidden` between two
 *  HIDDEN renders — DPI/bleed scrubs replace the render-settings object per
 *  frame and a hidden editor has no use for it (its build effect bails on
 *  !active; it repaints on activation). A factory taking `keyof P`, not a
 *  hardcoded string: the caller names the ignored prop against its real
 *  props type, so renaming that prop fails to compile instead of silently
 *  degrading the bail. */
export function makeHiddenPropsEqual<P extends { active: boolean }>(
  ignoredWhenHidden: keyof P & string,
) {
  return (prev: P, next: P): boolean => {
    for (const key of Object.keys(next) as (keyof P)[]) {
      if (key === ignoredWhenHidden && !prev.active && !next.active) continue;
      if (!Object.is(prev[key], next[key])) return false;
    }
    return true;
  };
}
