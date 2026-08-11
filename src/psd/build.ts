// build.ts — builds the layered Photoshop deliverable with ag-psd. Same
// LabelConfig and same layout.ts geometry as the PDF builder, re-expressed as
// PSD layers: every text element becomes an editable type layer except the
// barcode, the logo / QR / barcode bars+digits become vector shape layers
// (bezier paths, node-editable), and the texture is the one honest raster
// layer.
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
import * as L from "../layout";
import { barcodeFootprint, barcodeGeometry, barcodeStrokePt } from "../barcode";
import { parseDescription, parseInfoLine, parseRuns } from "../description";
import { parseLogo } from "../logo";
import { qrShapes, qrUrl } from "../qr";
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
/** PostScript names, which is what Photoshop resolves the type layer against. */
const PS_NAME = {
  regular: "Poppins-Regular",
  semibold: "Poppins-SemiBold",
  bold: "Poppins-Bold",
} as const;
type Face = keyof typeof PS_NAME;

/** One editable type layer. `x`/`baseline` are in label points; `rotated`
 *  applies the same quarter turn the PDF's drawRotated does (text reads
 *  bottom-to-top), expressed purely in the affine transform. */
function textLayer(
  name: string,
  text: string,
  opts: {
    x: number; baseline: number; size: number; fill: Fill; face: Face;
    /** Face an inline `**bold**` run steps up to. Defaults to semibold,
     *  matching drawLine; the rotated Info column passes bold, since its
     *  unmarked text is already semibold. */
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
    /** Justify every line to the full measure, the way drawJustifiedRotated
     *  spaces the warning's columns. */
    justify?: boolean;
    /** Outer stroke, as an editable Photoshop layer EFFECT. The PDF fakes
     *  the same stroke as a ring of offset text copies (pdf-lib cannot
     *  stroke text); Photoshop has the real thing, so the PSD uses it. */
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
          font: { name: PS_NAME[r.bold ? boldFace : opts.face] },
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
        font: { name: PS_NAME[opts.face] },
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
}

const faceOf = (line: { bold?: boolean }): Face => (line.bold ? "semibold" : "regular");

// --- the label ------------------------------------------------------------

function buildLayers(
  cfg: LabelConfig, assets: PsdAssets, f: Faces, fk: FKFont, mode: PsdMode,
): Layer[] {
  const groups: Layer[] = [];
  /** This mode's paint for a styled element. */
  const P = (s: { fill: Fill; layer: "metallic" | "white" }) => paint(mode, s.fill, s.layer);

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
  // Measure with the SAME face the layer renders in, or a bold style line
  // centres against regular metrics and sits off-centre.
  // Tracked, like the PDF's drawLine: a tracked line is wider than the font
  // measures it, and centring on the untracked width would leave it sitting
  // half a run's worth of spacing left of the centre line.
  // Measured over inline runs, like both PDF passes: the layer holds the
  // marker-STRIPPED text (see textLayer), so centring the raw markdown would
  // shove a marked-up line right by the markers' own width. A bold run also
  // measures in the bold face, which is what it draws in.
  const centered = (text: string, cx: number, size: number, face: Face, tracking = 0) =>
    cx - L.runsWidth(
      parseRuns({ text, fill: "none", layer: "metallic" }),
      (r) => f[r.bold ? "bold" : face].widthOfTextAtSize(r.text, size),
      tracking,
    ) / 2;
  const logo = parseLogo(assets.logoSvg, L.LOGO.w);
  // Same nudge the PDFs apply, so the PSD stays registered with them.
  const logoCy = L.LOGO.cy + (cfg.logo.offsetY ?? 0);
  const logoPaths = logo.paths.flatMap((d) =>
    svgToPaths(d, L.LOGO.cx - logo.w / 2, logoCy - logo.h / 2),
  );
  groups.push({
    name: "Center",
    opened: false,
    children: [
      textLayer("Wordmark", L.WORDMARK.text, {
        x: centered(L.WORDMARK.text, L.WORDMARK.cx, L.WORDMARK.size, "bold", cfg.wordmark.letterSpacing),
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
        x: centered(displayName(cfg).toUpperCase(), L.NAME.cx, L.NAME.size, "bold", cfg.nameStyle.letterSpacing),
        baseline: L.NAME.baseline, size: L.NAME.size,
        fill: P(cfg.nameStyle), face: "bold", tracking: cfg.nameStyle.letterSpacing,
        stroke: cfg.nameStyle.stroke, strokeLayer: cfg.nameStyle.strokeLayer,
        strokeWidth: cfg.nameStyle.strokeWidth, mode,
      }),
      textLayer("Style line", displayStyle(cfg), {
        x: centered(displayStyle(cfg), L.STYLE_LINE.cx, L.STYLE_LINE.size, faceOf(cfg.styleLine), cfg.styleLine.letterSpacing),
        baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size,
        fill: P(cfg.styleLine), face: faceOf(cfg.styleLine), tracking: cfg.styleLine.letterSpacing,
        stroke: cfg.styleLine.stroke, strokeLayer: cfg.styleLine.strokeLayer,
        strokeWidth: cfg.styleLine.strokeWidth, mode,
      }),
    ],
  });

  // Right rotated column ---------------------------------------------------
  // Same tracked measure the PDF wraps with, so both deliverables break the
  // warning into the same columns.
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
  groups.push({ name: "Codes", opened: false, children: codeLayers(cfg, f, fk, mode) });
  // PSD layer order is bottom-first, matching the PDF's draw order.
  return groups;
}

/** QR (vector) + the barcode: one merged "Barcode" shape layer (bars and
 *  digit glyph outlines, both bezier, in cfg.barcodeFill) with an optional
 *  "Barcode stroke" layer directly beneath it, mirroring the PDF's halo. */
function codeLayers(cfg: LabelConfig, f: Faces, fk: FKFont, mode: PsdMode): Layer[] {
  const q = qrShapes(qrUrl(displayName(cfg)));
  const ms = q.moduleSize * L.QR.size;
  const at = (u: number, axis: "x" | "y") =>
    u * L.QR.size + (axis === "x" ? L.QR.x : L.QR.yTop);
  const qrPaths: BezierPath[] = [
    ...q.dots.map((d) => circlePath(at(d.cx, "x"), at(d.cy, "y"), ms * 0.5 * 0.92)),
    // Three concentric circles per finder; even-odd turns the middle one
    // into a hole and the innermost back into a dot, no winding tricks.
    ...q.finders.flatMap((p) =>
      [3.5 * ms * 0.95, 2.3 * ms, 1.4 * ms].map((r) =>
        circlePath(at(p.cx, "x"), at(p.cy, "y"), r),
      ),
    ),
  ];

  // Geometry is shared with the PDF builder (see ../barcode) so the two
  // deliverables cannot drift on the one element where drift stops it
  // scanning.
  const B = L.BARCODE;
  const measure = (t: string) => f.regular.widthOfTextAtSize(t, B.textSize);
  const geo = barcodeGeometry(cfg.upc, measure);

  // yStart is exactly what the old digit TYPE layers used as `baseline` —
  // the string-start Y a `rotate(90)` PDF drawText lands at (see
  // digitGroupPaths for the derivation); keeping this identical is what
  // makes the outlines land where the type layers used to.
  const digitGroups = geo.digits.map((d) =>
    digitGroupPaths(fk, d.text, B.textSize, d.x, geo.bottom - d.center * geo.mod + measure(d.text) / 2),
  );
  const barcodePaths: BezierPath[] = [
    ...geo.bars.map((b) => rectPath(b.x, b.yTop, b.w, b.h)),
    ...digitGroups.flatMap((g) => g.paths),
  ];

  // Resolved outer-stroke width, from the SAME shared resolver the PDF's
  // drawBarcode uses (barcodeStrokePt in ../barcode) rather than a second
  // copy of the expression. "none" or an explicit zero width both collapse to
  // S = 0, which omits the stroke effect entirely — matching the PDF's own `if
  // (S > 0)` gate so the two deliverables can't disagree on whether a halo
  // exists, or on how wide it is.
  const S = barcodeStrokePt(cfg);

  const qr = shapeLayer(
    "QR", qrPaths, paint(mode, cfg.qrFill, cfg.qrLayer),
    strokePaint(mode, cfg.qrStroke, cfg.qrStrokeLayer), cfg.qrStrokeWidth,
  );

  if (mode === "mask") {
    // Preserve the mask PDF's deliberate underprint geometry: exact bar
    // rectangles plus one glyph-box pill per digit group. The editable
    // outside effect expands that base footprint by the same S as the PDF's
    // stroke pass while keeping its color independent from the fill.
    const footprint: BezierPath[] = barcodeFootprint(geo, 0, measure)
      .map((r) => ({ ...rectPath(r.x, r.yTop, r.w, r.h), operation: "combine" as const }));
    return [
      qr,
      shapeLayer(
        "Barcode", footprint, paint(mode, cfg.barcodeFill, cfg.barcodeLayer),
        S > 0 ? strokePaint(mode, cfg.barcodeStroke, cfg.barcodeStrokeLayer) : undefined,
        px(S),
      ),
    ];
  }

  // The halo is the same editable stroke effect every other element carries
  // (position outside, so Photoshop dilates bars and digit outlines alike and
  // unions the result) — replacing the old approximate "Barcode stroke" rect
  // layer. strokeEffect wants px @600dpi; S resolves in points, so convert.
  return [
    qr,
    shapeLayer(
      "Barcode", barcodePaths, paint(mode, cfg.barcodeFill, cfg.barcodeLayer),
      S > 0 ? strokePaint(mode, cfg.barcodeStroke, cfg.barcodeStrokeLayer) : undefined,
      px(S),
    ),
  ];
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
