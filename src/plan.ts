// plan.ts — the label's display list: WHERE every element draws, computed
// once, renderer-agnostically. pdf/build.ts and hittest.ts both consume it
// (the canvas backend joins in Phase 2 — see the 2026-08-25 canvas preview
// renderer spec), so placement cannot drift between what is drawn, hit-
// tested, and exported. Coordinates are label-space points with a TOP-LEFT
// origin; backends convert (the PDF's y-flip stays in pdf/build.ts).
// Measurement is injected: the PDF backend passes PDFFont metrics so built
// bytes place text exactly as before, the UI passes the fonts.ts canvas
// metrics — the same split hittest always had.
import type {
  CollabSlot, CustomBarcodeLayer, Fill, Style, StyledLine, LabelConfig,
} from "./types";
import { anchoredX, anchoredY, type GuideLines } from "./model/position";
import { logoNudge, type ElementId } from "./elements";
import { parseRuns } from "./description";
import { strokeLayerOf } from "./strokes";
import * as L from "./layout";
import { displayAbv, displayName, displayStyle } from "./defaults";
import { parseDescription, parseInfoLine } from "./description";
import { warningMeasure, wrapWarning } from "./warning";
import { parseLogo } from "./logo";
import { qrPath, qrShapes, qrUrl } from "./qr";
import {
  barcodeDigitsFor, barcodeFootprint, barcodeGeometry, barcodeStrokePt,
  CUSTOM_BARCODE_DIGIT_GAP_RATIO, CUSTOM_BARCODE_DIGIT_SIZE_RATIO,
  encodeFor, quietModulesFor, validateFor, type BarcodeGeometry,
} from "./barcode";

export type Face = "regular" | "semibold" | "bold";
export type MeasureFace = (text: string, size: number, face: Face) => number;

export type StrokeSpec = { fill: Fill; layer: Style["layer"]; w: number };

/** The two plates every backend renders. */
export type Mode = "art" | "mask";

export interface PlacedText {
  readonly kind: "text";
  readonly id: ElementId;
  readonly text: string;
  /** Unrotated: run's left edge / baseline. Rotated (reads bottom-to-top):
   *  x is the baseline's vertical line, y is where the run STARTS, and the
   *  run extends toward smaller y by `w`. */
  readonly x: number;
  readonly y: number;
  /** Drawn width of this run — tracked, without the trailing gap. */
  readonly w: number;
  readonly size: number;
  readonly face: Face;
  readonly tracking: number;
  readonly fill: Fill;
  readonly layer: Style["layer"];
  readonly stroke: StrokeSpec | null;
  readonly rotated: boolean;
}

/** Vector art placed on the label: pre-scaled absolute path data (see
 *  parseLogo) translated to (x, y), top-left origin. Backends fill with the
 *  nonzero rule (pdf-lib's drawSvgPath and Path2D's default agree); a stroke
 *  paints every path before any fill so overlapping laurel branches keep
 *  clean edges. */
export interface PlacedPaths {
  readonly kind: "paths";
  readonly id: ElementId;
  readonly paths: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly fill: Fill;
  readonly layer: Style["layer"];
  readonly stroke: StrokeSpec | null;
}

/** A raster collab logo's fitted rect. The bytes stay with the backend
 *  (keyed by id); art mode draws the image, mask mode paints the rect
 *  white-ink blue so a full-color logo prints on white ink. */
export interface PlacedImage {
  readonly kind: "image";
  readonly id: ElementId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Custom-layer asset key (CustomImageLayer.asset); absent for collab
   *  slots. Backends look bytes up by it. */
  readonly asset?: string;
}

/** The barcode as one item: shared geometry plus everything both plates
 *  paint from. Genuinely mode-asymmetric (art = stroked bars+digits, mask =
 *  the outset footprint), so it stays one item rather than mode-dependent
 *  primitives — the backends keep their paint logic, the geometry exists
 *  once. `digits` follow ONE of two conventions, gated by `rotated`: rotated
 *  (the template) reads bottom-to-top — x is the baseline's vertical line, y
 *  the run's start, extent -w; upright (every custom barcode layer) reads
 *  left-to-right like ordinary text — x is the run's CENTER (left edge is
 *  x - w/2), y is the baseline. Widened from the literal "barcode" to
 *  ElementId so a master-variant custom barcode layer (Task 3) can be one
 *  of these too, keyed by its own `custom-${string}` id like every other
 *  custom layer's placed item. */
