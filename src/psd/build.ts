// build.ts — builds the layered Photoshop deliverable with ag-psd. Same
// LabelConfig and same layout.ts geometry as the PDF builder, re-expressed as
// PSD layers: every text element becomes an editable type layer except the
// barcode, the logo / QR / barcode bars+digits become vector shape layers
// (bezier paths, node-editable), and the texture is the one honest raster
// layer.
//
// Placement (where every element sits) comes from plan.ts's planLabel — the
// same display list pdf/build.ts and hittest.ts consume — via a pdf-lib
// MeasureFace mirroring the PDF backend's, so text/logo/barcode positions
// cannot drift from the other renderers. This file re-derives its OWN QR
// shapes and warning wrap (see the comments at qrShapes/wrapWarning below)
// because it draws them as different structures than the plan's flat items.
//
// The barcode is ONE merged shape layer (Task 9b): bars and digit glyph
// outlines in a single vectorMask, fill from cfg.barcodeFill. The digits are
// bezier outlines, not editable type — an explicit, user-approved tradeoff
// for a print-ready single-shape barcode. Its halo is the same editable
// stroke EFFECT every other element uses (strokeEffect, position outside),
// including the independently painted effect on the mask PSD; omitted when
// the resolved stroke width is 0 (cfg.barcodeStroke === "none" or an explicit
// zero width).
//
// Coordinates: layout.ts is already top-left origin with y down, which is
// exactly PSD's convention, so conversion is a plain 600dpi scale with no
// axis flip. Bezier knot points are [ctrlInX, ctrlInY, anchorX, anchorY,
// ctrlOutX, ctrlOutY] in document pixels.
//
// Rotated text rides on the layer's affine transform. Do NOT reach for
// ag-psd's `orientation: 'vertical'` — that is CJK vertical writing and its
// own docs warn it can emit a broken file.
import { PDFDocument, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
// writePsdUint8Array, not writePsdBuffer — the latter returns a Node Buffer
// and throws "Buffer not supported on this platform" in the browser.
import { writePsdUint8Array, type BezierPath, type Layer, type Psd } from "ag-psd";
import type { Fill, LabelConfig, StyledLine } from "../types";
import { displayAbv, displayName, displayStyle } from "../defaults";
import type { ElementId } from "../elements";
import { FONT_FAMILIES, fontFamilyOf } from "../fontCatalog";
import * as L from "../layout";
import { parseDescription, parseInfoLine, parseRuns } from "../description";
import {
  labelGuides, planLabel,
  type MeasureFace, type Placed, type PlacedBarcode, type PlanArt,
} from "../plan";
import { anchoredX, anchoredY } from "../model/position";
import { qrShapes, qrUrl, type QrShapes } from "../qr";
import { strokeLayerOf } from "../strokes";
import { warningMeasure, wrapWarning } from "../warning";

export interface PsdAssets {
  fonts: { regular: Uint8Array; semibold: Uint8Array; bold: Uint8Array };
  /** Raw contents of logo2025.svg. */
  logoSvg: string;
  /** Decoded RGBA texture, placed centred. PSD layers hold pixels 1:1, so
   *  nothing here rescales — a caller wanting full coverage pre-scales to
   *  PSD_DOC (the browser does, via canvas; the Node CLI has no resampler
   *  and passes native pixels, which then sit centred).
   *  Omitted leaves the background empty, like a PDF built without one. */
  texture?: { data: Uint8Array; width: number; height: number };
  /** Decoded RGBA of the uploaded mask, passed through as-authored (the
   *  printer accepts these plates unrecolored), for mask-mode builds.
   *  Same 1:1 pixel contract as `texture`. Omitted
   *  floods the plate solid white-ink blue, matching buildMaskPdf. */
  mask?: { data: Uint8Array; width: number; height: number };
  /** Master-variation custom image layers' loaded state, keyed by
   *  CustomImageLayer's `asset` — mirrors pdf/build.ts's `Assets.custom`
   *  exactly, so an SVG-sourced custom image plans as ink-tight vector paths
   *  (like the logo) instead of a raster rect; a raster-sourced one plans as
   *  an `image` rect sized from `aspect` (see plan.ts's PlanAssets.custom). */
  custom?: Record<string, { aspect: number; art?: PlanArt }>;
  /** Decoded RGBA of each RASTER custom image, at its NATURAL pixel size,
   *  keyed by CustomImageLayer.asset. Unlike `texture` (a fixed background
   *  the caller pre-scales or leaves centred), a custom layer's placed box
   *  can differ from its asset's native resolution, so the builder itself
   *  resamples to the placed rect (see resizeRGBA) — PSD layers still hold
   *  pixels 1:1, just at the resampled size. An SVG-sourced custom image
   *  carries no entry here (it plans as paths via `custom` above and needs
   *  no pixels); a missing entry for a raster one is the same "asset bytes
   *  not loaded yet" no-op every other backend honors. */
  customImages?: Record<string, { data: Uint8Array; width: number; height: number }>;
}

/** Which deliverable to build: the art PSD, or the white-ink mask plate.
 *  Mask mode mirrors buildMaskPdf: fills and strokes each repaint from their
 *  own layer assignment (metallic knockout white, white layer mask blue). */
export type PsdMode = "art" | "mask";

/** Points -> pixels of THIS document, at the export resolution.
 *
 *  Deliberately OUTPUT_DPI and not L.PX: PSD_DOC scales with the resolution
 *  knob, so laying elements out on the design grid instead would place a
 *  600dpi layout inside a 300dpi canvas and pack the whole label into the
 *  top-left quarter. The two agree at the shipped 600, which is exactly why
 *  the psd-build suite cannot catch this — see the DPI test in rulers.test.
 *
 *  Ink weights are unaffected: a stroke saved in px becomes points via L.PX
 *  (pinned at DESIGN_DPI) and only then arrives here, so it keeps its
 *  physical width and simply lands on more or fewer pixels. */
const px = (n: number) => (n / 72) * L.OUTPUT_DPI;

/** Points -> pixels for a POSITION, which px() alone is not enough for: the
 *  layout's coordinates are page-absolute at MEASURED_BLEED, so a changed
 *  bleed has moved the page edge out from under them and they need
 *  BLEED_SHIFT added back before converting (see layout.BLEED_SHIFT).
 *
 *  Sizes — type size, leading, stroke width — must keep using px(): they are
 *  lengths, and a length does not move when the page grows. That is the one
 *  distinction to keep straight in this file; getting it backwards would
 *  scale the label instead of sliding it.
 *
 *  Identity at the shipped bleed, where BLEED_SHIFT is 0. */
const pos = (n: number) => px(n + L.BLEED_SHIFT);
/** Document size in pixels. Exported so a caller can cover-fit the texture
 *  to it before handing the pixels over — PSD layers hold pixels 1:1. */
export const PSD_DOC = L.PSD_DOC;

const color255 = (fill: Fill) => {
  const c = L.parseHexFill(fill);
  return { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) };
};

