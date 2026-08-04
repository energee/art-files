// build.ts — builds the layered Photoshop deliverable with ag-psd. Same
// LabelConfig and same layout.ts geometry as the PDF builder, re-expressed as
// PSD layers: every text element becomes an editable type layer, the logo /
// QR / barcode become vector shape layers (bezier paths, node-editable), and
// the texture is the one honest raster layer.
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
import { barcodeGeometry } from "../barcode";
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
  opts: { x: number; baseline: number; size: number; fill: Fill; face: Face; rotated?: boolean },
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
      },
    },
  };
}

const faceOf = (line: { bold?: boolean }): Face => (line.bold ? "semibold" : "regular");

// --- the label ------------------------------------------------------------

function buildLayers(cfg: LabelConfig, assets: PsdAssets, f: Faces): Layer[] {
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
      fill: cfg.volume.fill, face: faceOf(cfg.volume),
    }),
    textLayer("ABV", `${cfg.abv}% alc by vol`, {
      x: L.ABV.x, baseline: L.ABV.baseline, size: L.ABV.size,
      fill: cfg.abvStyle.fill, face: "regular",
    }),
  ];
  if (desc.header)
    left.push(
      textLayer("Description header", desc.header.text, {
        x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size,
        fill: desc.header.fill, face: faceOf(desc.header),
      }),
    );
  // One layer per line: the markdown subset styles lines individually, and a
  // single type layer would need style runs to express that.
  desc.lines.forEach((line, i) =>
    left.push(
      textLayer(`Description ${i + 1}`, line.text, {
        x: L.DESC.x, baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size,
        fill: line.fill, face: faceOf(line),
      }),
    ),
  );
  groups.push({ name: "Left column", opened: false, children: left });

  // Center column ----------------------------------------------------------
  // Measure with the SAME face the layer renders in, or a bold style line
  // centres against regular metrics and sits off-centre.
  const centered = (text: string, cx: number, size: number, face: Face) =>
    cx - f[face].widthOfTextAtSize(text, size) / 2;
  const logo = parseLogo(assets.logoSvg, L.LOGO.w);
  const logoPaths = logo.paths.flatMap((d) =>
    svgToPaths(d, L.LOGO.cx - logo.w / 2, L.LOGO.cy - logo.h / 2),
  );
  groups.push({
    name: "Center",
    opened: false,
    children: [
      textLayer("Wordmark", L.WORDMARK.text, {
        x: centered(L.WORDMARK.text, L.WORDMARK.cx, L.WORDMARK.size, "bold"),
        baseline: L.WORDMARK.baseline, size: L.WORDMARK.size,
        fill: cfg.wordmark.fill, face: "bold",
      }),
      shapeLayer("Logo", logoPaths, cfg.logo.fill),
      textLayer("Beer name", cfg.beerName.toUpperCase(), {
        x: centered(cfg.beerName.toUpperCase(), L.NAME.cx, L.NAME.size, "bold"),
        baseline: L.NAME.baseline, size: L.NAME.size,
        fill: cfg.nameStyle.fill, face: "bold",
      }),
      textLayer("Style line", cfg.styleLine.text, {
        x: centered(cfg.styleLine.text, L.STYLE_LINE.cx, L.STYLE_LINE.size, faceOf(cfg.styleLine)),
        baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size,
        fill: cfg.styleLine.fill, face: faceOf(cfg.styleLine),
      }),
    ],
  });

  // Right rotated column ---------------------------------------------------
  const warnLines = wrapWarning(f.regular, L.WARNING.size, L.WARNING.maxLen);
  groups.push({
    name: "Right column",
    opened: false,
    children: [
      textLayer("Handle / address", cfg.handleAddress.text, {
        x: L.HANDLE_ADDR.x, baseline: L.HANDLE_ADDR.yStart, size: L.HANDLE_ADDR.size,
        fill: cfg.handleAddress.fill, face: "semibold", rotated: true,
      }),
      ...warnLines.map((line, i) =>
        textLayer(`Warning ${i + 1}`, line, {
          x: L.WARNING.x + i * L.WARNING.leading, baseline: L.WARNING.yStart,
          size: L.WARNING.size, fill: cfg.warning.fill, face: "regular", rotated: true,
        }),
      ),
      textLayer("Store cold", cfg.storeCold.text, {
        x: L.STORE_COLD.x, baseline: L.STORE_COLD.yStart, size: L.STORE_COLD.size,
        fill: cfg.storeCold.fill, face: "semibold", rotated: true,
      }),
    ],
  });

  // Codes ------------------------------------------------------------------
  groups.push({ name: "Codes", opened: false, children: codeLayers(cfg, f) });
  // PSD layer order is bottom-first, matching the PDF's draw order.
  return groups;
}

/** QR + barcode: all vector, plus the barcode's digits as type layers. */
function codeLayers(cfg: LabelConfig, f: Faces): Layer[] {
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

  return [
    shapeLayer("QR", qrPaths, cfg.qrFill),
    shapeLayer(
      "Barcode bars",
      geo.bars.map((b) => rectPath(b.x, b.yTop, b.w, b.h)),
      "#1A1A1A",
    ),
    ...geo.digits.map((d) =>
      textLayer(`UPC ${d.text}`, d.text, {
        x: d.x,
        baseline: geo.bottom - d.center * geo.mod + measure(d.text) / 2,
        size: B.textSize, fill: "#1A1A1A", face: "regular", rotated: true,
      }),
    ),
  ];
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
  const psd: Psd = {
    width: PSD_DOC.w,
    height: PSD_DOC.h,
    children: buildLayers(cfg, assets, f),
  };
  return writePsdUint8Array(psd);
}
