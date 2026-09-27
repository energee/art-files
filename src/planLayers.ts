// planLayers.ts — the display list for v3 layers (spec: "Renderer"): one
// placement path per layer `kind`, no built-in ids. Every layer is measured
// (its box as it sits on the page), placeLayers resolves x/y — anchors and
// `below` bindings — and each layer emits the SAME Placed items plan.ts's
// planLabel emits today (text runs, rotated runs, paths, image rects, the
// barcode item), in array order, so pdf/build.ts, psd/build.ts and
// canvas/draw.ts consume the list unchanged. The one new item is `page`:
// the background texture and metallic mask, which no Placed variant could
// express (see PlacedPage). Coordinates are label-space points, top-left
// origin, at the master's bleed; the backends add BLEED_SHIFT as before.
// Measurement is injected (MeasureFace), like planLabel. Format strings in
// barcode/qr values are already expanded by the caller (resolveLayers).
import type {
  BarcodeLayer, ImageLayer, Layer, QrLayer, TextLayer, TextLine,
} from "./model/layers";
import { uppercaseOf } from "./model/layers";
import type { StyledLine } from "./types";
import { placeLayers, type Box } from "./model/place";
import { anchorFraction } from "./model/position";
import {
  justifiedRotatedRuns, rotatedRuns, strokeSpec,
  type Face, type MeasureFace, type Placed, type PlacedBarcode, type PlacedText, type PlanAssets,
} from "./plan";
import { markedWords, parseRuns, printableText } from "./description";
import { strokeLayerOf } from "./strokes";
import { parseLogo } from "./logo";
import { qrPaths, qrShapes } from "./qr";
import {
  barcodeDigitsFor, CUSTOM_BARCODE_DIGIT_GAP_RATIO, CUSTOM_BARCODE_DIGIT_SIZE_RATIO,
  encodeFor, quietModulesFor, validateFor, type BarcodeGeometry,
} from "./barcode";
import * as L from "./layout";

/** Full-page raster art: the background texture (drawn on the art plate
 *  only) or the metallic mask (drawn on the mask plate only), cover-fit to
 *  the page — L.coverFit's rect, which is what buildArtPdf / buildMaskPdf /
 *  the canvas backend compute themselves today. A plain `image` item cannot
 *  stand in: its contract paints the rect white-ink blue on the mask plate,
 *  which is wrong for both roles. Absent (no asset loaded) = today's
 *  fallback: bare stock for the background, the white-ink flood for the
 *  mask. */
