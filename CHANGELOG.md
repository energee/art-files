# Changelog

User-facing changes to the Label Lab desktop application are recorded here. Every
binary-impacting change gets its own version before it is merged.

## [0.1.52] - 2026-09-05

- Show “Up-to-date” with a checked-box icon in the update status.

- Make layer reordering smoother by updating its indicator only when the drop
  position changes. Moving guides reuses loaded images, and preview drawing,
  hit testing, and selection outlines share measured layer positions.

## [0.1.51] - 2026-09-05

- Drag layer names to reorder them with a drop-position indicator; keyboard
  reordering remains available with Alt+Up/Down.

- Move the range/add selection hint below the layer list and remove the divider
  below the master selector. Use the standard shadcn Select for choosing masters,
  with Open Master and Duplicate actions below it.

## [0.1.50] - 2026-09-05

- Show “Up to date” in the lower status bar after a successful update check,
  including after closing the manual check dialog.

## [0.1.49] - 2026-09-05

- Bind a layer to the top, left, right, or bottom of another layer. Bound layers
  follow their neighbor's size with an adjustable gap, including chained bindings.
  Dragging adjusts the gap; switching sides, unbinding, and removing the neighbor
  preserve the freed position. Existing “Bind below” files remain compatible.

## [0.1.48] - 2026-09-05

- Added left/right margin-guide bindings alongside top/middle/bottom. Horizontal
  and vertical bindings work together, follow margin changes, and keep adjustable
  offsets when dragged. Detaching preserves the layer's position.

## [0.1.47] - 2026-09-04

- Added a middle guide anchor: keep a layer vertically centered between the
  top and bottom margin guides as its content grows, with an adjustable offset.

## [0.1.46] - 2026-09-04

- Anchor a layer's top or bottom edge to its margin guide from the inspector,
  with an adjustable offset. Bottom-anchored text grows upward; dragging adjusts
  the offset, and detaching preserves position.
- Margin changes now save with the master and move guide-anchored layers in
  preview and exports.

## [0.1.45] - 2026-09-04

- Turning on a dimmed variant layer now activates its variant instead of
  accidentally disabling the layer and triggering a binding error. The power
  button reflects whether the layer is actually enabled in the current variant;
  undo restores both the variant and layer together.

## [0.1.44] - 2026-09-04

- Available desktop updates appear in the lower status bar without interrupting
  work. Click the version to review release notes and install; choosing Later
  keeps the update available from the bar, across tabs.

## [0.1.43] - 2026-09-04

- Masters now contain editable layers; variants store changes to those layers.
  One Layers list with a Fillable filter replaces the separate editing modes,
  Fields and Document panels. Every text layer supports rich multiline editing.
- Position any unlocked layer, or bind it below another so it follows growing
  text. Variant edits stay with the variant, including position changes.
- Preview, PDF and PSD exports share layer placement. Existing master and label
  files convert on open; newly saved files use format version 3.

## [0.1.42] - 2026-09-04

- Presets are gone: the saved beer-style and barcode lists, the "Saved
  styles…" / "Saved barcodes…" pickers in the inspector, and File → View /
  Import / Export Presets. A master is the saved style, and a barcode is
  typed on its layer. Document Settings (corner radius, edge softness,
  resolution, bleed) and saved color swatches now live in the app's own
  per-machine storage; on the first launch after this update they start from
  the defaults once.
- The preview has three views instead of five: Label (1), Mask (2) and Can
  (3). The separate Rendered flat-label view is gone, and the four-pack is a
  1 / 4 count switch in the Can view's toolbar rather than a view of its own.
- View has two toggles instead of seven: Rulers (R) and Guides (G). Guides
  shows the trim line, the margin and center guides and the manual guides
  together; the separate Bleed Lines, Margin / Center / Manual Guides and
  Clear Manual Guides items are gone. A manual guide is removed with the ×
  that appears in the ruler when you hover it (dragging it back onto the
  ruler and Delete still work).

## [0.1.41] - 2026-08-29

- Internal cleanup of the new master-container and PSD collab code (shared
  packing helpers, one raster-drawing rule, parallel export decodes). No
  visible behavior change; picking a library master no longer reads its file
  twice.

## [0.1.40] - 2026-08-29

