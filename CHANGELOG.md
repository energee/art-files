# Changelog

User-facing changes to the Label Lab desktop application are recorded here. Every
binary-impacting change gets its own version before it is merged.

## [0.1.28] - 2026-08-27

- Groundwork for masters and variations: a new internal data model that can
  describe a label template (master), stackable named overrides (variations),
  fillable fields with validation, derived text like QR URLs, and a slimmer
  `.label` format that can be re-aimed at a different master. Nothing in the
  app uses it yet — no visible or behavioral change in this release.

## [0.1.27] - 2026-08-26

- Wide keylines no longer eat small glyph features in the preview. A period,
  the dot on an i, and the counters of characters like % and 8 were showing
  white bites out of their outline — the on-screen renderer's stroke leaves
  unpainted cavities where a wide outline folds over itself, which the
  exported PDFs already worked around. The preview and the 3D views now use
  the same remedy, so what is on screen matches the printed plate. The PDFs
  and the PSD were never affected.
- Editing the ABV on the preview no longer leaves a gap between the number
  being typed and "% alc by vol": the field is measured with the same metrics
  the artwork is drawn with instead of guessing a digit's width, so the unit
  sits where the finished render puts it.

## [0.1.26] - 2026-08-26

- No behaviour changes. This release only adds automated coverage for the
  description editor's on-screen formatting — the part that turns bold and
  white-ink markers into styled text and back again — so the two ways it once
  lost those markers while typing cannot come back unnoticed.

## [0.1.25] - 2026-08-26

- Backgrounds now accept WebP alongside PNG and JPEG, by drop or file picker.
  A WebP is decoded and kept as PNG in the project and both PDFs, since the
  PDF embed handles PNG and JPEG only. The mask is still PNG-only, so a WebP
  dropped on the mask half of the chooser lands on the background.

## [0.1.24] - 2026-08-26

- Opening several .label files at once from Finder no longer drops all but
  the last one — each file gets its own tab.
- Hiding a collaboration logo no longer removed the "A collaborative project
  with" lead-in from the exported PDF while the preview kept showing it. The
  lead-in now follows its own eye in both.
- The 2D preview rasterizes at the density it is actually displayed at
  instead of oversampling past it, and releases that density when you zoom
  back out — noticeably less work per keystroke.
- "Open With" on a non-.label file is now ignored instead of surfacing an
  open error, and a .LABEL file opens like a .label one.
- Fresh installs get their seed preset library back (styles and Tier
  barcodes) — an accidental dev-server writeback had emptied it.
- A failed file open no longer permanently blocks re-opening that file, and
  a project saved under a new name no longer intercepts opens of its
  original file.
- An upload or export failure now stays in the error strip until it is
  actually resolved, instead of vanishing on the next keystroke; failures
  while a 3D view is rebuilding its textures now reach the strip too.
- The preview no longer renders distorted after changing bleed at maximum
  zoom, and tracked text renders correctly on macOS WebViews older than
  Safari 17.4.
- Internal: launching by file no longer crashes on non-Unicode command-line
  arguments; the font family parameter is now required through the canvas
  backend; the collab slot envelopes have one shared spelling between
  placement and hit-testing.

## [0.1.23] - 2026-08-26

- Double-clicking the description on the 2D preview now edits it in place
  over the artwork with a compact floating toolbar, instead of opening a
  panel that duplicated the field.

## [0.1.22] - 2026-08-25

- Internal: font pipeline is config-driven internally; typeface choices
  arrive with font sourcing.

## [0.1.21] - 2026-08-25

- Drag the laurel and collab logos vertically on the 2D preview; one undo
  step per drag.

## [0.1.20] - 2026-08-25

- Internal: the PSD builder now places layers from the shared display list
  instead of computing its own layout; exported PSDs are byte-identical.

## [0.1.19] - 2026-08-25

- The preview now renders directly on canvas from the shared display list —
  2D updates land per keystroke with no debounce, in-place editing hides the
  edited element instantly, and the 3D views texture from the same plates.
  PDFs and PSDs are built only on export; exported files are unchanged.

## [0.1.18] - 2026-08-25

- Internal: the shared display list now covers the whole label (laurel, QR,
  collab logos, barcode), and a new canvas renderer draws both plates from
  it — groundwork for the direct-canvas preview, behind a dev-only flag.
  Exports are unchanged; a parity harness (npm run parity) checks the two
  renderers against each other.

## [0.1.17] - 2026-08-25

- Internal: text placement is now computed once (a shared display list)
  and consumed by both the PDF renderer and click-target hit-testing,
  groundwork for the direct-canvas preview. No visual or output changes
  intended.

## [0.1.16] - 2026-08-25

- Double-clicking any editable text on the 2D preview — beer name, style,
  ABV, description, volume, info line, or store cold — now edits it in
  place: the label re-renders live as you type, in the element's true style.
  The description opens the same WYSIWYG field as the sidebar over its block
  (buttons on top of the field; markdown only behind its "Edit as Markdown"
  toggle), and the rotated info / store-cold lines edit in a small field at
  the element. Enter or clicking away ends the edit (one undo step for the
  whole session), Escape restores the old text. The ABV editor accepts only
  the number — its "% alc by vol" tail stays fixed.

## [0.1.15] - 2026-08-25

- Fixed hidden tabs reverting the shared DPI and bleed settings during
  background re-renders, which could skew rulers, size readouts, and exports
  until the active tab refreshed.