export interface PlacedPage {
  readonly kind: "page";
  readonly id: string;
  readonly role: "background" | "mask";
  readonly asset: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type PlacedLayer = Placed | PlacedPage;

/** Plain and bold run faces; the master owns the family. */
export interface TextFaces { base: Face; bold: Face }
export const DEFAULT_FACES: TextFaces = { base: "regular", bold: "semibold" };
export const facesOf = (l: TextLayer): TextFaces => l.faces ?? DEFAULT_FACES;

const ASC = L.FONT_ASC;
const DESC = L.FONT_DESC;

/** A measured layer: its page box size, and how to emit it once placed.
 *  Null = draws nothing (empty asset, invalid payload) and occupies a
 *  zero box at its position, so a binding below it still resolves. */
interface Prepared { size: { w: number; h: number }; emit(box: Box): PlacedLayer[] }

// --- text -----------------------------------------------------------------

/** The lines a text layer actually draws: the placeholder when every line is
 *  empty, the suffix on the first line, uppercase applied, and every line
 *  carrying the layer's block style (stroke, tracking) under its own fill /
 *  layer / bold. A header line is bold, as the description's `# ` line has
 *  always been. Control characters are settled here too (printableText):
 *  label values arrive clean from resolveLayers, but master-authored lines,
 *  placeholders and suffixes do not. */
function drawableLines(l: TextLayer): TextLine[] {
  const s = l.style;
  let lines = l.lines;
  if (l.placeholder && lines.every((ln) => !printableText(ln.text).trim()))
    lines = [{ ...(lines[0] ?? { fill: s.fill, layer: s.layer }), text: l.placeholder }];
  if (l.suffix)
    lines = lines.length
      ? [{ ...lines[0], text: lines[0].text + l.suffix }, ...lines.slice(1)]
      : [{ fill: s.fill, layer: s.layer, text: l.suffix }];
  return lines.map((ln) => ({
    ...ln,
    text: printableText(uppercaseOf(l) ? ln.text.toUpperCase() : ln.text),
    bold: !!ln.bold || !!ln.header,
    stroke: s.stroke, strokeLayer: s.strokeLayer, strokeWidth: s.strokeWidth,
    letterSpacing: s.letterSpacing,
  }));
}

/** Greedy word wrap to `width`, wrapWarning's rule: a line that fits stays
 *  whole; a longer one breaks before the word that overflows. Words split
 *  via markedWords; measures the joined text so runs keep their faces. */
function wrap(lines: TextLine[], widthOf: (ln: TextLine) => number, width?: number): (TextLine & { paragraphEnd?: boolean })[] {
  if (width === undefined) return lines.map((ln) => ({ ...ln, paragraphEnd: true }));
  return lines.flatMap((ln) => {
    if (widthOf(ln) <= width) return [{ ...ln, paragraphEnd: true }];
    const out: (TextLine & { paragraphEnd?: boolean })[] = [];
    let cur = "";
    for (const word of markedWords(ln.text)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && widthOf({ ...ln, text: next }) > width) { out.push({ ...ln, text: cur }); cur = word; }
      else cur = next;
    }
    if (cur) out.push({ ...ln, text: cur, paragraphEnd: true });
    return out;
  });
}

/** One unrotated line as placed runs from `x` — lineRuns' walk with the
 *  layer's face pair instead of its forced-face / bold-means-semibold rule. */
function lineAt(
  id: string, line: StyledLine, m: MeasureFace, faceOf: (r: StyledLine) => Face,
  x: number, baseline: number, size: number,
): PlacedText[] {
  const runs = parseRuns(line);
  const tracking = line.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, size, faceOf(r)), tracking);
  const stroke = strokeSpec(line);
  let at = x;
  return runs.map((run, i) => {
    const placed: PlacedText = {
      kind: "text", id, text: run.text, x: at, y: baseline, w: advances[i] - tracking,
      size, face: faceOf(run), tracking, fill: run.fill, layer: run.layer, stroke, rotated: false,
    };
    at += advances[i];
    return placed;
  });
}

