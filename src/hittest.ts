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

/** Every element's box, in paint order (later entries sit on top). */
export function boxesOf(cfg: LabelConfig, m: Measure): Box[] {
  const desc = parseDescription(cfg.description, cfg.descStyle);
  const boxes: Box[] = [
    flat("volume", cfg.volume.text, L.VOLUME.x, L.VOLUME.baseline, L.VOLUME.size, m, !!cfg.volume.bold),
    flat("abv", `${cfg.abv}% alc by vol`, L.ABV.x, L.ABV.baseline, L.ABV.size, m),
    centred("wordmark", L.WORDMARK.text, L.WORDMARK.cx, L.WORDMARK.baseline, L.WORDMARK.size, m, true),
    centred("name", cfg.beerName.toUpperCase(), L.NAME.cx, L.NAME.baseline, L.NAME.size, m, true),
    centred("styleLine", cfg.styleLine.text, L.STYLE_LINE.cx, L.STYLE_LINE.baseline, L.STYLE_LINE.size, m, !!cfg.styleLine.bold),
    rotated("handleAddress", cfg.handleAddress.text, L.HANDLE_ADDR.x, L.HANDLE_ADDR.yStart, L.HANDLE_ADDR.size, m),
    rotated("storeCold", cfg.storeCold.text, L.STORE_COLD.x, L.STORE_COLD.yStart, L.STORE_COLD.size, m),
    // Logo and QR are boxes, not text.
    { id: "logo",
      x0: L.LOGO.cx - L.LOGO.w / 2, x1: L.LOGO.cx + L.LOGO.w / 2,
      y0: L.LOGO.cy - L.LOGO.w / 2, y1: L.LOGO.cy + L.LOGO.w / 2 },
    { id: "qr",
      x0: L.QR.x, x1: L.QR.x + L.QR.size,
      y0: L.QR.yTop, y1: L.QR.yTop + L.QR.size },
  ];
  // The warning is three rotated columns sharing one style.
  for (let i = 0; i < 3; i++)
    boxes.push({
      id: "warning",
      x0: L.WARNING.x + i * L.WARNING.leading - ASC * L.WARNING.size,
      x1: L.WARNING.x + i * L.WARNING.leading + DESC * L.WARNING.size,
      y0: L.WARNING.yStart - L.WARNING.maxLen, y1: L.WARNING.yStart,
    });
  // Every description line maps to the one description element.
  const lines = [
    ...(desc.header
      ? [{ text: desc.header.text, x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size }]
      : []),
    ...desc.lines.map((l, i) => ({
      text: l.text, x: L.DESC.x,
      baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size,
    })),
  ];
  for (const d of lines) boxes.push(flat("description", d.text, d.x, d.baseline, d.size, m));
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
