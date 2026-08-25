# Workspace tabs — design

Branch `feat/workspace-tabs`, stacked on `feat/windows-linux-support` (PR #29);
its PR targets main and merges after #29. Version bump: 0.1.10 → 0.1.11.

## Goal

Multiple `.label` projects open at once in one window, each in its own tab.
Works in both the desktop (Tauri) and browser builds. OS file-opens
(Finder / Explorer double-click, second-instance argv) open a new tab instead
of replacing the current document.

## Approach (decided): mounted-but-hidden editor instances

App.tsx's component becomes `DocumentEditor`; a new thin `TabsShell` owns the
tab strip and renders one `DocumentEditor` per tab, hiding inactive ones with
`display:none`. All per-document state — config history, dirty flag, save
target (`projectHandle`/`projectPath`), asset slots and their object URLs,
selection, zoom, view mode, guides, hidden layers — stays exactly where it
lives today, inside each instance. This is the codebase's existing idiom
(PreviewCompare stays mounted-but-hidden across view switches).

Rejected alternatives, for the record:

- **Lift all document state into a `TabState[]` store** — architecturally
  cleaner (state as data), but rewires all ~20 per-document `useState`s and
  their subtle interactions (build-chain identity checks, object-URL
  lifecycle, dirty choreography) for the same user-visible result.
- **Suspend background tabs to serialized snapshots** — lowest memory but
  seconds-scale tab switches and awkward undo-history preservation.

### Memory policy (decided): keep state, drop renders

Background tabs keep JS state and asset bytes but release rendered output:

- On `active` → false, the editor nulls its `pdfs` state and `built` ref.
  PreviewCompare (mounted, hidden) receives null bytes; CanView renders only
  when `active && viewMode !== "2d"`, so its three.js context and textures
  are freed while the instance is hidden.
- On reactivation the existing debounced build repaints from the kept
  preview-resolution asset bytes (~a second), the same lag today's
  first-need mask build has.

### The gating contract

`DocumentEditor` takes an `active: boolean` prop. Everything global-scoped in
today's App.tsx either gates on it or moves to the shell:

| Surface | Disposition |
| --- | --- |
| document keydown (undo/redo, command keys) | gate: return early when `!active` |
| `CommandMenu`'s ⌘K document keydown | gate on `active` (N palettes otherwise) |
| `AssetDropOverlay`'s window drag/drop listeners | gate on `active` — a hidden tab's overlay could swallow the active tab's drop |
| sidebar ⌘B window keydown (`SidebarProvider`) | gate on `active` — instances share a state cookie and would all toggle |
| `AppMenu` (the native Tauri menu is a singleton) | render only in the active instance |
| context-menu blocker (window listener) | move to `TabsShell` |
| `disposePreviewWorker` unmount effect | move to `TabsShell` (worker is shared) |
| `DesktopUpdater` | move to `TabsShell`; `dirty` = any tab dirty; the menu's Check-for-Updates reaches it via a shell callback prop |
| `render` settings (DPI/bleed/corner radius) + presets adopt/debounce-write | **lift to `TabsShell`**, passed down as a prop. Per-editor copies adopted once at mount would diverge, and each instance writes `setLayoutBleed`/`setOutputDpi` into shared module globals during render — a hidden tab re-rendering after the active one would stomp them with stale values. Shared state makes the render-time global writes identical from every instance; they're press/die settings, not document state |
| preview worker, tint cache, measure fonts | shared module singletons, safe as-is |
| presets dialogs / import-export (`usePresets` reads) | stay per-editor; the store is shared so instances agree |

The debounced build effect also gains `active` in its dependency list: it
bails while inactive, and the flip back to true is what triggers the
reactivation rebuild (nulling the `built` ref alone re-runs nothing).

Anything later added to `DocumentEditor` that registers window/document-level
listeners or singletons must honor `active` — stated in the component's
header comment.

## Tab model

New `src/tabs.ts` — pure data + transition functions (testable without a DOM
renderer, like history.ts):

```ts
export type Tab = {
  id: number;               // monotonically assigned by the shell
  title: string;            // exportBaseName / file basename; "Untitled" default
  dirty: boolean;           // mirrors the editor's dirty flag
  edited: boolean;          // any user mutation since mount/open — see Closing
  filePath: string | null;  // Tauri path identity, for OS-open dedupe
};
```

Transitions: `addTab`, `closeTab` (activates a neighbor), `activateTab`,
`updateTabMeta`, and `routeFileOpen(tabs, activeId, path)` returning
`{ focus: id }` (path already open) | `{ reuse: id }` (active tab pristine) |
`{ open: "new" }`.

The editor reports `{ title, dirty, edited, filePath }` upward through an
`onMeta` callback whenever any change. `edited` is set at the same three
sites that set `dirty` (`update`, `swapLoaded`, `mutating`) and cleared by
open/new — it distinguishes an untouched default document (which boots with
`dirty === true` so Save is enabled) from real unsaved work.

## Opening files

- **Pristine-reuse rule:** a tab is pristine iff `!edited && !filePath`.
  File → Open and OS opens load into the active tab if it is pristine,
  otherwise into a new tab. An OS open whose path is already open just
  focuses that tab.
- **OS opens:** the `take_opened_file` pull and `project-file-opened`
  listener move from the editor to `TabsShell`. The Rust side is untouched —
  PR #29's `deliver_opened_file` already covers macOS/Windows/Linux. The
  shell routes via `routeFileOpen` and hands the target editor a
  `fileToOpen: { seq, path?, handle?, file? }` prop; the editor's existing
  `openWithRetry` pipeline runs when `seq` changes and reports the resulting
  `filePath` back through `onMeta`.
- **File → Open:** the picker (FS-Access picker + hidden-input fallback)
  moves to the shell so it can target a new tab; the editor keeps
  `openWithRetry`/`openProject` and adopts the passed handle/path so Save
  rewrites the opened file, exactly as today.
- **File → New Project (⌘N)** becomes **New Tab**: a fresh untitled tab. The
  in-editor "discard unsaved changes?" New-Project dialog is deleted — tab
  closing covers its job.

## Closing (decided): per-tab Save / Discard / Cancel

- Tab × (and File → Close Tab, ⌘W): if `edited && dirty`, the shell shows a
  themed three-way dialog — **Save** / **Discard** / **Cancel**. Save calls
  the editor's save through an imperative handle (`saveProject` gains a
  `Promise<boolean>` result; false = save dialog cancelled, which cancels
  the close). Discard closes immediately; Cancel dismisses.
