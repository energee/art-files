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
import type { Fill, LabelConfig, StyledLine } from "../types";
import { WARNING_TEXT } from "../defaults";
import * as L from "../layout";
import { encodeUpc } from "../upc";
import { qrPath, qrShapes } from "../qr";
import { parseDescription } from "../description";

export interface Assets {
  fonts: { regular: Uint8Array; semibold: Uint8Array; bold: Uint8Array };
  /** Raw contents of logo2025.svg. */
  logoSvg: string;
  texture: { bytes: Uint8Array; kind: "png" | "jpg" };
  /** Mask recolored to blue/transparent (see maskimage.ts), re-encoded as PNG. */
  maskPng: Uint8Array;
}

interface Fonts {
  regular: PDFFont;
  semibold: PDFFont;
  bold: PDFFont;
}

type Mode = "art" | "mask";

const toRgb = (c: { r: number; g: number; b: number }) => rgb(c.r, c.g, c.b);

function fillColor(fill: Fill) {
  return toRgb(L.COLORS[fill]);
}

/** Mask-mode paint for an element: knockout (white) or white-ink (blue). */
function maskColor(layer: "metallic" | "white") {
  return layer === "metallic" ? toRgb(L.COLORS.white) : toRgb(L.COLORS.maskBlue);
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
  opts: { x?: number; cx?: number; baseline: number; size: number },
) {
  const font = line.bold ? fonts.semibold : fonts.regular;
  const color = mode === "art" ? fillColor(line.fill) : maskColor(line.layer);
  const x =
    opts.cx !== undefined
      ? opts.cx - font.widthOfTextAtSize(line.text, opts.size) / 2
      : opts.x!;
  page.drawText(line.text, { x, y: y(opts.baseline), size: opts.size, font, color });
}

/** Rotated 90deg CCW text (reads bottom-to-top). x = baseline vertical line,
 *  yStart = where the first character sits (toward the label bottom). */
