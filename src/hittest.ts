// hittest.ts — maps a point in label space (points, top-left origin) to the
// element under it, so clicking the preview can select that element. Boxes
// mirror what the PDF renderer draws; Poppins' font box is 1.05em above the
// baseline and 0.35em below (measured with pdftotext -bbox).
import type { LabelConfig } from "./types";
import type { ElementId } from "./elements";
import { parseDescription } from "./description";
import * as L from "./layout";

export type Measure = (text: string, size: number, bold: boolean) => number;
export interface Box { x0: number; y0: number; x1: number; y1: number; id: ElementId }

const ASC = 1.05;
const DESC = 0.35;

const flat = (
  id: ElementId, text: string, x: number, baseline: number, size: number,
  m: Measure, bold = false,
): Box => ({
  id, x0: x, x1: x + m(text, size, bold),
  y0: baseline - ASC * size, y1: baseline + DESC * size,
});

const centred = (
  id: ElementId, text: string, cx: number, baseline: number, size: number,
  m: Measure, bold = false,
): Box => {
  const w = m(text, size, bold);
  return {
    id, x0: cx - w / 2, x1: cx + w / 2,
    y0: baseline - ASC * size, y1: baseline + DESC * size,
  };
};

const rotated = (
  id: ElementId, text: string, x: number, yStart: number, size: number,
  m: Measure, bold = false,
): Box => ({
  id, x0: x - ASC * size, x1: x + DESC * size,
  y0: yStart - m(text, size, bold), y1: yStart,
});

/** Every element's box, in paint order (later entries sit on top): volume,
 *  abv, description, wordmark, logo, name, styleLine, qr, handleAddress,
 *  warning, storeCold, barcode — exactly drawElements' order in
 *  src/pdf/build.ts.
 *  handleAddress and storeCold pass bold=true because drawRotated always
 *  renders them with the semibold face (its font is a fixed argument, never
 *  read from style.bold); the description header passes its own bold since
 *  parseDescription hardcodes header bold=true (e.g. the default "# HOPS"). */
export function boxesOf(cfg: LabelConfig, m: Measure): Box[] {
  const desc = parseDescription(cfg.description, cfg.descStyle);
  // Every description line maps to the one description element; the header,
  // if present, always precedes the body lines, matching drawElements.
  const descLines = [
    ...(desc.header
      ? [{ text: desc.header.text, x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size, bold: !!desc.header.bold }]
      : []),
    ...desc.lines.map((l, i) => ({
      text: l.text, x: L.DESC.x,
      baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size, bold: !!l.bold,
    })),
  ];

  const boxes: Box[] = [
    // Left column
    flat("volume", cfg.volume.text, L.VOLUME.x, L.VOLUME.baseline, L.VOLUME.size, m, !!cfg.volume.bold),
    flat("abv", `${cfg.abv}% alc by vol`, L.ABV.x, L.ABV.baseline, L.ABV.size, m),
    ...descLines.map((d) => flat("description", d.text, d.x, d.baseline, d.size, m, d.bold)),
    // Center column. Wordmark and beer name always render with the Bold face.
    centred("wordmark", L.WORDMARK.text, L.WORDMARK.cx, L.WORDMARK.baseline, L.WORDMARK.size, m, true),
    // Logo is a box, not text.
    { id: "logo",
      x0: L.LOGO.cx - L.LOGO.w / 2, x1: L.LOGO.cx + L.LOGO.w / 2,
      y0: L.LOGO.cy - L.LOGO.w / 2, y1: L.LOGO.cy + L.LOGO.w / 2 },
    centred("name", cfg.beerName.toUpperCase(), L.NAME.cx, L.NAME.baseline, L.NAME.size, m, true),
    centred("styleLine", cfg.styleLine.text, L.STYLE_LINE.cx, L.STYLE_LINE.baseline, L.STYLE_LINE.size, m, !!cfg.styleLine.bold),
    // QR is a box, not text.
    { id: "qr",
      x0: L.QR.x, x1: L.QR.x + L.QR.size,
      y0: L.QR.yTop, y1: L.QR.yTop + L.QR.size },
    // Right rotated column. handleAddress always renders semibold (bold=true;
    // see the function doc comment).
    rotated("handleAddress", cfg.handleAddress.text, L.HANDLE_ADDR.x, L.HANDLE_ADDR.yStart, L.HANDLE_ADDR.size, m, true),
  ];
  // The warning is three rotated columns sharing one style, painted after
  // handleAddress and before storeCold.
  for (let i = 0; i < 3; i++)
    boxes.push({
      id: "warning",
      x0: L.WARNING.x + i * L.WARNING.leading - ASC * L.WARNING.size,
      x1: L.WARNING.x + i * L.WARNING.leading + DESC * L.WARNING.size,
      y0: L.WARNING.yStart - L.WARNING.maxLen, y1: L.WARNING.yStart,
    });
  // storeCold always renders semibold too (bold=true; see the doc comment).
  boxes.push(rotated("storeCold", cfg.storeCold.text, L.STORE_COLD.x, L.STORE_COLD.yStart, L.STORE_COLD.size, m, true));
  // The barcode is drawn last, so its box goes last too. No font measurement:
  // the footprint is the whole symbol, bars AND the digits column (BARCODE.w
  // is the full symbol depth), which is exactly the rectangle the mask lays
  // white ink under. The outer stroke is deliberately not added — a click
  // target should follow the artwork, not a width the user can change.
  boxes.push({
    id: "barcode",
    x0: L.BARCODE.x, x1: L.BARCODE.x + L.BARCODE.w,
    y0: L.BARCODE.yTop, y1: L.BARCODE.yTop + L.BARCODE.h,
  });
  return boxes;
}

export function hitTest(
  xPt: number, yPt: number, m: Measure, cfg: LabelConfig,
): ElementId | null {
  const boxes = boxesOf(cfg, m);
  // Topmost first, matching paint order.
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (xPt >= b.x0 && xPt <= b.x1 && yPt >= b.y0 && yPt <= b.y1) return b.id;
  }
  return null;
}

/** The union box for an element, for drawing the selection outline. */
export function boxOf(id: ElementId, cfg: LabelConfig, m: Measure): Box | null {
  const parts = boxesOf(cfg, m).filter((b) => b.id === id);
  if (!parts.length) return null;
  return parts.reduce((a, b) => ({
    id, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
  }));
}
