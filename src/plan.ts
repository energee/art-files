// plan.ts — the label's display list: WHERE every text run draws, computed
// once, renderer-agnostically. pdf/build.ts and hittest.ts both consume it
// (the canvas backend joins in Phase 2 — see the 2026-08-25 canvas preview
// renderer spec), so placement cannot drift between what is drawn, hit-
// tested, and exported. Coordinates are label-space points with a TOP-LEFT
// origin; backends convert (the PDF's y-flip stays in pdf/build.ts).
// Measurement is injected: the PDF backend passes PDFFont metrics so built
// bytes place text exactly as before, the UI passes the fonts.ts canvas
// metrics — the same split hittest always had.
import type { Fill, Style, StyledLine, LabelConfig } from "./types";
import type { ElementId } from "./elements";
import { parseRuns } from "./description";
import { strokeLayerOf } from "./strokes";
import * as L from "./layout";
import { displayAbv, displayName, displayStyle } from "./defaults";
import { parseDescription, parseInfoLine } from "./description";
import { warningMeasure, wrapWarning } from "./warning";

export type Face = "regular" | "semibold" | "bold";
export type MeasureFace = (text: string, size: number, face: Face) => number;

export type StrokeSpec = { fill: Fill; layer: Style["layer"]; w: number };

export interface PlacedText {
  id: ElementId;
  text: string;
  /** Unrotated: run's left edge / baseline. Rotated (reads bottom-to-top):
   *  x is the baseline's vertical line, y is where the run STARTS, and the
   *  run extends toward smaller y by `w`. */
  x: number;
  y: number;
  /** Drawn width of this run — tracked, without the trailing gap. */
  w: number;
  size: number;
  face: Face;
  tracking: number;
  fill: Fill;
  layer: Style["layer"];
  stroke: StrokeSpec | null;
  rotated: boolean;
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
  at: { x?: number; cx?: number; baseline: number; size: number; face?: Face },
): PlacedText[] {
  const runs = parseRuns(line);
  const faceOf = (r: StyledLine): Face => at.face ?? (r.bold ? "semibold" : "regular");
  const tracking = line.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, at.size, faceOf(r)), tracking);
  const total = advances.reduce((a, b) => a + b, 0) - tracking;
  let x = at.cx !== undefined ? at.cx - total / 2 : at.x!;
  const stroke = strokeSpec(line);
  return runs.map((run, i) => {
    const placed: PlacedText = {
      id, text: run.text, x, y: at.baseline,
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
      id, text: run.text, x: at.x, y: yPos, w: advances[i] - tracking,
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
  collab?: CollabSlots;
}

/** Every text run of the label, in drawElements' order. Non-text elements
 *  (logo, QR, barcode, collab images) are not planned yet — Phase 2. */
export function planLabel(cfg: LabelConfig, m: MeasureFace, opts: PlanOpts = {}): PlacedText[] {
  const skip = (id: ElementId) => !!opts.skip?.has(id);
  const out: PlacedText[] = [];

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
  if (cfg.collabEnabled && opts.collab?.left && !skip("collabLead")) {
    const flow = L.collabLeftFlow(desc.lines.length);
    L.COLLAB_LEAD.lines.forEach((text, i) =>
      out.push(...lineRuns("collabLead", { text, ...cfg.collabLead, bold: true }, m,
        { x: L.COLLAB_LEAD.x, baseline: flow.leadBaselines[i], size: L.COLLAB_LEAD.size })));
  }

  if (!skip("wordmark"))
    out.push(...lineRuns("wordmark", { text: L.WORDMARK.text, ...cfg.wordmark, bold: true }, m,
      { cx: L.WORDMARK.cx, baseline: L.WORDMARK.baseline, size: L.WORDMARK.size, face: "bold" }));
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

  return out;
}
