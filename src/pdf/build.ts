// build.ts — builds the two deliverable PDFs with pdf-lib. One element walk
// (drawElements) serves both: in "art" mode elements draw with their fill
// color over the texture; in "mask" mode metallic elements knock out (white)
// and white-layer elements paint mask blue. Both modes share the exact same
// geometry, so the pair stays registered.
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  degrees,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import svgpath from "svgpath";
import type { Fill, LabelConfig, Style, StyledLine } from "../types";
import { WARNING_TEXT } from "../defaults";
import * as L from "../layout";
import { encodeUpc } from "../upc";
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
   *  PNG. Optional: without it the white-ink layer is just the per-element
   *  assignments on a knockout page. */
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
 *  offset copies drawn under the fill — the barcode-digit technique, at 16
 *  directions so wider strokes stay round. */
function ring(w: number): [number, number][] {
  return Array.from({ length: 16 }, (_, i) => {
    const a = (i * Math.PI) / 8;
    return [w * Math.cos(a), w * Math.sin(a)];
  });
}

const y = (topY: number) => L.PAGE.h - topY; // top-left origin -> PDF space

/** Extract the logo's paths pre-scaled to `width` points. Per-path transforms
 *  (the mirrored branch) are applied, and the output is normalized to absolute
 *  M/L/C/Z commands with rounded coordinates — pdf-lib's drawSvgPath cannot
 *  handle relative/shorthand/arc/H/V commands or its own scale option's
 *  exponent-notation output. */
function parseLogo(svg: string, width: number): { paths: string[]; w: number; h: number } {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb) throw new Error("Could not parse logo SVG viewBox");
  const scale = width / +vb[1];
  const tags = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
  const paths = tags.map((tag) => {
    const d = tag.match(/ d="([^"]+)"/)?.[1];
    if (!d) throw new Error("Logo path is missing d attribute");
    const tf = tag.match(/ transform="([^"]+)"/)?.[1] ?? "";
    const out: string[] = [];
    svgpath(d)
      .transform(tf)
      .scale(scale)
      .abs()
      .unshort()
      .unarc()
      .round(4)
      .iterate((seg, _i, x, y) => {
        if (seg[0] === "H") out.push(`L ${seg[1]} ${y}`);
        else if (seg[0] === "V") out.push(`L ${x} ${seg[1]}`);
        else out.push(seg.join(" "));
      });
    return out.join(" ");
  });
  if (paths.length === 0) throw new Error("Could not parse logo SVG paths");
  return { paths, w: +vb[1] * scale, h: +vb[2] * scale };
}

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