export interface PlacedBarcode {
  readonly kind: "barcode";
  readonly id: ElementId;
  readonly geo: BarcodeGeometry;
  /** Resolved halo width in points; 0 = no halo at all. */
  readonly S: number;
  readonly fill: Fill;
  readonly stroke: Fill;
  readonly fillLayer: Style["layer"];
  readonly strokeLayer: Style["layer"];
  readonly textSize: number;
  /** True for the template barcode, whose symbol lives pre-rotated into the
   *  page's vertical right column (modules run along Y) — its digits paint
   *  through a 90° glyph rotation. False for every custom barcode layer
   *  (Task 3), whose symbol is laid out upright (modules along X) — its
   *  digits paint as ordinary horizontal text. Backends (pdf/build.ts,
   *  canvas/draw.ts, psd/build.ts) branch their digit-drawing on this. */
  readonly rotated: boolean;
  readonly digits: readonly { text: string; x: number; y: number; w: number }[];
  /** The white-ink footprint at S = 0 (bars + digit pills); the mask pass
   *  outsets it by S as a border, matching barcodeFootprint's contract. */
  readonly footprint: readonly { x: number; yTop: number; w: number; h: number }[];
}

export type Placed = PlacedText | PlacedPaths | PlacedImage | PlacedBarcode;

/** Collab art as the plan needs it: SVG art plans as paths (the plan fits
 *  it itself, via parseLogo); raster art plans as a fitted rect, so only
 *  the intrinsic pixel size travels — bytes stay with the backend. */
export type PlanArt =
  | { kind: "svg"; svg: string }
  | { kind: "raster"; w: number; h: number };

export interface PlanAssets {
  /** Raw contents of logo2025.svg. */
  logoSvg: string;
  collabLeft?: PlanArt | null;
  collabCenter?: PlanArt | null;
  /** Custom image layers' loaded state, keyed by CustomImageLayer's `asset`.
   *  A layer whose key is absent here emits nothing (collab-art contract) —
   *  the asset hasn't loaded/isn't supplied. `aspect` is the intrinsic w/h,
   *  used by every custom image (raster or SVG-before-load) to size its box.
   *  `art` carries the loaded bytes' own shape: absent (not yet decoded) or
   *  `{kind:"raster"}` places the stored rect as before; `{kind:"svg"}`
   *  switches the item to an ink-tight `paths` fit (see planLabel below) —
   *  same "collab pattern" as collabItems, since an SVG custom image drawn as
   *  a rect never had bytes to embed and so never actually drew. */
  custom?: Record<string, { aspect: number; art?: PlanArt }>;
}

/** The guide lines a custom layer's anchor resolves against: the label's
 *  safe-area edges (L.SAFE), center = the midpoint of left/right. The ONE
 *  place this is computed — Task 4's drag-to-position math (model/position.ts)
 *  uses the same GuideLines shape, so a custom layer's plotted position and
 *  its drag guides can never disagree. */
export function labelGuides(): GuideLines {
  return {
    left: L.SAFE.left, right: L.SAFE.right,
    center: (L.SAFE.left + L.SAFE.right) / 2,
    top: L.SAFE.top, bottom: L.SAFE.bottom,
  };
}

/** The element's outer stroke as data (width in points). Null when off —
 *  same rules as pdf/build.ts's strokeOf: no stroke, "none", or width <= 0.
 *  Colors stay unresolved: art mode paints `fill`, mask mode paints by
 *  `layer` — that choice belongs to the backend, not the placement. */
export function strokeSpec(style: Style): StrokeSpec | null {
  if (!style.stroke || style.stroke === "none") return null;
  const px = style.strokeWidth ?? L.DEFAULT_STROKE_PX;
  if (px <= 0) return null;
  return { fill: style.stroke, layer: strokeLayerOf(style), w: px * L.PX };
}

/** One styled line as placed runs: walks the parsed runs left to right (or
 *  centered around `at.cx`), advancing x by each run's measured width plus
 *  tracking. `at.face` (the wordmark/name's forced Bold) wins over the bold
 *  flag on each run. This is the PDF backend's former drawLine, minus the
 *  drawing. */
