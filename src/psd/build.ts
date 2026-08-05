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
// for a print-ready single-shape barcode. A "Barcode stroke" layer sits
// directly beneath it, mirroring the PDF's stroke halo; omitted when the
// resolved stroke width is 0 (cfg.barcodeStroke === "none" or an explicit
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
import type { Fill, LabelConfig } from "../types";
import * as L from "../layout";
import { barcodeGeometry, barcodeStrokePt } from "../barcode";
import { parseDescription } from "../description";
import { parseLogo } from "../logo";
import { qrShapes, qrUrl } from "../qr";
import { wrapWarning } from "../pdf/build";

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
}

/** Points -> pixels at the 600dpi deliverable. (layout.PX is the inverse —
 *  points per pixel — so deriving from it keeps one definition of the DPI.) */
const px = (n: number) => n / L.PX;
/** Document size in pixels. Exported so a caller can cover-fit the texture
 *  to it before handing the pixels over — PSD layers hold pixels 1:1. */
export const PSD_DOC = { w: Math.round(px(L.PAGE.w)), h: Math.round(px(L.PAGE.h)) };

const color255 = (fill: Fill) => {
  const c = L.parseHexFill(fill);
  return { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) };
};

// --- vector helpers -------------------------------------------------------

type Pt = [number, number];
const knot = (cIn: Pt, a: Pt, cOut: Pt) => ({
  linked: false,
  points: [...cIn, ...a, ...cOut].map(px),
});
/** A hard corner: both handles collapse onto the anchor. */
const corner = (x: number, y: number) => knot([x, y], [x, y], [x, y]);

const closed = (knots: ReturnType<typeof knot>[]): BezierPath => ({
  open: false,
  fillRule: "even-odd",
  knots,
});

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

function shapeLayer(name: string, paths: BezierPath[], fill: Fill): Layer {
  return {
    name,
    left: 0, top: 0, right: PSD_DOC.w, bottom: PSD_DOC.h,
    vectorFill: { type: "color", color: color255(fill) },
    vectorMask: { paths },
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
    rotated?: boolean;
    /** Letter-spacing in label points (Style.letterSpacing). */
    tracking?: number;
  },
): Layer {
  const t = px(opts.x);
  const b = px(opts.baseline);
  return {
    name,
    text: {
      text,
      transform: opts.rotated ? [0, -1, 1, 0, t, b] : [1, 0, 0, 1, t, b],
      style: {
        font: { name: PS_NAME[opts.face] },
        fontSize: px(opts.size),
        fillColor: color255(opts.fill),
        // Photoshop authors tracking in 1/1000 em, so the points-per-glyph
        // value converts against the type size — and needs no px() scaling,
        // being a ratio. Omitted at 0 so untracked layers stay exactly as
        // this builder has always written them.
        ...(opts.tracking ? { tracking: (opts.tracking / opts.size) * 1000 } : {}),
      },
    },
  };
}

const faceOf = (line: { bold?: boolean }): Face => (line.bold ? "semibold" : "regular");

// --- the label ------------------------------------------------------------

