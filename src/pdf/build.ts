// build.ts — builds the two deliverable PDFs with pdf-lib. One element walk
// (drawElements) serves both: in "art" mode elements draw with their fill
// color over the texture; in "mask" mode metallic elements knock out (white)
// and white-layer elements paint mask blue. Both modes share the exact same
// geometry, so the pair stays registered.
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFFont,
  PDFPage,
  degrees,
  rgb,
  setLineCap,
  setLineJoin,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Fill, LabelConfig, Style, StyledLine } from "../types";
import { parseLogo } from "../logo";
import { WARNING_TEXT } from "../defaults";
import * as L from "../layout";
import { barcodeGeometry, barcodeStrokePt } from "../barcode";
import { qrPath, qrShapes, qrUrl } from "../qr";
import { parseDescription } from "../description";

export interface Assets {
  fonts: { regular: Uint8Array; semibold: Uint8Array; bold: Uint8Array };
  /** Raw contents of logo2025.svg. */
  logoSvg: string;
  /** Optional: without it the art PDF is just the elements on bare stock,
   *  which is what the preview shows before a texture is dropped. */
  texture?: { bytes: Uint8Array; kind: "png" | "jpg" };
  /** Mask recolored to blue/transparent (see maskimage.ts), re-encoded as
   *  PNG. Optional: without it buildMaskPdf floods the whole page white-ink
   *  blue instead ("no mask" = "print as a white label"), and the per-element
   *  assignments (metallic knockouts, white-layer ink) draw on top of that. */
  maskPng?: Uint8Array;
}

interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
}

type Mode = "art" | "mask";

const toRgb = (c: { r: number; g: number; b: number }) => rgb(c.r, c.g, c.b);

function fillColor(fill: Fill) {
  return toRgb(L.parseHexFill(fill));
}

/** Mask-mode paint for an element: knockout (white) or white-ink (blue). */
function maskColor(layer: "metallic" | "white") {
  return layer === "metallic" ? toRgb(L.COLORS.white) : toRgb(L.COLORS.maskBlue);
}

/** Outer-stroke params for an element (art mode only), or null when off.
 *  Widths are authored in px at the 600dpi deliverable. */
function strokeOf(style: Style, mode: Mode) {
  if (mode !== "art" || !style.stroke || style.stroke === "none") return null;
  return { color: fillColor(style.stroke), w: (style.strokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX };
}

/** pdf-lib can't stroke text, so an outer stroke is faked as a ring of
 *  offset copies drawn under the fill. The sample count scales with the
 *  radius — a fixed count leaves adjacent copies 2w*sin(pi/n) apart, which
 *  at a wide stroke reads as stair-steps down the outer edge. One sample
 *  per ~0.4pt of circumference keeps that step below a printer's dot. */
function ring(w: number): [number, number][] {
  // Capped only as a backstop: each sample is its own drawText, so an
  // uncapped count would let a stroke width become a build-time amplifier
  // (600px measured at ~18k calls / 700ms, outlasting the 600ms debounce).
  // The UI now clamps width at 60px (StyleProperties' stroke-width input),
  // i.e. 7.2pt, where the 0.4pt rule asks for n = 114 — so the ceiling sits
  // at 128 and never binds in practice. The old cap of 64 DID bind above
  // ~34px and broke the spacing guarantee: at 60px it left adjacent copies
  // 2w*sin(pi/64) ~ 0.71pt apart, ~6 device dots at 600dpi, which prints as
  // a visibly scalloped outer edge.
  const n = Math.min(128, Math.max(16, Math.ceil((2 * Math.PI * w) / 0.4)));
  return Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n;
    return [w * Math.cos(a), w * Math.sin(a)];
  });
}

const y = (topY: number) => L.PAGE.h - topY; // top-left origin -> PDF space

function drawLine(
  page: PDFPage,
  fonts: Fonts,
  line: StyledLine,
  mode: Mode,
  opts: { x?: number; cx?: number; baseline: number; size: number; font?: PDFFont },
) {
  const font = opts.font ?? (line.bold ? fonts.semibold : fonts.regular);
  const color = mode === "art" ? fillColor(line.fill) : maskColor(line.layer);
  const x =
    opts.cx !== undefined
      ? opts.cx - font.widthOfTextAtSize(line.text, opts.size) / 2
      : opts.x!;
  const at = { y: y(opts.baseline), size: opts.size, font };
  const stroke = strokeOf(line, mode);
  if (stroke)
    for (const [dx, dy] of ring(stroke.w))
      page.drawText(line.text, { ...at, x: x + dx, y: at.y + dy, color: stroke.color });
  page.drawText(line.text, { ...at, x, color });
}

