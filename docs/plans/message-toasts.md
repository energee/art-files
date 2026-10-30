# Messages as Toasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every header message pill (`HeaderAlert`) with Sonner toasts at the bottom centre of the preview, keep ongoing problems at their cause, and show nothing for a plain cancel.

**Architecture:** One `<Toaster>` for the window (mounted in `src/main.tsx`), positioned over the active tab's preview pane through two CSS variables the active editor publishes. A tiny `notify` module fixes kinds and durations; a `useOwnedToast` hook replaces `useOwnedError` for messages that belong to one source and one tab. Exports, Save Master, opens, blocked exports, asset/render errors, the tab strip and `UncaughtErrors` call these instead of writing header state; the header block and `HeaderAlert` are deleted.

**Tech Stack:** React 19 + TypeScript, shadcn/ui, Vitest 5 + happy-dom, Tauri 2 (Rust), `sonner@2.0.8`, `@tauri-apps/plugin-opener@^2.7.2` + `tauri-plugin-opener` 2.x.

**Spec:** `docs/superpowers/specs/2026-10-29-message-toasts-design.md` (approved 2026-10-29). Read it before any task; its message map rows are referenced below as "row N".

**Where:** worktree `/Users/tedslesinski/Repos/art-files/.agents/worktrees/message-toasts`, branch `feat/message-toasts` (create it from `docs/message-toasts-design` before Task 1). Run `pwd` and `git branch --show-current` before each task.

## Global Constraints

