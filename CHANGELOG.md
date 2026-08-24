# Changelog

User-facing changes to the Label Lab desktop application are recorded here. Every
binary-impacting change gets its own version before it is merged.

## [0.1.10] - 2026-08-24

- Label Lab now runs on Windows and Linux: releases add a Windows installer
  (setup.exe) and a Linux AppImage built for Debian 13 "trixie" and newer,
  both with the same automatic updates as macOS. Double-clicking a .label
  project opens it in the app on every platform — including into an
  already-running window.

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