export function lineRuns(
  id: ElementId,
  line: StyledLine,
  m: MeasureFace,
  at: ({ x: number } | { cx: number }) & { baseline: number; size: number; face?: Face },
): PlacedText[] {
  const runs = parseRuns(line);
  const faceOf = (r: StyledLine): Face => at.face ?? (r.bold ? "semibold" : "regular");
  const tracking = line.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, at.size, faceOf(r)), tracking);
  const total = advances.reduce((a, b) => a + b, 0) - tracking;
  let x = "cx" in at ? at.cx - total / 2 : at.x;
  const stroke = strokeSpec(line);
  return runs.map((run, i) => {
    const placed: PlacedText = {
      kind: "text", id, text: run.text, x, y: at.baseline,
      // The run's drawn width is its advance minus the gap to the next run.
      w: advances[i] - tracking,
      size: at.size, face: faceOf(run), tracking,
      fill: run.fill, layer: run.layer, stroke, rotated: false,
    };
    x += advances[i];
    return placed;
  });
}

/** Rotated 90° CCW text (reads bottom-to-top) as placed runs: walks the
 *  parsed runs bottom to top, advancing y by each run's measured width plus
 *  tracking (the rotation swaps the advance axis to y). `boldFace` omitted
 *  means inline `**bold**` runs keep `base` (storeCold's contract); given,
 *  they step up (info/warning). This is the PDF backend's former
 *  drawRotated, minus the drawing. */
export function rotatedRuns(
  id: ElementId,
  style: Style,
  text: string,
  m: MeasureFace,
  at: { x: number; yStart: number; size: number; base: Face; boldFace?: Face },
): PlacedText[] {
  const runs = parseRuns({ ...style, text });
  const faceOf = (r: StyledLine): Face => (r.bold ? at.boldFace ?? at.base : at.base);
  const tracking = style.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, at.size, faceOf(r)), tracking);
  const stroke = strokeSpec(style);
  let yPos = at.yStart;
  return runs.map((run, i) => {
    const placed: PlacedText = {
      kind: "text", id, text: run.text, x: at.x, y: yPos, w: advances[i] - tracking,
      size: at.size, face: faceOf(run), tracking,
      fill: run.fill, layer: run.layer, stroke, rotated: true,
    };
    yPos -= advances[i];
    return placed;
  });
}

/** A justified warning column: inter-word gaps stretched so the span lands
 *  exactly on maxLen (the PDF backend's former drawJustifiedRotated's math).
 *  Word widths measure the runs each word actually draws (markers stripped,
 *  own faces), or a bold-marked column would overshoot. A single word has no
 *  gap and stays at its natural length (see warningColumnLen). */
export function justifiedRotatedRuns(
  id: ElementId,
  style: Style,
  text: string,
  m: MeasureFace,
  at: { x: number; yStart: number; size: number; maxLen: number; base: Face; boldFace?: Face },
): PlacedText[] {
  const words = text.split(" ");
  if (words.length < 2) return rotatedRuns(id, style, text, m, at);
  const faceOf = (r: StyledLine): Face => (r.bold ? at.boldFace ?? at.base : at.base);
  const widths = words.map((w) =>
    L.runsWidth(parseRuns({ ...style, text: w }),
      (r) => m(r.text, at.size, faceOf(r)), style.letterSpacing ?? 0));
  const totalWordWidth = widths.reduce((a, b) => a + b, 0);
  const gap = (at.maxLen - totalWordWidth) / (words.length - 1);
  let cursor = at.yStart;
  return words.flatMap((w, i) => {
    const placed = rotatedRuns(id, style, w, m, { ...at, yStart: cursor });
    cursor -= widths[i] + gap;
    return placed;
  });
}

/** Which collab logo slots hold art — the same fact hittest tracks: the
 *  renderers skip an empty slot, so its text must not be planned either. */
export interface CollabSlots { left: boolean; center: boolean }

export interface PlanOpts {
  /** Elements to omit entirely (the layers-panel eyes, and the in-place
   *  editor's session element from Phase 3 on). Layout is untouched:
   *  skipping never reflows neighbours. */
  skip?: { has(id: ElementId): boolean };
  /** Which slots hold collab art. Overrides what `assets` implies, for the
   *  caller whose art is nulled out by something other than absence: the PDF
   *  build drops a hidden logo's art so no bytes reach the file, but the
   *  lead-in it introduces has its own eye and must not vanish with it. */
  collab?: CollabSlots;
  /** With assets, planLabel emits the COMPLETE display list — text, laurel,
   *  QR, collab art, barcode — in drawElements' historical draw order.
   *  Without assets: text only, gated by opts.collab — hittest's contract. */
  assets?: PlanAssets;
}

