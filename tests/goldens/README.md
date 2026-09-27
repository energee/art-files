# Master-as-layers migration: raster review

2026-09-04: regenerated all four PDF diffs using `scripts/golden-diff.mts`
with Poppler at 600 DPI. Each image is 4876 × 3076 pixels. The old PDFs'
SHA-256 hashes match the pre-migration values in the committed
`tests/collab-variant-goldens.test.ts`.

| State | Plate | Changed pixels | Bounding box (x,y,w,h) |
| --- | --- | ---: | --- |
| Collab off | Art | 99,275 | 4251,241,100,2505 |
| Collab on | Art | 99,275 | 4251,241,100,2505 |
| Collab off | Mask | 53,661 | 4266,256,70,2478 |
| Collab on | Mask | 53,661 | 4266,256,70,2478 |

Visual review of all four PNGs: differences are confined to the final warning
column. The generic planner leaves that final line at natural width, as the
approved spec requires; the previous renderer justified it. Volume, ABV,
description, brand, logo, name, style, info, store-cold, QR, barcode and the
collab block have no changed pixels. The new PDF hashes are locked in the test.

PSD hashes are candidate regression locks, **not a completed visual re-baseline**.
No Photoshop-rendered old/new PSD raster pair was available. `ag-psd` reads and
writes layer data but does not render editable text, vector masks and effects
into a composite. PDF comparisons cannot certify Photoshop's rendering.
The PSD tests verify exported text, run transforms, shape geometry, effects,
asset placement and missing-art behavior. Justified text exports as individually
editable placed runs inside its app-layer group so variable word gaps remain
exact; ordinary text remains one editable type layer. Page rasters now use the
same planned cover-fit rectangle as PDF/canvas. Before certifying the spec's
PSD visual gate, render the old and new PSDs in Photoshop at 600 DPI and commit
the reviewed diff PNGs alongside these candidates.

## 2026-09-27 barcode backing (#284)

The new `*-backing.diff.png` files compare the four PDF golden fixtures before
and after adding a continuous barcode backing. All four have **zero changed
pixels** at 600 DPI: these fixtures already have bare white stock / a flooded
white-ink mask. Their byte hashes change because the backing path is now explicit.
The PSD hashes also change; the backing exports as a four-knot editable shape in
the barcode group. Photoshop raster certification remains pending as above.

The real Blue Agate art comparison has 54,340 changed pixels, all in the barcode
backing (bounding box 3786,2627,850,253 on a 4876×3076 raster). Bars, digits and all
other artwork remain in place. See the issue-queue audit for scan evidence.
