# `.label` project file — design

2026-08-09 · branch `project-file`

## Purpose

One self-contained file that captures everything needed to reopen a beer label
for editing later: all text/style configuration plus the source images
(rock texture, metallic mask, collab art). Like presets, but per-beer.

## Format

A ZIP archive with suffix `.label` (same pattern as `.docx`/`.sketch`):

| Entry | Contents | Compression |
| --- | --- | --- |
| `config.json` | The existing `ConfigFile` (`src/types.ts`, `version: 1`) — all text, styles, UPC, collab config — plus the original filenames of each embedded image so a re-save round-trips them. | deflate |
| `texture.png` | Rock texture, original bytes untouched | store |
| `mask.png` | Metallic mask, original bytes untouched | store |
| `collab-left.png` / `collab-center.png` | Only when present | store |

Rationale for store-not-deflate on PNGs: PNG is already deflate-compressed
internally; re-compressing gains ~1-2% and wastes time. Storing raw bytes is
lossless by definition and avoids the +33% bloat of base64-in-JSON.

Library: **fflate** (small, tree-shakeable) for zip/unzip in the browser.

## Save

File menu → "Save Project…": build the ZIP in memory, trigger a download named
`<beerName>.label`.

## Load

Two paths, both ending in the same code:

- Drop a `.label` file onto the existing drop surface.
- File menu → "Open Project…" picker.

Unzip, then:

1. Parse `config.json` and apply it through the existing normalize path
   (unknown keys dropped, missing keys defaulted — same forgiveness presets
   already have).
2. Feed each embedded PNG through the same handlers a manual drop uses
   (`onTexture`, `onMask`, collab readers), so previews, mask polarity, and
   object-URL lifecycle behave identically to hand-dropped files.

## Errors & versioning

- A ZIP without `config.json` → rejected with a clear message.
- Missing image entries → that slot simply loads as "not yet dropped".
- `version: 1` carried in `config.json`; future migrations ride the same
  normalize function presets use today.

## Out of scope (YAGNI)

Downscaled preview images, reference-by-path variants, autosave, and any
migration machinery beyond the existing normalize.
