# Phone layout — design

- Date: 2026-11-12. Status: approved 2026-11-12.
- Scope: the Label Lab editor's web build, on phones and other touch screens. The Tauri desktop app is unaffected (its window has `minWidth` 1024).

## Intent

Label Lab is unusable on a phone today. Measured at 390×844 with touch emulation: the Layers sidebar keeps 256px, the label preview renders at 111×69px, the menu bar is cut off after "Layer", every control is under 40px, and the inspector covers the preview (PR #382).

The user wants the **full editor** on a phone, opened in the phone's browser. Everyday use is making labels, so on a small screen the preview and the fields someone fills in come first.

## Decisions made by the user

| Decision | User's words or choice |
|---|---|
| Full editor on a phone, including move, resize and style by touch | Decided before this session; a "fill and export only" version was turned down |
| A hosted web app, not a Tauri mobile app | Decided before this session |
| **Same interface at both sizes.** Three new phone layouts (bottom sheet, bottom tabs, canvas first) were rejected | "It seems like we are reinventing the interface, can we build something that is similar between displays but takes advantage of if desktop display?" Then picked "Yes, same interface" from the second mockup |
| Hosting: GitHub Pages, public, at `energ.ee/art-files/app/` | "GitHub Pages, public" |
| Tablets: phone layout below 768px, desktop layout above | Picked |
| Base branch: phase 1 off `main`; later phases after PR #773 lands | Picked |
| One PR per phase, a checkpoint after each | Stated in the request |

Mockups (local only, not committed): `.superpowers/brainstorm/4250-1794529389/content/same-interface.html` (chosen), `phone-layout.html` (rejected options).

## The layout

One interface. The phone keeps the desktop's four parts — Layers panel, preview, preview toolbar, inspector — and the same buttons open them. Only placement changes.

```
Desktop (unchanged)                    Phone, layer selected
┌────────┬────────────────┬────────┐   ┌──────────────────┐
│ Layers │ ▤ File Edit …  │ Inspec-│   │ ▤ ☰        ↶ ↷  │  header
│        ├────────────────┤ tor    │   ├──────────────────┤
│        │    preview     │        │   │     preview      │
│        ├────────────────┤        │   ├──────────────────┤
│        │ 100% Label Mask│        │   │ 100% Label Mask… │  toolbar
└────────┴────────────────┴────────┘   ├──────────────────┤
                                       │ inspector        │  from the bottom
                                       └──────────────────┘
```

What differs on the phone, and nothing else:

1. **Layers** slides over the preview from the left, with a dimmed backdrop, instead of sitting beside it. Same ▤ button. It starts closed. Tapping a layer selects it and closes the panel; tapping the backdrop closes it.
2. **The inspector** rises from the bottom instead of the right. The preview re-centres in the space above it, the way it re-centres beside it today. It opens on selection and closes on its ✕ or on deselecting, as today.
3. **The menus** (File, Edit, Layer, View, Help) fold into one ☰ button holding the same menus as submenus.
4. **Undo and redo** get header buttons, because a phone has no ⌘Z.
5. **Controls grow to finger size** (44px minimum) on touch screens only.

## Goals

At 390×844 with touch emulation, and on a real phone, someone can: open a master, select a layer, edit its text, move and resize it, change its style, multi-select, reorder, undo, save and export. Throughout:

- The preview stays visible while the inspector is open.
- Nothing scrolls sideways at page level.
- Tap targets are at least 44px.
- The desktop layout at 1024px and wider, with a mouse, is unchanged (pixel-compare before and after).

## Non-goals

- A Tauri iOS/Android app. Offline install (PWA). A separate tablet layout.
- Any change to what the desktop looks like or how it behaves with a mouse.
- New features. Every phone path reaches something the desktop already does.

## Anti-goals

- A second interface that drifts from the desktop. No phone-only copies of the Layers list, inspector, menu or toolbar: one component each, placed by size.
- Helper text or hints explaining touch gestures. Fix the layout instead.
- CSS adjusted by eye. Each layout change records measured before and after values.

## Constraints found in the code

Verified this session on `feat/quiet-layers` (now merged into #773's branch) unless noted.

- **Shell** (`src/App.tsx` ~2419–2744): `SidebarProvider` + `Sidebar` (256px, resizable; when open a spacer holds its width in the layout, when collapsed it slides off-canvas; `src/components/ui/sidebar.tsx` has no mobile mode, and `sidebarOpen` starts `true` at `App.tsx:424`, so an overlay is new sidebar behaviour, not only placement), a header with `SidebarTrigger` and `AppMenu`, the preview pane, a toolbar (`h-8`, 26px at the 13px root), and a non-modal `Sheet side="right"` 300px wide. The pane makes room with `mr-[300px]`. `ui/sheet.tsx` already supports `side="bottom"`.
- **No size handling anywhere**: no `matchMedia`, no `useIsMobile`. Root font size is 13px (`src/index.css:272`), so every rem-based size is scaled by it. The shell already sizes itself with `h-svh` (`src/TabsShell.tsx:733`, `sidebar.tsx`).
- **Zoom and pan** (`src/useZoomPan.ts`): wheel to zoom, right-button drag to pan. Nothing for fingers.
- **Canvas gestures** already use pointer events (move, resize, reorder, rulers, 3D view).
- **Right-click menus**: Base UI's `ContextMenuTrigger` opens on long-press (its source handles touch with a long-press timer). Layer rows also set `touch-none` and capture the pointer for drag-reorder, so long-press and drag must be checked together on a real touch screen.
- **Hover-only controls**: the per-field reset arrow (`LayerInspectorControls.tsx:202`), the close button on inactive tabs (`src/TabsShell.tsx:695–707`; the active tab's × already shows on touch, and inactive tabs hide it on purpose so a tap switches tabs: leave that as is), a ruler control (`Rulers.tsx:428`), the dimmed metallic toggle (`MetallicToggle.tsx:54`).
- **Double-click**: rename (`LayerList.tsx:244`), in-place text edit (`PreviewCompare.tsx:443`).
- **Mouse-only events**: `TextEditor.tsx:498, 678, 686` (`onMouseDown`), `MasterPicker.tsx:317` (`onMouseUp`).
- **Files**: open and save go through `filePickers.ts`/`files.ts`, which fall back to an `<input type="file">` and a download (`assets/io.ts` `saveBytes`) where the File System Access API is missing, as on iOS Safari.
- **Tauri-only paths** are guarded (`isTauri` in `masters.ts`, `files.ts`, `reveal.ts`, `titlebar.ts`, `TabsShell.tsx`, `AppMenu.tsx`, `DesktopUpdater.tsx`); the app already runs in a browser under `npm run dev`.
- **Hosting today**: GitHub Pages at `energ.ee/art-files/` serves only the update feed (`latest.json` and updater archives). It is deployed by `release.yml`'s `publish-update-feed` job and by `update-feed.yml`; each deploy replaces the whole site. The docs are not on Pages (`/art-files/` and `/art-files/docs/` return 404), and `docs.yml` only builds on pull requests. `vite.config.ts` sets no `base`. Both Pages jobs sparse-checkout two files and build nothing. The repo is public; the comment at `release.yml:215–220` calling it private and the site URL unguessable is stale, so a public app at this origin exposes nothing new.

## Approaches

How the phone layout is built. The user handed over the how; these are the designer's calls.

1. **One component tree, placed by size (chosen).** A single `usePhoneLayout()` hook over `matchMedia`, read by the shell. The same `LayerList`, `LayerInspector`, `AppMenu` and toolbar render in both sizes; the hook only changes where the sidebar and sheet sit and how the menu is wrapped. Smallest diff, and the two sizes cannot drift. Cost: `App.tsx` gains a few size branches.
2. **A separate phone shell component.** A `PhoneApp` that composes the same leaf components differently. Cleaner file, but it duplicates the shell's wiring (selection, sheet close rules, focus handling), which is exactly where the subtle behaviour lives. Rejected: it is the second interface the user asked not to build.
3. **CSS only.** Breakpoint classes with no JavaScript. Rejected as the whole answer because three things need state: the sheet's `side` prop, Layers starting closed, and closing Layers on select. CSS is still used wherever it is enough (sizes, touch targets, hover reveals).

## Design by phase

One PR per phase, each ending at a checkpoint with measurements and scope remaining. Phase 1 branches from `main`. Phases 2–5 branch from `main` after #773 lands (stack on `feat/multi-layer-edit` only if the user says not to wait).

### Phase 1 — Publish the web build

- `vite build --base=/art-files/app/` output goes into the Pages site directory as `app/`, next to the update feed, in **both** `release.yml`'s `publish-update-feed` job and `update-feed.yml` (they must stay in lockstep; each deploy replaces the whole site, so both must include the app or a feed republish would delete it).
- **Designer's call: the update feed outranks the web app.** The app is built in a separate job (the same `npm run build` CI already runs on every PR) and handed to the feed job as an artifact. If that build fails, the feed still publishes, without `app/`, and the workflow run shows as failed. A broken web build must never hold back installed apps' updates.
- The app is built from the release tag (in `update-feed.yml`, from the tag being republished, not the dispatched ref), so the web app is always the same version as the desktop release. **Designer's call:** the web app updates when a release is cut, not on every merge. Publishing on every merge would have to rebuild the update feed each time, which puts installed apps' updates at risk for no gain.
- Asset paths, workers and lazy chunks must load under the `/art-files/app/` base. Check the Starter master, fonts, both workers and the 3D view from a local `vite preview` at that base before any deploy. `index.html:7–8` points its icons at `./src-tauri/icons/…`, which a `dist/` build lacks; fix that here. Correct the stale `release.yml` comment in the same PR.
- **First publication is outward-facing.** It happens at the next release, or by dispatching `update-feed.yml`. Either needs the user's explicit go-ahead at that time; approval of this design is not that go-ahead.
- Until then, real-phone checks use `npm run dev -- --host` over Wi-Fi.

### Phase 2 — The phone shell

- `usePhoneLayout()`: true when the viewport is under 768px wide **or under 500px tall** (designer's call: a phone held sideways is 844px wide and would otherwise get the full desktop layout in 390px of height).
- **Designer's call for a phone held sideways:** Layers overlays as on any phone, but the inspector stays on the right as on desktop, because a bottom inspector would leave no preview in 390px of height. The inspector goes to the bottom only when the viewport is under 768px wide.
- Layers: on phone the sidebar takes no layout width, overlays the preview with a backdrop, starts closed, is not resizable, and closes when a layer is tapped.
- Inspector: `side="bottom"`, about 45% of the viewport height, scrolling inside; the pane reserves bottom margin instead of right margin. The preview must remain at least 150px tall with the inspector open. When the on-screen keyboard is up, the field being edited stays visible.
- Header: ▤, ☰ (the existing menu commands, grouped as today), undo, redo. The workspace tab strip stays under it; if tabs overflow, the strip itself scrolls, never the page.
- Toolbar: same controls at 44px; the Lighting and Curve sliders wrap to a second row rather than scroll.
- The root font size stays 13px at every size (designer's call: raising it on touch would resize the desktop layout on touch laptops). Touch sizes are given in px.
- Touch sizing: a `touch:` Tailwind variant on `@media (pointer: coarse)`, like the existing `titlebar:` variant, raising controls to 44px. It applies on tablets and touch laptops too, in the desktop layout. Text inputs are at least 16px on touch so iOS Safari does not zoom the page on focus.
- Heights stay on `svh`, which the shell already uses and which keeps the bottom clear of Safari's toolbars. No change to shared height code.

### Phase 3 — Touch gestures on the canvas

- One finger on a layer selects, then drags it (existing pointer path). One finger on empty pasteboard pans. Two fingers pinch-zoom about their midpoint and pan. The pane sets `touch-action: none` so the browser does not scroll or zoom the page instead.
- Resize handles get a 44px hit area without growing visually.
- Double-tap a text layer to edit in place. If the browser does not deliver `dblclick` reliably on touch, detect two taps on the same layer within 300ms.
- 3D can view: confirm orbit, zoom and pan by touch (three.js `OrbitControls` supports them) and that it renders on a real phone; fix only what fails.

### Phase 4 — Touch paths for hover, right-click, double-click and keyboard actions

- Hover-only controls are always visible where there is no hover (`@media (hover: none)`), except the inactive tabs' close button.
- Layer row menu: long-press. If long-press fights drag-reorder on a real touch screen, rows get a ⋯ button on touch instead.
- Rename: a Rename item in the row menu.
- Multi-select: a Select item in the row menu turns on selection mode, where tapping rows toggles them; it ends when the selection is cleared. **Designer's call, to be confirmed with a mockup at this phase's start**, since it is the one place the phone needs a control the desktop does not have.
- Delete: the inspector header's Remove (exists). Reorder: drag (exists) and Bring Forward / Send Backward in the row menu. Nudge: the inspector's X and Y fields. ⌘B: the ▤ button.
- `onMouseDown` handlers in `TextEditor.tsx` become `onPointerDown` so suggestions commit on tap without losing focus.

### Phase 5 — Open, save and export on a phone

- Confirm on iOS Safari and Android Chrome: open a `.master` and a `.label`, Save Label, Save Master, export PDF and PSD, all through the input/download fallback. Custom extensions in `accept` can grey files out in the iOS picker; if so, drop `accept` on touch and validate after picking (the loaders already reject bad files).
- Every drag-and-drop target (texture, mask, images) must also open a file picker on tap. Add that where it is missing.
- Fix only what fails. No share-sheet integration unless a download cannot be made to work.

## Testing

- Logic is test-first in vitest: `usePhoneLayout`, the shell's phone branches (sheet side, Layers closes on select), pinch math in `useZoomPan`, selection mode.
- Layout is measured, not eyeballed: at 390×844 touch emulation record preview size, smallest tap target, and page scroll width before and after each change; at 1280×800 with a mouse, screenshots before and after must match. Results go in `.agents/ledger.md` with the branch tested.
- Each phase ends with the done list above run on a real phone, by the user, at the checkpoint.

## Left to the builder

Component and file names, exact sheet height and animation, the ☰ menu's markup, how pinch state is tracked, and the order of work inside a phase. Docs-site pages and `CHANGELOG.md` `[Unreleased]` bullets follow the repo's usual rules per PR.
