# Font import and system fonts

Status: plan, awaiting approval. Branch `feat/font-import`, worktree
`.agents/worktrees/font-import`.

## Why

A text layer reading "RỒNG" in Poppins Bold cannot export: the bundled
Poppins 4.004 has no Vietnamese stacked accents (Ồ, Ơ, Ư, Ế…), while
SVN-Poppins, the community Vietnamese build of the same design, has them all.
The user wants any font to be usable, the system's included, without the label
breaking on another machine.

## Shape

1. **Import a font into the file.** In a text layer's Font menu, **Import
   Font…** takes one to three `.ttf`/`.otf` files of one family. Label Lab
   stores their bytes in the `.master` or `.label` under `fonts/<id>/<file>`.
   The label then previews and exports the same on desktop, web and phone, and
   on any other machine.
2. **System fonts (desktop only).** The same menu lists installed fonts. Picking
   one **imports it into the file**, exactly like step 1, so it still travels.
   The browser and phone builds show no system list.

This keeps the August 2026 ruling: the label never depends on what a machine
has installed. A system font is only a source to import from.

## Decisions taken by default (say if any is wrong)

- **Family id** is content-addressed: `imported:<first 12 hex of SHA-256 of
  the sorted face bytes>`. The same font imported in two tabs or two files gets
  one id, so tabs share a loaded face and a master and its labels agree.
- **Faces.** Labels use three faces: regular (400), semibold (600) and bold
  (700). Each imported file is placed by its OS/2 weight to the nearest face;
  a face with no file uses the nearest file given. Importing only
  SVN-Poppins-Bold makes all three faces that Bold.
- **Embedding licence.** A font whose OS/2 `fsType` forbids embedding
  (restricted, bit 1) or is bitmap-only (bit 9) is refused with a message.
- **Collections.** `.ttc`/`.otc` files (many macOS system fonts) are left out
  of the system list for now: pdf-lib embeds a single font, and pulling one out
  of a collection is its own job.
- **Format version stays 3.** An older Label Lab opening a file with an
  imported font already refuses it with "Unknown label font family: …".
- **Removing a font.** An imported font is dropped from the file when no layer
  uses it at save time. There is no font manager.
- **Where it is stored.** A font a master layer uses goes in the `.master`. A
  `.label` carries every font it draws with, its master's included, as it
  already carries the master's images, so it opens against a copy of the master
  that lacks the font. (Changed during task 9 from "label-only fonts".)
- **Integrity.** A font's id is its content hash, and every font from a file is
  re-hashed before it is registered; a mismatch refuses the open, so a crafted
  file cannot replace another tab's font.
- **PSD.** Type layers name the imported font's PostScript name; Photoshop
  shows the text live when that font is installed, as it does for Poppins today.
