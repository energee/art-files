// draw.ts — the canvas backend: walks the display list (plan.ts) and paints
// one plate into a 2D context. Same Mode semantics as pdf/build.ts — art
// paints fills over the texture, mask paints knockout white / white-ink blue
// — but no y-flip (canvas and the plan are both top-left origin). Text
// strokes DO carry the same cavity bridge the PDF backend uses; Skia
// underpaints a wide stroke's interior just as pdf.js does (see
// bridgeOffsets in strokes.ts). Fonts arrive through the fonts.ts
// gate: callers must have awaited loadLabelFont()/loadLabelFaces() for the
// same family as the `fontCss` passed in, so that CSS family resolves — a
// missing face would silently measure wrong, which is exactly what the gate
// exists to prevent.
import {
  planLabel, type Mode, type MeasureFace, type Placed, type PlacedBarcode, type PlacedText,
  type PlanAssets,
} from "../plan";
import type { Fill, LabelConfig, Style } from "../types";
import type { ElementId } from "../elements";
import { bridgeOffsets } from "../strokes";
import { FACE_WEIGHT } from "../fonts";
import * as L from "../layout";

// TypeScript note: some lib.dom versions lack `letterSpacing` on the 2D
// context type; declared locally rather than `as any` per call site.
interface Ctx2DLetterSpacing { letterSpacing: string }
type Ctx = (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) & Ctx2DLetterSpacing;

/** Whether the engine's 2D context implements letterSpacing (Safari/WKWebView
 *  gained it in 17.4). Older engines silently IGNORE the assignment, so
 *  tracked text would paint narrower than the plan placed it — drawText
 *  falls back to per-glyph advances there instead. Detected once; in Node
 *  (vitest hands in fake contexts, nothing rasterizes) the normal path is
 *  fine and `document` doesn't exist, so absence of DOM means "supported". */
const CANVAS_LETTER_SPACING =
  typeof document === "undefined"
  || "letterSpacing" in (document.createElement("canvas").getContext("2d") ?? {});

export interface CanvasAssets {
  /** Art plate background, cover-fitted; absent = bare stock (white). */
  texture?: (CanvasImageSource & { width: number; height: number }) | null;
  /** Uploaded mask, drawn as-authored; absent = flood white-ink blue. */
  maskImage?: (CanvasImageSource & { width: number; height: number }) | null;
  /** Raster collab logos, keyed to the PlacedImage ids. */
  collabLeft?: CanvasImageSource | null;
  collabCenter?: CanvasImageSource | null;
}

/** Everything a view needs to render label plates from the display list:
 *  the face-aware measure, the plan's asset descriptors, the decoded
 *  bitmaps, and the skip set (layer eyes + the in-place edit session). */
export interface CanvasRenderSource {
  m: MeasureFace;
  planAssets: PlanAssets;
  drawAssets: CanvasAssets;
  skip: { has(id: ElementId): boolean };
  /** The registered CSS font-family for this source's family (labelFontCss
   *  of fontFamilyOf(cfg)) — the same string the faces were loaded under, so
   *  drawPlate's text/barcode calls resolve the right glyphs. */
  fontCss: string;
}

/** The one spelling of "plan from a render source" — PreviewCompare and the
 *  3D texture path both build the identical call (Phase-3 deferred minor). */
export const planFrom = (cfg: LabelConfig, s: CanvasRenderSource): Placed[] =>
  planLabel(cfg, s.m, { skip: s.skip, assets: s.planAssets });

/** Art-mode CSS color for a Fill — "none" is no ink, i.e. white, the same
 *  rule as pdf/build.ts's fillColor via parseHexFill. */
const cssFill = (fill: Fill) => (fill === "none" ? "#FFFFFF" : fill);
/** Mask-mode paint: knockout (white) or white-ink (blue). */
const cssMask = (layer: Style["layer"]) =>
  layer === "metallic" ? "#FFFFFF" : L.MASK_BLUE_HEX;

/** Paint one plate from the plan. The canvas's pixel size sets the scale
 *  (width / PAGE.w); the caller sizes it. Backgrounds paint before the
 *  BLEED_SHIFT translate, exactly like shiftForBleed in the PDF: they cover
 *  the page and must not move with the design. */