/** Wrap the warning paragraph to fit the rotated column height. */
export function wrapWarning(font: PDFFont, size: number, maxLen: number): string[] {
  const words = WARNING_TEXT.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxLen && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function drawBarcode(page: PDFPage, fonts: Fonts, upcValue: string, mode: Mode) {
  const B = L.BARCODE;
  const S = B.stroke;
  if (mode === "mask") {
    // The footprint gets white ink so the code scans over the texture; it
    // covers the stroke too, so the mask matches the art's ink extent.
    page.drawRectangle({
      x: B.x - S,
      y: y(B.yTop + B.h + S),
      width: B.w + 2 * S,
      height: B.h + 2 * S,
      color: toRgb(L.COLORS.maskBlue),
    });
    return;
  }
  const { modules, guards } = encodeUpc(upcValue);
  const inGuard = (i: number) => guards.some(([a, b]) => i >= a && i < b);
  // Rotated layout: bars run horizontally, code advances bottom-to-top, and
  // the digits column sits to the RIGHT of the bars — the same arrangement
  // JsBarcode renders (bars, then the value row) turned a quarter turn.
  const runLen = B.h - 2 * B.padRun; // along the code
  const mod = runLen / modules.length;
  const barX = B.x + B.pad;
  // rotate(90) turns the glyph body toward -x, so this is the digit
  // baseline and the digits grow back toward the bars from it.
  const textX = barX + B.textOffset;
  const bottom = B.yTop + B.h - B.padRun;
  // Merge consecutive modules into one rect so a run draws as a single bar.
  // Runs never merge across a guard boundary, which keeps the tall guard
  // groups square-ended.
  const bars: { x: number; y: number; width: number; height: number }[] = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] !== "1") { i++; continue; }
    let j = i;
    while (j < modules.length && modules[j] === "1" && inGuard(j) === inGuard(i)) j++;
    bars.push({
      x: barX,
      // y() of the run's lowest module IS the rect's bottom edge in PDF space
      // (y grows upward past it) — subtracting the run height here again is
      // what used to smear runs below their slots.
      y: y(bottom - i * mod),
      // Guard groups run long, into the digits column (JsBarcode's guardHeight).
      width: inGuard(i) ? B.guardLen : B.barLen,
      height: (j - i) * mod,
    });
    i = j;
  }

  // Digits: the two five-digit groups centre under their 35-module halves;
  // `anchor` is a module position and "start"/"end" align the text's near or
  // far edge to it, which is JsBarcode's textAlign left/right for the outer
  // number-system and check digits.
  const place = (txt: string, anchor: number, align: "center" | "start" | "end" = "center") => {
    const w = fonts.regular.widthOfTextAtSize(txt, B.textSize);
    const half = w / 2 / mod;
    const center =
      align === "start" ? anchor + half : align === "end" ? anchor - half : anchor;
    return { txt, x: textX, y: y(bottom - center * mod) - w / 2 };
  };
  const quiet = B.padRun / mod; // the 8-module zone at each end
  const digits = [
    place(upcValue[0], -quiet, "start"), // number-system digit, before the symbol
    place(upcValue.slice(1, 6), 27.5), // centered on modules 10-45
    place(upcValue.slice(6, 11), 67.5), // centered on modules 50-85
    place(upcValue[11], modules.length + quiet, "end"), // check digit, after it
  ];
  const glyph = { size: B.textSize, font: fonts.regular, rotate: degrees(90) };

  // Outer stroke. EVERY white shape draws before ANY black one — that
  // ordering is what makes this safe. Interleaving the two (a white underlay
  // per bar, then its bar) lets a later stroke bite into an already-drawn
  // neighbour, which distorted the module widths until the code stopped
  // decoding. Between the dense bars the stroke closes into a solid field
  // and around the digits it reads as a pill, matching the reference's
  // white shape without a backing box.
  for (const r of bars)
    page.drawRectangle({
      x: r.x - S, y: r.y - S,
      width: r.width + 2 * S, height: r.height + 2 * S,
      color: toRgb(L.COLORS.white),
    });
  for (const d of digits)
    for (const [dx, dy] of ring(S))
      page.drawText(d.txt, { ...glyph, x: d.x + dx, y: d.y + dy, color: toRgb(L.COLORS.white) });

  // The artwork itself, at its exact geometry.
  for (const r of bars) page.drawRectangle({ ...r, color: toRgb(L.COLORS.black) });
  for (const d of digits)
    page.drawText(d.txt, { ...glyph, x: d.x, y: d.y, color: toRgb(L.COLORS.black) });
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
  const warnLines = wrapWarning(fonts.regular, L.WARNING.size, L.WARNING.maxLen);
  warnLines.forEach((line, i) =>
    drawRotated(page, fonts.regular, line, mode, cfg.warning, {
      x: L.WARNING.x + i * L.WARNING.leading, yStart: L.WARNING.yStart, size: L.WARNING.size,
    }),
  );
  drawRotated(page, fonts.semibold, cfg.storeCold.text, mode, cfg.storeCold, {
    x: L.STORE_COLD.x, yStart: L.STORE_COLD.yStart, size: L.STORE_COLD.size,
  });

  // Barcode
  drawBarcode(page, fonts, cfg.upc, mode);
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
  }
  drawElements(page, fonts, cfg, assets, "mask");
  doc.setTitle(`${cfg.beerName} white-ink layer`);
  return doc.save();
}