/** Rotated 90deg CCW text (reads bottom-to-top). x = baseline vertical line,
 *  yStart = where the first character sits (toward the label bottom). */
function drawRotated(
  page: PDFPage,
  font: PDFFont,
  text: string,
  mode: Mode,
  style: Style,
  opts: { x: number; yStart: number; size: number },
) {
  const color = mode === "art" ? fillColor(style.fill) : maskColor(style.layer);
  const base = { size: opts.size, font, rotate: degrees(90) };
  const stroke = strokeOf(style, mode);
  if (stroke)
    for (const [dx, dy] of ring(stroke.w))
      page.drawText(text, { ...base, x: opts.x + dx, y: y(opts.yStart) + dy, color: stroke.color });
  page.drawText(text, { ...base, x: opts.x, y: y(opts.yStart), color });
}

/** Wrap the warning paragraph to fit the rotated column height. `measure`
 *  returns a string's width at WARNING.size in points — passed in (rather
 *  than a PDFFont) so the hit-tester can derive the SAME column count and
 *  per-column length from its own measure without importing font machinery;
 *  the number of columns is a wrap result, never a constant. */
export function wrapWarning(measure: (text: string) => number, maxLen: number): string[] {
  const words = WARNING_TEXT.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) > maxLen && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Approximate glyph box for the barcode digits' mask pills: ascender
 *  1.05em above the baseline, descender 0.35em below — the same measured
 *  Poppins font box hittest.ts uses. Duplicated rather than imported:
 *  hittest.ts already imports wrapWarning from this module, so importing
 *  the other way would make a cycle. */
const DIGIT_ASC = 1.05;
const DIGIT_DESC = 0.35;

/** The barcode, in both modes. `cfg` (not just the UPC digits) because both
 *  branches below resolve their geometry from the same barcode* style fields
 *  — see S. */
export function drawBarcode(page: PDFPage, fonts: Fonts, cfg: LabelConfig, mode: Mode) {
  const B = L.BARCODE;
  // Resolved outer-stroke width, in points — from the shared resolver in
  // ../barcode, which the PSD builder reads too. BOTH branches below read
  // this one value: if the mask's footprint stopped matching the art's ink
  // extent, the white-ink plate would fringe against the printed artwork.
  const S = barcodeStrokePt(cfg);
  // Rotated layout: bars run horizontally, the code advances bottom-to-top,
  // and the digits column sits to the RIGHT of the bars — the same
  // arrangement JsBarcode renders, turned a quarter turn. The geometry
  // itself is shared with the PSD builder (see ../barcode), and BOTH modes
  // below read the same bars/digits so the mask's footprint can't drift
  // from what the art pass actually inks.
  const geo = barcodeGeometry(cfg.upc, (t) => fonts.regular.widthOfTextAtSize(t, B.textSize));
  // y() of a run's lowest module IS the rect's bottom edge in PDF space, so
  // the top-origin box converts by its far edge.
  const bars = geo.bars.map((b) => ({
    x: b.x, y: y(b.yTop + b.h), width: b.w, height: b.h,
  }));
  // rotate(90) turns the glyph body toward -x, so `x` is the baseline and the
  // digits grow back toward the bars from it. `w` (the glyph run's length)
  // is kept alongside for the mask's digit pills below.
  const digits = geo.digits.map((d) => {
    const w = fonts.regular.widthOfTextAtSize(d.text, B.textSize);
    return { txt: d.text, x: d.x, y: y(geo.bottom - d.center * geo.mod) - w / 2, w };
  });
  const glyph = { size: B.textSize, font: fonts.regular, rotate: degrees(90) };

  if (mode === "mask") {
    // The true footprint the art pass inks: one outset rect per bar (the
    // same ±S outset the art halo pass draws below) plus a pill per digit
    // group — the rect the art's ring-of-copies halo approximates — around
    // its glyph box expanded by S. At S=0 (stroke "none") this reduces to
    // exactly the bars' and digits' own ink, still needed under the ink for
    // scan contrast. A single bounding rect used to stand in for all of
    // this; that under-covered the gaps between bars and the digit column,
    // which can unprint the code on a textured stock.
    const color = maskColor(cfg.barcodeLayer);
    for (const r of bars)
      page.drawRectangle({
        x: r.x - S, y: r.y - S, width: r.width + 2 * S, height: r.height + 2 * S, color,
      });
    for (const d of digits) {
      const x0 = d.x - DIGIT_ASC * B.textSize - S;
      const x1 = d.x + DIGIT_DESC * B.textSize + S;
      page.drawRectangle({ x: x0, y: d.y - S, width: x1 - x0, height: d.w + 2 * S, color });
    }
    return;
  }

  // Outer stroke, skipped entirely at S = 0 — ring(0) would emit 16 identical
  // copies at zero offset. EVERY stroke shape draws before ANY fill one —
  // that ordering is what makes this safe. Interleaving the two (an underlay
  // per bar, then its bar) lets a later stroke bite into an already-drawn
  // neighbour, which distorted the module widths until the code stopped
  // decoding. Between the dense bars the stroke closes into a solid field
  // and around the digits it reads as a pill, matching the reference's
  // white shape without a backing box.
  if (S > 0) {
    const strokeColor = fillColor(cfg.barcodeStroke);
    const ringS = ring(S); // loop-invariant
    for (const r of bars)
      page.drawRectangle({
        x: r.x - S, y: r.y - S,
        width: r.width + 2 * S, height: r.height + 2 * S,
        color: strokeColor,
      });
    for (const d of digits)
      for (const [dx, dy] of ringS)
        page.drawText(d.txt, { ...glyph, x: d.x + dx, y: d.y + dy, color: strokeColor });
  }

  // The artwork itself, at its exact geometry.
  const ink = fillColor(cfg.barcodeFill);
  for (const r of bars) page.drawRectangle({ ...r, color: ink });
  for (const d of digits) page.drawText(d.txt, { ...glyph, x: d.x, y: d.y, color: ink });
}

