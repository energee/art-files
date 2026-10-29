# Messages as toasts — design

- Date: 2026-10-29. Status: awaiting approval. Base: `main` at 0.1.113.
- Scope: Label Lab editor (browser and Tauri desktop). The CLI, the updater dialog and its status-bar button, and the render-crash `ErrorBoundary` screen are out of scope.

## Intent

Every note, success, warning and error the editor reports today is an amber/red/green pill (`HeaderAlert`, `src/App.tsx`) in the header above the tab strip, e.g. "Note: Export cancelled before saving label.pdf." The user doesn't like these messages or where they sit. Two problems:

1. Messages about **something that just happened** (a save, a half-finished export) push into the header, and some report non-events: a cancel the user chose themselves.
2. Messages about **something still wrong** (export blocked by an invalid barcode) duplicate what the layer list and inspector already show at the cause.

The new model: things that just happened become Sonner toasts at the bottom centre of the window; things still wrong stay at their cause. The header carries no messages.

## Decisions made by the user

| Decision | User's words |
|---|---|
| Use Sonner toasts | "maybe these can be in sonner displays?" |
| One-off events become toasts; anything still wrong stays visible until fixed | "yes" |
| Toasts sit at the **bottom centre**, over the preview, above the view switcher (mockup option B) | "bottom center" |
| Ongoing problems live **only at their cause**: no standing bar; an export attempt while blocked pops an error toast with **Show layer** (mockup option C) | "C" |
| The playback below, including the designer's calls | "looks good" |
| Keep the **Show in Finder** action, adding the opener plugin it needs | "keep "Show in Finder" button" |

Mockups: `.superpowers/brainstorm/26641-1793315312/content/` (`toast-placement.html`, `problem-placement.html`; local only, not committed).

## Goals

- The header shows no messages. Every message that reaches `HeaderAlert` today has a new home (table below).
- A plain cancel shows nothing.
- A toast offers the obvious next step where one exists (**Show in Finder**, **Export again**, **Show layer**, **Undo**).
- Shorter wording, action first, no "Note:" prefix. All five UI languages (en, es, fr, de, pt-BR; `src/locales/*.ts`) updated.
- Each message is announced to screen readers once; errors announced assertively.
- Toasts follow the app theme (`src/theme.ts`: system/light/dark).

## Non-goals

- No new kinds of message beyond the table; the updater keeps its dialog and status-bar button.
- No change to what blocks an export, or to validation itself.
- `ErrorBoundary`'s render-crash screen stays as it is.

## Anti-goals (fail even if it "works")