/** Mask-plate blue (layout.COLORS.maskBlue as hex): the white-ink underlay. */
const MASK_BLUE = L.MASK_BLUE_HEX;

/** Resolve an element's paint for the mode — the PDF's maskColor rule:
 *  in mask mode metallic knocks out (white) and white-layer prints ink
 *  (mask blue); art mode is just the fill. */
const paint = (mode: PsdMode, fill: Fill, layer: "metallic" | "white"): Fill =>
  mode === "art" ? fill : layer === "metallic" ? "#FFFFFF" : MASK_BLUE;

/** Resolve an enabled stroke's art or mask color. Missing legacy plate data
 *  is deliberately white/non-metallic through the shared resolver. */
const strokePaint = (
  mode: PsdMode,
  stroke: Fill | undefined,
  strokeLayer: "metallic" | "white" | undefined,
): Fill | undefined =>
  !stroke || stroke === "none"
    ? undefined
    : paint(mode, stroke, strokeLayerOf({ strokeLayer }));

// --- vector helpers -------------------------------------------------------

type Pt = [number, number];
// Every number here is a coordinate — the anchor and both handles — and the
// bleed shift is the same in x and y, so the whole flat array goes through
// pos() without having to tell the two apart.
const knot = (cIn: Pt, a: Pt, cOut: Pt) => ({
  linked: false,
  points: [...cIn, ...a, ...cOut].map(pos),
});
/** A hard corner: both handles collapse onto the anchor. */
const corner = (x: number, y: number) => knot([x, y], [x, y], [x, y]);

const closed = (knots: ReturnType<typeof knot>[]): BezierPath => ({
  open: false,
  fillRule: "even-odd",
  knots,
});

/** Axis-aligned rectangle in PAGE coordinates rather than design ones.
 *
 *  PAGE already grew with the bleed, so its corners are where they should be
 *  and must NOT be shifted again — they are not measured design positions.
 *  Hence px() and not pos(). Kept as its own helper so a page-covering rect can
 *  read as the (0, 0)-to-PAGE.w it obviously is: the alternative is passing
 *  rectPath a -BLEED_SHIFT origin chosen purely to cancel pos() back out, which
 *  invites the next reader to "simplify" it to 0 and silently crop the flood. */
const pageRectPath = (x: number, y: number, w: number, h: number): BezierPath => {
  const at = (px1: number, py: number) => ({ linked: false, points: [px1, py, px1, py, px1, py].map(px) });
  return closed([at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)]);
};

/** Axis-aligned rectangle (barcode bars), in points. */
function rectPath(x: number, y: number, w: number, h: number): BezierPath {
  return closed([corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)]);
}

/** Circle as four cubic segments — the standard 0.5523 handle ratio. */
const K = 0.5522847498307936;
function circlePath(cx: number, cy: number, r: number): BezierPath {
  const k = K * r;
  return closed([
    knot([cx - k, cy - r], [cx, cy - r], [cx + k, cy - r]),
    knot([cx + r, cy - k], [cx + r, cy], [cx + r, cy + k]),
    knot([cx + k, cy + r], [cx, cy + r], [cx - k, cy + r]),
    knot([cx - r, cy + k], [cx - r, cy], [cx - r, cy - k]),
  ]);
}

/** Axis-aligned rect, top-left (x,y), side `s`, with optional rounded
 *  corners: `radius` <= 0 is a plain 4-knot rect (corner()); `radius` > 0
 *  rounds each corner with a quarter-circle cubic using the same K handle
 *  ratio circlePath uses, per corner rather than per full circle. Mirrors
 *  qrPath's (../qr) `square()` SVG builder, restated as explicit knots:
 *  8 knots in clockwise order, straight edges collapsed to the anchor
 *  (corner()-style) and arc corners bulged by k = K * radius. */
function squarePath(x: number, y: number, s: number, radius: number): BezierPath {
  if (radius <= 0) return rectPath(x, y, s, s);
  const r = Math.min(radius, s / 2);
  const k = K * r;
  return closed([
    knot([x + r - k, y], [x + r, y], [x + r, y]),
    knot([x + s - r, y], [x + s - r, y], [x + s - r + k, y]),
    knot([x + s, y + r - k], [x + s, y + r], [x + s, y + r]),
    knot([x + s, y + s - r], [x + s, y + s - r], [x + s, y + s - r + k]),
    knot([x + s - r + k, y + s], [x + s - r, y + s], [x + s - r, y + s]),
    knot([x + r, y + s], [x + r, y + s], [x + r - k, y + s]),
    knot([x, y + s - r + k], [x, y + s - r], [x, y + s - r]),
    knot([x, y + r], [x, y + r], [x, y + r - k]),
  ]);
}

/** Convert QR module shapes (see ../qr) into bezier paths at a given
 *  full-QR-square size, styled per `shapes.style` — the geometry `qrPath`
 *  (../qr) draws as one flattened SVG path, restated as node-editable
 *  bezier paths for the PSD's shape layer. Coordinates are in QR-local
 *  space (unit coordinates scaled by `sizePx`, no page-position offset);
 *  `codeLayers` translates the result to the QR's actual page position, so
 *  this stays a pure size-only converter callers (and this test suite) can
 *  exercise directly. Exported for the psd-build test suite and reuse.
 *
 *  Squares/rounded squares use qrPath's own `radius = 0.25 * moduleSize`
 *  rule (plain rects for "square", quarter-arc-rounded rects for
 *  "rounded"); the dots/finders branch is unchanged from before this
 *  function existed. */
