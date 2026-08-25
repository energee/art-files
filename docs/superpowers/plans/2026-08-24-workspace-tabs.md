# Workspace Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiple .label projects open at once in one window, each in its own tab, on desktop and browser builds.

**Architecture:** App.tsx's component becomes `DocumentEditor`; a new `TabsShell` owns a pure-data tab list (`src/tabs.ts`) and renders one mounted-but-hidden editor per tab. Inactive editors gate their global listeners and drop rendered output; shared/press-level concerns (render settings, updater, preview worker, OS file-open routing) lift to the shell.

**Tech Stack:** React 19, TypeScript, Tauri 2, shadcn/base-ui, vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-workspace-tabs-design.md`

## Global Constraints

- Branch `feat/workspace-tabs`, worktree `.claude/worktrees/workspace-tabs`, stacked on `feat/windows-linux-support`.
- Version 0.1.10 → 0.1.11 across `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, with a CHANGELOG entry.
- `npx tsc --noEmit` and `npm test` clean before every commit; `node scripts/check-release.mjs origin/main` before push.
- No new dependencies. No Rust changes. No Co-Authored-By lines in commits.
- Docs update in the same commit as the behavior they describe.

---

### Task 1: Pure tab model (`src/tabs.ts`)

**Files:**
- Create: `src/tabs.ts`
- Test: `tests/tabs.test.ts`

