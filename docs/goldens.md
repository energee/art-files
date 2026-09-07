# Goldens: what is locked, and how to re-baseline one

## What is locked today

- `tests/collab-variant-goldens.test.ts` pins the sha256 and byte length of the
  art PDF, the mask PDF and the PSD for the shipped Lolev master, Collab OFF and
  ON. PDF timestamps are pinned (`PDF_EPOCH` in `src/pdf/build.ts`), so the same
  input builds byte-identical output and a digest IS byte identity.
- `tests/print-geometry-goldens.test.ts` pins concrete plotted numbers (bar
  rects, digit baselines, white-ink footprints) rather than digests.
- `tests/psd-collab.test.ts` pins the PSD layer tree for a Collab label.

Outside an approved rendering change, a digest that moves is a regression, not a
golden to regenerate: stop and report it (the comment atop
`collab-variant-goldens.test.ts` says why).

## When a golden may move

The master-as-layers migration
(`docs/superpowers/specs/2026-09-04-master-as-layers-design.md`, "Goldens")
does not target byte identity: text draws through one generic path afterwards.
Each PDF/PSD golden is re-baselined after a 600 DPI raster diff against the old
output, reviewed per layer; the diff PNG is committed with the new golden.
Afterwards the golden is byte-locked again.

## Re-baseline procedure

1. Build the OLD output from the last commit where the golden held. The
   cheapest way is a throwaway worktree (gitignored under `.agents/worktrees/`):

   ```sh
   git worktree add .agents/worktrees/golden-old <last-good-sha>
   (cd .agents/worktrees/golden-old && npm install && \
     npm run generate -- <texture.png|none> <mask.png|none> /tmp/golden-old [config.json])
   ```

   The same four files also come from the master/values form, e.g.
   `npm run generate -- --out /tmp/golden-old --format all` for the shipped
   Lolev master with empty fills, or a `.master` plus `values.json`.

   `generate` writes `{slug}.pdf`, `{slug}-mask.pdf`, `{slug}.psd` and
   `{slug}-mask.psd`, where `slug` is `machineName` of the name layer (or
   `label` if that layer is blank). A beer named Labradorite is
   `labradorite.pdf`. Use the same texture, mask and values the golden
   test uses (for the collab goldens: the shipped master, no texture, no mask).

2. Build the NEW output from your branch the same way into `/tmp/golden-new`.

3. Diff each PDF pair at print resolution and look at the PNG:

   ```sh
   npx tsx scripts/golden-diff.mts /tmp/golden-old/Foo.pdf /tmp/golden-new/Foo.pdf \
       tests/goldens/foo-art.diff.png            # --dpi 600 --threshold 0 are the defaults
   npx tsx scripts/golden-diff.mts /tmp/golden-old/Foo-mask.pdf /tmp/golden-new/Foo-mask.pdf \
       tests/goldens/foo-mask.diff.png
   ```

   stdout is one line, `changed: <n> px (<pct>%), bbox: x,y,w,h` (`bbox: none`
   when nothing changed); the exit code is 1 when `changed` exceeds
   `--threshold`, 2 on a usage or I/O error. Review the red per layer against
   the change you meant to make — a moved description block should light up
   only the description and whatever is positioned relative to it.

4. Once every red pixel is accounted for, take the new digests and byte lengths
   (`shasum -a 256 Foo.pdf; wc -c Foo.pdf`) into the golden test, and commit the
   diff PNGs from step 3 alongside them in the same commit, so the review is
   reproducible from history.

## What the diff PNG means

The PNG is the NEW render drawn faded (a quarter of the ink kept), with every
pixel that differs from the old render painted solid red:

- a moved element is two red silhouettes: where it was and where it is;
- a re-antialiased glyph edge is a thin red outline around otherwise faded text;
- an unchanged label is a uniformly faded page with no red;
- when the two pages differ in size, the diff runs over their union and the
  strip present in only one of them is red.

Comparison is exact per channel. The two rasterizers below anti-alias
differently, so both inputs of one diff always go through the same engine, and
a PNG made with one engine is never compared against one made with the other.

## Rasterizer

`pdftoppm` (poppler) is used when it is on PATH, at `--dpi` (600 by default,
the label's design DPI, so one raster pixel is one print pixel). Without it the
script warns and falls back to `pdfjs-dist` rendering through
`@napi-rs/canvas` (pdfjs-dist's optional dependency) — it takes ~10-15s to
start and is a safety net for machines without poppler, not the reference.
Force one with `--rasterizer pdftoppm|pdfjs`.

Only page 1 is rasterized; every label PDF is single-page.

## PSD goldens

The PSD builder stays byte-locked: Node has no canvas to composite a PSD, and
`tests/psd-build.test.ts` reads the layer TREE only. To review a PSD change
visually, export the layer or composite you changed to PNG from Photoshop for
both the old and new file and diff the PNGs — the script sniffs PNG inputs and
diffs them directly (`diffPngs` in `scripts/golden-diff.mts`), with the same
summary line, PNG output and exit code.