export function qrBeziers(shapes: QrShapes, sizePx: number): BezierPath[] {
  const ms = shapes.moduleSize * sizePx;
  if (shapes.squares) {
    const radius = shapes.style === "rounded" ? 0.25 * ms : 0;
    return shapes.squares.map((sq) => squarePath(sq.x * sizePx, sq.y * sizePx, ms, radius));
  }
  return [
    ...shapes.dots.map((d) => circlePath(d.cx * sizePx, d.cy * sizePx, ms * 0.5 * 0.92)),
    // Three concentric circles per finder; even-odd turns the middle one
    // into a hole and the innermost back into a dot, no winding tricks.
    ...shapes.finders.flatMap((p) =>
      [3.5 * ms * 0.95, 2.3 * ms, 1.4 * ms].map((r) => circlePath(p.cx * sizePx, p.cy * sizePx, r)),
    ),
  ];
}

/** Shift every point of a bezier path by a page-pixel offset. Used to move
 *  qrBeziers' QR-local-space output to the QR's actual page position —
 *  splitting position out of qrBeziers is what keeps it a clean size-only
 *  converter. Exact: pos()/px() are both affine in their argument, so
 *  translating the already-converted pixel points by px(offset) matches
 *  converting `local + offset` directly in one pos() call (the offset here
 *  never itself needs the page's BLEED_SHIFT — the size-only points already
 *  carried it once, via knot()'s pos()). */
function translatePath(path: BezierPath, dx: number, dy: number): BezierPath {
  return {
    ...path,
    knots: path.knots.map((k) => ({
      ...k,
      points: k.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)),
    })),
  };
}

/** Convert one normalized absolute SVG path (see ../logo) into bezier paths,
 *  offset into label space. Only M/L/C/Z appear, by construction. */
function svgToPaths(d: string, dx: number, dy: number): BezierPath[] {
  const out: BezierPath[] = [];
  let pts: { a: Pt; in?: Pt; out?: Pt }[] = [];
  const flush = () => {
    if (pts.length >= 2) {
      // A trailing point on top of the first is the Z closing back onto it;
      // fold its incoming handle into the first knot instead of duplicating.
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (Math.abs(first.a[0] - last.a[0]) < 1e-3 && Math.abs(first.a[1] - last.a[1]) < 1e-3) {
        first.in = last.in;
        pts.pop();
      }
      out.push(closed(pts.map((p) => knot(p.in ?? p.a, p.a, p.out ?? p.a))));
    }
    pts = [];
  };
  for (const m of d.match(/[MLCZ][^MLCZ]*/g) ?? []) {
    const op = m[0];
    const n = (m.slice(1).trim().match(/-?[\d.]+/g) ?? []).map(Number);
    if (op === "M") {
      flush();
      pts.push({ a: [n[0] + dx, n[1] + dy] });
    } else if (op === "L") {
      pts.push({ a: [n[0] + dx, n[1] + dy] });
    } else if (op === "C") {
      pts[pts.length - 1].out = [n[0] + dx, n[1] + dy];
      pts.push({ a: [n[4] + dx, n[5] + dy], in: [n[2] + dx, n[3] + dy] });
    } else if (op === "Z") {
      flush();
    }
  }
  flush();
  return out;
}

/** One glyph-outline command as fontkit's Path emits it at runtime — the
 *  public `Path` interface only exposes builder methods, but every glyph's
 *  outline is really this recorded command list (`path.commands`). */
type GlyphCmd = { command: string; args: number[] };
type FKFont = { unitsPerEm: number; layout(text: string): FKGlyphRun };
interface FKGlyphRun {
  glyphs: { path: { commands: GlyphCmd[] } }[];
  positions: { xAdvance: number; xOffset: number; yOffset: number }[];
}

/** One digit group's glyph outlines as closed bezier subpaths in label
 *  points, reproducing the PDF's `rotate(90)` placement (see
 *  `pdf/build.ts:177-182`) algebraically instead of via an affine layer
 *  transform (ag-psd shape layers have none — only type layers do).
 *
 *  A font-local point is (u, v): u runs along the baseline from the string's
 *  start (font's normal +x advance direction, in points, already scaled by
 *  size/unitsPerEm), v is height above the baseline (font's +y, ascenders
 *  positive). Composing pdf-lib's CCW 90 degree rotation about the PDF-space
 *  anchor with the PDF page's y-flip back into layout.ts's top-left/y-down
 *  space reduces to: label = (dx - v, yStart - u). `dx` is the digit
 *  column's fixed baseline x (all four groups share one, see barcodeGeometry
 *  `place`); `yStart` is the label-space Y the string's start lands at,
 *  already the value the old text layer used as `baseline`
 *  (`geo.bottom - d.center * geo.mod + measure(d.text) / 2`).
 *
 *  TrueType glyphs are quadratic (fontkit emits `quadraticCurveTo`, never
 *  cubic) — svgToPaths cannot be reused here, its regex only understands
 *  M/L/C/Z and would silently swallow a Q's numbers into the previous
 *  command. Elevation to cubic is exact: C1 = P0 + 2/3(Q-P0),
 *  C2 = P2 + 2/3(Q-P2); this still holds after the (u,v)->label map above
 *  because that map is affine, and affine maps preserve the barycentric
 *  combination the elevation formula is built from. */
