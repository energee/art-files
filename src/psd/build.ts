// build.ts — builds the layered Photoshop deliverable with ag-psd from the
// same DISPLAY LIST the PDF and canvas backends draw (planLayers.ts's
// PlacedLayer[], planned by the caller from the resolved v3 layers with a
// pdf-lib MeasureFace, so nothing here can drift from the other renderers).
// Every app layer becomes one PSD GROUP named after it, holding its items
// re-expressed as PSD layers: a text layer's runs fold back into ONE editable
// type layer (lines from the baselines, style runs from the faces/fills);
// justified text keeps editable placed runs to preserve variable word gaps.
// vector art (the laurel, SVG collab art) and the QR become node-editable
// shape layers, raster art a pixel layer resampled to its placed box, and
// the two page roles the base coats (the texture on the art plate; the
// knockout page, the mask raster or the white-ink flood on the mask plate).
//
// The QR is rebuilt from its LAYER data (qrShapes -> qrBeziers) rather than
// the plan's flattened path string, which uses arcs svgToPaths cannot read;
// that is why buildPsd takes the resolved layers alongside the list.
//
// The barcode is ONE merged shape layer: bars and digit glyph outlines in a
// single vectorMask. The digits are bezier outlines, not editable type — an
// explicit, user-approved tradeoff for a print-ready single-shape barcode.
// Its halo is the same editable stroke EFFECT every other element uses
// (strokeEffect, position outside), including the independently painted
// effect on the mask PSD; omitted when the resolved stroke width is 0.
//
// Coordinates: layout.ts is already top-left origin with y down, which is
// exactly PSD's convention, so conversion is a plain 600dpi scale with no
// axis flip. Bezier knot points are [ctrlInX, ctrlInY, anchorX, anchorY,
// ctrlOutX, ctrlOutY] in document pixels.
//
// Rotated text rides on the layer's affine transform. Do NOT reach for
// ag-psd's `orientation: 'vertical'` — that is CJK vertical writing and its
// own docs warn it can emit a broken file.
// writePsdUint8Array, not writePsdBuffer — the latter returns a Node Buffer
// and throws "Buffer not supported on this platform" in the browser.
import { writePsdUint8Array, type BezierPath, type Layer, type Psd } from "ag-psd";
import type { Fill } from "../types";
import { FONT_FAMILIES, type FontFamilyId } from "../fontCatalog";
import type { Font } from "@pdf-lib/fontkit";
import { openFont } from "../fontkit";
import { glyphPaths } from "../pdf/outline";
import * as L from "../layout";
import type { Face, PlacedBarcode, PlacedPaths, PlacedText } from "../plan";
import type { CollabImage } from "../pdf/build";
import { digitStartX, strokeSpec } from "../plan";
import { pageDrawsOn, type PlacedLayer, type PlacedPage } from "../planLayers";
import { facesOf } from "../planLayers";
import { PAGE_ART_ID, type Layer as AppLayer, type TextLayer } from "../model/layers";
import { qrShapes, type QrShapes } from "../qr";
import { strokeLayerOf } from "../strokes";

/** Decoded RGBA pixels at their natural size. */
export interface Rgba { data: Uint8Array; width: number; height: number }

export interface PsdAssets {
  fonts: { regular: Uint8Array; semibold: Uint8Array; bold: Uint8Array };
  /** The typeface the type layers name (PostScript names from
   *  fontCatalog.ts) — the master's fontFamily. Absent = "poppins". */
  fontFamily?: FontFamilyId;
  /** Decoded RGBA by asset id — the id every `image` and `page` item
   *  carries in `asset`. Raster art resamples to its placed box (see
   *  resizeRGBA), since a layer's box can differ from its asset's native
   *  resolution. The two PAGE roles use their planned cover-fit rectangles too. A missing key is the same "bytes not
   *  loaded" no-op every other backend honors: no layer at all (and for the
   *  page roles, an empty background / the white-ink flood). An SVG-sourced
   *  image carries no entry — planLayers already turned it into paths. */
  images?: Record<string, Rgba | null | undefined>;
}

