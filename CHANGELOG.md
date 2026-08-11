# Changelog

User-facing changes to the Label Lab desktop application are recorded here. Every
binary-impacting change gets its own version before it is merged.

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