function digitGroupPaths(
  font: FKFont,
  text: string,
  size: number,
  dx: number,
  yStart: number,
): { paths: BezierPath[]; bbox: { minX: number; maxX: number; minY: number; maxY: number } } {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  const out: BezierPath[] = [];
  const bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const track = (p: Pt) => {
    bbox.minX = Math.min(bbox.minX, p[0]);
    bbox.maxX = Math.max(bbox.maxX, p[0]);
    bbox.minY = Math.min(bbox.minY, p[1]);
    bbox.maxY = Math.max(bbox.maxY, p[1]);
  };
  let uCum = 0;
  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    const pos = run.positions[i];
    const u0 = uCum + pos.xOffset * scale;
    const v0 = pos.yOffset * scale;
    const toLabel = (fx: number, fy: number): Pt => [dx - (v0 + fy * scale), yStart - (u0 + fx * scale)];
    let pts: { a: Pt; in?: Pt; out?: Pt }[] = [];
    let last: Pt = [0, 0];
    const flush = () => {
      if (pts.length >= 2) out.push(closed(pts.map((p) => knot(p.in ?? p.a, p.a, p.out ?? p.a))));
      pts = [];
    };
    for (const c of glyph.path.commands) {
      if (c.command === "moveTo") {
        flush();
        last = toLabel(c.args[0], c.args[1]);
        pts.push({ a: last });
        track(last);
      } else if (c.command === "lineTo") {
        last = toLabel(c.args[0], c.args[1]);
        pts.push({ a: last });
        track(last);
      } else if (c.command === "quadraticCurveTo") {
        const q = toLabel(c.args[0], c.args[1]);
        const end = toLabel(c.args[2], c.args[3]);
        const c1: Pt = [last[0] + (2 / 3) * (q[0] - last[0]), last[1] + (2 / 3) * (q[1] - last[1])];
        const c2: Pt = [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])];
        pts[pts.length - 1].out = c1;
        pts.push({ a: end, in: c2 });
        track(q);
        track(end);
        last = end;
      } else if (c.command === "bezierCurveTo") {
        const c1 = toLabel(c.args[0], c.args[1]);
        const c2 = toLabel(c.args[2], c.args[3]);
        const end = toLabel(c.args[4], c.args[5]);
        pts[pts.length - 1].out = c1;
        pts.push({ a: end, in: c2 });
        track(c1);
        track(c2);
        track(end);
        last = end;
      } else if (c.command === "closePath") {
        flush();
      }
    }
    flush();
    uCum += pos.xAdvance * scale;
  }
  return { paths: out, bbox };
}

/** One vector layer. `stroke`/`strokeWidth` become the same editable
 *  Photoshop stroke effect textLayer uses — the PDF strokes these paths for
 *  real (drawSvgPath's borderColor), and the effect is the PSD parallel. */
function shapeLayer(
  name: string, paths: BezierPath[], fill: Fill, stroke?: Fill, strokeWidth?: number,
): Layer {
  return {
    name,
    left: 0, top: 0, right: PSD_DOC.w, bottom: PSD_DOC.h,
    vectorFill: { type: "color", color: color255(fill) },
    vectorMask: { paths },
    ...strokeEffect(stroke, strokeWidth),
  };
}

/** Full-page flood rect as a shape layer (the mask plate's base coats). */
// pageRectPath, not rectPath: this covers the whole PAGE, which already
// includes the current bleed, so it takes no shift (see pageRectPath).
const floodLayer = (name: string, fill: Fill): Layer =>
  shapeLayer(name, [pageRectPath(0, 0, L.PAGE.w, L.PAGE.h)], fill);

/** The `effects.stroke` fragment for a layer, or nothing when the element
 *  carries no stroke. Widths are authored in px at the 600dpi deliverable,
 *  which is the PSD's own resolution — no px() conversion, unlike the
 *  point-based geometry everywhere else. */
function strokeEffect(stroke: Fill | undefined, strokeWidth: number | undefined) {
  if (!stroke || stroke === "none") return {};
  return {
    effects: {
      stroke: [{
        enabled: true,
        position: "outside" as const,
        size: { units: "Pixels" as const, value: strokeWidth ?? L.DEFAULT_STROKE_PX },
        fillType: "color" as const,
        color: color255(stroke),
        opacity: 1,
      }],
    },
  };
}

// --- text helpers ---------------------------------------------------------

interface Faces {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
}
/** PostScript names, which is what Photoshop resolves the type layer
 *  against — cfg's family (see fontCatalog.ts's FONT_FAMILIES), not a fixed
 *  Poppins map. */
type Face = keyof typeof FONT_FAMILIES["poppins"]["ps"];

/** One editable type layer, bound to one family's PostScript names (`ps`,
 *  resolved once per build from cfg — see buildLayers). `x`/`baseline` are
 *  in label points; `rotated` applies the same quarter turn plan.ts's
 *  rotatedRuns does (text reads bottom-to-top), expressed purely in the
 *  affine transform. */