**Interfaces:**
- Produces (used by Task 4's shell):
  - `type TabMeta = { title: string; dirty: boolean; edited: boolean; filePath: string | null }`
  - `type Tab = TabMeta & { id: number }`
  - `type TabsState = { tabs: Tab[]; active: number; nextId: number }`
  - `initialTabs(): TabsState` — one Untitled tab, active.
  - `addTab(s): TabsState` — appends an Untitled tab and activates it.
  - `activateTab(s, id): TabsState` — no-op for unknown ids.
  - `updateTabMeta(s, id, meta: Partial<TabMeta>): TabsState`
  - `closeTab(s, id): TabsState` — removes the tab; if it was active, activates the right neighbor (left when it was last); closing the only tab yields a fresh Untitled tab.
  - `isPristine(t: Tab): boolean` — `!t.edited && !t.filePath`.
  - `routeFileOpen(s, path): { focus: number } | { reuse: number } | { open: "new" }`
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests** (`tests/tabs.test.ts`, vitest, mirroring `tests/history.test.ts` style):

```ts
import { describe, expect, test } from "vitest";
import {
  activateTab, addTab, closeTab, initialTabs, isPristine, routeFileOpen,
  updateTabMeta,
} from "@/tabs";

const opened = (path: string) =>
  ({ title: path, dirty: false, edited: false, filePath: path });

describe("tab transitions", () => {
  test("boots with one active Untitled tab", () => {
    const s = initialTabs();
    expect(s.tabs).toHaveLength(1);
    expect(s.active).toBe(s.tabs[0].id);
    expect(s.tabs[0].title).toBe("Untitled");
  });
  test("addTab appends and activates, ids never repeat", () => {
    let s = initialTabs();
    const first = s.active;
    s = addTab(s);
    expect(s.tabs).toHaveLength(2);
    expect(s.active).not.toBe(first);
    const reused = closeTab(addTab(s), s.tabs[1].id);
    expect(new Set(reused.tabs.map((t) => t.id)).size).toBe(reused.tabs.length);
  });
  test("activateTab ignores unknown ids", () => {
    const s = initialTabs();
    expect(activateTab(s, 999)).toBe(s);
  });
  test("closing the active tab activates the right neighbor, left at the end", () => {
    let s = addTab(addTab(initialTabs()));           // ids 1,2,3 — active 3
    s = activateTab(s, 2);
    expect(closeTab(s, 2).active).toBe(3);           // right neighbor
    s = activateTab(s, 3);
    expect(closeTab(s, 3).active).toBe(2);           // was last — left
  });
  test("closing an inactive tab keeps the active one", () => {
    const s = addTab(initialTabs());
    expect(closeTab(s, s.tabs[0].id).active).toBe(s.active);
  });
  test("closing the only tab replaces it with a fresh Untitled tab", () => {
    const s = initialTabs();
    const next = closeTab(s, s.active);
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0].id).not.toBe(s.active);
    expect(isPristine(next.tabs[0])).toBe(true);
  });
  test("updateTabMeta patches one tab", () => {
    const s0 = initialTabs();
    const s = updateTabMeta(s0, s0.tabs[0].id, { dirty: false });
    expect(s.tabs[0].dirty).toBe(false);
  });
});

describe("routeFileOpen", () => {
  test("focuses the tab already holding the path", () => {
    let s = addTab(initialTabs());
    s = updateTabMeta(s, s.tabs[0].id, opened("/a.label"));
    expect(routeFileOpen(s, "/a.label")).toEqual({ focus: s.tabs[0].id });
  });
  test("reuses a pristine active tab", () => {
    const s = initialTabs();
    expect(routeFileOpen(s, "/a.label")).toEqual({ reuse: s.active });
  });
  test("edited or file-backed active tab means a new tab", () => {
    const s0 = initialTabs();
    let s = updateTabMeta(s0, s0.active, { edited: true });
    expect(routeFileOpen(s, "/a.label")).toEqual({ open: "new" });
    s = updateTabMeta(s0, s0.active, opened("/b.label"));
    expect(routeFileOpen(s, "/a.label")).toEqual({ open: "new" });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tabs.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/tabs.ts`:**

```ts
// tabs.ts — pure tab-strip state for the workspace shell (TabsShell.tsx).
// Data + transition functions with no React, like history.ts: the shell
// owns a TabsState in useState and applies these on user events. Editors
// report TabMeta upward; the shell never reaches into editor internals.
export type TabMeta = {
  title: string;            // file basename or exportBaseName; "Untitled" default
  dirty: boolean;           // the editor's dirty flag (Save enabled)
  edited: boolean;          // any user mutation since mount/open — gates close prompts
  filePath: string | null;  // Tauri path identity, for OS-open dedupe
};
export type Tab = TabMeta & { id: number };
export type TabsState = { tabs: Tab[]; active: number; nextId: number };

const UNTITLED: TabMeta = { title: "Untitled", dirty: true, edited: false, filePath: null };
// dirty starts true, edited false: a fresh default document has Save enabled
// (today's boot state) but closing it must not prompt.

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

/** Where an OS-opened .label lands: the tab already holding that path, else
 *  a pristine active tab, else a new tab. */
export type OpenRoute = { focus: number } | { reuse: number } | { open: "new" };
export function routeFileOpen(s: TabsState, path: string): OpenRoute {
  const existing = s.tabs.find((t) => t.filePath === path);
  if (existing) return { focus: existing.id };
  const active = s.tabs.find((t) => t.id === s.active);
  if (active && isPristine(active)) return { reuse: active.id };
  return { open: "new" };
}
```

- [ ] **Step 4: Run** `npx vitest run tests/tabs.test.ts` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add src/tabs.ts tests/tabs.test.ts && git commit -m "Add pure tab-strip state model"`.

---

### Task 2: Sidebar hotkey gating

**Files:**
- Modify: `src/components/ui/sidebar.tsx` (the `SidebarProvider` keydown effect, ~line 115–124)

**Interfaces:**
- Produces: `SidebarProvider` accepts optional `hotkey?: boolean` (default `true`); when false the ⌘B window keydown listener is not registered.
- Consumes: nothing.

- [ ] **Step 1:** Add `hotkey = true` to `SidebarProvider`'s props and wrap the keydown effect: `if (!hotkey) return;` first line, `hotkey` in the dep array. One-line JSDoc on the prop: hidden tab-instances pass false so only the active editor owns ⌘B.
- [ ] **Step 2:** `npx tsc --noEmit` clean (behavior default-on, no test — trivial).
- [ ] **Step 3: Commit** — `git commit -m "Allow disabling the sidebar hotkey per provider"`.

---

### Task 3: App.tsx → DocumentEditor

The load-bearing refactor. All edits in `src/App.tsx` unless noted.

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Presets` type from `@/presets`.
- Produces (Task 4 relies on exactly these):

```ts
export type FileToOpen = {
  seq: number;                      // monotonic; a new seq triggers the open
  path?: string;                    // Tauri: OS open / native dialog
  handle?: FileSystemFileHandle;    // browser FS-Access picker
  file?: File;                      // hidden-input fallback (no save identity)
};
export type DocumentMeta = {
  title: string; dirty: boolean; edited: boolean; filePath: string | null;
};
export type RenderSettings = Presets["render"];
type DocumentEditorProps = {
  active: boolean;
  fileToOpen: FileToOpen | null;
  onMeta: (meta: DocumentMeta) => void;
  /** Shell-owned slot the editor assigns its save fn into each render;
   *  resolves false when the user cancels the save dialog. */
  saveSlot: { current: (() => Promise<boolean>) | null };
  render: RenderSettings;
  onRenderChange: (r: RenderSettings) => void;
  onOpenProject: () => void;   // File→Open lives in the shell now
  onNewTab: () => void;
  onCloseTab: () => void;
  onCheckForUpdates: () => void;
};
export function DocumentEditor(props: DocumentEditorProps)
```

- [ ] **Step 1: Rename + props.** `export default function App()` → `export function DocumentEditor({...}: DocumentEditorProps)`. Update the header comment: App.tsx now owns one document's state; the shell contract (active gating, meta reporting) is stated there, including "anything added here that registers window/document listeners or singletons must honor `active`".
- [ ] **Step 2: `edited` + meta reporting.**
  - Add `const [edited, setEdited] = useState(false);` and `const [filePath, setFilePath] = useState<string | null>(null);`.
  - `update`, `swapLoaded`, `mutating`: add `setEdited(true)` beside the existing `setDirty(true)`.
  - Everywhere `projectPath.current` is assigned, also `setFilePath(...)` with the same value (`saveProject` success, the fileToOpen path adoption, `forgetProjectFile`).
  - Title: `const title = filePath ? filePath.split(/[\\/]/).pop()!.replace(/\.label$/i, "") : exportBaseName(cfg);`
  - Report: `useEffect(() => onMeta({ title, dirty, edited, filePath }), [title, dirty, edited, filePath]);` (onMeta is a per-tab shell callback; eslint-disable the dep warning like the existing mount effects).
  - `openProject` success path: `setEdited(false)` beside the existing `setDirty(false)`.
- [ ] **Step 3: Render settings from props.** Delete the editor's `const [render, setRender] = useState(DEFAULT_RENDER)`, the `adopted` ref effect, and the debounced `mutatePresets` write (they move to the shell in Task 4). Rewrite `docSettings` handlers against the props (`onRenderChange({ ...render, dpi: Math.round(v) })` etc.; the `commitBleedIn` echo-guard: `const bleedIn = commitBleedIn(render.bleedIn, v); if (bleedIn !== render.bleedIn) onRenderChange({ ...render, bleedIn });`). `usePresets` stays (presets dialog + error alert).
- [ ] **Step 4: Active gating.**
  - `const activeRef = useRef(active); activeRef.current = active;` — both document keydown handlers get `if (!activeRef.current) return;` as their first line.
  - `<AppMenu>`, `<CommandMenu>`, `<AssetDropOverlay>`: wrap in `{active && ...}`.
  - `SidebarProvider` gets `hotkey={active}` (Task 2).
  - `<CanView>` condition `viewMode !== "2d"` → `active && viewMode !== "2d"` (three.js context freed while hidden).
  - Delete the contextmenu-blocker effect, the `disposePreviewWorker` unmount effect, the `<DesktopUpdater>` element and `updateCheckRequest` state (shell-owned; the menu's Check-for-Updates now calls the `onCheckForUpdates` prop straight through).
  - Deactivation cleanup: `useEffect(() => { if (!active) { setPdfs(null); built.current = null; } }, [active]);`
  - Build effect: first line `if (blocked || !active) return;`, `active` appended to the dep array — the flip back to true is the reactivation rebuild trigger.
- [ ] **Step 5: Open plumbing.**
  - Delete the Finder-open effect (`take_opened_file` pull + `project-file-opened` listener — shell-owned now) and `openProjectPicker` + the hidden `openRef` input (picker moves to the shell). Export `LABEL_TYPES` and `openPicker`/`isAbort` if the shell needs them from here (or duplicate the three lines there — whichever reads cleaner).
  - Add the `fileToOpen` effect:

```ts
// Opens handed down by the shell (OS opens and File→Open both land here).
// seq-gated so a re-render can't re-open; each source adopts the matching
// save identity, mirroring what the deleted per-editor entry points did.
const openedSeq = useRef(0);
useEffect(() => {
  if (!fileToOpen || fileToOpen.seq === openedSeq.current) return;
  openedSeq.current = fileToOpen.seq;
  const { path, handle, file } = fileToOpen;
  void (async () => {
    try {
      if (path) {
        const name = await basename(path);
        if (await openWithRetry(async () => ({ name, bytes: await readNativeFile(path) }))) {
          projectPath.current = path;
          setFilePath(path);
        }
      } else if (handle) {
        if (await openWithRetry(async () => fileSource(await handle.getFile())))
          projectHandle.current = handle;
      } else if (file) {
        if (await openWithRetry(() => fileSource(file))) forgetProjectFile();
      }
    } catch (err) {
      reportOpenError(err);
    }
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [fileToOpen]);
```

- [ ] **Step 6: Save returns success + slot.**
  - `saveProject` → `Promise<boolean>`: `true` after each `setDirty(false)` path, `false` on the null-path/abort returns and on caught errors.
  - After its definition: `saveSlot.current = () => saveProject();` (assigned every render — the shell reads it only on user events).
  - `forgetProjectFile` also calls `setFilePath(null)`.
- [ ] **Step 7: Commands.** Replace `project-new` with `{ id: "tab-new", label: "New Tab", key: "n", mods: "⌘", run: onNewTab }`; add `{ id: "tab-close", label: "Close Tab", key: "w", mods: "⌘", run: onCloseTab }`; `project-open`'s run becomes `onOpenProject`. Delete `requestNewProject`, `createNewProject`, `newProjectOpen` state and its `<Dialog>` (`resetDocument` stays — `openProject` uses it).
- [ ] **Step 8:** `npx tsc --noEmit` — remaining errors only in `src/main.tsx` (no default export) and `tests/appmenu.test.ts` (`project-new`); fixed by Tasks 4–5. `npx vitest run` for the other suites.
- [ ] **Step 9: Commit** with Task 4 if needed to keep every commit compiling.

---

### Task 4: TabsShell + main.tsx

**Files:**
- Create: `src/TabsShell.tsx`
- Modify: `src/main.tsx`; `src/components/ui/sidebar.tsx` only if `h-svh`/`min-h-svh` sizing needs it (see Step 6).

**Interfaces:**
- Consumes: Task 1's transitions; Task 3's `DocumentEditor`, `FileToOpen`, `DocumentMeta`, `RenderSettings`.
- Produces: default export `TabsShell()` — the app root.

- [ ] **Step 1: Skeleton.** State: `const [state, setState] = useState(initialTabs)`, `const stateRef = useRef(state); stateRef.current = state;`, `const [pending, setPending] = useState<Record<number, FileToOpen>>({})`, `const seq = useRef(1)`, `const saveSlots = useRef(new Map<number, { current: (() => Promise<boolean>) | null }>())` (one stable slot object per tab id, created on demand in the render loop), `const [confirmClose, setConfirmClose] = useState<number | null>(null)`, `const [closingWindow, setClosingWindow] = useState(false)`, `const [checkRequest, setCheckRequest] = useState(0)`.
- [ ] **Step 2: Lifted shared effects** (moved from App.tsx): contextmenu blocker, `useEffect(() => () => disposePreviewWorker(), [])`, the render-settings block (`usePresets()` + `useState(DEFAULT_RENDER)` + `adopted` adoption + 500 ms debounced `mutatePresets` write), and `<DesktopUpdater dirty={state.tabs.some((t) => t.dirty && t.edited)} checkRequest={checkRequest} />`.
- [ ] **Step 3: Open routing.**

```tsx
/** Queue an open into tab `id` and show it. */
const openInTab = (id: number, fo: Omit<FileToOpen, "seq">) => {
  setPending((p) => ({ ...p, [id]: { ...fo, seq: seq.current++ } }));
  setState((s) => activateTab(s, id));
};
/** Open into a pristine active tab, else a new one. */
const openSomewhere = (fo: Omit<FileToOpen, "seq">) => {
  const s = stateRef.current;
  const active = s.tabs.find((t) => t.id === s.active);
  if (active && isPristine(active)) return openInTab(active.id, fo);
  const next = addTab(s);
  setState(next);
  openInTab(next.active, fo);
};
```

  - OS opens (`isTauri()` only) — the old Finder effect reshaped: pull `take_opened_file` on mount and on each `project-file-opened`; route `routeFileOpen(stateRef.current, path)` — `focus` → `activateTab`, `reuse` → `openInTab(id, { path })`, `open` → `openSomewhere({ path })` (which lands on a new tab, the active one being non-pristine).
  - File→Open (moved picker): FS-Access `openPicker()` probe + hidden `<input type="file" accept={LABEL_EXT}>` fallback, result to `openSomewhere({ handle })` / `openSomewhere({ file })`.
- [ ] **Step 4: Close flow.**

```tsx
const doClose = (id: number) => {
  saveSlots.current.delete(id);
  setPending(({ [id]: _, ...rest }) => rest);
  setState((s) => closeTab(s, id));
};
const requestClose = (id: number) => {
  const tab = stateRef.current.tabs.find((t) => t.id === id);
  if (tab && tab.edited && tab.dirty) {
    setState((s) => activateTab(s, id));  // show what's being decided
    setConfirmClose(id);
  } else doClose(id);
};
```

  Dialog (shadcn `Dialog`, same shape as the deleted New-Project one): title `Close "{title}"?`, body "This tab has unsaved changes.", buttons **Cancel** (dismiss + `setClosingWindow(false)`), **Discard** (destructive → `doClose`), **Save** (`await saveSlots.current.get(id)?.current?.()`; `true` → `doClose`, `false` → dialog stays).
  After a `doClose` while `closingWindow`: next `edited && dirty` tab → `setConfirmClose(next.id)` (+ activate), else `getCurrentWindow().destroy()`.
- [ ] **Step 5: Window integration.** Tauri: `getCurrentWindow().onCloseRequested` — any `edited && dirty` tab → `preventDefault()`, `setClosingWindow(true)`, `requestClose(firstDirty.id)`. Title effect on the active tab's meta: `` setTitle(dirty && edited ? `• ${title}` : title) ``. Browser: `beforeunload` handler (`e.preventDefault()`) registered while any tab is `edited && dirty`.
- [ ] **Step 6: Layout + editor loop.**

```tsx
<div className="flex h-svh flex-col">
  <TabStrip />   {/* local component in this file, not a new module */}
  <div className="relative min-h-0 flex-1">
    {state.tabs.map((t) => {
      let slot = saveSlots.current.get(t.id);
      if (!slot) saveSlots.current.set(t.id, (slot = { current: null }));
      return (
        <div key={t.id} className={t.id === state.active ? "h-full" : "hidden"}>
          <DocumentEditor
            active={t.id === state.active}
            fileToOpen={pending[t.id] ?? null}
            onMeta={(m) => setState((s) => updateTabMeta(s, t.id, m))}
            saveSlot={slot}
            render={render} onRenderChange={setRender}
            onOpenProject={() => void openProjectPicker()}
            onNewTab={() => setState(addTab)}
            onCloseTab={() => requestClose(t.id)}
            onCheckForUpdates={() => setCheckRequest((n) => n + 1)} />
        </div>
      );
    })}
  </div>
</div>
```

  The editor's `h-svh` (SidebarInset) and the provider's `min-h-svh` become `h-full`/`min-h-0 h-full` so strip + editor fit one viewport — `className` overrides at the use sites in App.tsx; edit `ui/sidebar.tsx` only if its built-ins win the merge.
  TabStrip: a `bg-sidebar` row — per tab a button group: title, dirty dot (shown when `dirty && edited`), lucide `X` → `requestClose`; active tab `bg-background`; trailing `+` → `setState(addTab)`; `overflow-x-auto`.
- [ ] **Step 7: main.tsx** — replace the App import with `TabsShell`, render `<TabsShell />`.
- [ ] **Step 8: Verify** — `npx tsc --noEmit` clean; `npx vitest run` (appmenu red until Task 5); `npm run dev`: two tabs, isolated edits, switch drops/rebuilds preview, dirty-close dialog works.
- [ ] **Step 9: Commit** — `git commit -m "Add workspace tabs"` (with Task 3's changes if held).

---

### Task 5: Menu layout + appmenu tests

**Files:**
- Modify: `src/components/AppMenu.tsx` (MENU_LAYOUT data), `tests/appmenu.test.ts`

**Interfaces:**
- Consumes: command ids from Task 3 (`tab-new`, `tab-close`, `project-open`).
- Produces: File menu — New Tab, Open Project…, Close Tab, then the existing Save/export entries.

- [ ] **Step 1:** Update the pins in `tests/appmenu.test.ts` (`project-new` → `tab-new`, insert `tab-close`); `npx vitest run tests/appmenu.test.ts` → FAIL against the current layout.
- [ ] **Step 2:** Update `MENU_LAYOUT` to match → PASS. Full `npx vitest run` + `npx tsc --noEmit` clean.
- [ ] **Step 3: Commit** — `git commit -m "Wire tab commands into the app menu"`.

---

### Task 6: Docs, version, release check

**Files:**
- Modify: `README.md` (tabs behavior: strip, ⌘N/⌘W, OS opens land in tabs, browser caveats), `CHANGELOG.md` (0.1.11), `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` (0.1.11).

- [ ] **Step 1:** Bump the five synchronized files (consult `scripts/check-release.mjs` for exactly what it verifies), CHANGELOG entry, README section.
- [ ] **Step 2:** `node scripts/check-release.mjs origin/main`, `npx tsc --noEmit`, `npx vitest run` — all clean.
- [ ] **Step 3: Commit** — `git commit -m "Document workspace tabs and bump to 0.1.11"`.

---

### Task 7: Manual verification matrix

- [ ] Desktop (`npm run tauri dev`): two OS file-opens → two tabs; same file twice → focus; dirty tab × → three-way dialog, Save-cancel keeps the tab; window close sweeps dirty tabs; window title tracks the active tab.
- [ ] Browser (`npm run dev`): tabs + `+`; File→Open into a new tab when the active one is edited; beforeunload prompt when dirty; ⌘K palette affects only the active tab; a dropped texture lands in the active tab only.
- [ ] Memory sanity: 3 tabs with textures — background tabs hold no fresh renders; reactivation repaints within ~1 s.

Deviations from this plan get reported at the end with reasons.
