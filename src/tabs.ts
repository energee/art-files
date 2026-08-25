// tabs.ts — pure tab-strip state for the workspace shell (TabsShell.tsx).
// Data + transition functions with no React, like history.ts: the shell
// owns a TabsState in useState and applies these on user events. Editors
// report TabMeta upward through onMeta; the shell never reaches into
// editor internals.
export type TabMeta = {
  title: string;            // file basename or exportBaseName; "Untitled" default
  dirty: boolean;           // the editor's dirty flag (Save enabled)
  edited: boolean;          // any user mutation since mount/open — gates close prompts
  filePath: string | null;  // Tauri path identity, for OS-open dedupe
};
export type Tab = TabMeta & { id: number };
export type TabsState = { tabs: Tab[]; active: number; nextId: number };

// dirty starts true, edited false: a fresh default document has Save enabled
// (today's boot state) but closing it must not prompt.
const UNTITLED: TabMeta = { title: "Untitled", dirty: true, edited: false, filePath: null };

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
 *  of the shell's open entry points go through it. */
export type OpenRoute = { focus: number } | { reuse: number } | { open: "new" };
export function routeFileOpen(s: TabsState, path?: string): OpenRoute {
  if (path) {
    const existing = s.tabs.find((t) => t.filePath === path);
    if (existing) return { focus: existing.id };
  }
  const active = s.tabs.find((t) => t.id === s.active);
  if (active && isPristine(active)) return { reuse: active.id };
  return { open: "new" };
}