function makeTextLayer(ps: Record<Face, string>) {
  return function textLayer(
  name: string,
  text: string,
  opts: {
    x: number; baseline: number; size: number; fill: Fill; face: Face;
    /** Face an inline `**bold**` run steps up to. Defaults to semibold,
     *  matching plan.ts's lineRuns; the rotated Info column passes bold,
     *  since its unmarked text is already semibold. */
    boldFace?: Face;
    rotated?: boolean;
    /** Letter-spacing in label points (Style.letterSpacing). */
    tracking?: number;
    /** Line spacing in label points, for a layer holding several lines.
     *  Omitted leaves Photoshop's auto leading, which is what every
     *  single-line layer here wants. */
    leading?: number;
    /** Per-line styles for a merged multi-line layer, in line order. Each
     *  entry styles one line of `text` (its newline included), so the block
     *  keeps its per-line faces and fills in ONE editable layer. */
    lines?: StyledLine[];
    /** Justify every line to the full measure, the way plan.ts's
     *  justifiedRotatedRuns spaces the warning's columns. */
    justify?: boolean;
    /** Outer stroke, as an editable Photoshop layer EFFECT. The PDF draws
     *  the same stroke via PDF's fill-and-outline text rendering mode;
     *  Photoshop has its own stroke effect, so the PSD uses that. */
    stroke?: Fill;
    strokeLayer?: "metallic" | "white";
    strokeWidth?: number;
    /** Mask mode repaints every run and the stroke effect by their respective
     *  layer assignments (see `paint`). */
    mode?: PsdMode;
  },
): Layer {
  const mode = opts.mode ?? "art";
  // Positions, so pos() rather than px() — see the note on pos. The type size
  // and leading below stay on px(): they are lengths, not places.
  const t = pos(opts.x);
  const b = pos(opts.baseline);
  // Inline runs become Photoshop STYLE RUNS: a text layer carries a base
  // style plus a list of {length, style} overrides measured in characters,
  // so Photoshop lays the mixed faces out itself — no per-run x advance to
  // compute here, and the line stays one editable layer. Lengths index the
  // marker-stripped string, which is what the layer actually holds.
  // A merged block styles per LINE (each line's own face and fill); a single
  // line styles per inline RUN. Either way the layer ends up with one style
  // run per styled span, which is what Photoshop edits.
  const runs = opts.lines
    ? opts.lines.flatMap((l, i) =>
        // The newline belongs to the line before it, so run lengths cover
        // the whole string.
        parseRuns(l).map((r, j, all) => ({
          ...r,
          text: j === all.length - 1 && i < opts.lines!.length - 1 ? `${r.text}\n` : r.text,
        })))
    : parseRuns({ text, fill: opts.fill, layer: "metallic" });
  const drawn = runs.map((r) => r.text).join("");
  const boldFace = opts.boldFace ?? "semibold";
  // A line with no markers is one run in the base face: emitting no runs at
  // all there keeps those layers byte-identical to what this builder has
  // always written.
  const mixed = runs.length > 1 || runs.some((r) => r.bold);
  const styleRuns = mixed
    ? runs.map((r) => ({
        length: r.text.length,
        style: {
          font: { name: ps[r.bold ? boldFace : opts.face] },
          // A merged block's lines can differ in colour (a `_white ink_`
          // line keeps the block's fill, a re-filled one does not), so the
          // run carries its own. Mask mode repaints per run: a white-ink
          // span prints blue while the rest of the line knocks out.
          ...(opts.lines || mode === "mask"
            ? { fillColor: color255(paint(mode, r.fill, r.layer)) }
            : {}),
        },
      }))
    : undefined;
  return {
    name,
    text: {
      text: drawn,
      transform: opts.rotated ? [0, -1, 1, 0, t, b] : [1, 0, 0, 1, t, b],
      style: {
        font: { name: ps[opts.face] },
        fontSize: px(opts.size),
        fillColor: color255(opts.fill),
        ...(opts.leading ? { leading: px(opts.leading), autoLeading: false } : {}),
        // Photoshop authors tracking in 1/1000 em, so the points-per-glyph
        // value converts against the type size — and needs no px() scaling,
        // being a ratio. ROUNDED: Photoshop's engine wants an integer here,
        // and a fractional value renders the whole layer empty. Omitted at 0
        // so untracked layers stay exactly as this builder has always
        // written them.
        ...(opts.tracking
          ? { tracking: Math.round((opts.tracking / opts.size) * 1000) }
          : {}),
      },
      ...(styleRuns ? { styleRuns } : {}),
      ...(opts.justify ? { paragraphStyle: { justification: "justify-all" as const } } : {}),
    },
    ...strokeEffect(
      strokePaint(mode, opts.stroke, opts.strokeLayer),
      opts.strokeWidth,
    ),
  };
  };
}

const faceOf = (line: { bold?: boolean }): Face => (line.bold ? "semibold" : "regular");

// --- the label ------------------------------------------------------------