- Typing the beer name no longer re-renders the whole editor twice per
  keystroke to retitle the tab.
- Double-clicking a .label file twice in quick succession now focuses the tab
  already opening it instead of opening the same file in two tabs.
- Closing the window right after changing Document Settings no longer loses
  that change — the pending save completes before the window closes.

## [0.1.14] - 2026-08-25

- Fixed the preview losing its image with "Preview asset bytes were not sent
  to the worker" when switching back to a tab while several tabs are open.
- Tab and window titles now always show the beer name as typed ("Untitled"
  while blank), instead of switching to the saved file's name after Save.

## [0.1.13] - 2026-08-25

- Update dialog polish: release notes render with styled headings and bullets
  instead of raw markdown text, the release date sits next to the version in
  the header, the download shows a themed progress bar with "X MB of Y MB",
  and a manual update check shows a spinner while it looks for a release.
- Switches match the current shadcn look — larger track and thumb — and turn
  royal blue when on instead of purple.
- The document Settings layer now uses a gear icon.
- Presets persist in the browser: a build with neither the desktop backend nor
  the dev server now saves the library to localStorage instead of losing it.
  Desktop and dev storage are unchanged.

## [0.1.12] - 2026-08-24

- No user-visible changes: hardening around workspace tabs. The rules for
  where an opened file lands, tab titles for unusual paths, and the OS
  file-open queue are now pinned by unit tests (including the app's first
  Rust tests), with small internal refactors to make them testable.

## [0.1.11] - 2026-08-24

- Workspace tabs: several .label projects can be open at once in one window,
  each in its own tab with its own undo history, unsaved-changes state, and
  save target. ⌘N opens a new tab and ⌘W closes one; closing a tab (or the
  window) with unsaved work asks Save / Discard / Cancel per tab.
  Double-clicking a .label file now opens it in a new tab — or focuses the
  tab that already has it — instead of replacing the current document.
  Works in the browser build too. Several files opened at once (or in quick
  succession) each get their tab — none are dropped — and uppercase .LABEL
  extensions open correctly on Windows and Linux.

## [0.1.10] - 2026-08-24

- Label Lab now runs on Windows and Linux: releases add a Windows installer
  (setup.exe) and a Linux AppImage built for Debian 13 "trixie" and newer,
  both with the same automatic updates as macOS. Double-clicking a .label
  project opens it in the app on every platform — including into an
  already-running window.

## [0.1.9] - 2026-08-24

- Wide text outlines in Label Lab previews now close cleanly around punctuation
  and other tiny glyphs, matching Photoshop at the dynamically selected stroke
  width instead of leaving white cavities. Print geometry is unchanged.

## [0.1.8] - 2026-08-24

- Zoomed 2D previews now redraw from the PDF at the current zoom and display
  density, keeping small punctuation and fine stroke details crisp instead of
  stretching a low-resolution bitmap. Preview memory remains capped at a
  600-DPI-equivalent canvas.

## [0.1.7] - 2026-08-24

- Text outlines now render as true strokes instead of stacked offset copies,
  fixing white gaps inside the outline around small glyph features — dots on
  i and ü, the counters of % — and the subtly scalloped outline edge. Applies
  to every stroked text element and the barcode digits' halo; barcodes still
  scan (verified by decoding the rendered pixels).

## [0.1.6] - 2026-08-19

- Default save and export filenames are now machine-friendly slugs of the
  beer name — lowercased with spaces and punctuation turned to dashes, the
  same rule the QR code URL uses ("Peregrine Falcon" saves as
  peregrine-falcon.label / .pdf / .psd).
- Internal cleanup of the menu wiring and the project-open pipeline following
  review; opening a project behaves exactly as before, including the quiet
  retries for files that fail their first read.

## [0.1.5] - 2026-08-18

- Restored Cut, Copy, Paste, and Select All in the desktop app, including the
  standard keyboard shortcuts while editing any text field.

## [0.1.4] - 2026-08-11

- Registered the .label file type with macOS: double-clicking a project in
  Finder (or Open With / dropping it on the Dock icon) now opens it in Label
  Lab, including while the app is already running, and Save rewrites the
  opened file.
- Made the stack nudge apply only while Collab is enabled: turning Collab off
  returns the laurel to its default position, while the saved nudge value is
  kept for the next collab release.

## [0.1.3] - 2026-08-11

- Fixed Save Project As and file exports in the desktop app so they open the
  native Save dialog instead of behaving like browser downloads.
- Made Save Project reuse the file chosen by Save As for later edits.

## [0.1.2] - 2026-08-11

- Matched barcode white-ink stroke corners to the rounded artwork and PSD
  strokes, removing small mask overhangs at bar and digit corners.

## [0.1.1] - 2026-08-11

- Added New Project with an unsaved-changes confirmation, a standard keyboard
  shortcut, and a clean document/history reset.
- Restored full-window and inspector-field image drops in the packaged desktop
  app.
- Added independent white/metallic layer assignments for outer strokes,
  defaulting every stroke to white/non-metallic with matching PDF and PSD mask
  output.
- Changed mask handling: uploaded masks are embedded in the mask PDF exactly
  as authored (no more recoloring or palette validation), the 3D preview now
  detects foil by brightness so any ink color works, and the default foil
  edge softness is now 0.

## [0.1.0] - 2026-08-11

- Added the first Label Lab desktop release for Apple Silicon and Intel Macs.
- Added signed in-app updates backed by a public update feed while keeping source
  code and installer releases private.