export function drawPlate(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  plan: readonly Placed[],
  assets: CanvasAssets,
  mode: Mode,
  // Required, no poppins default: a caller that forgot to thread the
  // config's family would silently render the wrong face — the exact
  // failure the fonts.ts gate exists to prevent.
  fontCss: string,
): void {
  const c = ctx as Ctx;
  const scale = c.canvas.width / L.PAGE.w;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.lineJoin = "round";
  c.lineCap = "round";
  // This backend owns text alignment: the plan's x/baseline are start-of-run
  // and alphabetic-baseline coordinates, so a caller-mutated ctx (canvas
  // contexts persist state between frames) must not be able to shift every
  // glyph.
  c.textAlign = "left";
  c.textBaseline = "alphabetic";

  // Plate background — mirrors buildArtPdf / buildMaskPdf.
  c.fillStyle = "#FFFFFF";
  c.fillRect(0, 0, L.PAGE.w, L.PAGE.h);
  const cover = (img: CanvasImageSource & { width: number; height: number }) => {
    const r = L.coverFit(img.width, img.height);
    c.drawImage(img, r.x, r.y, r.w, r.h);
  };
  if (mode === "art") {
    if (assets.texture) cover(assets.texture);
  } else if (assets.maskImage) cover(assets.maskImage);
  else {
    // No mask uploaded: flood white ink ("print as a white label"); metallic
    // elements knock back out on top.
    c.fillStyle = L.MASK_BLUE_HEX;
    c.fillRect(0, 0, L.PAGE.w, L.PAGE.h);
  }

  c.translate(L.BLEED_SHIFT, L.BLEED_SHIFT);

  // One copy per device pixel: this plate knows its own density, and
  // bridgeOffsets floors the request at the print bound so a dense raster
  // still samples the way the PDF it has to match does.
  const ring: Ring = (w) => bridgeOffsets(w, 1 / scale);

  for (const r of plan) {
    if (r.kind === "text") drawText(c, r, mode, fontCss, ring);
    else if (r.kind === "paths") {
      c.save();
      c.translate(r.x, r.y);
      const paths = r.paths.map((d) => new Path2D(d));
      // Every stroke path before any fill — the laurel-branch rule. Unlike
      // pdf-lib's stroked drawSvgPath (whose one op fills AND strokes), the
      // stroke pass only strokes: the fill pass below repaints every
      // interior anyway, so a stroke-colored fill here would be dead paint.
      // No cavity bridge here, unlike drawText: the laurel's stroke measured
      // clean against the PDF (0 stray pixels over its whole crop) — its leaf
      // tips never fold the stroke over itself. Re-measure with strokecap
      // before assuming otherwise.
      if (r.stroke) {
        c.strokeStyle = mode === "art" ? cssFill(r.stroke.fill) : cssMask(r.stroke.layer);
        c.lineWidth = 2 * r.stroke.w;
        for (const p of paths) c.stroke(p);
      }
      c.fillStyle = mode === "art" ? cssFill(r.fill) : cssMask(r.layer);
      for (const p of paths) c.fill(p);
      c.restore();
    } else if (r.kind === "image") {
      if (mode === "art") {
        const img = r.id === "collabLeft" ? assets.collabLeft : assets.collabCenter;
        // The plan only places an image the caller declared (PlanArt came
        // from the same slot), so a missing bitmap is an assembly bug —
        // fail fast rather than render a silently incomplete label.
        if (!img) throw new Error(`Canvas asset missing for "${r.id}" — the plan placed it, so its bitmap must be supplied.`);
        c.drawImage(img, r.x, r.y, r.w, r.h);
      } else {
        // Raster art prints on white ink: the mask paints its footprint blue.
        c.fillStyle = L.MASK_BLUE_HEX;
        c.fillRect(r.x, r.y, r.w, r.h);
      }
    } else drawBarcode(c, r, mode, fontCss, ring);
  }
}

/** This plate's bridge ring for a stroke of width `w`: where to stamp the
 *  filled copies that close the cavities Skia's stroker leaves. Handed down
 *  from drawPlate so the sampling policy — one copy per device pixel, which
 *  bridgeOffsets floors at the print bound — is stated once per plate rather
 *  than at each painter. */
type Ring = (w: number) => { dx: number; dy: number }[];