- A toast for a cancel.
- Toasts piling up for the same thing: each source owns one toast id and replaces it.
- An error toast disappearing while the problem is still true, or one source's success dismissing another source's error. The `useOwnedError` contract (#473, #511) must survive: a writer clears only the message it set.
- A background tab's ongoing problem showing while another tab is in front.
- A toast covering the view switcher or the bottom status bar.

## Message map (today → new home)

`exportNote`, `exportError`/`buildMessage`, `loadMessage`/`loadError`, `renderError`, `blocked`/`blockedWhy` and `resolveWarnings` all feed `HeaderAlert` today (`src/App.tsx` header, `src/useExport.ts`, `src/useOwnedError.ts`).

| # | Today | New | Kind | Stays |
|---|---|---|---|---|
| 1 | "Saved {files}." (export) | **Saved Lupula.pdf** · action **Show in Finder** (desktop, when the file has a path) | success | fades (Sonner default, ~4 s) |
| 2 | "Note: Export cancelled before saving {file}." (nothing saved) | **nothing** | — | — |
| 3 | "Note: Saved {files}. Export cancelled before saving {file}." | **Lupula-mask.pdf wasn't saved** · "Export again to save both files." · action **Export again** (re-runs the same export, asking) | warning | until dismissed |
| 4 | "Could not save {file}: {error}" / "Saved {files}. Could not save {file}: {error}" | **Couldn't save {file}** · {error}; when something saved first, the description starts "Saved {files}." | error | until dismissed |
| 5 | "Note: Saved {file}. {mask} beside it is from an older export; this PDF already includes the white ink, so don't send both." | **Saved {file}** · "Don't send the old {mask} with it — this PDF already has the white ink." · action **Show in Finder** (reveals the old mask) | warning | until dismissed |
| 6 | "Note: Saved {name} ({n} change)" (Save Master) | **Saved {name}** · "{n} changes" | success | fades |
| 6b | "· {n} image has no file to save. It will be blank when you reopen this master." | separate toast with the same text | warning | until dismissed |
| 7 | "Note: Switched to “{name}” · {notes} · ⌘Z to restore" (Open Master over hidden values) | **Switched to “{name}”** · {notes} · action **Undo** | info | ~8 s |
| 8 | "Note: {warnings}" from opening a master/label, "Restored from {path}, which moved…" | one toast per open, text without "Note:" | warning | until dismissed |
| 9 | `loadError` (open/read/save-master failures) | error toast, same text | error | until dismissed |
| 10 | owned asset errors (`textureError`, `maskError`, `imageError`, `assetError`) and `renderError` | error toast owned by its source: `set` shows/replaces it, `clear` dismisses only its own | error | until its owner clears it or the user dismisses it |
| 11 | native menu install/update errors (`onNativeError`) | error toast | error | until dismissed |
| 12 | `resolveWarnings` (label overrides an unknown layer, unknown variant, missing references) | warning toast when the set first appears or changes for that tab | warning | until dismissed |
| 13 | blocked pill ("Export blocked: {reason}", click selects the bad layer) | **no header pill.** The invalid layer's row in Layers is **tinted red with red text**, as in the approved mockup (today it carries only a 6px dot, `src/components/LayerList.tsx`), and its tooltip gives the reason; the inspector shows the reason once the layer is selected (exists today). Any export command while blocked shows **Can't export yet** · {reason} · action **Show layer**, which opens the Layers sidebar if collapsed and selects the layer (`selectInvalidLayer`). The invisible `data-export-blocked-status` announcement stays, so screen readers still hear when a label becomes blocked | error | until dismissed or export unblocks |
| 14 | `UncaughtErrors` alert pinned to the bottom of the window | error toast with the same title/text (it would otherwise collide with bottom-centre toasts) | error | until dismissed |
| 15 | anything else that reaches `HeaderAlert` through `setBuildError`/`setLoadError`/an owned error (e.g. the tab-strip open error, edit refusals, font-load failures) | same rule by kind: a one-off failure is an error toast until dismissed; an owned/ongoing one follows row 10 | error | as its row |

English wording above is the target; the builder may tighten it but keeps the action-first shape.

## The designer's calls (approved with the playback, still worth checking)

- **Save Label stays silent.** Correction to the playback, which said Save Label would toast like Save Master: Save Label shows no message today, and the window title's • clearing already confirms it. A toast on every ⌘S would be noise.
- **Export menu rows stay enabled while blocked** (still disabled while an export is running), so choosing one explains why via row 13 instead of being a greyed-out dead end. ⌘E/⇧⌘E already reach the app while blocked.
- **Ongoing toasts belong to their tab** (rows 10, 12, 13): shown only while that tab is active, hidden on switching away, raised again on return. Event toasts (rows 1–9, 11, 14) show whatever tab is in front, and name their file.
- **Show in Finder** (kept by the user) uses `@tauri-apps/plugin-opener` / `tauri-plugin-opener` (`revealItemInDir`) with the narrowest capability scope the plugin allows, a second new dependency after `sonner`. It is named per platform in all five languages: **Show in Finder** (macOS), **Show in File Explorer** (Windows), **Show in Folder** (Linux). The browser build shows no such action.
- Durations: success ~4 s, info with Undo ~8 s, warnings and errors until dismissed. Every persistent toast has a close button.

## Constraints

- Sonner is added as a dependency, with a shadcn-style `src/components/ui/sonner.tsx` wrapper fed by `useTheme()` from `src/theme.ts` (shadcn's stock wrapper uses `next-themes`, which this app doesn't have). One toaster for the window, **centred over the preview area** (as in the approved mockup), not over the whole window: its horizontal centre follows the Layers sidebar and inspector widths, and it sits just above the preview's bottom toolbar (zoom and view switcher) without covering it.
- Each tab is its own `App`/`DocumentEditor` instance; toast ids must be namespaced per tab.
- `useOwnedError` keeps its contract (a writer clears only its own message) but targets a toast id instead of a header slot.
- Release train: binary-impacting, so a `### Changed` bullet under `[Unreleased]` in `CHANGELOG.md`, no version bump.
- Lint is zero-warning; knip fails on unused exports (remove `HeaderAlert`, `HEADER_ALERT_TONE` and dead message keys from all five locale files).
- Operator docs (`docs-site/`) that describe header notes or the blocked pill are updated in the same change.

## Tests the change needs

Existing DOM tests assert header text and the `data-export-saved` / `data-blocked-export` / `data-export-blocked-status` hooks (about 15 files under `tests/`). They move to asserting toasts. New behavioural tests, at minimum:

- cancel on a one-file export shows no toast;
- a pair export cancelled at the second file shows the warning toast, and **Export again** re-runs the export;
- an export command while blocked shows **Can't export yet** with the reason, and **Show layer** opens a collapsed Layers sidebar and selects the invalid layer;
- an invalid layer's row renders in the red (tinted, red-text) state and its tooltip names the reason;
- an owned error is dismissed by its owner's `clear` and not by another source's success (#473/#511);
- an ongoing toast for a background tab is hidden while another tab is active and returns with its tab;
- success toasts auto-dismiss; warnings and errors persist.

## Left to the builder

- How editors reach the toaster (direct `toast()` calls vs a small per-tab helper), within the per-tab id and ownership constraints.
- Visual tuning of the Sonner theme to the app's tokens, exact offsets, icon set.
- Whether the invisible `role="status"` announcement spans stay or Sonner's live region replaces them, as long as each message is announced once and errors assertively.
- Test harness details (Sonner renders into the document; happy-dom is fine).