- A saved `.master` now carries its template art: the texture, the metallic
  mask, and any master-owned image layers' files travel inside the master, so
  a new label from a master needs nothing re-dropped. Labels keep their own
  embedded art when they have it (a label's art always wins), and `.master`
  files saved by earlier versions still open unchanged.

## [0.1.39] - 2026-08-29

- PSD exports now include the Collab partner art: a "Collab" layer group with
  the lead-in text and both partner logos, on the art plate and (as a
  white-ink footprint) on the mask plate. Previously the exported PSD of a
  Collab label silently omitted the partner logos entirely.

## [0.1.38] - 2026-08-28

- Fill mode no longer shows variant checkboxes. Labels that already have a
  variant enabled keep its fields, artwork, and saved values unchanged.

## [0.1.37] - 2026-08-27

- Design mode now edits the master — the shared core every label inherits —
  instead of the label in front of you. Restyle the name, move the QR, lock
  the logo, switch a layer off: it applies to every label made from that
  master from now on. For a one-off, pick or create a variant from the new
  "Editing" selector in the Design sidebar and the change is recorded there
  instead, ready to enable whenever you need it; properties a variant changes
  are badged, and each can be reset back to the master. Masters save and open
  as `.master` files and register themselves in the library, so a label can
  find its master again — or be re-aimed at another one, with anything that
  does not carry over kept on a bench rather than dropped. Any layer with
  editable content can be made fillable from the inspector, and a layer added
  in Design mode now belongs to the master rather than to the one label in
  front of you.
- Collab is no longer a special case. It is an ordinary variant carrying the
  two partner logos, which you fill from the field list like anything else and
  switch on and off from the same checkbox every variant gets. The lead-in
  line above them stays fixed template art. Labels saved with the old collab
  switch open with the variant already on and look exactly as they did.
- Fixed: a layer added in Design mode could not really be edited. Dragging,
  restyling, renaming, locking or deleting one appeared to work and then
  silently reverted, and deleting was impossible — the layer came straight
  back. Reorder arrows could also be shown for moves that did nothing.
- Fixed: edits to the built-in Lolev master were lost when a label was
  reopened, even after saving the master to a `.master` file. A saved master
  on disk now wins over the built-in one, as it always should have.
- Fixed: editing a beer name, ABV or other fillable text directly on the
  canvas in Design mode reverted, and wrote that one label's text into the
  master, where every other label would have inherited it.
- Fixed: a duplicated master could not be saved, and a label pointing at one
  could not be reopened afterwards.
- Fixed: opening a `.master` whose variant added an unrecognised layer crashed
  the whole sidebar.
- Fixed: custom barcodes printed wrong. The human-readable digits overprinted
  the bottom of the bars instead of sitting in the space reserved below them,
  the white-ink plate extended twice as far past the ink as intended, and a
  UPC-A or EAN-13's outer digits were not counted in its width — so a
  right-aligned one could push its check digit off the trim edge. Custom
  barcode layers on existing labels shift as a result; Code 128 is unaffected.
- Fixed: a custom image layer whose artwork had not loaded still stamped a
  solid white-ink rectangle into the exported PSD, under artwork that never
  printed.
- Fixed: replacing a field image left the old one behind, growing every
  `.label` saved afterwards; and dropping a damaged image failed silently
  instead of reporting the error.
- The layers panel now lists front to back — the layer you'd click on top
  sits at the top of the list — instead of back to front. The up arrow on a
  custom layer now moves its row up the list as well as forward, and the
  down arrow moves it down as well as back, so the arrows finally point the
  way the rows move.
- A custom layer's name can now be renamed right in the layers panel —
  double-click it, same as a built-in layer — instead of only from the Name
  field in the inspector.

## [0.1.36] - 2026-08-27

- The layers panel now lists the label's real layers in drawing order, in one
  flat list, instead of the fixed Beer / Collab / Template groups. Each layer
  is declared by the master, so a layer can be renamed, switched off, or
  locked there rather than being hardwired into the app — the wordmark is now
  "Brand", and the government warning ships locked. The collab block is no
  longer a special section with its own switch: its three layers belong to the
  Collab variant and appear when it is enabled, marked with a Collab badge
  while it is off. Custom layers can be moved forward and backward in the
  stack.

## [0.1.35] - 2026-08-27

- "Variation" is now called **Variant** throughout — the Collab checkbox, the
  data model, and the `.label` file format, which stores the enabled variants
  under a renamed key. A `.label` saved before this release still opens, but
  its enabled variants are forgotten and need re-checking once. No other
  behavior changed.

## [0.1.34] - 2026-08-27

- The layers panel's empty Custom group now reads just "No custom layers".

## [0.1.33] - 2026-08-27

- The Design/Fill control moved from the top menubar row to the right end of
  the preview toolbar at the bottom of the window, beside the view readouts.
  No behavior change — same two buttons, same keyboard/palette commands.

## [0.1.32] - 2026-08-27

- Design mode can now add layers: text, image, barcode (UPC-A, EAN-13,
  Code 128, with human-readable digits and a show/hide knob), and QR
  (square/rounded/dots; error correction defaults to M, with a warning when
  a Code 128 module is set too narrow to scan). Barcode and QR payloads can
  be built from label fields with a chip-based format editor and live
  preview. Custom image layers now actually render — their bytes travel
  inside the `.label` file — and the PSD exports carry every custom layer
  plus the square/rounded QR styles they previously dropped. Custom text
  layers support bold and letter-spacing; image hit areas now match portrait
  artwork exactly.

## [0.1.31] - 2026-08-27

- Labels now run on a master + variations + values model. A new Design/Fill
  control (Fill is the default) shows fillers just the label, a field list,
  and variation checkboxes — the collab switch is now the shipped Collab
  variation. Files save in a slimmer v2 `.label` format recording the master,
  enabled variations, and values; existing `.label` files still open exactly
  as before, and re-saving upgrades them. The app keeps a library index of
  where `.master` files live; the Lolev master ships built in.

## [0.1.30] - 2026-08-27

- Custom text and image layers: a label file can now carry extra layers that
  draw in the 2D preview and both print PDFs, positioned by left/center/right
  and top/bottom anchors so alignment survives content changes. Drag them
  anywhere on the label; dragging near a safe-area guide snaps to it (and
  the highlight shows which guide engaged). A new Lock toggle on movable
  elements — including the laurel and collab logos — makes them inert to
  dragging. There is no UI to add custom layers yet, so existing labels are
  unaffected; custom image layers position but do not paint until image
  assets are wired up in a later release.

## [0.1.29] - 2026-08-27

- More groundwork for masters and variations: EAN-13 and Code 128 barcode
  encoders (verified against the published symbol tables), a barcode
  geometry that can draw any symbology, QR style options (square, rounded,
  or the current dots look) with a selectable error-correction level, and
  validation for the new code types. Nothing in the app calls any of it
  yet — no visible or behavioral change in this release.

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