- Closing the last tab leaves one fresh untitled tab — the app always shows
  a document, as today.
- **Window close:** desktop intercepts `onCloseRequested`; each
  `edited && dirty` tab is activated in turn and gets the same three-way
  dialog; any Cancel aborts the window close. The browser build gains a
  `beforeunload` prompt while any tab is edited-and-dirty (new — today's
  single-document app has none; browsers only allow the generic dialog).
- ⌘W caveat: the browser reserves the shortcut, so the web build gets the
  menu item only; desktop gets the real accelerator.

## UI

A slim tab strip above the existing header row (both builds): label + dirty
dot + × per tab, a `+` button, click to activate. Built from existing
primitives (Button, cn, lucide icons) — no new dependency — and painted like
the `bg-sidebar` chrome band. The desktop window title shows the active
tab's title with the standard modified marker.

## Error handling

- Per-document errors (`loadError`, `buildError`, blocked states) stay
  inside each editor's header alerts, scoped to its tab.
- A failed OS-open into a new tab leaves the tab open showing the editor's
  existing load-error alert — same behavior as today's failed open.
- Save failures inside the close flow keep the tab open (the close is
  cancelled) with the editor's save-error alert visible.

## Testing

- `tests/tabs.test.ts`: pure transition tests — add/close/activate,
  neighbor activation on close, meta updates, `routeFileOpen`'s three
  outcomes, pristine rule.
- `tests/appmenu.test.ts`: updated pins for New Tab / Close Tab entries.
- Existing suites (`history`, `labelfile`, …) unaffected.
- Manual matrix: desktop two OS opens → two tabs; dirty-close dialog paths;
  window-close sweep; browser tabs + beforeunload.

## Files touched

- `src/tabs.ts`, `tests/tabs.test.ts` — new.
- `src/App.tsx` — App → `DocumentEditor` with props
  `{ active, fileToOpen, onMeta, saveRef, render, onRenderChange,
  onOpenProject, onCheckForUpdates }`; gating per the table; renders
  dropped on deactivate; New-Project dialog removed; save returns a
  boolean.
- `src/TabsShell.tsx` — new shell; `src/main.tsx` renders it.
- `src/components/AppMenu.tsx` — command-list entries only.
- `README.md`, `CHANGELOG.md`, and the synchronized version files
  (`package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`) — 0.1.11.
- `src-tauri/src/main.rs` — no change; the OpenedFile seam is already
  tab-shaped.