- Toasts: one Toaster, `position="bottom-center"`, horizontally centred over the active tab's preview pane (`previewPane` in `src/App.tsx`), bottom edge 8 px above that pane's bottom edge; never over the zoom/view switcher.
- Durations: success 4000 ms, info 8000 ms; warning and error stay until dismissed (`duration: Infinity`) and show a close button.
- Wording: no "Note:" prefix anywhere; title is the fact, description the detail, action the next step. English targets are in the spec's message map.
- Every new string goes into `en` and into `es`, `fr`, `de`, `pt` of the same `src/locales/*.ts` file (`Record<keyof typeof en, string>` makes `tsc` reject a missing one). Remove a key from all five when its last use goes.
- Show-in-folder label: "Show in Finder" (macOS), "Show in File Explorer" (Windows), "Show in Folder" (Linux); absent in the browser build.
- New dependencies: exactly `sonner@2.0.8`, `@tauri-apps/plugin-opener@^2.7.2`, `tauri-plugin-opener = "2"`. Install with `npm install <pkg>@<ver>` (it is a dependency change); never `npm ci` through a symlinked `node_modules`.
- Ownership (#473, #511): a writer dismisses only the toast it showed. Ongoing (owned) toasts belong to their tab; event toasts show whatever tab is in front.
- Each message is announced once; errors assertively (`role="alert"` or `aria-live="assertive"`), others politely.
  - Note (2026-10-30): errors are announced once, politely, not assertively. Sonner's live region is fixed to polite and has no per-toast override, so a second assertive region would read an error twice.
- Release train: binary-impacting; one `### Changed` bullet under `## [Unreleased]` in `CHANGELOG.md` (Task 11), no version bump.
- Gates on every task: `npx tsc --noEmit` clean, `npm run lint` zero warnings, the task's tests green. Under machine load run vitest with `--testTimeout=180000`.

## Review Focus

1. **Repeated ⌘E while blocked** must leave one "Can't export yet" toast, not a stack → test in Task 7.
2. **Closing a tab** whose owned toast is showing must dismiss that toast → test in Task 3.
3. **Several messages at once** (an export success, a stale-mask warning and an asset error) must all stay visible; Sonner's default of 3 visible hides the oldest → `visibleToasts={4}` and a test in Task 1.
4. **An export that finishes after its tab went to the background** still toasts its result (it's an event) → test in Task 5.
5. **Long file names** (an 80-character label name) wrap inside the toast instead of widening it past the preview → `max-width` + `overflow-wrap:anywhere` rule in Task 1, checked visually in Task 11.

## Dependencies and parallelism

| Task | Depends on | Can run in parallel with |
|---|---|---|
| 1 Toaster + `notify` | — | 4, 8 |
| 2 Preview anchor | 1 | 3, 4, 8, 10 |
| 3 `useOwnedToast` | 1 | 2, 4, 8, 10 |
| 4 Reveal in folder | — | 1, 2, 3, 8, 10 |
| 5 Export results | 1, 4 | 8, 10 |
| 6 Save Master + opens | 1 | 8, 10 (not 5, 7, 9: all edit `src/App.tsx`) |
| 7 Blocked export | 3 | 8, 10 |
| 8 Red invalid row | — | everything except 9 |
| 9 Owned errors, header removal | 2, 3, 5, 6, 7, 8 | 10 |
| 10 Tab strip + UncaughtErrors | 1 | 2–9 |
| 11 Docs, strings, final validation | all | — |

`src/App.tsx` tasks (2's one-line wire-up, 5, 6, 7, 9) run one at a time in that order.

---

### Task 1: Toaster and `notify`

**Files:**
- Test: `tests/toaster-dom.test.tsx` (new)
- Create: `src/notify.ts`, `src/components/ui/sonner.tsx`
- Modify: `src/main.tsx` (mount `<Toaster />` beside `<UncaughtErrors />`), `src/index.css` (placement + wrap rule), `package.json`/`package-lock.json` (`sonner@2.0.8`)

**Interfaces:**
- Produces, `src/notify.ts`:
  - `type ToastAction = { label: string; onClick: () => void }`
  - `type NotifyOptions = { id?: string; description?: string; action?: ToastAction }`
  - `notify.success | info | warning | error(title: string, opts?: NotifyOptions): string | number` and `notify.dismiss(id: string): void`
  - `TOAST_MS = { success: 4000, info: 8000 } as const`
- Produces, `src/components/ui/sonner.tsx`: `Toaster(): JSX.Element`, wrapping Sonner's with `theme` from `useTheme()[0]` (`src/theme.ts`), `position="bottom-center"`, `visibleToasts={4}`, and the app's colour tokens.
- `src/index.css`: `[data-sonner-toaster][data-x-position="center"] { left: var(--toast-center-x, 50%) !important; bottom: var(--toast-bottom, 16px) !important; }`, plus `overflow-wrap: anywhere` and a max width no wider than `min(420px, 90vw)` on a toast.

- [ ] **Step 1: Write the failing tests** in `tests/toaster-dom.test.tsx` (render `<Toaster />`, fake timers):
  - `"a success toast shows its title and fades after 4 s"`: `notify.success("Saved Lupula.pdf")` → text present; advance 4000 ms plus Sonner's exit → text gone.
  - `"warnings and errors stay until dismissed and have a close button"`: after 60 s both still present; the close button removes one.
  - `"sits at the bottom centre"`: `[data-sonner-toaster]` has `data-y-position="bottom"` and `data-x-position="center"`.
  - `"follows the app theme"`: `document.documentElement.dataset.theme = "dark"` → toaster has `data-sonner-theme="dark"`.
  - `"keeps four toasts visible"`: four `notify.warning` calls → four titles visible.
  - `"announces errors assertively and successes politely"`: the error's text is inside an `[aria-live="assertive"]` or `[role="alert"]` element; the success's is not.
    - Note (2026-10-30): errors are announced once, politely, not assertively. Sonner's live region is fixed to polite and has no per-toast override, so a second assertive region would read an error twice. The shipped test counts that each toast's text sits in exactly one live region.
- [ ] **Step 2:** `npx vitest run tests/toaster-dom.test.tsx` → FAIL (module not found).
- [ ] **Step 3:** `npm install sonner@2.0.8`; implement `notify.ts`, `ui/sonner.tsx` and the CSS; mount in `main.tsx`. Warnings and errors get `duration: Infinity, closeButton: true`.
- [ ] **Step 4:** rerun → PASS; `npx tsc --noEmit`; `npm run lint`.
- [ ] **Step 5:** commit `Feat: Sonner toaster and notify helper`.

### Task 2: Centre toasts over the active preview

**Files:**
- Test: `tests/toast-anchor-dom.test.tsx` (new)
- Create: `src/toastAnchor.ts`
- Modify: `src/App.tsx` (one call next to the `previewPane` ref)

**Interfaces:**
- Consumes: the CSS variables from Task 1.
- Produces: `usePreviewToastAnchor(pane: React.RefObject<HTMLElement | null>, active: boolean): void`. While `active`, it observes the pane (ResizeObserver plus window `resize`) and sets `--toast-center-x = ${rect.left + rect.width / 2}px` and `--toast-bottom = ${innerHeight - rect.bottom + 8}px` on `document.documentElement`. Inactive editors never write.

- [ ] **Step 1: Failing tests** (stub `getBoundingClientRect` → `{ left: 256, width: 800, bottom: 760 }`, `innerHeight` 800, stub ResizeObserver):
  - `"the active editor centres toasts over its pane"`: `--toast-center-x` is `"656px"` and `--toast-bottom` is `"48px"`.
  - `"an inactive editor leaves the anchor alone"`.
  - `"a pane resize moves the anchor"`: the ResizeObserver callback fires with `width: 600` → `"556px"`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement and wire `usePreviewToastAnchor(previewPane, active)` in `DocumentEditor`. **Step 4:** run → PASS, tsc, lint. **Step 5:** commit `Feat: Centre toasts over the active preview`.

### Task 3: `useOwnedToast`

**Files:**
- Test: `tests/use-owned-toast-dom.test.tsx` (new)
- Create: `src/useOwnedToast.ts` (`src/useOwnedError.ts` stays until Task 9 removes its last caller)

**Interfaces:**
- Consumes: `notify`, `NotifyOptions` (Task 1).
- Produces: `type OwnedKind = "error" | "warning"` and `useOwnedToast(active: boolean): { set(text: string, kind?: OwnedKind, opts?: Pick<NotifyOptions, "description" | "action">): void; clear(): void }`. `kind` defaults to `"error"`. The toast id comes from `useId()`, so one hook instance means one toast. `set` replaces the hook's own toast. `clear` dismisses only its own. While `!active` its toast is dismissed but remembered; when `active` returns, it is shown again. Unmount dismisses it.

- [ ] **Step 1: Failing tests:**
  - `"shows its message and replaces it instead of stacking"`: `set("A")`, `set("B")` → only "B".
  - `"clear dismisses only its own toast (#473, #511)"`: owners X and Y; `X.set("x")`, `Y.set("y")`, `Y.clear()` → "x" remains.
  - `"hides while its tab is inactive and returns with the tab"`: rerender with `active=false` → gone; `active=true` → back.
  - `"stays until cleared"`: after 60 s it is still shown.
  - `"unmounting the owner dismisses its toast"` (Review Focus 2).
- [ ] **Steps 2–5:** run → FAIL; implement; run → PASS, tsc, lint; commit `Feat: useOwnedToast for messages owned by one source and tab`.

### Task 4: Reveal in folder (Show in Finder)

**Files:**
- Test: `tests/reveal-dom.test.ts` (new), `tests/tauri-capabilities.test.ts` (add one case)
- Create: `src/reveal.ts`
- Modify: `package.json`/`package-lock.json` (`@tauri-apps/plugin-opener@^2.7.2`), `src-tauri/Cargo.toml` (`tauri-plugin-opener = "2"`), `src-tauri/Cargo.lock`, `src-tauri/src/main.rs` (`.plugin(tauri_plugin_opener::init())` beside dialog/fs), `src-tauri/capabilities/default.json` (`"opener:allow-reveal-item-in-dir"` only), `src/locales/core.ts` (three labels, 5 languages)

**Interfaces:**
- Consumes: `ToastAction` (Task 1), `isTauri` from `@tauri-apps/api/core`.
- Produces: `revealLabel(): string`, which picks the platform label from `navigator.userAgent` (Macintosh, else Windows, else Linux), and `revealAction(path: string | undefined): ToastAction | undefined`. It is `undefined` in the browser or without a path; otherwise `onClick` dynamically imports `@tauri-apps/plugin-opener` and calls `revealItemInDir(path)`.

- [ ] **Step 1: Failing tests:**
  - `"names the action for each platform"`: Mac UA → "Show in Finder", Windows → "Show in File Explorer", Linux → "Show in Folder".
  - `"offers nothing in the browser or without a path"`.
  - `"reveals the saved file"`: mock the plugin; `revealAction("/x/Lupula.pdf")!.onClick()` → `revealItemInDir` called with `"/x/Lupula.pdf"`.
  - In `tauri-capabilities.test.ts`: `"grants only reveal-item-in-dir from the opener plugin"`: the permissions include it, and no other `opener:` permission.
- [ ] **Step 2:** run → FAIL. **Step 3:** install, add the crate, register the plugin, grant the capability, implement. **Step 4:** run → PASS; `cargo check --manifest-path src-tauri/Cargo.toml`; tsc; lint. **Step 5:** commit `Feat: Reveal exported files in Finder`.

### Task 5: Export results as toasts (rows 1–5)

**Files:**
- Test: `tests/use-export-dom.test.tsx`, `tests/export-pair-dialog-dom.test.tsx` (update assertions on `exportNote`/header text; add the cases below)
- Modify: `src/useExport.ts` (`exportPair`, `exportSingle`, `warnIfStaleMask`; drop `exportNote`/`setExportNote` and the `useOwnedError` export slot), `src/App.tsx` (drop the `exportNote` alert and the `data-export-saved` span), locale strings

**Interfaces:**
- Consumes: `notify` (Task 1), `revealAction` (Task 4).
- Produces: `useExport` no longer returns `exportNote`. Each editor's export messages use one id, `` `${useId()}:export` ``. A new export run dismisses that id first; nothing else does.
- Behaviour, following spec rows 1–5:
  - **Fresh success:** `notify.success(t("Saved {{files}}"), { action: revealAction(firstSavedPath) })`.
  - **One-file cancel:** no toast.
  - **Pair cancelled at the second file:** `notify.warning(t("{{file}} wasn't saved"), { description: t("Export again to save both files."), action: { label: t("Export again"), onClick: retry } })`. `retry` re-runs the same pair export with `ask: true`.
  - **Write failure:** `notify.error(t("Couldn't save {{file}}"), …)`. The description is `errMsg`, prefixed with "Saved {files}." when part was saved.
  - **Stale mask:** `notify.warning(t("Saved {{file}}"), { description: t("Don't send the old {{mask}} with it — this PDF already has the white ink."), action: revealAction(maskPath) })`.

- [ ] **Step 1: Failing tests:**
  - `"a cancelled one-file export shows no toast"`.
  - `"a pair cancelled at the mask warns, and Export again re-runs it asking"`: the warning text is "Lupula-mask.pdf wasn't saved"; clicking the action opens a second save request with `ask: true`.
  - `"a failed write keeps an error toast naming the file"`.
  - `"a fresh export toasts Saved Lupula.pdf with Show in Finder on desktop"`.
  - `"an edit during the export withholds the success toast (#400)"`.
  - `"the result toasts even when the tab went to the background"` (Review Focus 4).
  - `"an older -mask.pdf beside the print PDF warns and offers to reveal it"`.
- [ ] **Steps 2–5:** run → FAIL; implement; run the two files → PASS, tsc, lint; commit `Feat: Export results as toasts; a cancel shows nothing`.

### Task 6: Save Master and open messages (rows 6–9)

**Files:**
- Test: `tests/save-races-dom.test.tsx` (the Open Master cases at "benched-values note…" and "switches at once over hidden values…"), `tests/export-pair-dialog-dom.test.tsx` (Save Master note), `tests/stale-label-ids-dom.test.tsx`
- Modify: `src/App.tsx`: the Save Master success near `t("Note: Saved {{name}}"…)`, `tryParseMaster`'s warnings, the recovered-path note, the Open Master "Switched to…" note, and every `setLoadError(...)` call. Leave the owned `textureError`/`maskError` slots for Task 9. Also locale strings.

**Interfaces:**
- Consumes: `notify` (Task 1).
- Produces: no more `setLoadMessage({ note: true, … })` or `setLoadError(…)` calls outside the owned-error slots.
- Behaviour:
  - **Save Master:** `notify.success(t("Saved {{name}}"), { description: t("{{count}} changes", { count }) })`. The description is omitted at 0.
  - **Missing images:** a separate `notify.warning` with the existing sentence.
  - **Open warnings and the recovered-path note:** `notify.warning(text)` with no "Note:".
  - **Open Master over hidden values:** `notify.info(t("Switched to “{{name}}”"), { description: notes.join(" · "), action: { label: t("Undo"), onClick: undo } })`.
  - **Load and save failures:** `notify.error(text)`.

- [ ] **Step 1: Failing tests:**
  - `"Save Master toasts Saved Lolev.master · 3 changes and it fades"`.
  - `"an image with no file to save warns in its own toast"`.
  - `"Open Master over hidden values offers Undo, which restores them"`. Replaces the header assertions of the existing "switches at once…" test.
  - `"the benched-values toast survives the master's texture loading (#11)"`.
  - `"open warnings show once, without Note:"`.
- [ ] **Steps 2–5:** run → FAIL; implement; run → PASS, tsc, lint; commit `Feat: Save Master and open messages as toasts`.

### Task 7: Blocked export, at the cause (row 13, toast part)

**Files:**
- Test: `tests/export-blocked-toast-dom.test.tsx` (new), `tests/app-ux-commands-dom.test.tsx` (update blocked cases)
- Modify: `src/App.tsx`: the export command table (`disabled: exporting !== null`, no longer `exportBlocked`), a `guardExport` wrapper around each export command's `run`, deletion of the blocked-key branch in the keydown handler (`else if (cmd.id.startsWith("export-")) …`), and deletion of the blocked `HeaderAlert`. The `data-export-blocked-status` span stays. Also locale strings.

**Interfaces:**
- Consumes: `useOwnedToast` (Task 3), `selectInvalidLayer`, `setSidebarOpen`.
- Produces: `const blockedToast = useOwnedToast(active)`. While blocked, an export command calls `blockedToast.set(t("Can't export yet"), "error", { description: blockedWhy, action: { label: t("Show layer"), onClick: () => { setSidebarOpen(true); selectInvalidLayer(); } } })` and builds nothing. An effect calls `blockedToast.clear()` when `blocked` turns false.

- [ ] **Step 1: Failing tests:**
  - `"⌘E while blocked shows Can't export yet with the reason and builds nothing"`.
  - `"Export PDF in the menu is enabled while blocked and shows the same toast"`.
  - `"pressing ⌘E twice leaves one toast"` (Review Focus 1).
  - `"Show layer opens a collapsed Layers sidebar and selects the invalid layer"`.
  - `"fixing the value dismisses the toast"`.
  - `"screen readers still hear Export blocked: {reason}"` (the `data-export-blocked-status` text).
- [ ] **Steps 2–5:** run → FAIL; implement; run both files → PASS, tsc, lint; commit `Feat: Blocked export explains itself in a toast; no header pill`.

### Task 8: Red invalid row in Layers (row 13, row part)

**Files:**
- Test: `tests/layerlist-dom.test.tsx` (add a case)
- Modify: `src/components/LayerList.tsx`: the `invalid` prop becomes `Map<string, string>` (layer id → reason). An invalid row gets `data-invalid`, a red tint and red text (`bg-destructive/10 text-destructive-text`). Its dot stays, and the dot's `title` and the row's tooltip read the reason. Also update `src/App.tsx` where `invalid={errorIds}` is passed: give it `new Map(Object.entries(errors))`, memoised, replacing `errorIds`.

**Interfaces:**
- Produces: `LayerList` prop `invalid: Map<string, string>`.

- [ ] **Step 1: Failing test:** `"marks an invalid row red and names the reason"`. The row for `"barcode"` has `data-invalid`; its tooltip text is `"Needs 12 digits"`.
- [ ] **Steps 2–5:** run → FAIL; implement; run → PASS, tsc, lint; commit `Feat: Invalid layers show red in Layers with the reason`.

### Task 9: Owned errors to toasts; delete the header messages (rows 10–12, 15 in App)

**Files:**
- Test: `tests/filedrop-dom.test.tsx`, `tests/characterheight-dom.test.tsx`, `tests/field-input-dom.test.tsx`, `tests/stale-label-ids-dom.test.tsx`, `tests/error-boundary-dom.test.tsx`, `tests/save-races-dom.test.tsx`, `tests/generate.test.ts` (any header-text assertions; `generate` CLI output itself is unchanged)
- Modify: `src/App.tsx`
- Delete: `src/useOwnedError.ts`

**What changes in `src/App.tsx`:**
- `textureError`, `maskError`, `imageError` and `assetError` become `useOwnedToast(active)`.
- `renderError` sets an owned toast while it's non-empty and clears it when empty.
- `resolveWarnings` becomes an owned warning toast, set when the joined text changes and cleared when it's empty.
- `onNativeError` and the remaining `setBuildError` callers (font-load failures, edit refusals) use `notify.error`.
- Delete `HeaderAlert`, `HEADER_ALERT_TONE`, `headerError`, `buildMessage`, `loadMessage`/`loadError` state, and the header's message JSX.

**Interfaces:**
- Consumes: Tasks 1, 3; runs after 5, 6 and 7 so nothing still writes header state.

- [ ] **Step 1: Failing tests:**
  - `"a texture that fails to decode keeps an error toast until a good texture replaces it"`.
  - `"a render error toast belongs to its tab"`: switch tabs → hidden; switch back → shown.
  - `"a label overriding an unknown layer warns once"`.
  - `"the header shows no message"`: no `[role="alert"]`, `[data-blocked-export]` or `.text-warning-text` inside `<header>`, after each of: export success, blocked, asset error.
  - Update the listed files' header assertions to toast assertions.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement and delete. **Step 4:** run the listed files → PASS; `npx knip@6.38.0` clean; tsc; lint. **Step 5:** commit `Feat: Owned errors as toasts; remove header messages`.

### Task 10: Tab-strip open error and uncaught errors (rows 14, 15)

**Files:**
- Test: `tests/tabs-open-recent-dom.test.tsx`, `tests/tabs-os-open-dom.test.tsx`, `tests/uncaught-errors-dom.test.tsx`
- Modify: `src/TabsShell.tsx`: `pickError` state and its `<span role="alert">` go, replaced by `notify.error(t("Could not open label: {{error}}", …))`. Also `src/components/UncaughtErrors.tsx`: it keeps its window listeners and its abort filter, renders nothing, and calls `notify.error(title, { description })`; update its header comment.

**Interfaces:**
- Consumes: `notify` (Task 1).

- [ ] **Step 1: Failing tests:**
  - `"a recent file that is gone shows an error toast and leaves the list"`.
  - `"an unhandled rejection shows an error toast that stays until dismissed"`.
  - `"an aborted picker shows nothing"`.
- [ ] **Steps 2–5:** run → FAIL; implement; run → PASS, tsc, lint; commit `Feat: Tab-strip and uncaught errors as toasts`.

### Task 11: Docs, strings, changelog, final validation

**Files:**
- Modify: `docs-site/content/docs/workspace.mdx`, `docs-site/content/docs/(output)/export.mdx`, `docs-site/content/docs/(authoring)/inspector.mdx`, `docs-site/content/docs/(authoring)/masters-and-labels.mdx`. Every mention of the header note, the blocked pill, or "Note:" describes toasts and the red row instead.
- Modify: `CHANGELOG.md`, adding under `## [Unreleased]` → `### Changed`: **Messages are toasts.** It covers saves and export results at the bottom of the preview, Show in Finder after an export, a cancel showing nothing, and a blocked export explaining itself and pointing at the red layer.
- Modify: `src/locales/*.ts`, removing every key with no remaining `t()` use (all five languages): every "Note: …" key, "Export blocked: {{reason}}" if unused, and the old export strings.

- [ ] **Step 1:** grep check:
  ```bash
  rg -n '"Note: ' src
  rg -n 'HeaderAlert|useOwnedError' src tests
  ```
  Expected output: nothing.
- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint`, `npx knip@6.38.0`, `npx vitest run` (all green), `cargo check --manifest-path src-tauri/Cargo.toml`, and `npm run typecheck --prefix docs-site` if present. Then `node scripts/check-release.mjs origin/main` passes.
- [ ] **Step 3:** Desktop check in an isolated debug build, with its own identifier and executable name, as for #586:
  - Export saves a file → "Saved X" toast, centred over the preview. Show in Finder reveals the file.
  - Cancel → nothing.
  - An invalid barcode, then ⌘E → "Can't export yet". Show layer selects the row, which is red.
  - A long label name wraps in the toast (Review Focus 5).
  - Dark mode toasts are legible.
- [ ] **Step 4:** commit `Docs: Toast messages in the operator guide; changelog`, push, open a PR against `main`.