function drawElements(
  page: PDFPage,
  fonts: Fonts,
  cfg: LabelConfig,
  assets: Assets,
  mode: Mode,
) {
  // Left column
  drawLine(page, fonts, cfg.volume, mode, { x: L.VOLUME.x, baseline: L.VOLUME.baseline, size: L.VOLUME.size });
  drawLine(page, fonts, { text: `${cfg.abv}% alc by vol`, ...cfg.abvStyle }, mode, {
    x: L.ABV.x, baseline: L.ABV.baseline, size: L.ABV.size,
  });
  const desc = parseDescription(cfg.description, cfg.descStyle);
  if (desc.header)
    drawLine(page, fonts, desc.header, mode, {
      x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size,
    });
  desc.lines.forEach((line, i) =>
    drawLine(page, fonts, line, mode, {
      x: L.DESC.x, baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size,
    }),
  );

  // Center column. Wordmark and beer name use the Bold face — the reference
  // label sets both in the same heavy weight.
  drawLine(page, fonts, { text: L.WORDMARK.text, ...cfg.wordmark, bold: true }, mode, {
    cx: L.WORDMARK.cx, baseline: L.WORDMARK.baseline, size: L.WORDMARK.size, font: fonts.bold,
  });
  const logo = parseLogo(assets.logoSvg, L.LOGO.w);
  const logoColor = mode === "art" ? fillColor(cfg.logo.fill) : maskColor(cfg.logo.layer);
  const logoAt = { x: L.LOGO.cx - logo.w / 2, y: y(L.LOGO.cy - logo.h / 2) };
  // Outer stroke: a centered border at 2w extends w beyond the shape; the
  // fill pass on top then covers the inner half. All stroke paths draw
  // before any fill so overlapping laurel branches keep clean edges.
  const logoStroke = strokeOf(cfg.logo, mode);
  if (logoStroke)
    for (const d of logo.paths)
      page.drawSvgPath(d, {
        ...logoAt,
        color: logoStroke.color,
        borderColor: logoStroke.color,
        borderWidth: 2 * logoStroke.w,
      });
  for (const d of logo.paths) page.drawSvgPath(d, { ...logoAt, color: logoColor });
  drawLine(page, fonts, { text: cfg.beerName.toUpperCase(), ...cfg.nameStyle, bold: true }, mode, {
    cx: L.NAME.cx, baseline: L.NAME.baseline, size: L.NAME.size, font: fonts.bold,
  });
  drawLine(page, fonts, cfg.styleLine, mode, {
    cx: L.STYLE_LINE.cx, baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size,
  });

  // QR — payload derived from the beer name; optional stroked underlay.
  const shapes = qrShapes(qrUrl(cfg.beerName));
  const qrAt = { x: L.QR.x, y: y(L.QR.yTop) };
  if (mode === "art" && cfg.qrStroke !== "none")
    page.drawSvgPath(
      qrPath(shapes, L.QR.size, (cfg.qrStrokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX),
      { ...qrAt, color: fillColor(cfg.qrStroke) },
    );
  const qrColor = mode === "art" ? fillColor(cfg.qrFill) : maskColor(cfg.qrLayer);
  page.drawSvgPath(qrPath(shapes, L.QR.size), { ...qrAt, color: qrColor });

  // Right rotated column
  drawRotated(page, fonts.semibold, cfg.handleAddress.text, mode, cfg.handleAddress, {
    x: L.HANDLE_ADDR.x, yStart: L.HANDLE_ADDR.yStart, size: L.HANDLE_ADDR.size,
  });
  const warnLines = wrapWarning(
    (t) => fonts.regular.widthOfTextAtSize(t, L.WARNING.size), L.WARNING.maxLen,
  );
  warnLines.forEach((line, i) =>
    drawRotated(page, fonts.regular, line, mode, cfg.warning, {
      x: L.WARNING.x + i * L.WARNING.leading, yStart: L.WARNING.yStart, size: L.WARNING.size,
    }),
  );
  drawRotated(page, fonts.semibold, cfg.storeCold.text, mode, cfg.storeCold, {
    x: L.STORE_COLD.x, yStart: L.STORE_COLD.yStart, size: L.STORE_COLD.size,
  });

  // Barcode
  drawBarcode(page, fonts, cfg, mode);
}

async function newDoc(assets: Assets): Promise<{ doc: PDFDocument; page: PDFPage; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await doc.embedFont(assets.fonts.regular, { subset: true }),
    semibold: await doc.embedFont(assets.fonts.semibold, { subset: true }),
    bold: await doc.embedFont(assets.fonts.bold, { subset: true }),
  };
  const page = doc.addPage([L.PAGE.w, L.PAGE.h]);
  // Round every stroke join and cap for the whole page. pdf-lib has no
  // per-draw option for this, so it goes in as a graphics-state operator up
  // front; PDF's default is a MITER join, which shoots long spikes off any
  // acute corner — very visible on the laurel's leaf tips.
  page.pushOperators(setLineJoin(LineJoinStyle.Round), setLineCap(LineCapStyle.Round));
  return { doc, page, fonts };
}

