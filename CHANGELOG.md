# Changelog

User-facing changes to the Label Lab desktop application are recorded here. Every
binary-impacting change gets its own version before it is merged.

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