function drawText(ctx: Ctx, r: PlacedText, mode: Mode, fontCss: string, ring: Ring) {
  ctx.font = `${FACE_WEIGHT[r.face]} ${r.size}px ${fontCss}`;
  // Tracking in points: under the pt-scaled transform, user-space px ARE
  // points. Canvas letterSpacing also gaps after the final glyph, but that
  // is advance, not ink — run positions come from the plan, so it cannot
  // shift anything.
  ctx.letterSpacing = `${r.tracking}px`;
  // Engines without letterSpacing ignore the assignment above, so tracked
  // runs are laid out by hand: one glyph per call, advancing by the glyph's
  // own measured width plus the tracking — all in user-space px, which the
  // pt-scaled transform makes scale-free. Kerning between pairs is lost on
  // this degraded path; positions still match the plan's run starts. The
  // glyphs are PLACED once per run, not per paint: a stroked run paints the
  // text up to 66 times (the bridge ring, the stroke, the ink), and measuring
  // every glyph for each of those was the whole cost of this path on the
  // engines stuck with it. Null means the engine can place the run itself.
  let x = 0;
  const placed = !CANVAS_LETTER_SPACING && r.tracking
    ? [...r.text].map((ch) => {
        const at = { ch, x };
        x += ctx.measureText(ch).width + r.tracking;
        return at;
      })
    : null;
  const paint = (method: "fillText" | "strokeText", dx = 0, dy = 0) => {
    if (!placed) return ctx[method](r.text, dx, dy);
    for (const p of placed) ctx[method](p.ch, dx + p.x, dy);
  };
  ctx.save();
  ctx.translate(r.x, r.y);
  if (r.rotated) ctx.rotate(-Math.PI / 2); // y-down CCW = PDF's degrees(90)
  if (r.stroke) {
    const ink = mode === "art" ? cssFill(r.stroke.fill) : cssMask(r.stroke.layer);
    // Bridge the cavities first, in the stroke's own ink, then stroke over
    // them: the copies sit inside the true envelope, so the stroke keeps the
    // outer edge.
    ctx.fillStyle = ink;
    for (const { dx, dy } of ring(r.stroke.w)) paint("fillText", dx, dy);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2 * r.stroke.w; // outer half is the w-wide stroke; fill covers the inner
    paint("strokeText");
  }
  ctx.fillStyle = mode === "art" ? cssFill(r.fill) : cssMask(r.layer);
  paint("fillText");
  ctx.restore();
  ctx.letterSpacing = "0px";
}

/** Both plates of the barcode — the same paint logic as pdf/build.ts's
 *  drawBarcode, from the same item. */
function drawBarcode(ctx: Ctx, item: PlacedBarcode, mode: Mode, fontCss: string, ring: Ring) {
  // One ring for the whole barcode: every digit strokes at the same width.
  const bridge = item.S > 0 ? ring(item.S) : [];
  const digit = (d: { text: string; x: number; y: number }, paint: "fill" | "stroke") => {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(-Math.PI / 2);
    if (paint === "fill") ctx.fillText(d.text, 0, 0);
    else {
      // Digits are the same tiny-feature case drawText bridges — 0, 6, 8 and
      // 9 all have counters a wide halo folds over. The copies are stroke-
      // colored and belong to this stroke pass, so they stay ahead of every
      // fill below (the module-width rule).
      for (const { dx, dy } of bridge) ctx.fillText(d.text, dx, dy);
      ctx.strokeText(d.text, 0, 0); // ink pass repaints the glyph body
    }
    ctx.restore();
  };
  ctx.font = `${FACE_WEIGHT.regular} ${item.textSize}px ${fontCss}`;
  ctx.letterSpacing = "0px";

  if (mode === "mask") {
    // Expanded stroke footprint first, exact fill footprint on top — same
    // plate-independence rule as the PDF's mask branch.
    const paintFootprint = (outset: number, color: string) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * outset;
      for (const f of item.footprint) {
        ctx.fillRect(f.x, f.yTop, f.w, f.h);
        if (outset > 0) ctx.strokeRect(f.x, f.yTop, f.w, f.h);
      }
    };
    if (item.S > 0) paintFootprint(item.S, cssMask(item.strokeLayer));
    if (item.S === 0 || item.strokeLayer !== item.fillLayer)
      paintFootprint(0, cssMask(item.fillLayer));
    return;
  }

  const bars = item.geo.bars;
  if (item.S > 0) {
    // Halo only: the ink pass below repaints every bar body and digit, so
    // this pass strokes without filling (dead paint otherwise).
    // One ink for both: the digits' bridge copies FILL in the stroke colour.
    ctx.fillStyle = ctx.strokeStyle = cssFill(item.stroke);
    ctx.lineWidth = 2 * item.S;
    // EVERY stroke shape before ANY fill — interleaving distorts module
    // widths until the code stops decoding (see pdf/build.ts).
    for (const b of bars) ctx.strokeRect(b.x, b.yTop, b.w, b.h);
    for (const d of item.digits) digit(d, "stroke");
  }
  ctx.fillStyle = cssFill(item.fill);
  for (const b of bars) ctx.fillRect(b.x, b.yTop, b.w, b.h);
  for (const d of item.digits) digit(d, "fill");
}