/** A collab slot's art as placed items — drawCollab's placement without the
 *  drawing: the box scaled by the slot's scale knob, offsetY nudging the
 *  flowed position, SVG fitted ink-tight by parseLogo, raster fitted by its
 *  intrinsic aspect. */
/** The two collab slots' fit ENVELOPES — the unscaled frame each slot's art
 *  aspect-fits into. The ONE spelling shared by collabItems' call sites
 *  below and the hit-tester's envelope boxes (hittest.ts), so slot placement
 *  cannot drift between draw and hit-test. The slot's scale/offsetY knobs
 *  are applied by each consumer on top, identically (see collabItems). */
export function collabLeftFrame(descLineCount: number) {
  const flow = L.collabLeftFlow(descLineCount);
  return {
    x: L.COLLAB_LEFT.x, top: flow.logoTop,
    maxW: L.COLLAB_LEFT.maxW, maxH: L.COLLAB_LEFT.maxH,
  };
}
export function collabCenterFrame(logoBottom: number) {
  return {
    cx: L.COLLAB_CENTER.cx, top: logoBottom + L.COLLAB_CENTER.gapAbove,
    maxW: L.COLLAB_CENTER.maxW, maxH: L.COLLAB_CENTER.maxH,
  };
}

function collabItems(
  id: ElementId,
  art: PlanArt,
  slot: CollabSlot,
  box: ({ x: number } | { cx: number }) & { top: number; maxW: number; maxH: number },
): Placed[] {
  const maxW = box.maxW * slot.scale;
  const maxH = box.maxH * slot.scale;
  const top = box.top + (slot.offsetY ?? 0);
  const place = (w: number) => ("cx" in box ? box.cx - w / 2 : box.x);
  if (art.kind === "svg") {
    const a = parseLogo(art.svg, maxW, maxH);
    return [{
      kind: "paths", id, paths: a.paths, x: place(a.w), y: top,
      fill: slot.fill, layer: slot.layer, stroke: strokeSpec(slot),
    }];
  }
  const s = Math.min(maxW / art.w, maxH / art.h);
  const w = art.w * s;
  const h = art.h * s;
  return [{ kind: "image", id, x: place(w), y: top, w, h }];
}

/** The barcode's placed item. Exported for the barcode tests, which assert
 *  paint behaviour against a hand-built item. */
export function barcodeItem(cfg: LabelConfig, m: MeasureFace): PlacedBarcode {
  const B = L.BARCODE;
  const measure = (t: string) => m(t, B.textSize, "regular");
  const geo = barcodeGeometry(cfg.upc, measure);
  return {
    kind: "barcode", id: "barcode", geo,
    S: barcodeStrokePt(cfg),
    fill: cfg.barcodeFill, stroke: cfg.barcodeStroke,
    fillLayer: cfg.barcodeLayer, strokeLayer: cfg.barcodeStrokeLayer,
    textSize: B.textSize, rotated: true,
    digits: geo.digits.map((d) => {
      const w = measure(d.text);
      return { text: d.text, x: d.x, y: geo.bottom - d.center * geo.mod + w / 2, w };
    }),
    footprint: barcodeFootprint(geo, 0, measure),
  };
}

// --- Custom barcode layers (Task 3) ---------------------------------------
// A custom barcode layer draws its own independent symbol rather than the
// template's UPC: barcodeGeometry itself stays untouched (its digits:[] rule
// for any supplied pattern is a standing ruling — see its own comment), so
// this is a small local geometry built directly from the layer's own
// moduleW/h, in a plain UPRIGHT layout (modules along X, digits a normal
// horizontal caption below the bars) — unlike the template's symbol, which
// lives pre-rotated into the page's vertical right column (modules along Y,
// digits rotated 90°). Both share PlacedBarcode/drawBarcode as the paint
// step; PlacedBarcode.rotated (false here, true for the template) is what
// lets the shared renderer (drawBarcode in pdf/build.ts and canvas/draw.ts,
// barcodeLayer in psd/build.ts) draw each orientation correctly instead of
// unconditionally rotating every digit glyph.

/** The pattern's runs merged into rects at the layer's own moduleW/h — the
 *  bar half of a custom barcode layer's geometry, mirroring barcodeGeometry's
 *  run-merging but plain (no guard elongation: a free-floating layer has no
 *  template-fixed digit column its guards need to clear). */