function prepareText(l: TextLayer, measure: MeasureFace): Prepared {
  const m: MeasureFace = (text, size, face) => measure(text, size, face, l.fontFamily);
  const id = l.id;
  const faces = facesOf(l);
  const faceOf = (r: StyledLine): Face => (r.bold ? faces.bold : faces.base);
  const tracking = l.style.letterSpacing ?? 0;
  const sizeOf = (ln: TextLine) => (ln.header ? l.size * (l.headerScale ?? 1) : l.size);
  const widthOf = (ln: TextLine) =>
    L.runsWidth(parseRuns(ln), (r) => m(r.text, sizeOf(ln), faceOf(r)), tracking);
  const lines = wrap(drawableLines(l), widthOf, l.width);
  const widths = lines.map(widthOf);
  const n = lines.length;
  const leading = (l.leading ?? 1.2) * l.size;
  const first = n ? sizeOf(lines[0]) : l.size;
  const last = n ? sizeOf(lines[n - 1]) : l.size;
  // Extent along the reading direction (the declared width, else the widest
  // line) and across it (first ascender, the baseline grid, last descender).
  const along = l.width ?? (n ? Math.max(...widths) : 0);
  const across = n ? ASC * first + (n - 1) * leading + DESC * last : 0;
  const rotated = l.rotation === 90;
  return {
    size: rotated ? { w: across, h: along } : { w: along, h: across },
    emit(box) {
      const out: PlacedText[] = [];
      lines.forEach((ln, i) => {
        const size = sizeOf(ln);
        const lw = widths[i];
        const justify = l.align === "justify" && !ln.paragraphEnd && ln.text.includes(" ");
        if (rotated) {
          // Columns step right by the leading; each reads bottom-to-top from
          // the box bottom (left), or ends at its top (right).
          const x = box.x + ASC * first + i * leading;
          const bottom = box.y + box.h;
          const at = { x, size, base: faces.base, boldFace: faces.bold };
          if (justify) out.push(...justifiedRotatedRuns(id, ln, ln.text, m, { ...at, yStart: bottom, maxLen: along }));
          else {
            const yStart = l.align === "center" ? bottom - (along - lw) / 2
              : l.align === "right" ? box.y + lw : bottom;
            out.push(...rotatedRuns(id, ln, ln.text, m, { ...at, yStart }));
          }
          return;
        }
        const baseline = box.y + ASC * first + i * leading;
        if (justify) {
          const words = markedWords(ln.text);
          const ww = words.map((w) => widthOf({ ...ln, text: w }));
          const gap = (box.w - ww.reduce((a, b) => a + b, 0)) / (words.length - 1);
          let cursor = box.x;
          words.forEach((w, k) => {
            out.push(...lineAt(id, { ...ln, text: w }, m, faceOf, cursor, baseline, size));
            cursor += ww[k] + gap;
          });
          return;
        }
        const x = l.align === "center" ? box.x + (box.w - lw) / 2
          : l.align === "right" ? box.x + box.w - lw : box.x;
        out.push(...lineAt(id, ln, m, faceOf, x, baseline, size));
      });
      return l.fontFamily ? out.map((run) => ({ ...run, fontFamily: l.fontFamily })) : out;
    },
  };
}

/** Text-only measurement uses the exact export preparation, without needing
 *  sibling layers to resolve bindings or image assets to load. */
export function planText(layer: TextLayer, measure: MeasureFace): PlacedText[] {
  const prepared = prepareText(layer, measure);
  return prepared.emit({ x: 0, y: 0, ...prepared.size }) as PlacedText[];
}

// --- image ----------------------------------------------------------------

function prepareImage(l: ImageLayer, assets: PlanAssets): Prepared | null {
  const id = l.id;
  if (!l.asset) return null;
  if (l.role === "background" || l.role === "mask") {
    const entry = assets.custom?.[l.asset];
    if (!entry) return null;
    const rect = L.coverFit(entry.aspect, 1);
    const role = l.role;
    return { size: { w: rect.w, h: rect.h }, emit: () => [{ kind: "page", id, role, asset: l.asset, ...rect }] };
  }
  if (l.asset === "builtin:logo") {
    const a = parseLogo(assets.logoSvg, l.w);
    return {
      size: { w: a.w, h: a.h },
      emit: (box) => [{
        kind: "paths", id, paths: a.paths, x: box.x, y: box.y,
        fill: l.style.fill, layer: l.style.layer, stroke: strokeSpec(l.style),
      }],
    };
  }
  const entry = assets.custom?.[l.asset];
  if (!entry) return null;
  // The envelope the art contain-fits into: w x h (h absent = the asset's
  // aspect at w), times the scale knob. The envelope is the layer's box; the
  // fitted art sits at its top, on the anchor's side.
  const scale = l.scale ?? 1;
  const maxW = l.w * scale;
  const maxH = (l.h ?? l.w / entry.aspect) * scale;
  const placeX = (box: Box, w: number) => box.x + anchorFraction(l.anchor) * (box.w - w);
  const size = { w: maxW, h: maxH };
  if (entry.art?.kind === "svg") {
    const a = parseLogo(entry.art.svg, maxW, maxH);
    return {
      size,
      emit: (box) => [{
        kind: "paths", id, paths: a.paths, x: placeX(box, a.w), y: box.y,
        fill: l.style.fill, layer: l.style.layer, stroke: strokeSpec(l.style),
      }],
    };
  }
  const s = Math.min(maxW / entry.aspect, maxH);
  const w = entry.aspect * s;
  const h = s;
  return { size, emit: (box) => [{ kind: "image", id, asset: l.asset, x: placeX(box, w), y: box.y, w, h }] };
}