/** PsdAssets.images from the export's art bytes: every raster image asset
 *  (SVGs are skipped — planLayers already made them paths) plus the page
 *  texture and mask under their PAGE_ART_ID keys. `decode` must return
 *  NATURAL-size pixels: pageLayer and rasterItemLayer resample into the placed
 *  rect themselves, so pixels pre-fit to PSD_DOC would be fit twice and
 *  stretch any texture whose aspect differs from the page (#88). */
export async function psdImages(
  images: Record<string, CollabImage>,
  page: { texture?: Uint8Array; mask?: Uint8Array },
  decode: (bytes: Uint8Array) => Promise<Rgba>,
): Promise<Record<string, Rgba>> {
  const sources: [string, Uint8Array | undefined][] = [
    ...Object.entries(images).map(([id, img]): [string, Uint8Array | undefined] =>
      [id, img.kind === "svg" ? undefined : img.bytes]),
    [PAGE_ART_ID.background, page.texture],
    [PAGE_ART_ID.mask, page.mask],
  ];
  return Object.fromEntries(await Promise.all(sources.flatMap(([id, bytes]) =>
    bytes ? [decode(bytes).then((px) => [id, px] as const)] : [])));
}

export interface PsdOpts {
  /** The RESOLVED layers the list was planned from (resolveLayers' output).
   *  Supplies each group's display name and the text/QR data a type layer
   *  or the QR's node-editable shape need beyond what the flat items carry.
   *  A layer missing here is named by its id and its text falls back to the
   *  items' own faces; a QR without its layer cannot be rebuilt and throws. */
  layers?: readonly AppLayer[];
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
/** Document size in pixels. Page rasters are NOT pre-fit to it — hand them
 *  over at natural size; pageLayer cover-fits them (see psdImages). */
const PSD_DOC = L.PSD_DOC;

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
  mode === "art" ? fill : layer === "metallic" ? L.WHITE_HEX : MASK_BLUE;

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

/** PSD adapter for the shared raw-advance glyph walker: converts the neutral
 * outline to ag-psd's BezierPath. Barcode groups have no tracking. */
export function digitGroupPaths(
  font: Pick<Font, "unitsPerEm" | "layout">,
  text: string,
  size: number,
  rotated: boolean,
  anchorX: number,
  anchorY: number,
): { paths: BezierPath[]; bbox: { minX: number; maxX: number; minY: number; maxY: number } } {
  const { paths, bbox } = glyphPaths(font, text, size, rotated, anchorX, anchorY);
  return {
    paths: paths.map(({ knots }) => ({
      open: false,
      fillRule: "even-odd",
      knots: knots.map(({ points }) => ({
        linked: false,
        points: [pos(points[0]), pos(points[1]), pos(points[2]), pos(points[3]), pos(points[4]), pos(points[5])],
      })),
    })),
    bbox,
  };
}

/** One vector layer. `stroke`/`strokePt` (width in points) become the same
 *  editable Photoshop stroke effect textLayer uses — the PDF strokes these
 *  paths for real (drawSvgPath's borderColor), and the effect is the PSD
 *  parallel. */
function shapeLayer(
  name: string, paths: BezierPath[], fill: Fill, stroke?: Fill, strokePt = 0,
): Layer {
  return {
    name,
    left: 0, top: 0, right: PSD_DOC.w, bottom: PSD_DOC.h,
    vectorFill: { type: "color", color: color255(fill) },
    vectorMask: { paths },
    ...strokeEffect(stroke, strokePt),
  };
}

/** Full-page flood rect as a shape layer (the mask plate's base coats). */
// pageRectPath, not rectPath: this covers the whole PAGE, which already
// includes the current bleed, so it takes no shift (see pageRectPath).
const floodLayer = (name: string, fill: Fill): Layer =>
  shapeLayer(name, [pageRectPath(0, 0, L.PAGE.w, L.PAGE.h)], fill);

/** The `effects.stroke` fragment for a layer, or nothing when the element
 *  carries no stroke. `strokePt` is the resolved width in POINTS (a placed
 *  stroke's `w`, or a style's px * L.PX); like every other length here it
 *  goes through px(), so the effect lands on this document's pixels and
 *  keeps its physical ink width at any export DPI (1.8pt = 15px at 600,
 *  7.5px at 300). Rounded to 1/1000 px to drop the conversion's float dust. */
function strokeEffect(stroke: Fill | undefined, strokePt: number) {
  if (!stroke || stroke === "none") return {};
  return {
    effects: {
      stroke: [{
        enabled: true,
        position: "outside" as const,
        size: { units: "Pixels" as const, value: Math.round(px(strokePt) * 1000) / 1000 },
        fillType: "color" as const,
        color: color255(stroke),
        opacity: 1,
      }],
    },
  };
}

// --- text helpers ---------------------------------------------------------

/** One line of a type layer, rebuilt from its placed runs. */
interface TypeLine { runs: PlacedText[]; text: string; spaced: boolean[] }

/** Fold a text layer's placed runs back into lines. Runs share a line when
 *  they share a baseline (y unrotated, x rotated); within a line, a run that
 *  does not start where the previous one's advance ended is a justified
 *  word boundary (planLayers emits justified lines one word at a time), so
 *  the space the wrap consumed goes back in. */
function linesOf(runs: PlacedText[]): TypeLine[] {
  const lines: TypeLine[] = [];
  for (const r of runs) {
    const last = lines[lines.length - 1];
    const same = last && (r.rotated ? last.runs[0].x === r.x : last.runs[0].y === r.y);
    if (!same) { lines.push({ runs: [r], text: r.text, spaced: [] }); continue; }
    const prev = last.runs[last.runs.length - 1];
    const end = r.rotated ? prev.y - prev.w - prev.tracking : prev.x + prev.w + prev.tracking;
    const gap = r.rotated ? end - r.y : r.x - end;
    last.spaced.push(gap > 1e-6);
    last.runs.push(r);
    last.text += (gap > 1e-6 ? " " : "") + r.text;
  }
  return lines;
}

/** One editable type layer from a text layer's placed runs. The runs are
 *  the truth for what is drawn (uppercase, suffix, placeholder and the
 *  header's bold already applied); the LAYER supplies what the runs cannot
 *  say about the block — its base face, alignment and leading. Inline runs
 *  become Photoshop STYLE RUNS (one per placed run: face, fill and, for a
 *  header line, size), measured in characters of the marker-stripped string
 *  the layer holds, so Photoshop lays the mixed faces out itself and the
 *  block stays one editable layer. Rotation rides on the layer's affine
 *  transform — never ag-psd's `orientation: 'vertical'`, which is CJK
 *  vertical writing and can emit a broken file. */
function typeLayer(
  name: string, runs: PlacedText[], layer: TextLayer | undefined, ps: Record<Face, string>, mode: PsdMode,
): Layer {
  const lines = linesOf(runs);
  const first = runs[0];
  const rotated = first.rotated;
  const size = layer?.size ?? first.size;
  const base = layer ? facesOf(layer).base : first.face;
  const align = layer?.align ?? "left";
  // Block extent along the reading direction, from the placed runs.
  const start = (l: TypeLine) => (rotated ? l.runs[0].y : l.runs[0].x);
  const end = (l: TypeLine) => {
    const r = l.runs[l.runs.length - 1];
    return rotated ? r.y - r.w : r.x + r.w;
  };
  const along0 = rotated ? Math.max(...lines.map(start)) : Math.min(...lines.map(start));
  const along1 = rotated ? Math.min(...lines.map(end)) : Math.max(...lines.map(end));
  // The anchor Photoshop aligns each line against: the block's start edge
  // for left/justify, its middle for center, its far edge for right.
  const anchor = align === "center" ? (along0 + along1) / 2 : align === "right" ? along1 : along0;
  // Positions, so pos() rather than px() — see the note on pos. The type
  // size, leading and tracking below stay on px(): they are lengths.
  const x = pos(rotated ? first.x : anchor);
  const baseline = pos(rotated ? anchor : first.y);
  const mixed = runs.length > 1 || first.face !== base || lines.some((l) => l.runs.some((r) => r.size !== size));
  const styleRuns = mixed
    ? coalesce(lines.flatMap((l, i) => l.runs.map((r, j) => ({
        // The newline belongs to the line before it, so run lengths cover
        // the whole string; a justified word boundary carries its space.
        length: r.text.length
          + (l.spaced[j] ? 1 : 0)
          + (j === l.runs.length - 1 && i < lines.length - 1 ? 1 : 0),
        style: {
          font: { name: ps[r.face] },
          fillColor: color255(paint(mode, r.fill, r.layer)),
          ...(r.size !== size ? { fontSize: px(r.size) } : {}),
        },
      }))))
    : undefined;
  const leading = layer ? (layer.leading ?? 1.2) * size
    : lines.length > 1 ? Math.abs((rotated ? lines[1].runs[0].x - lines[0].runs[0].x : lines[1].runs[0].y - lines[0].runs[0].y)) : 0;
  const justification = align === "justify" ? "justify-left" : align === "left" ? undefined : align;
  return {
    name,
    text: {
      text: lines.map((l) => l.text).join("\n"),
      transform: rotated ? [0, -1, 1, 0, x, baseline] : [1, 0, 0, 1, x, baseline],
      style: {
        font: { name: ps[base] },
        fontSize: px(size),
        fillColor: color255(paint(mode, first.fill, first.layer)),
        // Photoshop auto-kerns by default; the PDF draws raw glyph advances
        // and the plan measures unkerned (#86), so a kern-table face like
        // Barlow Condensed would set tighter here than in the PDF. Style
        // runs inherit this from the base style (#143).
        autoKerning: false,
        // Omitted for a single line: Photoshop's auto leading is what every
        // single-line layer wants.
        ...(lines.length > 1 ? { leading: px(leading), autoLeading: false } : {}),
        // Photoshop authors tracking in 1/1000 em, so the points-per-glyph
        // value converts against the type size — and needs no px() scaling,
        // being a ratio. ROUNDED: Photoshop's engine wants an integer here,
        // and a fractional value renders the whole layer empty.
        ...(first.tracking ? { tracking: Math.round((first.tracking / size) * 1000) } : {}),
      },
      ...(styleRuns ? { styleRuns } : {}),
      ...(justification ? { paragraphStyle: { justification } } : {}),
    },
    ...strokeEffect(
      first.stroke ? paint(mode, first.stroke.fill, first.stroke.layer) : undefined,
      first.stroke?.w ?? 0,
    ),
  };
}

/** Merge adjacent style runs with identical styles (a justified line is one
 *  placed run per word, all in one face) so Photoshop sees one span per
 *  styled stretch, the way a designer would author it. */
function coalesce<T extends { length: number; style: object }>(runs: T[]): T[] {
  const out: T[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.style) === JSON.stringify(r.style)) last.length += r.length;
    else out.push({ ...r });
  }
  return out;
}