function customBarcodeBars(
  pattern: { modules: string }, x: number, yTop: number, h: number, moduleW: number,
): BarcodeGeometry["bars"] {
  const bars: BarcodeGeometry["bars"] = [];
  const { modules } = pattern;
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== "1") { i++; continue; }
    let j = i;
    while (j < modules.length && modules[j] === "1") j++;
    bars.push({ x: x + i * moduleW, yTop, w: (j - i) * moduleW, h });
    i = j;
  }
  return bars;
}

/** A custom barcode layer's hit/drag box size — the symbol plus BOTH quiet
 *  zones (quietModulesFor; zero for code-128) wide, `h` tall plus the digit
 *  band when shown — or null when its (raw,
 *  possibly unexpanded — see CustomBarcodeLayer.value) payload fails the
 *  symbology's own validator, so hittest/dragTarget2 and customBarcodeItem
 *  below can't disagree about which layers are even present. Exported so
 *  hittest.ts shares this exact sizing instead of re-deriving the digit-band
 *  math; elements.ts's dragTarget2 keeps its own small local copy of this
 *  function (customBarcodeDragBox — a runtime value-import back into plan.ts
 *  would make the two modules mutually dependent), but imports the SAME two
 *  ratio constants from barcode.ts that this function uses below, so the two
 *  copies' math cannot drift apart even though the functions themselves
 *  aren't shared. */
export function customBarcodeBox(
  layer: CustomBarcodeLayer,
): { w: number; h: number; quiet: number; pattern: ReturnType<typeof encodeFor> } | null {
  if (!validateFor(layer.symbology, layer.value).ok) return null;
  const pattern = encodeFor(layer.symbology, layer.value);
  const showDigits = layer.showDigits ?? true;
  const textSize = layer.h * CUSTOM_BARCODE_DIGIT_SIZE_RATIO;
  const gap = layer.h * CUSTOM_BARCODE_DIGIT_GAP_RATIO;
  // The box spans the quiet zone on BOTH sides, not just the printed symbol:
  // barcodeDigitsFor puts the UPC-A/EAN-13 leading digit at -quiet and the
  // UPC-A check digit at modulesLen + quiet, so a symbol-only box left both
  // outside it — a right-anchored UPC-A pushed its check digit past the trim
  // and the hit/drag box missed both edge digits. `quiet` is in modules and is
  // 0 for code-128, whose single centred caption needs no zone.
  const quiet = quietModulesFor(layer.symbology);
  return {
    w: (pattern.modules.length + 2 * quiet) * layer.moduleW,
    h: layer.h + (showDigits ? gap + textSize : 0),
    quiet,
    pattern,
  };
}

/** A custom barcode layer's placed item, or null when its (raw, possibly
 *  unexpanded — see CustomBarcodeLayer.value) payload fails the symbology's
 *  own validator: an invalid payload emits nothing, never a garbage symbol. */