// --- barcode --------------------------------------------------------------

/** One geometry for both orientations. Upright = the custom-layer layout
 *  (modules along X, digits a horizontal caption below); rotation 90 = the
 *  template's (modules along Y reading bottom-to-top, digits turned with
 *  them, baseline at the plate's right edge). JsBarcode's UPC-A/EAN-13 rule
 *  for the guards applies in both: with digits shown, start/center/end
 *  guards run long through the digit band. */
function prepareBarcode(l: BarcodeLayer, m: MeasureFace): Prepared | null {
  if (!validateFor(l.symbology, l.value).ok) return null;
  const id = l.id;
  const { modules, guards } = encodeFor(l.symbology, l.value);
  const inGuard = (i: number) => guards.some(([a, b]) => i >= a && i < b);
  const mod = l.moduleW;
  const quiet = quietModulesFor(l.symbology);
  const showDigits = l.showDigits ?? true;
  const textSize = l.h * CUSTOM_BARCODE_DIGIT_SIZE_RATIO;
  const gap = l.h * CUSTOM_BARCODE_DIGIT_GAP_RATIO;
  const depth = l.h + (showDigits ? gap + textSize : 0);
  const guardLen = showDigits ? l.h + textSize / 2 + gap : l.h;
  const runLen = (modules.length + 2 * quiet) * mod;
  const rotated = l.rotation === 90;
  const measure = (t: string) => m(t, textSize, "regular");
  const style = l.style;
  const S = style.stroke && style.stroke !== "none" ? (style.strokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX : 0;
  // Merged runs of dark modules, never across a guard boundary, so the tall
  // guard groups stay square-ended.
  const runs: [number, number][] = [];
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== "1") { i++; continue; }
    let j = i;
    while (j < modules.length && modules[j] === "1" && inGuard(j) === inGuard(i)) j++;
    runs.push([i, j]);
    i = j;
  }
  const digitsRaw = showDigits
    ? barcodeDigitsFor(l.symbology, l.value, modules.length, quiet, (t) => measure(t) / mod)
    : [];
  const item = (geo: BarcodeGeometry, digits: PlacedBarcode["digits"], footprint: PlacedBarcode["footprint"]): PlacedBarcode => ({
    kind: "barcode", id, geo, S, rotated,
    fill: style.fill, stroke: style.stroke ?? "none",
    fillLayer: style.layer, strokeLayer: strokeLayerOf(style),
    textSize, digits, footprint,
  });
  if (rotated) {
    return {
      size: { w: depth, h: runLen },
      emit(box) {
        const bottom = box.y + runLen - quiet * mod;
        const bars = runs.map(([i, j]) => ({
          x: box.x, yTop: bottom - j * mod, w: inGuard(i) ? guardLen : l.h, h: (j - i) * mod,
        }));
        const baseX = box.x + depth;
        const geo: BarcodeGeometry = { mod, bottom, bars, digits: digitsRaw.map((d) => ({ ...d, x: baseX })) };
        const digits = geo.digits.map((d) => {
          const w = measure(d.text);
          return { text: d.text, x: d.x, y: bottom - d.center * mod + w / 2, w };
        });
        // The rotated run's measured width is the pill's height, centred on
        // the group's centre module; the font box spans it crosswise.
        const pills = geo.digits.map((d) => {
          const len = measure(d.text);
          const x0 = d.x - ASC * textSize;
          const yc = bottom - d.center * mod;
          return { x: x0, yTop: yc - len / 2, w: (ASC + DESC) * textSize, h: len };
        });
        return [item(geo, digits, [...bars, ...pills])];
      },
    };
  }
  return {
    size: { w: runLen, h: depth },
    emit(box) {
      const runX = box.x + quiet * mod;
      const bars = runs.map(([i, j]) => ({
        x: runX + i * mod, yTop: box.y, w: (j - i) * mod, h: inGuard(i) ? guardLen : l.h,
      }));
      const geo: BarcodeGeometry = {
        mod, bottom: box.y + l.h, bars,
        digits: digitsRaw.map((d) => ({ ...d, x: runX + d.center * mod })),
      };
      // Baseline one em below the reserved band's top, so the band IS the
      // glyphs' em box (see customBarcodeItem).
      const digits = geo.digits.map((d) => ({
        text: d.text, x: d.x, y: box.y + l.h + gap + textSize, w: measure(d.text),
      }));
      const pills = digits.map((d) => ({
        x: d.x - d.w / 2, yTop: d.y - ASC * textSize, w: d.w, h: (ASC + DESC) * textSize,
      }));
      return [item(geo, digits, [...bars, ...pills])];
    },
  };
}