- **The Illustrator export draft (#769)** reads `FONT_FAMILIES` directly and
  will need the same family lookup when it lands; noted on #769, not changed here.

## Types

```ts
// src/fontCatalog.ts
type BundledFontId = "poppins" | "barlow-condensed";
type ImportedFontId = `imported:${string}`;
export type FontFamilyId = BundledFontId | ImportedFontId;

type Face = "regular" | "semibold" | "bold";
export type FontFamily = {
  label: string;                       // the family name shown in the Font menu
  ps: Record<Face, string>;            // PostScript names (PSD type layers)
};

// src/labelfile.ts
export type FontAsset = { name: string; bytes: Uint8Array };
export type ImportedFont = { family: string; faces: Record<Face, FontAsset> };
LabelAssets.fonts?: Record<ImportedFontId, ImportedFont>;   // also in MasterAssets

// src-tauri (desktop only)
struct SystemFont { family: String, postscript: String, weight: u16, path: String }
```

## Tasks

Each task starts by writing its named test and showing it fail. UI rendering is
verified by eye after its logic is test-driven. Acceptance for every task:
`npx tsc --noEmit` clean and the named tests green.

| # | Task | Depends on | Parallel group |
|---|------|-----------|----------------|
| 1 | Open the family id type | — | A |
| 2 | Read an imported font | — | A |
| 3 | Store fonts in the file container | 1 | B |
| 4 | Accept imported ids when opening a file | 1, 3 | C |
| 5 | Register imported faces in the font gate | 1, 2 | B |
| 6 | Export (PDF) with imported faces | 5 | D |
| 7 | Export (PSD) with imported faces | 5 | D |
| 8 | Glyph checks and Character height with imported faces | 5 | D |
| 9 | Carry fonts through open, save, recovery and tabs | 3, 4, 5 | E |
| 10 | Import Font… in the Font menu | 2, 9 | F |
| 11 | Headless `generate` CLI reads fonts from the file | 3, 4 | D |
| 12 | Rust: list system fonts | — | A |
| 13 | Rust: read one listed system font | 12 | B |
| 14 | System fonts in the Font menu (desktop) | 10, 13 | G |
| 15 | Docs, CHANGELOG, locales | 10, 14 | H |
| 16 | Full validation | all | H |

### 1. Open the family id type

- Modify `src/fontCatalog.ts`: `FontFamilyId` as above; `isImportedFontId(id)`;
  `fontFamilyOf` accepts an id present in a passed `imported` set, else falls
  back to Poppins as today; a `fontFamily(id, imported)` lookup returning
  `FontFamily` for bundled and imported ids. `FONT_FAMILIES` keeps its two
  bundled entries.
- Update every `FONT_FAMILIES[id]` read to use the lookup:
  `LayerInspectorSections.tsx`, `psd/build.ts`, `scripts/generate-lib.ts`,
  `scripts/ai-format-proof.ts`.
- Test first: `tests/fontcatalog.test.ts` — an imported id resolves to its
  family name; an unknown imported id falls back to Poppins; bundled ids are
  unchanged.

### 2. Read an imported font

- Create `src/fontImport.ts` (Node-safe, uses `src/fontkit.ts`):
  `readImportedFont(files: FontAsset[]): Promise<{ id: ImportedFontId; font: ImportedFont }>`.
  It parses each file, checks one family, refuses `fsType` restricted or
  bitmap-only, refuses `.ttc`, places faces by weight, and computes the id.
- Test first: `tests/font-import.test.ts`, using SVN-Poppins-Bold and
  Barlow Condensed from `src/assets/fonts` as fixtures — one Bold file fills all
  three faces; Regular plus Bold map 400 and 700 with semibold taking the
  nearer; two families are refused; a font with `fsType` bit 1 set is refused;
  the id is stable regardless of file order.
- Add SVN-Poppins-Bold.ttf to `tests/fixtures/fonts/` with its OFL text (OFL
  allows redistribution).

### 3. Store fonts in the file container

- Modify `src/labelfile.ts`: `packAssets` writes `fonts/<id>/<face>-<name>`;
  `extractAssets` reads them back into `assets.fonts`. Follows the
  `custom/<assetId>/<name>` pattern, one file per face directory.
- Modify `src/model/files.ts`: `MasterAssets` includes `fonts`.
- Test first: `tests/labelfile.test.ts` and `tests/model-files.test.ts` — a
  master and a label with an imported font round-trip byte-for-byte; a file
  with no `fonts/` is unchanged.

### 4. Accept imported ids when opening a file

- Modify `src/model/layers.ts` (`validateLayer`, line ~375) and
  `src/model/files.ts` (`parseOverrides`, line ~126): an imported id is valid
  when the file (or its master) carries that font; otherwise the existing
  "Unknown label font family" error.
- Test first: `tests/layer-fonts.test.ts` — a layer naming a carried imported
  font opens; one naming a missing imported font is refused with that message.

### 5. Register imported faces in the font gate

- Modify `src/fonts.ts`: `registerImportedFont(id, font)` stores the bytes;
  `loadFonts(id)` returns them for an imported id instead of fetching a URL;
  `registerFaces` and `loadLabelFaces` work unchanged on top. `labelFontCss`
  turns `imported:<hex>` into a valid CSS identifier (`LabelFont-imported-<hex>`),
  closing the carry-item from Phase 4c.
- Test first: `tests/fonts-load.test.ts` — an imported id loads the registered
  bytes without fetching; an unregistered imported id rejects with a message;
  the CSS name has no colon.

### 6. Export (PDF) with imported faces

- `src/useExport.ts` and `src/pdf/build.ts` already take per-family packs;
  confirm they pass imported packs, and that the missing-glyph message names
  the imported family's label rather than its PostScript name.
- Test first: `tests/pdf-build.test.ts` — "RỒNG" in an imported SVN-Poppins
  family builds a PDF whose embedded font is SVN-Poppins and whose glyphs
  include U+1ED2; the same text in Poppins still raises the existing error.

### 7. Export (PSD) with imported faces

- Modify `src/psd/build.ts` (line ~548) to take PostScript names from the
  family lookup.
- Test first: `tests/psd-build.test.ts` — a type layer in an imported font
  names that font's PostScript name.

### 8. Glyph checks and Character height with imported faces

- `src/textheight.ts` `loadTextChecks(family)` and
  `src/components/CharacterHeight.tsx` take any `FontFamilyId`.
- Test first: extend `tests/layer-fonts.test.ts` — the inspector's missing-glyph
  check reports nothing for "RỒNG" in SVN-Poppins and reports Ồ in Poppins.

### 9. Carry fonts through open, save, recovery and tabs

- Modify the tab state that holds `MasterAssets`/`LabelAssets` (`src/App.tsx`,
  `src/TabsShell.tsx` and the recovery snapshot code): opening a file registers
  its fonts before the first render; save writes only fonts in use (see
  Decisions); a recovery snapshot keeps them.
- Test first: `tests/font-carry.test.ts` — open a label using an imported font,
  save it, reopen: same id and bytes; remove the last layer using it, save: the
  font is gone from the archive; a recovered tab renders with it.

### 10. Import Font… in the Font menu

- Modify `src/components/LayerInspectorSections.tsx` `TextFace`: the Select
  lists bundled families, then the file's imported families, then **Import
  Font…**. Choosing it opens `openThrough` with a font filter (multiple files
  allowed: extend `openNativeFile`/`openThrough` with `multiple`), runs
  `readImportedFont`, adds the font to the tab, and sets the layer's
  `fontFamily`. Refusals show as the existing error toast.
- Test first: `tests/layerinspector-dom.test.tsx` — choosing Import Font… with
  a picked file sets the layer's family to the new id and lists it in the
  menu; a refused file leaves the layer unchanged and shows the message.
  Verify the menu by eye on desktop and phone widths.

### 11. Headless `generate` CLI reads fonts from the file

- Modify `scripts/generate-lib.ts` (`fontPack`, line ~447, and the glyph
  check at ~756): imported families come from the master/label's `fonts/`.
- Test first: `tests/generate.test.ts` — generating a label that uses an
  imported font succeeds and embeds it.

### 12. Rust: list system fonts

- Add `fontdb` (pure-Rust font database) to `src-tauri/Cargo.toml`. Add a
  `list_system_fonts` command in a new `src-tauri/src/system_fonts.rs`:
  scans the system font directories, returns `Vec<SystemFont>` for single-font
  `.ttf`/`.otf` files only, sorted by family then weight.
- Test first: a `#[cfg(test)]` module in `system_fonts.rs` — the filter drops
  collection faces and non-TTF/OTF files from a fixture list; the result is
  sorted. Run with `cargo test`.

### 13. Rust: read one listed system font

- `read_system_font(path)` returns the bytes **only** for a path the last
  `list_system_fonts` returned (held in Tauri state); anything else is refused,
  so the webview cannot read arbitrary files.
- Test first: same module — a listed path reads; an unlisted path, a `..` path
  and a symlink out of the font directories are refused.

### 14. System fonts in the Font menu (desktop)

- `src/systemFonts.ts`: `listSystemFonts()` and `importSystemFamily(family)`
  (reads each weight's file through task 13, then `readImportedFont`). Desktop
  only (`isTauri()`).
- `TextFace`: on desktop, the Select gains a **System Fonts** group below the
  file's fonts. It is long, so it becomes a searchable list (the existing
  `src/components/ui/command.tsx`) opened from the Font field instead of a
  plain Select. Picking a family imports it and sets the layer.
- Test first: `tests/system-fonts.test.ts` (Tauri `invoke` mocked) — picking a
  family with Regular and Bold files imports both faces under one id; the web
  build lists none. Verify by eye in the desktop app with SVN-Poppins installed.

### 15. Docs, CHANGELOG, locales

- `docs-site/content/docs/(authoring)/inspector.mdx`: the Font menu, Import
  Font…, System Fonts, and that the font is saved in the file.
- `docs-site/content/docs/(output)/export.mdx`: a missing letter now suggests
  importing a font that has it.
- `docs-site/content/docs/(reference)/generate.mdx`: the CLI reads imported
  fonts from the file.
- `src/locales/{en,de,es,fr,pt}.ts`: every new string.
- `CHANGELOG.md` `[Unreleased]`, `### Added`: font import and system fonts.
- Module comments on `src/fontImport.ts`, `src/systemFonts.ts`,
  `src-tauri/src/system_fonts.rs`; update the header comments of
  `fontCatalog.ts`, `fonts.ts` and `labelfile.ts`.

### 16. Full validation

`npx tsc --noEmit`, `npx vitest run`, `cargo test` in `src-tauri`,
`npm run build`, `node scripts/check-release.mjs origin/main`. Then by hand:
the RỒNG label exports from desktop with SVN-Poppins imported from the system,
and the saved `.label` opens and exports in the browser on a machine without
SVN-Poppins installed.

## No database changes

Label Lab has no database; the stored-format change is the `fonts/` directory
in the `.master`/`.label` archive (task 3).