function buildLayers(
  cfg: LabelConfig, assets: PsdAssets, f: Faces, fk: FKFont, mode: PsdMode,
): Layer[] {
  const groups: Layer[] = [];
  /** This mode's paint for a styled element. */
  const P = (s: { fill: Fill; layer: "metallic" | "white" }) => paint(mode, s.fill, s.layer);
  // Bound once to cfg's family's PostScript names — every textLayer call
  // below resolves the type layer's font against these, not a fixed Poppins
  // map (see fontCatalog.ts's FONT_FAMILIES).
  const textLayer = makeTextLayer(FONT_FAMILIES[fontFamilyOf(cfg)].ps);

  // Text + laurel + barcode placement, from the same display list every other
  // backend consumes. The PSD draws no collab art, so no collab assets go in —
  // the plan simply plans none.
  const pdfMeasure: MeasureFace = (t, size, face) =>
    (face === "bold" ? f.bold : face === "semibold" ? f.semibold : f.regular)
      .widthOfTextAtSize(t, size);
  const plan = planLabel(cfg, pdfMeasure, {
    assets: { logoSvg: assets.logoSvg, custom: assets.custom },
  });
  const planned = <K extends Placed["kind"]>(id: string, kind: K) =>
    plan.filter((p): p is Extract<Placed, { kind: K }> => p.kind === kind && p.id === id);
  // The min-x of an element's planned runs is exactly what the old centered()
  // helper computed: both subtract half the tracked runs-width from the same
  // cx, measured with the same PDFFont metrics.
  const textX = (id: ElementId) => Math.min(...planned(id, "text").map((r) => r.x));

  if (mode === "mask") {
    // Same base coats as buildMaskPdf: white page (knockout by default),
    // then the recolored mask raster — or, with none, a solid white-ink
    // flood ("no mask" = "print as a white label"). Elements knock out or
    // add ink on top.
    groups.push(floodLayer("Knockout base", "#FFFFFF"));
    if (assets.mask) {
      const left = Math.round((PSD_DOC.w - assets.mask.width) / 2);
      const top = Math.round((PSD_DOC.h - assets.mask.height) / 2);
      groups.push({
        name: "Mask",
        left, top,
        right: left + assets.mask.width,
        bottom: top + assets.mask.height,
        imageData: {
          data: assets.mask.data,
          width: assets.mask.width,
          height: assets.mask.height,
        },
      });
    } else {
      groups.push(floodLayer("White ink flood", MASK_BLUE));
    }
  } else if (assets.texture) {
    // Centred, so a native-size texture straddles the page rather than
    // hanging off the top-left corner. A pre-scaled one lands at 0,0.
    const left = Math.round((PSD_DOC.w - assets.texture.width) / 2);
    const top = Math.round((PSD_DOC.h - assets.texture.height) / 2);
    groups.push({
      name: "Texture",
      left, top,
      right: left + assets.texture.width,
      bottom: top + assets.texture.height,
      imageData: {
        data: assets.texture.data,
        width: assets.texture.width,
        height: assets.texture.height,
      },
    });
  }

  // Left column ------------------------------------------------------------
  const desc = parseDescription(cfg.description, cfg.descStyle);
  const left: Layer[] = [
    textLayer("Volume", cfg.volume.text, {
      x: L.VOLUME.x, baseline: L.VOLUME.baseline, size: L.VOLUME.size,
      fill: P(cfg.volume), face: faceOf(cfg.volume), tracking: cfg.volume.letterSpacing,
      stroke: cfg.volume.stroke, strokeLayer: cfg.volume.strokeLayer,
      strokeWidth: cfg.volume.strokeWidth, mode,
    }),
    textLayer("ABV", `${displayAbv(cfg)}% alc by vol`, {
      x: L.ABV.x, baseline: L.ABV.baseline, size: L.ABV.size,
      fill: P(cfg.abvStyle), face: "regular", tracking: cfg.abvStyle.letterSpacing,
      stroke: cfg.abvStyle.stroke, strokeLayer: cfg.abvStyle.strokeLayer,
      strokeWidth: cfg.abvStyle.strokeWidth, mode,
    }),
  ];
  if (desc.header)
    left.push(
      textLayer("Description header", desc.header.text, {
        x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size,
        fill: P(desc.header), face: faceOf(desc.header),
        tracking: desc.header.letterSpacing,
        stroke: desc.header.stroke, strokeLayer: desc.header.strokeLayer,
        strokeWidth: desc.header.strokeWidth, mode,
      }),
    );
  // ONE layer for the whole block: the markdown subset styles lines
  // individually, and style runs express that inside a single editable type
  // layer (one run per line, or per inline span within a line). Leading is
  // the PDF's own line advance, so the merged layer's lines land on the
  // baselines the per-line layers used to occupy.
  if (desc.lines.length)
    left.push(
      textLayer("Description", desc.lines.map((l) => l.text).join("\n"), {
        x: L.DESC.x, baseline: L.DESC.firstBaseline, size: L.DESC.size,
        fill: P(cfg.descStyle), face: "regular",
        tracking: cfg.descStyle.letterSpacing, leading: L.DESC.leading,
        lines: desc.lines,
        stroke: cfg.descStyle.stroke, strokeLayer: cfg.descStyle.strokeLayer,
        strokeWidth: cfg.descStyle.strokeWidth, mode,
      }),
    );
  groups.push({ name: "Left column", opened: false, children: left });

  // Center column ----------------------------------------------------------
  // x for each centred line comes from textX (see its definition above): the
  // plan already centred these runs against the same cx with the same
  // PDFFont metrics, so re-deriving the measurement here would risk a
  // different rounding for a byte-identical requirement.
  const logoItem = planned("logo", "paths")[0];
  const logoPaths = logoItem.paths.flatMap((d) => svgToPaths(d, logoItem.x, logoItem.y));
  groups.push({
    name: "Center",
    opened: false,
    children: [
      textLayer("Wordmark", L.WORDMARK.text, {
        x: textX("wordmark"),
        baseline: L.WORDMARK.baseline, size: L.WORDMARK.size,
        fill: P(cfg.wordmark), face: "bold", tracking: cfg.wordmark.letterSpacing,
        stroke: cfg.wordmark.stroke, strokeLayer: cfg.wordmark.strokeLayer,
        strokeWidth: cfg.wordmark.strokeWidth, mode,
      }),
      shapeLayer(
        "Logo", logoPaths, P(cfg.logo),
        strokePaint(mode, cfg.logo.stroke, cfg.logo.strokeLayer), cfg.logo.strokeWidth,
      ),
      textLayer("Beer name", displayName(cfg).toUpperCase(), {
        x: textX("name"),
        baseline: L.NAME.baseline, size: L.NAME.size,
        fill: P(cfg.nameStyle), face: "bold", tracking: cfg.nameStyle.letterSpacing,
        stroke: cfg.nameStyle.stroke, strokeLayer: cfg.nameStyle.strokeLayer,
        strokeWidth: cfg.nameStyle.strokeWidth, mode,
      }),
      textLayer("Style line", displayStyle(cfg), {
        x: textX("styleLine"),
        baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size,
        fill: P(cfg.styleLine), face: faceOf(cfg.styleLine), tracking: cfg.styleLine.letterSpacing,
        stroke: cfg.styleLine.stroke, strokeLayer: cfg.styleLine.strokeLayer,
        strokeWidth: cfg.styleLine.strokeWidth, mode,
      }),
    ],
  });

  // Right rotated column ---------------------------------------------------
  // Kept local because plan.ts's warning items are already the wrapped,
  // justified runs — this call exists only to get the LINE TEXT back out for
  // the merged multi-line layer (styleRuns need per-line strings, not the
  // plan's per-run x/y), so re-wrapping here is cheaper than re-joining the
  // plan's runs back into lines.
  const warnLines = wrapWarning(
    warningMeasure(
      (t, bold) => (bold ? f.bold : f.regular).widthOfTextAtSize(t, L.WARNING.size),
      cfg.warning.letterSpacing,
    ),
    L.WARNING.maxLen,
  );
  // Same markdown parse as the PDF path, so the layer carries the rendered
  // text (markers stripped) and the face they asked for.
  const info = parseInfoLine(cfg.handleAddress.text, cfg.handleAddress);
  groups.push({
    name: "Right column",
    opened: false,
    children: [
      textLayer("Info", info.text, {
        x: L.HANDLE_ADDR.x, baseline: L.HANDLE_ADDR.yStart, size: L.HANDLE_ADDR.size,
        fill: P(info), face: info.bold ? "bold" : "semibold", boldFace: "bold", rotated: true,
        tracking: info.letterSpacing,
        stroke: info.stroke, strokeLayer: info.strokeLayer,
        strokeWidth: info.strokeWidth, mode,
      }),
      // ONE layer for the whole warning: its columns are the lines of a
      // wrapped paragraph, so leading (the PDF's own column advance) and
      // justification carry what used to be one layer per column. The wrap
      // still comes from wrapWarning above, measured with the metrics the
      // PDF wraps with, so both deliverables break identically.
      textLayer("Warning", warnLines.join("\n"), {
        x: L.WARNING.x, baseline: L.WARNING.yStart,
        // boldFace "bold", not the semibold default: the **GOVERNMENT
        // WARNING:** prefix must step up to true Bold, matching the PDF.
        size: L.WARNING.size, fill: P(cfg.warning), face: "regular", boldFace: "bold", rotated: true,
        tracking: cfg.warning.letterSpacing, leading: L.WARNING.leading, justify: true,
        stroke: cfg.warning.stroke, strokeLayer: cfg.warning.strokeLayer,
        strokeWidth: cfg.warning.strokeWidth, mode,
      }),
      textLayer("Store cold", cfg.storeCold.text, {
        x: L.STORE_COLD.x, baseline: L.STORE_COLD.yStart, size: L.STORE_COLD.size,
        // Bold toggle steps semibold up to Bold, matching the PDF path.
        fill: P(cfg.storeCold), face: cfg.storeCold.bold ? "bold" : "semibold", rotated: true,
        tracking: cfg.storeCold.letterSpacing,
        stroke: cfg.storeCold.stroke, strokeLayer: cfg.storeCold.strokeLayer,
        strokeWidth: cfg.storeCold.strokeWidth, mode,
      }),
    ],
  });

  // Codes ------------------------------------------------------------------
  groups.push({ name: "Codes", opened: false, children: codeLayers(cfg, fk, mode, plan) });

  // Master-variation custom layers (Task 6) ---------------------------------
  // Guarded on length, not just an always-empty-array fallthrough: an absent
  // or empty customLayers must add NO group at all, so a config with none
  // builds byte-identical output to before this feature (barcode custom
  // layers are handled inside codeLayers above, alongside the template's).
  if (cfg.customLayers?.length)
    groups.push({
      name: "Custom layers", opened: false,
      children: buildCustomLayers(cfg, assets, plan, mode, textLayer),
    });
  // PSD layer order is bottom-first, matching the PDF's draw order.
  return groups;
}

