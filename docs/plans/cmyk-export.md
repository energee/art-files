# Print-ready CMYK export

Status: planned (order 3 of 3: white-ink PDF → realistic can → CMYK export).
Blocked on task 0: what the printer actually requires.

## Why

Today the app writes RGB. Neutral fills are written as DeviceGray so black
stays on K. The operator then runs `tools/to-cmyk.sh`, and Ghostscript
converts everything else through its generic default profile. Weak spots:

1. The step is manual, so it's easy to send the RGB file. The desktop app
   can't run it.
2. Nobody chooses the CMYK recipe for the inks. Gold `#D0B070` becomes
   whatever Ghostscript computes, and on silver film small shifts show.
3. Textures are RGB rasters, and converting those correctly needs a real
   colour profile.

`White Ink` (plan `white-ink-pdf.md`) is a spot colour, so it's unaffected by
any of this.

## Decided

- Keep the editor as is. Don't rewrite in Rust. The Tauri shell can host one
  Rust command if task 3 needs one.

## Tasks

### 0. Ask the printer — gate (user)
Questions for Blue Label Digital:
- Do you accept RGB with an embedded profile (PDF/X-4), or CMYK only?
- Which output profile/condition: GRACoL 2013, or your own ICC for this
  press and film?
- Do you want named CMYK builds for our recurring inks (gold, black)?
The answers pick the path:
- **RGB + ICC accepted:** do tasks 1, 2 and 4; skip 3.
- **CMYK only:** do all tasks.

### 1. CMYK fills, written exactly — `src/types.ts`, `src/layout.ts`, `src/pdf/build.ts`
- `Fill` today is a hex string or `"none"`. Add a third form,
  `cmyk(c,m,y,k)` with percentages. Additive, so it needs no migration.
  `L.parseHexFill` grows a sibling `parseFill` returning
  `{ rgb } | { cmyk, rgb }`, where `rgb` is a display approximation.
- `fillColor` in `pdf/build.ts` emits `cmyk(...)` (DeviceCMYK) for CMYK fills.
  Hex fills keep the current behaviour.
- The preview and PSD use the `rgb` approximation. The PSD stays an RGB
  handoff, as documented.
- UI: the fill picker gets a CMYK entry mode, and saved swatches can hold a
  CMYK fill. Find the existing colour field and swatch components first;
  extend them, don't add new ones.
- Test `tests/fill-cmyk.test.ts`: parse/format round trip. A PDF built with
  `cmyk(15,25,70,5)` has `0.15 0.25 0.7 0.05 k` in its content stream.

### 2. PDF/X-4 output intent — `src/pdf/build.ts`
- Embed the profile from task 0 (or sRGB when RGB + ICC is accepted) as
  `/OutputIntents [<< /S /GTS_PDFX /OutputConditionIdentifier … /DestOutputProfile … >>]`,
  plus `GTS_PDFXVersion (PDF/X-4)` in the Info dict and the XMP.
- Side benefit: Acrobat enables Overprint Preview by default for PDF/X, so
  `White Ink` shows correctly on open.
- Test: a structural check that the output intent and profile stream are
  present, plus a pass with an external preflight (`verapdf` doesn't cover
  PDF/X; use Acrobat Preflight once, by hand, and log it in the ledger).

### 3. Raster conversion — only if CMYK-only
- The desktop app gets a Tauri command `rgb_to_cmyk(bytes, profile) -> bytes`
  using the `lcms2` crate (LittleCMS) with the printer's ICC. It returns a
  CMYK JPEG or a Flate stream, which `embedRasters` embeds as `DeviceCMYK`.
- Browser build: the same conversion via a LittleCMS WebAssembly build, or
  keep the browser on RGB + ICC and say so in the docs. Choose once task 0 is
  answered.
- Test: a Rust unit test on a 2×2 patch with known profile output, and a
  vitest check that a converted texture embeds as `DeviceCMYK`.

### 4. Retire or narrow `tools/to-cmyk.sh`
Once exports are print-ready, the script is either deleted (with its docs) or
kept only for legacy files. Decide with the user.

### 5. Docs + release metadata
- Rewrite the CMYK section of `docs-site/content/docs/(output)/export.mdx`.
- Document CMYK fills on the inspector docs page.
- `CHANGELOG.md` `## [Unreleased]`.

## Parallelism

0 → 1 and 2 in parallel → 3 (if needed) → 4 → 5.
