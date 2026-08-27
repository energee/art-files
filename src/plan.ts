// plan.ts — the label's display list: WHERE every element draws, computed
// once, renderer-agnostically. pdf/build.ts and hittest.ts both consume it
// (the canvas backend joins in Phase 2 — see the 2026-08-25 canvas preview
// renderer spec), so placement cannot drift between what is drawn, hit-
// tested, and exported. Coordinates are label-space points with a TOP-LEFT
// origin; backends convert (the PDF's y-flip stays in pdf/build.ts).
// Measurement is injected: the PDF backend passes PDFFont metrics so built
// bytes place text exactly as before, the UI passes the fonts.ts canvas
// metrics — the same split hittest always had.
import type { CollabSlot, Fill, Style, StyledLine, LabelConfig } from "./types";
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
import { barcodeFootprint, barcodeGeometry, barcodeStrokePt, type BarcodeGeometry } from "./barcode";

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
}

/** The barcode as one item: shared geometry plus everything both plates
 *  paint from. Genuinely mode-asymmetric (art = stroked bars+digits, mask =
 *  the outset footprint), so it stays one item rather than mode-dependent
 *  primitives — the backends keep their paint logic, the geometry exists
 *  once. `digits` follow the rotated-run convention: x is the baseline's
 *  vertical line, y the run's start, extent -w. */
export interface PlacedBarcode {
  readonly kind: "barcode";
  readonly id: "barcode";
  readonly geo: BarcodeGeometry;
  /** Resolved halo width in points; 0 = no halo at all. */
  readonly S: number;
  readonly fill: Fill;
  readonly stroke: Fill;
  readonly fillLayer: Style["layer"];
  readonly strokeLayer: Style["layer"];
  readonly textSize: number;
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
  /** Custom image layers' intrinsic aspect (w/h), keyed by CustomImageLayer's
   *  `asset`. A layer whose key is absent here emits nothing (collab-art
   *  contract) — the asset hasn't loaded/isn't supplied. */
  custom?: Record<string, { aspect: number }>;
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
    textSize: B.textSize,
    digits: geo.digits.map((d) => {
      const w = measure(d.text);
      return { text: d.text, x: d.x, y: geo.bottom - d.center * geo.mod + w / 2, w };
    }),
    footprint: barcodeFootprint(geo, 0, measure),
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
  if (cfg.collabEnabled && slots.left && !skip("collabLead")) {
    const flow = L.collabLeftFlow(desc.lines.length);
    L.COLLAB_LEAD.lines.forEach((text, i) =>
      out.push(...lineRuns("collabLead", { text, ...cfg.collabLead, bold: true }, m,
        { x: L.COLLAB_LEAD.x, baseline: flow.leadBaselines[i], size: L.COLLAB_LEAD.size })));
  }

  // Left collab art, flowed under the lead-in — drawCollab's placement.
  if (A && cfg.collabEnabled && A.collabLeft && !skip("collabLeft"))
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
    if (cfg.collabEnabled && A.collabCenter && !skip("collabCenter"))
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

  // Master-variation custom layers — appended last so they draw on top of
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
    } else {
      const asset = A?.custom?.[layer.asset];
      if (!asset) continue;
      const h = layer.w / asset.aspect;
      out.push({
        kind: "image", id: layer.id,
        x: anchoredX(layer.position, layer.w, guides),
        y: anchoredY(layer.position, h, guides),
        w: layer.w, h,
      });
    }
  }

  return out;
}
