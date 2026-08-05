// hittest.ts — maps a point in label space (points, top-left origin) to the
// element under it, so clicking the preview can select that element. Boxes
// mirror what the PDF renderer draws; Poppins' font box is 1.05em above the
// baseline and 0.35em below (measured with pdftotext -bbox).
import type { LabelConfig } from "./types";
import type { ElementId } from "./elements";
import { parseDescription } from "./description";
// The renderer's own paragraph wrapper and justified-column length, so the
// warning's hit columns can't disagree with the columns it draws or the
// justified width it draws them at (see the warning boxes below).
import { wrapWarning, warningColumnLen } from "./pdf/build";
import * as L from "./layout";

export type Measure = (text: string, size: number, bold: boolean) => number;
export interface Box { x0: number; y0: number; x1: number; y1: number; id: ElementId }

const ASC = 1.05;
const DESC = 0.35;

/** Drawn logo height: LOGO.w scaled by logo2025.svg's viewBox aspect
 *  (0 0 480 525). Derived, not hardcoded, so a new logo file with a different
 *  aspect only needs these two numbers changed here alongside the asset. */
const LOGO_H = (L.LOGO.w * 525) / 480;

// Every text box measures through L.trackedWidth, so an element's tracking
// widens its hit box exactly as much as it widens the drawn line. `tracking`
// defaults to 0, which reduces each of these to the untracked measurement.
const flat = (
  id: ElementId, text: string, x: number, baseline: number, size: number,
  m: Measure, bold = false, tracking = 0,
): Box => ({
  id, x0: x, x1: x + L.trackedWidth(m(text, size, bold), text, tracking),
  y0: baseline - ASC * size, y1: baseline + DESC * size,
});

const centred = (
  id: ElementId, text: string, cx: number, baseline: number, size: number,
  m: Measure, bold = false, tracking = 0,
): Box => {
  const w = L.trackedWidth(m(text, size, bold), text, tracking);
  return {
    id, x0: cx - w / 2, x1: cx + w / 2,
    y0: baseline - ASC * size, y1: baseline + DESC * size,
  };
};

const rotated = (
  id: ElementId, text: string, x: number, yStart: number, size: number,
  m: Measure, bold = false, tracking = 0,
): Box => ({
  id, x0: x - ASC * size, x1: x + DESC * size,
  y0: yStart - L.trackedWidth(m(text, size, bold), text, tracking), y1: yStart,
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
      ? [{ text: desc.header.text, x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size, bold: !!desc.header.bold, tracking: desc.header.letterSpacing ?? 0 }]
      : []),
    ...desc.lines.map((l, i) => ({
      text: l.text, x: L.DESC.x,
      baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size, bold: !!l.bold,
      tracking: l.letterSpacing ?? 0,
    })),
  ];

  const boxes: Box[] = [
    // Left column
    flat("volume", cfg.volume.text, L.VOLUME.x, L.VOLUME.baseline, L.VOLUME.size, m, !!cfg.volume.bold, cfg.volume.letterSpacing),
    flat("abv", `${cfg.abv}% alc by vol`, L.ABV.x, L.ABV.baseline, L.ABV.size, m, false, cfg.abvStyle.letterSpacing),
    ...descLines.map((d) => flat("description", d.text, d.x, d.baseline, d.size, m, d.bold, d.tracking)),
    // Center column. Wordmark and beer name always render with the Bold face.
    centred("wordmark", L.WORDMARK.text, L.WORDMARK.cx, L.WORDMARK.baseline, L.WORDMARK.size, m, true, cfg.wordmark.letterSpacing),
    // Logo is a box, not text. It is drawn at LOGO.w wide and whatever height
    // the SVG's aspect gives (logo2025.svg is viewBox "0 0 480 525", so ~1.09
    // x the width — see parseLogo, which both renderers scale by width alone),
    // NOT square: using w for both would leave the top and bottom of the
    // laurel unclickable and crop the selection ring.
    // offsetY moves the drawn laurel (see drawElements), so the box has to
    // move with it or the click target drifts off the artwork.
    { id: "logo",
      x0: L.LOGO.cx - L.LOGO.w / 2, x1: L.LOGO.cx + L.LOGO.w / 2,
      y0: L.LOGO.cy + (cfg.logo.offsetY ?? 0) - LOGO_H / 2,
      y1: L.LOGO.cy + (cfg.logo.offsetY ?? 0) + LOGO_H / 2 },
    centred("name", cfg.beerName.toUpperCase(), L.NAME.cx, L.NAME.baseline, L.NAME.size, m, true, cfg.nameStyle.letterSpacing),
    centred("styleLine", cfg.styleLine.text, L.STYLE_LINE.cx, L.STYLE_LINE.baseline, L.STYLE_LINE.size, m, !!cfg.styleLine.bold, cfg.styleLine.letterSpacing),
    // QR is a box, not text.
    { id: "qr",
      x0: L.QR.x, x1: L.QR.x + L.QR.size,
      y0: L.QR.yTop, y1: L.QR.yTop + L.QR.size },
    // Right rotated column. handleAddress always renders semibold (bold=true;
    // see the function doc comment).
    rotated("handleAddress", cfg.handleAddress.text, L.HANDLE_ADDR.x, L.HANDLE_ADDR.yStart, L.HANDLE_ADDR.size, m, true, cfg.handleAddress.letterSpacing),
  ];
  // The warning is a wrapped paragraph in rotated, justified columns sharing
  // one style, painted after handleAddress and before storeCold. Column
  // count comes from wrapWarning with THIS caller's measure — the same
  // function and the same metrics the renderers wrap with — so a font or
  // maxLen change can never leave the boxes describing a column count the
  // artwork doesn't have. Column LENGTH comes from warningColumnLen: every
  // multi-word column is justified out to exactly maxLen (see
  // drawJustifiedRotated), so the box uses maxLen too rather than the
  // column's natural (pre-justification) measured width; a single-word
  // column has no gaps to stretch and stays natural-length.
  // Tracked, matching drawElements' wrap measure: the warning's own spacing
  // decides both how many columns the paragraph wraps into and how long each
  // justified one is.
  const warningMeasure = (t: string) =>
    L.trackedWidth(m(t, L.WARNING.size, false), t, cfg.warning.letterSpacing ?? 0);
  const warnLines = wrapWarning(warningMeasure, L.WARNING.maxLen);
  warnLines.forEach((line, i) =>
    boxes.push({
      id: "warning",
      x0: L.WARNING.x + i * L.WARNING.leading - ASC * L.WARNING.size,
      x1: L.WARNING.x + i * L.WARNING.leading + DESC * L.WARNING.size,
      y0: L.WARNING.yStart - warningColumnLen(line, L.WARNING.maxLen, warningMeasure),
      y1: L.WARNING.yStart,
    }),
  );
  // storeCold always renders semibold too (bold=true; see the doc comment).
  boxes.push(rotated("storeCold", cfg.storeCold.text, L.STORE_COLD.x, L.STORE_COLD.yStart, L.STORE_COLD.size, m, true, cfg.storeCold.letterSpacing));
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
