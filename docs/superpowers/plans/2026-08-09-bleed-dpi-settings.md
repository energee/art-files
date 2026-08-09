# Bleed and DPI as Settings knobs

**Status:** §0 resolved 2026-08-09 — bleed is **0.0635" per side**. Ready to execute.

## Goal

Two new knobs on the Settings layer, both stated in the units a press job is
specified in:

- **Bleed** — inches, per side. Extra artwork outside the trim that gets cut
  away. Included in the exported PDF/PSD.
- **DPI** — the raster resolution the deliverables are built at.

## 0. Settled: 0.0635" per side

Bleed is stored **per side**, in inches, defaulting to `0.0635`. Trim stays
8 × 5in and the page stays 8.127 × 5.127in, so **this change ships with
byte-identical output** — the knob only does something once someone turns it.

That is the useful property to hold onto during execution: at the default,
`BLEED_SHIFT` is 0 and every existing test must pass untouched. Any red test
means the mechanism is wrong, not that an expectation needs updating. Do not
"fix" a failing pdf-build or hittest expectation by editing the expected
value.

(Noted for later: 0.0635" is roughly 1/16". The common print standard is 1/8"
= 0.125". If the press ever asks for the standard, it is now a one-line
default change instead of a refactor — which is most of the point of this
work.)

## 1. The core problem: positions are page-absolute

`layout.ts` measures every element from the **page** edge, bleed included:

| constant | value | distance from trim |
|---|---|---|
| `LEFT_X` | 24.9 | 20.34 |
| `VOLUME.baseline` | 29.37 | 24.81 |
| `QR.x` / `QR.yTop` | 23 / 289 | 18.44 / 284.44 |
| `HANDLE_ADDR.x` | 505 | 500.44 |
| `WARNING.x` | 516.62 | 512.06 |
| `STORE_COLD.x` | 562.3 | 557.74 |
| `BARCODE.x` / `.yTop` | 537.13 / 237.23 | 532.57 / 232.67 |

…and `pdf/build.ts:128` flips y against `PAGE.h`, `:533` sizes the page
`[PAGE.w, PAGE.h]`.

So growing the page today slides the whole design toward the trim. Every one
of those constants is a value measured off the reference PDF; re-deriving
twenty of them by hand is where a misprinted label comes from.

### Don't rebase the constants — shift once at the boundary

Keep every measured constant exactly as written, and record the bleed they
were measured at:

```ts
/** Bleed the position constants in this file were measured at. Positions are
 *  page-absolute, so a different bleed moves the page edge out from under
 *  them; BLEED_SHIFT puts them back. Not a magic number to be "cleaned up" —
 *  it is the provenance of every measured value below. */
const MEASURED_BLEED = 4.56;
export const BLEED_SHIFT = BLEED - MEASURED_BLEED;
```

with

```ts
export const TRIM = { w: 576, h: 360 };            // 8 x 5in, fixed
export const BLEED = bleedIn * 72;                 // from Settings
export const ART  = { x: BLEED, y: BLEED, ...TRIM };
export const PAGE = { w: TRIM.w + 2 * BLEED, h: TRIM.h + 2 * BLEED };
```

Then add `BLEED_SHIFT` once per output boundary rather than to twenty
constants. At the default it is `0`, so nothing moves and no existing test
expectation changes.

**Boundaries to patch (4):**

| file | what to shift |
|---|---|
| `pdf/build.ts` | the `y()` helper and the x of each draw call — ideally one `translate` at the page level |
| `psd/build.ts` | raster layer origin |
| `hittest.ts` | incoming point before testing |
| `three/labelTextures.ts` / `maskimage.ts` | raster origin |

## 2. The threading problem

`PAGE`/`ART` are module-level `const`s that 14 modules read at import time.
Bleed is now runtime state, so they cannot stay constants.

**Recommendation — a single module-level document geometry, set once per
build.** `layout.ts` exposes `setBleed(inches)`, App calls it before each
debounced build, and the exports become getters over one mutable record.

```ts
// ponytail: one global document geometry, because the app edits exactly one
// label at a time. If it ever opens two, thread a Geometry through the
// renderers instead of reading module state.
```

The alternative — threading a `Geometry` parameter through every renderer,
the hit-tester and the 3D scene — is the "correct" version and roughly
triples the diff for a single-document app. Not worth it yet.

**Risk to check during execution:** the PDF worker (`pdf/worker.ts`) runs in a
separate module registry, so `setBleed` must be called on **both** sides or
the worker will build at the default while the UI shows the new value. This is
the single most likely way to ship a silently wrong file.

## 3. DPI

`DPI` is already a `layout.ts` export (added earlier today). Making it a knob
is mostly safe **except** that stroke widths are stored in the saved config in
**pixels** (`defaults.ts:9` `DEFAULT_STROKE_PX = 15`, plus `qrStrokeWidth`,
`barcodeStrokeWidth`, `logo.strokeWidth`) and converted to points via `PX`.

At 300 DPI those saved labels would render strokes at double their physical
width, silently, with no error.

**Fix:** split the two meanings.

```ts
/** DPI the px-denominated DESIGN values were authored against. Fixed forever:
 *  a stroke saved as 15px is 1.8pt of ink, and must stay 1.8pt whatever
 *  resolution the file is rastered at. */
export const DESIGN_DPI = 600;
export const PX = 72 / DESIGN_DPI;      // design px -> points (unchanged)

/** Output resolution — what the deliverables are rastered at. Settings knob. */
export const DPI = /* from settings */;
```

`DPI` then drives only: `PSD_DOC`, the mask/texture raster sizes, and the
toolbar readout. `PX` never moves, so no saved label changes appearance.

## 4. Settings UI

Both go in `DocSettings` (`StyleProperties.tsx:101`), persisting to
`presets.json` alongside `cornerRadius` — they are shop-wide production facts,
not per-label content.

- **Bleed** — `ScrubField`, unit `"`, step `0.005`, range `0`–`0.5`.
  Not `InchField`: that converts a stored *percentage*, and bleed is an
  absolute length.
- **DPI** — `ScrubField`, unit `dpi`, step `50`, range `150`–`1200`.

The preview toolbar readout already reads `PAGE` and `DPI`, so it follows both
knobs with no change.

## 5. Tests

- `sizeLabel(PAGE.w, PAGE.h, "in")` at default bleed still `8.127 × 5.127 in`.
- Bleed 0.125" ⇒ page `8.25 × 5.25 in`, and `ART.x === 9pt`.
- A representative element (barcode, the tightest fit) lands the same distance
  from the **trim** at 0.0635" and at 0.125" bleed — the regression test for
  the whole shift mechanism.
- DPI 300 ⇒ `PSD_DOC` halves **and** a keyline stroke is still 1.8pt.
- Existing `pdf-build` / `psd-build` / `hittest` suites must pass untouched at
  the default — that is the proof `BLEED_SHIFT = 0` is truly a no-op.

## 6. Order

1. `DESIGN_DPI` / `PX` split + DPI knob + tests. Self-contained, low risk.
2. `TRIM`/`BLEED`/`BLEED_SHIFT` in `layout.ts`, default preserving output.
3. The four boundary shifts, one file at a time, full suite between each.
4. `setBleed` threading, **including the PDF worker**.
5. Settings UI for bleed.

Steps 1 and 2–5 are independently shippable; 1 can land on its own.