// --- qr -------------------------------------------------------------------

/** Null for an empty value (no modules), like an invalid barcode. */
function prepareQr(l: QrLayer): Prepared | null {
  const id = l.id;
  const shapes = qrShapes(l.value, { style: l.qrStyle, ecLevel: l.ecLevel ?? "L", rotation: l.rotation });
  if (shapes.count === 0) return null;
  const style = l.style;
  return {
    size: { w: l.size, h: l.size },
    emit(box) {
      const at = { x: box.x, y: box.y };
      const out: PlacedLayer[] = [];
      // The stroke is its own grown path under the modules, so both items
      // are unstroked (the template QR's rule).
      if (style.stroke && style.stroke !== "none")
        out.push({
          kind: "paths", id, ...at, stroke: null,
          paths: qrPaths(shapes, l.size, (style.strokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX),
          fill: style.stroke, layer: strokeLayerOf(style),
        });
      out.push({ kind: "paths", id, ...at, stroke: null, paths: qrPaths(shapes, l.size), fill: style.fill, layer: style.layer });
      return out;
    },
  };
}

// --- the list -------------------------------------------------------------

function prepare(l: Layer, m: MeasureFace, assets: PlanAssets): Prepared | null {
  switch (l.kind) {
    case "text": return prepareText(l, m);
    case "image": return prepareImage(l, assets);
    case "barcode": return prepareBarcode(l, m);
    case "qr": return prepareQr(l);
  }
}

function layout(layers: Layer[], m: MeasureFace, assets: PlanAssets) {
  const prepared = new Map(layers.map((l) => [l.id, prepare(l, m, assets)]));
  const boxes = placeLayers(layers, (l) => prepared.get(l.id)?.size ?? { w: 0, h: 0 }, assets.guides);
  return { prepared, boxes };
}

/** Every layer's resolved box, keyed by id — what hittestLayers.ts draws its
 *  boxes from, so a hit box cannot drift from the artwork. */
export function layerBoxes(layers: Layer[], m: MeasureFace, assets: PlanAssets): Map<string, Box> {
  return layout(layers, m, assets).boxes;
}

export interface PlanLayersOpts {
  /** Layers to omit from the list (the in-place editor's session layer).
   *  Layout is untouched: a skipped layer still holds its box, so nothing
   *  bound below it moves. Disabled layers are the caller's to drop. */
  skip?: { has(id: string): boolean };
}

/** The complete display list, in array (draw) order. */
export function planLayerScene(
  layers: Layer[], m: MeasureFace, assets: PlanAssets, opts: PlanLayersOpts = {},
): { items: PlacedLayer[]; boxes: Map<string, Box> } {
  const { prepared, boxes } = layout(layers, m, assets);
  const out: PlacedLayer[] = [];
  for (const l of layers) {
    if (opts.skip?.has(l.id)) continue;
    const p = prepared.get(l.id);
    if (p) out.push(...p.emit(boxes.get(l.id)!));
  }
  return { items: out, boxes };
}

/** Display-list-only callers use the same measured scene as the preview. */
export function planLayers(
  layers: Layer[], m: MeasureFace, assets: PlanAssets, opts: PlanLayersOpts = {},
): PlacedLayer[] {
  return planLayerScene(layers, m, assets, opts).items;
}