function buildLayers(cfg: LabelConfig, assets: PsdAssets, f: Faces, fk: FKFont): Layer[] {
  const groups: Layer[] = [];

  if (assets.texture) {
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
      fill: cfg.volume.fill, face: faceOf(cfg.volume), tracking: cfg.volume.letterSpacing,
    }),
    textLayer("ABV", `${cfg.abv}% alc by vol`, {
      x: L.ABV.x, baseline: L.ABV.baseline, size: L.ABV.size,
      fill: cfg.abvStyle.fill, face: "regular", tracking: cfg.abvStyle.letterSpacing,
    }),
  ];
  if (desc.header)
    left.push(
      textLayer("Description header", desc.header.text, {
        x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size,
        fill: desc.header.fill, face: faceOf(desc.header),
        tracking: desc.header.letterSpacing,
      }),
    );
  // One layer per line: the markdown subset styles lines individually, and a
  // single type layer would need style runs to express that.
  desc.lines.forEach((line, i) =>
    left.push(
      textLayer(`Description ${i + 1}`, line.text, {
        x: L.DESC.x, baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size,
        fill: line.fill, face: faceOf(line), tracking: line.letterSpacing,
      }),
    ),
  );
  groups.push({ name: "Left column", opened: false, children: left });

  // Center column ----------------------------------------------------------
  // Measure with the SAME face the layer renders in, or a bold style line
  // centres against regular metrics and sits off-centre.
  // Tracked, like the PDF's drawLine: a tracked line is wider than the font
  // measures it, and centring on the untracked width would leave it sitting
  // half a run's worth of spacing left of the centre line.
  const centered = (text: string, cx: number, size: number, face: Face, tracking = 0) =>
    cx - L.trackedWidth(f[face].widthOfTextAtSize(text, size), text, tracking) / 2;
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
        fill: cfg.wordmark.fill, face: "bold", tracking: cfg.wordmark.letterSpacing,
      }),
      shapeLayer("Logo", logoPaths, cfg.logo.fill),
      textLayer("Beer name", cfg.beerName.toUpperCase(), {
        x: centered(cfg.beerName.toUpperCase(), L.NAME.cx, L.NAME.size, "bold", cfg.nameStyle.letterSpacing),
        baseline: L.NAME.baseline, size: L.NAME.size,
        fill: cfg.nameStyle.fill, face: "bold", tracking: cfg.nameStyle.letterSpacing,
      }),
      textLayer("Style line", cfg.styleLine.text, {
        x: centered(cfg.styleLine.text, L.STYLE_LINE.cx, L.STYLE_LINE.size, faceOf(cfg.styleLine), cfg.styleLine.letterSpacing),
        baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size,
        fill: cfg.styleLine.fill, face: faceOf(cfg.styleLine), tracking: cfg.styleLine.letterSpacing,
      }),
    ],
  });

  // Right rotated column ---------------------------------------------------
  // Same tracked measure the PDF wraps with, so both deliverables break the
  // warning into the same columns.
  const warnLines = wrapWarning(
    (t) => L.trackedWidth(
      f.regular.widthOfTextAtSize(t, L.WARNING.size), t, cfg.warning.letterSpacing ?? 0,
    ),
    L.WARNING.maxLen,
  );
  groups.push({
    name: "Right column",
    opened: false,
    children: [
      textLayer("Handle / address", cfg.handleAddress.text, {
        x: L.HANDLE_ADDR.x, baseline: L.HANDLE_ADDR.yStart, size: L.HANDLE_ADDR.size,
        fill: cfg.handleAddress.fill, face: "semibold", rotated: true,
        tracking: cfg.handleAddress.letterSpacing,
      }),
      ...warnLines.map((line, i) =>
        textLayer(`Warning ${i + 1}`, line, {
          x: L.WARNING.x + i * L.WARNING.leading, baseline: L.WARNING.yStart,
          size: L.WARNING.size, fill: cfg.warning.fill, face: "regular", rotated: true,
          tracking: cfg.warning.letterSpacing,
        }),
      ),
      textLayer("Store cold", cfg.storeCold.text, {
        x: L.STORE_COLD.x, baseline: L.STORE_COLD.yStart, size: L.STORE_COLD.size,
        fill: cfg.storeCold.fill, face: "semibold", rotated: true,
        tracking: cfg.storeCold.letterSpacing,
      }),
    ],
  });

  // Codes ------------------------------------------------------------------
  groups.push({ name: "Codes", opened: false, children: codeLayers(cfg, f, fk) });
  // PSD layer order is bottom-first, matching the PDF's draw order.
  return groups;
}

/** QR (vector) + the barcode: one merged "Barcode" shape layer (bars and
 *  digit glyph outlines, both bezier, in cfg.barcodeFill) with an optional
 *  "Barcode stroke" layer directly beneath it, mirroring the PDF's halo. */
function codeLayers(cfg: LabelConfig, f: Faces, fk: FKFont): Layer[] {
  const q = qrShapes(qrUrl(cfg.beerName));
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
  // S = 0, which omits the layer entirely — matching the PDF's own `if
  // (S > 0)` gate so the two deliverables can't disagree on whether a halo
  // exists, or on how wide it is.
  const S = barcodeStrokePt(cfg);

  const layers: Layer[] = [shapeLayer("QR", qrPaths, cfg.qrFill)];
  if (S > 0) {
    // Bars: the same rect, expanded S on every side, matching the PDF's
    // stroke rectangles exactly. Digits: the PDF fakes glyph dilation with
    // 16-64 offset copies of the whole glyph under the fill (not
    // representable as clean vector geometry — its own comment says the
    // result "reads as a pill"). Approximated here as a plain axis-aligned
    // rect around each digit group's outline bbox, expanded by S — a
    // deliberate simplification, not a rounded pill; see the task report.
    const strokePaths: BezierPath[] = [
      ...geo.bars.map((b) => rectPath(b.x - S, b.yTop - S, b.w + 2 * S, b.h + 2 * S)),
      ...digitGroups.map((g) =>
        rectPath(
          g.bbox.minX - S,
          g.bbox.minY - S,
          g.bbox.maxX - g.bbox.minX + 2 * S,
          g.bbox.maxY - g.bbox.minY + 2 * S,
        ),
      ),
    ];
    layers.push(shapeLayer("Barcode stroke", strokePaths, cfg.barcodeStroke));
  }
  layers.push(shapeLayer("Barcode", barcodePaths, cfg.barcodeFill));
  return layers;
}

/** Build the layered Photoshop file. Text layers carry no rendered bitmap, so
 *  Photoshop prompts to update them on open — that is expected; choosing
 *  "Update" redraws each from its text data. */
export async function buildPsd(cfg: LabelConfig, assets: PsdAssets): Promise<Uint8Array> {
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
    children: buildLayers(cfg, assets, f, digitFont),
  };
  return writePsdUint8Array(psd);
}