/** Cover-fit an embedded image over the full bleed page, centered. */
function coverPage(page: PDFPage, img: { width: number; height: number }) {
  const s = Math.max(L.PAGE.w / img.width, L.PAGE.h / img.height);
  const w = img.width * s;
  const h = img.height * s;
  return { x: (L.PAGE.w - w) / 2, y: (L.PAGE.h - h) / 2, width: w, height: h };
}

export async function buildArtPdf(cfg: LabelConfig, assets: Assets): Promise<Uint8Array> {
  const { doc, page, fonts } = await newDoc(assets);
  if (assets.texture) {
    const img =
      assets.texture.kind === "png"
        ? await doc.embedPng(assets.texture.bytes)
        : await doc.embedJpg(assets.texture.bytes);
    page.drawImage(img, coverPage(page, img));
  }
  drawElements(page, fonts, cfg, assets, "art");
  doc.setTitle(`${cfg.beerName} label art`);
  return doc.save();
}

export async function buildMaskPdf(cfg: LabelConfig, assets: Assets): Promise<Uint8Array> {
  const { doc, page, fonts } = await newDoc(assets);
  // White page = knockout by default; the recolored mask paints the blue
  // (white ink) regions, then elements knock out or add ink on top.
  page.drawRectangle({ x: 0, y: 0, width: L.PAGE.w, height: L.PAGE.h, color: rgb(1, 1, 1) });
  if (assets.maskPng) {
    const img = await doc.embedPng(assets.maskPng);
    page.drawImage(img, coverPage(page, img));
  } else {
    // No mask uploaded yet: flood the whole plate with white ink rather than
    // leaving it knocked out. "No mask" means "print as a white label" —
    // white ink everywhere, with only the metallic elements (drawn next, in
    // drawElements) knocking back out to bare stock. This MUST land before
    // drawElements so metallic knockouts still win on top of the flood.
    page.drawRectangle({ x: 0, y: 0, width: L.PAGE.w, height: L.PAGE.h, color: toRgb(L.COLORS.maskBlue) });
  }
  drawElements(page, fonts, cfg, assets, "mask");
  doc.setTitle(`${cfg.beerName} white-ink layer`);
  return doc.save();
}