// --- the label ------------------------------------------------------------

/** The plan's items grouped by layer id, in order of first appearance —
 *  the draw order, which is also PSD layer order (bottom-first). */
function groupById(items: readonly PlacedLayer[]): Map<string, PlacedLayer[]> {
  const out = new Map<string, PlacedLayer[]>();
  for (const it of items) (out.get(it.id) ?? out.set(it.id, []).get(it.id)!).push(it);
  return out;
}

/** A page raster uses the same cover-fit rectangle as PDF and canvas. */
function pageLayer(name: string, item: PlacedPage, pixels: Rgba): Layer {
  const left = Math.round(px(item.x));
  const top = Math.round(px(item.y));
  const width = Math.max(1, Math.round(px(item.w)));
  const height = Math.max(1, Math.round(px(item.h)));
  return {
    name, left, top, right: left + width, bottom: top + height,
    imageData: { data: resizeRGBA(pixels, width, height), width, height },
  };
}

function buildLayers(
  items: readonly PlacedLayer[], assets: PsdAssets, fk: Font, mode: PsdMode, opts: PsdOpts,
): Layer[] {
  const groups: Layer[] = [];
  const byId = new Map((opts.layers ?? []).map((l) => [l.id, l]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const pixelsOf = (asset: string | undefined) => (asset ? assets.images?.[asset] : null) ?? null;

  // Base coats precede the list, while page rasters retain authored draw order.
  const hasMask = items.some((r) => r.kind === "page" && r.role === "mask" && pixelsOf(r.asset));
  if (mode === "mask") {
    groups.push(floodLayer("Knockout base", L.WHITE_HEX));
    if (!hasMask) groups.push(floodLayer("White ink flood", MASK_BLUE));
  }

  for (const [id, its] of groupById(items)) {
    const page = its[0];
    if (page.kind === "page") {
      const pixels = pixelsOf(page.asset);
      if (pixels && pageDrawsOn(page, mode))
        groups.push(pageLayer(nameOf(id), page, pixels));
      continue;
    }
    const name = nameOf(id);
    const layer = byId.get(id);
    const children: Layer[] = [];
    const texts = its.filter((r): r is PlacedText => r.kind === "text");
    if (texts.length) {
      const ps = FONT_FAMILIES[texts[0].fontFamily ?? assets.fontFamily ?? "poppins"].ps;
      if (layer?.kind === "text" && layer.align === "justify") {
        // Photoshop point text cannot reproduce variable word gaps. Keep the
        // planned runs as editable type layers so export placement is exact.
        for (const [i, run] of texts.entries())
          children.push(typeLayer(`${name} ${i + 1}`, [run], undefined, ps, mode));
      } else children.push(typeLayer(name, texts, layer?.kind === "text" ? layer : undefined, ps, mode));
    }
    if (layer?.kind === "qr") {
      // Rebuilt from the layer: the plan's flattened path uses arcs
      // svgToPaths cannot read, and Photoshop wants node-editable circles.
      // The fill item (the last paths item) carries the placed origin.
      const fill = its.filter((r): r is PlacedPaths => r.kind === "paths").at(-1);
      if (fill) {
        const shapes = qrShapes(layer.value, { style: layer.qrStyle, ecLevel: layer.ecLevel, rotation: layer.rotation });
        const paths = qrBeziers(shapes, layer.size).map((p) => translatePath(p, px(fill.x), px(fill.y)));
        children.push(shapeLayer(
          name, paths, paint(mode, layer.style.fill, layer.style.layer),
          strokePaint(mode, layer.style.stroke, layer.style.strokeLayer),
          strokeSpec(layer.style)?.w ?? 0,
        ));
      }
    } else {
      for (const r of its) {
        // Text runs became the type layer above; a page item never shares an
        // id with these (its group continued). Every remaining kind is named,
        // so a new PlacedLayer kind fails to compile at the final else.
        if (r.kind === "text" || r.kind === "page") continue;
        if (r.kind === "paths") {
          if (!layer && r.paths.some((d) => /[aA]/.test(d)))
            throw new Error(`PSD: layer "${id}" draws arc paths (a QR?) and needs its layer data — pass opts.layers.`);
          children.push(shapeLayer(
            name, r.paths.flatMap((d) => svgToPaths(d, r.x, r.y)),
            paint(mode, r.fill, r.layer),
            r.stroke ? paint(mode, r.stroke.fill, r.stroke.layer) : undefined,
            r.stroke?.w,
          ));
        } else if (r.kind === "image") {
          // Missing pixels is a no-op on EITHER plate — checked BEFORE the
          // mask branch in rasterItemLayer, matching the PDF and canvas
          // backends: painting the footprint anyway would lay solid white
          // ink under art the art plate never prints.
          const pixels = pixelsOf(r.asset);
          if (pixels) children.push(rasterItemLayer(name, r, pixels, mode));
        } else {
          children.push(barcodeLayer(name, r, fk, mode));
        }
      }
    }
    if (children.length) groups.push({ name, opened: false, children });
  }
  // PSD layer order is bottom-first, matching the PDF's draw order.
  return groups;
}

/** One barcode's merged shape layer, from its placed item — bars and digit
 *  glyph outlines both bezier. Both plates use that same outline; mask mode
 *  only swaps in the plate colours. The halo is the same editable outside
 *  stroke every other element carries, so Photoshop dilates bars and digit
 *  outlines alike. `S` (resolved outer-stroke width; 0 = no halo) gates the
 *  stroke identically to the PDF's own `if (S > 0)`. */
function barcodeLayer(name: string, bc: PlacedBarcode, fk: Font, mode: PsdMode): Layer {
  const S = bc.S;
  // Rotated (the template): anchorY is the string-start Y a `rotate(90)`
  // PDF drawText lands at (see digitGroupPaths for the derivation). Upright
  // (every custom barcode layer): anchorX needs the run's LEFT edge, since
  // bc.digits' `x` is the run's CENTER (see PlacedBarcode's own doc).
  const digitGroups = bc.digits.map((d) =>
    digitGroupPaths(
      fk, d.text, bc.textSize, bc.rotated,
      digitStartX(d, bc.rotated), d.y,
    ),
  );
  const barcodePaths: BezierPath[] = [
    ...bc.geo.bars.map((b) => rectPath(b.x, b.yTop, b.w, b.h)),
    ...digitGroups.flatMap((g) => g.paths),
  ];
  return shapeLayer(
    name, barcodePaths, paint(mode, bc.fill, bc.fillLayer),
    S > 0 ? strokePaint(mode, bc.stroke, bc.strokeLayer) : undefined, S,
  );
}

/** A planned raster image as one PSD layer — the ONE spelling of the
 *  raster-art rules: mask mode paints the fitted rect white-ink blue
 *  regardless of the layer's own fill/layer assignment (raster art prints
 *  on white ink — the same rule pdf/build.ts's drawItems applies), art mode
 *  resamples the natural-size pixels to the placed box. */
function rasterItemLayer(
  name: string, item: { x: number; y: number; w: number; h: number }, pixels: Rgba, mode: PsdMode,
): Layer {
  if (mode === "mask")
    return shapeLayer(name, [rectPath(item.x, item.y, item.w, item.h)], MASK_BLUE);
  const left = Math.round(pos(item.x));
  const top = Math.round(pos(item.y));
  const w = Math.max(1, Math.round(px(item.w)));
  const h = Math.max(1, Math.round(px(item.h)));
  return {
    name, left, top, right: left + w, bottom: top + h,
    imageData: { data: resizeRGBA(pixels, w, h), width: w, height: h },
  };
}

/** Nearest-neighbor resample of RGBA pixels to (dstW, dstH). A raster
 *  image's placed box can differ from its asset's native resolution — PSD
 *  layers hold pixels 1:1, so the box's own pixels have to be resampled
 *  here. Nearest-neighbor keeps this dependency-free (no canvas, so it runs
 *  identically from the browser and scripts/generate.ts's Node CLI);
 *  export-resolution raster art at print DPI rarely benefits from a
 *  smoother filter. */
function resizeRGBA(src: Rgba, dstW: number, dstH: number): Uint8Array {
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

/** Build the layered Photoshop file from the display list. Text layers
 *  carry no rendered bitmap, so Photoshop prompts to update them on open —
 *  that is expected; choosing "Update" redraws each from its text data.
 *
 *  `mode` picks the deliverable: "art" (default) or "mask" — the white-ink
 *  plate, mirroring buildMaskPdf (see PsdMode). `opts.layers` are the
 *  resolved layers the list was planned from (see PsdOpts). */
export async function buildPsd(
  items: readonly PlacedLayer[], assets: PsdAssets, mode: PsdMode = "art", opts: PsdOpts = {},
): Promise<Uint8Array> {
  // The merged barcode layer needs fontkit's raw glyph outlines for the
  // digits, which pdf-lib's PDFFont wrapper doesn't expose; openFont gives
  // back the underlying Font, whose glyph paths carry their outline commands.
  const digitFont = openFont(assets.fonts.regular);
  const psd: Psd = {
    width: PSD_DOC.w,
    height: PSD_DOC.h,
    // The export DPI, stated twice because readers disagree on where to look:
    // Photoshop/InDesign read ResolutionInfo (0x03ED); macOS ImageIO (Finder,
    // Preview, sips) ignores it and reads the XMP tiff: tags. Without them a
    // reader assumes 72 ppi and sizes the page ~8× too large (#338).
    imageResources: {
      resolutionInfo: {
        horizontalResolution: L.OUTPUT_DPI, horizontalResolutionUnit: "PPI", widthUnit: "Inches",
        verticalResolution: L.OUTPUT_DPI, verticalResolutionUnit: "PPI", heightUnit: "Inches",
      },
      xmpMetadata: `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`
        + `<rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/">`
        + `<tiff:XResolution>${L.OUTPUT_DPI}</tiff:XResolution><tiff:YResolution>${L.OUTPUT_DPI}</tiff:YResolution>`
        + `<tiff:ResolutionUnit>2</tiff:ResolutionUnit></rdf:Description></rdf:RDF></x:xmpmeta>`,
    },
    children: buildLayers(items, assets, digitFont, mode, opts),
  };
  return writePsdUint8Array(psd);
}