/** One barcode's merged shape layer, from its placed item — shared by the
 *  template barcode (plan id "barcode") and any master-variation custom
 *  barcode layers (Task 6): both are PlacedBarcode items out of the same
 *  plan (see plan.ts's customBarcodeItem), so one code path builds either,
 *  bars and digit glyph outlines both bezier, in the item's own fill. Mask
 *  mode preserves the mask PDF's deliberate underprint geometry: exact bar
 *  rectangles plus one glyph-box pill per digit group, outset by S as a
 *  border. Art mode's halo is the same editable outside-stroke effect every
 *  other element carries, so Photoshop dilates bars and digit outlines alike
 *  and unions the result. `S` (resolved outer-stroke width; 0 = no halo)
 *  gates the stroke identically to the PDF's own `if (S > 0)`, so the two
 *  deliverables can't disagree on whether one exists. */
function barcodeLayer(name: string, bc: PlacedBarcode, fk: FKFont, mode: PsdMode): Layer {
  const S = bc.S;
  if (mode === "mask") {
    const footprint: BezierPath[] = bc.footprint
      .map((r) => ({ ...rectPath(r.x, r.yTop, r.w, r.h), operation: "combine" as const }));
    return shapeLayer(
      name, footprint, paint(mode, bc.fill, bc.fillLayer),
      S > 0 ? strokePaint(mode, bc.stroke, bc.strokeLayer) : undefined, px(S),
    );
  }
  // yStart is exactly what the old digit TYPE layers used as `baseline` —
  // the string-start Y a `rotate(90)` PDF drawText lands at (see
  // digitGroupPaths for the derivation); keeping this identical is what
  // makes the outlines land where the type layers used to.
  const digitGroups = bc.geo.digits.map((d, i) =>
    digitGroupPaths(fk, d.text, bc.textSize, d.x, bc.digits[i].y),
  );
  const barcodePaths: BezierPath[] = [
    ...bc.geo.bars.map((b) => rectPath(b.x, b.yTop, b.w, b.h)),
    ...digitGroups.flatMap((g) => g.paths),
  ];
  return shapeLayer(
    name, barcodePaths, paint(mode, bc.fill, bc.fillLayer),
    S > 0 ? strokePaint(mode, bc.stroke, bc.strokeLayer) : undefined, px(S),
  );
}

/** QR (vector) + every barcode in the plan: the template's own ("barcode")
 *  plus any master-variation custom barcode layers (Task 6), each named
 *  after its layer and drawn through barcodeLayer's shared merged-shape
 *  approach — widened from the old single-item lookup gated on
 *  `id === "barcode"` so a custom barcode layer emits too, without changing
 *  a byte of the template's own layer. */
function codeLayers(cfg: LabelConfig, fk: FKFont, mode: PsdMode, plan: Placed[]): Layer[] {
  // Kept local because plan.ts's QR item is the already-flattened path string
  // (qrPath), sized for pdf-lib's drawSvgPath — this file instead draws the
  // QR as its own dots/finders shape layer (node-editable circles rather than
  // one opaque path), which needs qrShapes' structured module data, not the
  // flattened path.
  const q = qrShapes(qrUrl(displayName(cfg)));
  // qrBeziers builds the shapes in QR-local space (unit coords * L.QR.size,
  // no page offset); translate into the QR's actual page position here —
  // the split is what keeps qrBeziers a pure, directly testable converter.
  const qrPaths: BezierPath[] = qrBeziers(q, L.QR.size).map((p) =>
    translatePath(p, px(L.QR.x), px(L.QR.yTop)),
  );
  const qr = shapeLayer(
    "QR", qrPaths, paint(mode, cfg.qrFill, cfg.qrLayer),
    strokePaint(mode, cfg.qrStroke, cfg.qrStrokeLayer), cfg.qrStrokeWidth,
  );

  const barcodes = plan.filter((p): p is PlacedBarcode => p.kind === "barcode");
  const nameOf = (bc: PlacedBarcode) =>
    bc.id === "barcode" ? "Barcode" : (cfg.customLayers?.find((l) => l.id === bc.id)?.name ?? bc.id);

  return [qr, ...barcodes.map((bc) => barcodeLayer(nameOf(bc), bc, fk, mode))];
}

/** Nearest-neighbor resample of RGBA pixels to (dstW, dstH). A custom raster
 *  image's placed box can differ from its asset's native resolution — PSD
 *  layers hold pixels 1:1, so the box's own pixels have to be resampled here
 *  rather than centred at native size the way `texture` is. Nearest-
 *  neighbor keeps this dependency-free (no canvas, so it runs identically
 *  from the browser and scripts/generate.ts's Node CLI); export-resolution
 *  raster art at print DPI rarely benefits from a smoother filter. */
function resizeRGBA(
  src: { data: Uint8Array; width: number; height: number }, dstW: number, dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / dstW));
      const si = (sy * src.width + sx) * 4;
      const di = (y * dstW + x) * 4;
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