export function customBarcodeItem(
  layer: CustomBarcodeLayer, m: MeasureFace, guides: GuideLines,
): PlacedBarcode | null {
  const box = customBarcodeBox(layer);
  if (!box) return null;
  const { pattern, quiet } = box;
  const showDigits = layer.showDigits ?? true;
  const textSize = layer.h * CUSTOM_BARCODE_DIGIT_SIZE_RATIO;
  const gap = layer.h * CUSTOM_BARCODE_DIGIT_GAP_RATIO;
  const x = anchoredX(layer.position, box.w, guides);
  const yTop = anchoredY(layer.position, box.h, guides);
  // Module 0 sits one quiet zone in from the box's left edge (the zone is
  // blank by definition, but the leading digit prints in it — see
  // customBarcodeBox), so every module coordinate below measures from here.
  const runX = x + quiet * layer.moduleW;
  const bars = customBarcodeBars(pattern, runX, yTop, layer.h, layer.moduleW);
  const measure = (t: string) => m(t, textSize, "regular");
  // barcodeDigitsFor's `measure` must return MODULE units (see its own
  // comment) since it has no `mod` to convert with — `measure` above is in
  // POINTS, so divide by moduleW before handing it in. Skipping this step
  // double-scaled the edge digits' (dir ±1) offset by moduleW a second time
  // once `center` gets multiplied back by moduleW below; centered groups
  // (dir 0) never combine measure with the anchor, so they were unaffected.
  const digitsRaw = showDigits
    ? barcodeDigitsFor(
        layer.symbology, layer.value, pattern.modules.length, quiet,
        (t) => measure(t) / layer.moduleW,
      )
    : [];
  // barcodeDigitsFor's `x` is a placeholder (see its own comment) — real x
  // comes from this layer's own run origin plus the group's module center.
  const geoDigits = digitsRaw.map((d) => ({ ...d, x: runX + d.center * layer.moduleW }));
  const geo: BarcodeGeometry = { mod: layer.moduleW, bottom: yTop + layer.h, bars, digits: geoDigits };
  const style = layer.style;
  const S = style.stroke && style.stroke !== "none"
    ? (style.strokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX : 0;
  // `y` is the alphabetic BASELINE — that is what all three renderers pass to
  // their text call — so it sits at the BOTTOM of the reserved digit band, not
  // its top: `+ textSize` is the last term. Full textSize (the em box) rather
  // than a cap height, because customBarcodeBox reserves exactly `gap +
  // textSize` below the bars; putting the baseline one em down makes that band
  // the glyphs' own em box, so the box and the ink describe the same
  // rectangle. Digits have no descenders, so nothing spills below it. Without
  // the term the glyph box climbed back over the bottom of the bars while the
  // reserved band printed empty.
  const digits = geoDigits.map((d) => ({
    text: d.text, x: d.x, y: yTop + layer.h + gap + textSize, w: measure(d.text),
  }));
  // Bars, plus one white-ink pill per digit group — unlike barcodeFootprint
  // (whose pill formula assumes the template's ROTATED layout, see its own
  // comment), this item is UPRIGHT: each digit's pill spans its centered run
  // width (x = d.x ± w/2, matching how the item is actually drawn — see
  // PlacedBarcode.rotated) and the font box around its baseline (FONT_ASC
  // above, FONT_DESC below, at this item's own textSize — not the template's
  // fixed BARCODE.textSize). These are BASE ink, NOT pre-outset by the halo S
  // — the same contract as the template's `barcodeFootprint(geo, 0, measure)`,
  // and the one every consumer already assumes: pdf/build.ts draws a centred
  // 2*S border on them, canvas/draw.ts strokes at lineWidth 2*outset, and
  // psd/build.ts applies an outside stroke of px(S). Outsetting here too
  // double-counted the halo on all three plates.
  const barFootprint = bars.map((b) => ({
    x: b.x, yTop: b.yTop, w: b.w, h: b.h,
  }));
  const digitFootprint = digits.map((d) => {
    const x0 = d.x - d.w / 2;
    const x1 = d.x + d.w / 2;
    const y0 = d.y - L.FONT_ASC * textSize;
    const y1 = d.y + L.FONT_DESC * textSize;
    return { x: x0, yTop: y0, w: x1 - x0, h: y1 - y0 };
  });
  return {
    kind: "barcode", id: layer.id, geo, S, rotated: false,
    fill: style.fill, stroke: style.stroke ?? "none",
    fillLayer: style.layer, strokeLayer: strokeLayerOf(style),
    textSize,
    digits,
    footprint: [...barFootprint, ...digitFootprint],
  };
}

/** Every display-list item of the label, in drawElements' order. Without
 *  `opts.assets` the list is text only — hittest's contract, and the numbers
 *  match what planLabel has always produced. With it, the laurel, QR, collab
 *  art and barcode interleave at their historical draw positions. */
export function planLabel(cfg: LabelConfig, m: MeasureFace, opts: PlanOpts = {}): Placed[] {
  const skip = (id: ElementId) => !!opts.skip?.has(id);
  const A = opts.assets;
  // One source for the slot gates: opts.collab when the caller knows which
  // slots HOLD art (hittest's booleans; the PDF build, whose art is nulled
  // out for a hidden layer), the art itself otherwise.
  const slots = opts.collab ?? { left: !!A?.collabLeft, center: !!A?.collabCenter };
  const out: Placed[] = [];

  if (!skip("volume"))
    out.push(...lineRuns("volume", cfg.volume, m,
      { x: L.VOLUME.x, baseline: L.VOLUME.baseline, size: L.VOLUME.size }));
  if (!skip("abv"))
    out.push(...lineRuns("abv", { text: `${displayAbv(cfg)}% alc by vol`, ...cfg.abvStyle }, m,
      { x: L.ABV.x, baseline: L.ABV.baseline, size: L.ABV.size }));

  const desc = parseDescription(cfg.description, cfg.descStyle);
  if (!skip("description")) {
    if (desc.header)
      out.push(...lineRuns("description", desc.header, m,
        { x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size }));
    desc.lines.forEach((line, i) =>
      out.push(...lineRuns("description", line, m,
        { x: L.DESC.x, baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size })));
  }

  // Lead-in only when there is a left logo for it to introduce — the same
  // gate drawElements applies with assets.collabLeft.
  if (slots.left && !skip("collabLead")) {
    const flow = L.collabLeftFlow(desc.lines.length);
    L.COLLAB_LEAD.lines.forEach((text, i) =>
      out.push(...lineRuns("collabLead", { text, ...cfg.collabLead, bold: true }, m,
        { x: L.COLLAB_LEAD.x, baseline: flow.leadBaselines[i], size: L.COLLAB_LEAD.size })));
  }

  // Left collab art, flowed under the lead-in — drawCollab's placement.
  if (A && A.collabLeft && !skip("collabLeft"))
    out.push(...collabItems(
      "collabLeft", A.collabLeft, cfg.collabLeft, collabLeftFrame(desc.lines.length)));

  if (!skip("wordmark"))
    out.push(...lineRuns("wordmark", { text: L.WORDMARK.text, ...cfg.wordmark, bold: true }, m,
      { cx: L.WORDMARK.cx, baseline: L.WORDMARK.baseline, size: L.WORDMARK.size, face: "bold" }));

  // The laurel, and the centre collab mark hanging off its nudged bottom.
  // Geometry is computed even when the laurel is skipped: the centre mark
  // hangs off logoCy, and hiding the laurel must not move it.
  if (A) {
    const logo = parseLogo(A.logoSvg, L.LOGO.w);
    const logoCy = L.LOGO.cy + logoNudge(cfg);
    if (!skip("logo"))
      out.push({
        kind: "paths", id: "logo", paths: logo.paths,
        x: L.LOGO.cx - logo.w / 2, y: logoCy - logo.h / 2,
        fill: cfg.logo.fill, layer: cfg.logo.layer, stroke: strokeSpec(cfg.logo),
      });
    if (A.collabCenter && !skip("collabCenter"))
      out.push(...collabItems("collabCenter", A.collabCenter, cfg.collabCenter,
        collabCenterFrame(logoCy + logo.h / 2)));
  }

  if (!skip("name"))
    out.push(...lineRuns("name", { text: displayName(cfg).toUpperCase(), ...cfg.nameStyle, bold: true }, m,
      { cx: L.NAME.cx, baseline: L.NAME.baseline, size: L.NAME.size, face: "bold" }));
  if (!skip("styleLine"))
    out.push(...lineRuns("styleLine", { ...cfg.styleLine, text: displayStyle(cfg) }, m,
      { cx: L.STYLE_LINE.cx, baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size }));

  const info = parseInfoLine(cfg.handleAddress.text, cfg.handleAddress);
  if (!skip("handleAddress"))
    out.push(...rotatedRuns("handleAddress", info, info.text, m, {
      x: L.HANDLE_ADDR.x, yStart: L.HANDLE_ADDR.yStart, size: L.HANDLE_ADDR.size,
      base: info.bold ? "bold" : "semibold", boldFace: "bold",
    }));

  // Wrapping measures with the warning's own tracking and inline runs — the
  // exact measure both renderers and hittest wrap with today.
  if (!skip("warning")) {
    const warnLines = wrapWarning(
      warningMeasure((t, bold) => m(t, L.WARNING.size, bold ? "bold" : "regular"),
        cfg.warning.letterSpacing),
      L.WARNING.maxLen,
    );
    warnLines.forEach((line, i) =>
      out.push(...justifiedRotatedRuns("warning", cfg.warning, line, m, {
        x: L.WARNING.x + i * L.WARNING.leading, yStart: L.WARNING.yStart,
        size: L.WARNING.size, maxLen: L.WARNING.maxLen, base: "regular", boldFace: "bold",
      })));
  }

  if (!skip("storeCold"))
    // No boldFace: drawElements passes no boldFont here, so markers keep the
    // line's own face.
    out.push(...rotatedRuns("storeCold", cfg.storeCold, cfg.storeCold.text, m, {
      x: L.STORE_COLD.x, yStart: L.STORE_COLD.yStart, size: L.STORE_COLD.size,
      base: cfg.storeCold.bold ? "bold" : "semibold",
    }));

  // QR — payload derived from the beer name; the stroked underlay is its own
  // paths item (the grow'd path IS the stroke, so the item itself is unstroked).
  if (A && !skip("qr")) {
    const shapes = qrShapes(qrUrl(displayName(cfg)));
    const at = { x: L.QR.x, y: L.QR.yTop };
    if (cfg.qrStroke !== "none")
      out.push({
        kind: "paths", id: "qr", ...at, stroke: null,
        paths: [qrPath(shapes, L.QR.size, (cfg.qrStrokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX)],
        fill: cfg.qrStroke, layer: cfg.qrStrokeLayer,
      });
    out.push({
      kind: "paths", id: "qr", ...at, stroke: null,
      paths: [qrPath(shapes, L.QR.size)], fill: cfg.qrFill, layer: cfg.qrLayer,
    });
  }

  if (A && !skip("barcode")) out.push(barcodeItem(cfg, m));

  // Master-variant custom layers — appended last so they draw on top of
  // every fixed element, in the order they're stored. Absent/empty
  // customLayers is a no-op: nothing appends, so the plan is byte-for-byte
  // the pre-feature list (the regression lock plan.test.ts checks).
  for (const layer of cfg.customLayers ?? []) {
    if (skip(layer.id)) continue;
    const guides = labelGuides();
    if (layer.type === "text") {
      const runs = parseRuns(layer.line);
      const faceOf = (r: StyledLine): Face => (r.bold ? "semibold" : "regular");
      const tracking = layer.line.letterSpacing ?? 0;
      const tw = L.runsWidth(runs, (r) => m(r.text, layer.size, faceOf(r)), tracking);
      out.push(...lineRuns(layer.id, layer.line, m, {
        x: anchoredX(layer.position, tw, guides),
        baseline: anchoredY(layer.position, layer.size, guides) + layer.size,
        size: layer.size,
      }));
    } else if (layer.type === "image") {
      const entry = A?.custom?.[layer.asset];
      if (entry?.art?.kind === "svg") {
        // SVG custom art has no raster bytes to embed (see the "image" arm
        // below and its backends' no-op guard for an SVG asset) — it plans
        // as a `paths` item instead, ink-tight fitted to the layer's own box
        // width, exactly like collabItems' SVG branch. `paths` items are
        // backend-generic (pdf/build.ts and canvas/draw.ts already draw any
        // `paths` item, no id-specific handling), so this needs no backend
        // work — only planLabel's placement changes.
        const a = parseLogo(entry.art.svg, layer.w);
        out.push({
          kind: "paths", id: layer.id, paths: a.paths,
          x: anchoredX(layer.position, a.w, guides),
          y: anchoredY(layer.position, a.h, guides),
          fill: layer.style.fill, layer: layer.style.layer, stroke: strokeSpec(layer.style),
        });
      } else {
        // The loaded asset's aspect wins when it's available; otherwise fall
        // back to the layer's own stored aspect (captured at drop time) so
        // the rect — and with it selection/hit/drag — exists before (or
        // without) bytes ever loading. Backends resolve the bytes themselves
        // by `asset`, and no-op when they have none.
        const aspect = entry?.aspect ?? layer.aspect;
        if (aspect === undefined) continue;
        const h = layer.w / aspect;
        out.push({
          kind: "image", id: layer.id, asset: layer.asset,
          x: anchoredX(layer.position, layer.w, guides),
          y: anchoredY(layer.position, h, guides),
          w: layer.w, h,
        });
      }
    } else if (layer.type === "barcode") {
      const item = customBarcodeItem(layer, m, guides);
      if (item) out.push(item);
    } else {
      // "qr" — plain stroke-underlay + fill `paths` items, exactly like the
      // template QR (see above): no backend changes needed, `paths` is
      // universal. EC level defaults to "M" for layers (P2) — the module-
      // level qrShapes default of "L" stays the template QR's own default,
      // unrelated to this layer type.
      const shapes = qrShapes(layer.value, { style: layer.qrStyle, ecLevel: layer.ecLevel ?? "M" });
      const at = { x: anchoredX(layer.position, layer.size, guides), y: anchoredY(layer.position, layer.size, guides) };
      const style = layer.style;
      if (style.stroke && style.stroke !== "none")
        out.push({
          kind: "paths", id: layer.id, ...at, stroke: null,
          paths: [qrPath(shapes, layer.size, (style.strokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX)],
          fill: style.stroke, layer: strokeLayerOf(style),
        });
      out.push({
        kind: "paths", id: layer.id, ...at, stroke: null,
        paths: [qrPath(shapes, layer.size)], fill: style.fill, layer: style.layer,
      });
    }
  }

  return out;
}