function drawRotated(
  page: PDFPage,
  font: PDFFont,
  text: string,
  mode: Mode,
  style: { fill: Fill; layer: "metallic" | "white" },
  opts: { x: number; yStart: number; size: number },
) {
  const color = mode === "art" ? fillColor(style.fill) : maskColor(style.layer);
  page.drawText(text, {
    x: opts.x,
    y: y(opts.yStart),
    size: opts.size,
    font,
    color,
    rotate: degrees(90),
  });
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

function drawBarcode(page: PDFPage, fonts: Fonts, upcValue: string, mode: Mode) {
  const B = L.BARCODE;
  if (mode === "mask") {
    // The barcode footprint still gets white ink so the code scans over the
    // texture; bars themselves are not part of the mask.
    page.drawRectangle({
      x: B.x,
      y: y(B.yTop + B.h),
      width: B.w,
      height: B.h,
      color: toRgb(L.COLORS.maskBlue),
    });
    return;
  }
  // No background block: black bars sit on the texture, outlined in white
  // (stroked) for contrast — digits get the same treatment below.
  const { modules, guards } = encodeUpc(upcValue);
  const inGuard = (i: number) => guards.some(([a, b]) => i >= a && i < b);
  // Rotated layout: bars run horizontally, code advances bottom-to-top.
  const runLen = B.h - 2 * B.padRun; // along the code
  const mod = runLen / modules.length;
  const textZone = B.textSize + 1.5; // digits column on the left of the bars
  const barLen = B.w - 2 * B.pad - textZone;
  const barX = B.x + B.pad + textZone;
  const bottom = B.yTop + B.h - B.padRun;
  // Merge consecutive modules into single bars so strokes outline whole bars,
  // not the seams between modules. Guard runs never merge with digit runs
  // (guards are isolated single modules).
  let i = 0;
  while (i < modules.length) {
    if (modules[i] !== "1") { i++; continue; }
    let j = i;
    while (j < modules.length && modules[j] === "1" && inGuard(j) === inGuard(i)) j++;
    const ext = inGuard(i) ? textZone * 0.7 : 0;
    const rect = {
      x: barX - ext,
      y: y(bottom - i * mod) - (j - i) * mod, // run spans upward from the bottom
      width: barLen + ext,
      height: (j - i) * mod,
    };
    // White outline as an expanded underlay — a centered border would swallow
    // bars only ~1pt tall.
    const s = B.stroke;
    page.drawRectangle({
      x: rect.x - s, y: rect.y - s,
      width: rect.width + 2 * s, height: rect.height + 2 * s,
      color: toRgb(L.COLORS.white),
    });
    page.drawRectangle({ ...rect, color: toRgb(L.COLORS.black) });
    i = j;
  }
  // Digits: first and last outside the guards, two groups of five inside.
  // pdf-lib cannot stroke text, so fake it: white copies offset in a ring,
  // then the black digits on top.
  const put = (txt: string, centerModule: number) => {
    const w = fonts.regular.widthOfTextAtSize(txt, B.textSize);
    const base = {
      size: B.textSize,
      font: fonts.regular,
      rotate: degrees(90),
    };
    const tx = B.x + B.pad;
    const ty = y(bottom - centerModule * mod) - w / 2;
    const s = B.stroke;
    for (const [dx, dy] of [
      [-s, 0], [s, 0], [0, -s], [0, s],
      [-s, -s], [-s, s], [s, -s], [s, s],
    ])
      page.drawText(txt, { ...base, x: tx + dx, y: ty + dy, color: toRgb(L.COLORS.white) });
    page.drawText(txt, { ...base, x: tx, y: ty, color: toRgb(L.COLORS.black) });
  };
  put(upcValue[0], -8);
  put(upcValue.slice(1, 6), 24);
  put(upcValue.slice(6, 11), 71);
  put(upcValue[11], 103);
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
  const desc = parseDescription(cfg.description);
  if (desc.header)
    drawLine(page, fonts, desc.header, mode, {
      x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size,
    });
  desc.lines.forEach((line, i) =>
    drawLine(page, fonts, line, mode, {
      x: L.DESC.x, baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size,
    }),
  );

  // Center column
  drawLine(page, fonts, { text: L.WORDMARK.text, ...cfg.wordmark, bold: true }, mode, {
    cx: L.WORDMARK.cx, baseline: L.WORDMARK.baseline, size: L.WORDMARK.size,
  });
  const logo = parseLogo(assets.logoSvg, L.LOGO.w);
  const logoColor = mode === "art" ? fillColor(cfg.logo.fill) : maskColor(cfg.logo.layer);
  for (const d of logo.paths) {
    page.drawSvgPath(d, {
      x: L.LOGO.cx - logo.w / 2,
      y: y(L.LOGO.cy - logo.h / 2),
      color: logoColor,
      // Dark keyline around the gold laurel, as on the printed label.
      ...(mode === "art"
        ? { borderColor: toRgb(L.COLORS.black), borderWidth: 0.7 }
        : {}),
    });
  }
  drawLine(page, fonts, { text: cfg.beerName.toUpperCase(), ...cfg.nameStyle, bold: true }, mode, {
    cx: L.NAME.cx, baseline: L.NAME.baseline, size: L.NAME.size,
  });
  drawLine(page, fonts, cfg.styleLine, mode, {
    cx: L.STYLE_LINE.cx, baseline: L.STYLE_LINE.baseline, size: L.STYLE_LINE.size,
  });

  // QR
  const qrColor = mode === "art" ? fillColor("gold") : maskColor(cfg.qrLayer);
  page.drawSvgPath(qrPath(qrShapes(cfg.qrData), L.QR.size), {
    x: L.QR.x,
    y: y(L.QR.yTop),
    color: qrColor,
  });

  // Right rotated column
  drawRotated(page, fonts.semibold, cfg.handleAddress.text, mode, cfg.handleAddress, {
    x: L.HANDLE_ADDR.x, yStart: L.HANDLE_ADDR.yStart, size: L.HANDLE_ADDR.size,
  });
  const warnLines = wrapWarning(fonts.regular, L.WARNING.size, L.WARNING.yStart - 20);
  warnLines.forEach((line, i) =>
    drawRotated(page, fonts.regular, line, mode, { fill: cfg.warning.fill, layer: cfg.warning.layer }, {
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
  const img =
    assets.texture.kind === "png"
      ? await doc.embedPng(assets.texture.bytes)
      : await doc.embedJpg(assets.texture.bytes);
  page.drawImage(img, coverPage(page, img));
  drawElements(page, fonts, cfg, assets, "art");
  doc.setTitle(`${cfg.beerName} label art`);
  return doc.save();
}

export async function buildMaskPdf(cfg: LabelConfig, assets: Assets): Promise<Uint8Array> {
  const { doc, page, fonts } = await newDoc(assets);
  // White page = knockout by default; the recolored mask paints the blue
  // (white ink) regions, then elements knock out or add ink on top.
  page.drawRectangle({ x: 0, y: 0, width: L.PAGE.w, height: L.PAGE.h, color: rgb(1, 1, 1) });
  const img = await doc.embedPng(assets.maskPng);
  page.drawImage(img, coverPage(page, img));
  drawElements(page, fonts, cfg, assets, "mask");
  doc.setTitle(`${cfg.beerName} white-ink layer`);
  return doc.save();
}