/** Master-variation custom layers (Task 6): one PSD layer per entry in
 *  cfg.customLayers, in stored order — the same order plan.ts appends their
 *  placed items in, so this group draws on top of every fixed element just
 *  like the plan does. Barcode layers are excluded here: codeLayers builds
 *  them (template and custom alike) through the shared barcodeLayer helper,
 *  so a custom barcode layer draws in the "Codes" group beside the
 *  template's, not here. */
function buildCustomLayers(
  cfg: LabelConfig, assets: PsdAssets, plan: Placed[], mode: PsdMode,
  textLayer: ReturnType<typeof makeTextLayer>,
): Layer[] {
  const out: Layer[] = [];
  const guides = labelGuides();
  for (const layer of cfg.customLayers ?? []) {
    if (layer.type === "barcode") continue; // codeLayers
    if (layer.type === "text") {
      // Position comes from the plan's own placed runs (lineRuns), the same
      // min-x + shared-baseline reading textX/baseline use for the fixed
      // centred elements — not re-measured here, so it can't drift from the
      // plan's own kerning. The RUN TEXT/styling still comes straight off
      // layer.line, exactly like every fixed text element passes its own
      // raw markdown string to textLayer rather than the plan's per-run text.
      const items = plan.filter((p): p is Extract<Placed, { kind: "text" }> =>
        p.kind === "text" && p.id === layer.id);
      if (!items.length) continue;
      const x = Math.min(...items.map((r) => r.x));
      out.push(textLayer(layer.name, layer.line.text, {
        x, baseline: items[0].y, size: layer.size,
        fill: paint(mode, layer.line.fill, layer.line.layer), face: faceOf(layer.line),
        tracking: layer.line.letterSpacing,
        stroke: layer.line.stroke, strokeLayer: layer.line.strokeLayer,
        strokeWidth: layer.line.strokeWidth, mode,
      }));
    } else if (layer.type === "image") {
      // SVG source: plans as an ink-tight `paths` item (see PsdAssets.custom
      // above) — drawn as a vector shape layer exactly like the Logo.
      const svgItem = plan.find((p): p is Extract<Placed, { kind: "paths" }> =>
        p.kind === "paths" && p.id === layer.id);
      if (svgItem) {
        const paths = svgItem.paths.flatMap((d) => svgToPaths(d, svgItem.x, svgItem.y));
        out.push(shapeLayer(
          layer.name, paths, paint(mode, layer.style.fill, layer.style.layer),
          strokePaint(mode, layer.style.stroke, layer.style.strokeLayer), layer.style.strokeWidth,
        ));
        continue;
      }
      // Raster source: plans as an `image` rect (from the layer's/asset's
      // aspect — see PlanAssets.custom). Missing bytes (asset not yet
      // loaded) is a no-op, same contract as the PDF/canvas backends.
      const imgItem = plan.find((p): p is Extract<Placed, { kind: "image" }> =>
        p.kind === "image" && p.id === layer.id);
      if (!imgItem) continue;
      if (mode === "mask") {
        // Raster art prints on white ink: the mask paints its footprint
        // blue regardless of the layer's own fill/layer assignment — the
        // same raster-collab rule pdf/build.ts's drawElements applies.
        out.push(shapeLayer(
          layer.name, [rectPath(imgItem.x, imgItem.y, imgItem.w, imgItem.h)], MASK_BLUE,
        ));
        continue;
      }
      const pixels = assets.customImages?.[layer.asset];
      if (!pixels) continue;
      const left = Math.round(pos(imgItem.x));
      const top = Math.round(pos(imgItem.y));
      const w = Math.max(1, Math.round(px(imgItem.w)));
      const h = Math.max(1, Math.round(px(imgItem.h)));
      out.push({
        name: layer.name, left, top, right: left + w, bottom: top + h,
        imageData: { data: resizeRGBA(pixels, w, h), width: w, height: h },
      });
    } else {
      // "qr" — same structured qrShapes -> qrBeziers conversion as the
      // template QR above, recomputed locally from the layer's own
      // value/style/ecLevel (the plan's item is just the flattened path
      // string, which can't drive qrBeziers' node-editable circles — see
      // codeLayers' own comment on the same tradeoff for the template QR).
      const shapes = qrShapes(layer.value, { style: layer.qrStyle, ecLevel: layer.ecLevel ?? "M" });
      const at = {
        x: anchoredX(layer.position, layer.size, guides),
        y: anchoredY(layer.position, layer.size, guides),
      };
      const paths = qrBeziers(shapes, layer.size).map((p) => translatePath(p, px(at.x), px(at.y)));
      out.push(shapeLayer(
        layer.name, paths, paint(mode, layer.style.fill, layer.style.layer),
        strokePaint(mode, layer.style.stroke, layer.style.strokeLayer), layer.style.strokeWidth,
      ));
    }
  }
  return out;
}

/** Build the layered Photoshop file. Text layers carry no rendered bitmap, so
 *  Photoshop prompts to update them on open — that is expected; choosing
 *  "Update" redraws each from its text data.
 *
 *  `mode` picks the deliverable: "art" (default) or "mask" — the white-ink
 *  plate, mirroring buildMaskPdf (see PsdMode). */
export async function buildPsd(
  cfg: LabelConfig, assets: PsdAssets, mode: PsdMode = "art",
): Promise<Uint8Array> {
  // pdf-lib is used only for font metrics, so the PSD's centering and the
  // warning's line wrap land identically to the PDF's.
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const f: Faces = {
    regular: await doc.embedFont(assets.fonts.regular),
    semibold: await doc.embedFont(assets.fonts.semibold),
    bold: await doc.embedFont(assets.fonts.bold),
  };
  // The merged barcode layer needs fontkit's raw glyph outlines for the
  // digits, which pdf-lib's PDFFont wrapper doesn't expose — @pdf-lib/
  // fontkit's own `create` gives back the underlying Font directly. Its
  // public `.d.ts` types `Glyph.path` as the builder-method-only `Path`
  // interface and omits the `commands` array those methods actually record
  // to (see digitGroupPaths); the cast bridges that gap in the type
  // declarations, not the runtime shape, which fontkit has always recorded.
  const digitFont = fontkit.create(assets.fonts.regular) as unknown as FKFont;
  const psd: Psd = {
    width: PSD_DOC.w,
    height: PSD_DOC.h,
    children: buildLayers(cfg, assets, f, digitFont, mode),
  };
  return writePsdUint8Array(psd);
}
