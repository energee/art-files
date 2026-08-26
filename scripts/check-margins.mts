// check-margins.mts — report every element's DRAWN extent against the safe
// margins, in PDF points. Run: npx tsx scripts/check-margins.mts
//
// This measures what actually hits the page, which is more than hittest.ts's
// boxes describe: real glyph ink rather than the em box, the per-run face (an
// inline **bold** run draws in Bold, which is wider), the element's
// letter-spacing, and the outer stroke — which pdf/build.ts paints OUTSIDE the
// glyph (text rendering mode 2 with a 2x line width, fill drawn on top), so it
// extends the ink by its full width on every side. Getting any of those wrong
// makes an element look aligned here and overhang on press.
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { layoutGuides, DEFAULT_MARGIN_PT } from "../src/rulers";
import { defaultConfig } from "../src/defaults";
import { parseRuns } from "../src/description";
import { warningMeasure, wrapWarning } from "../src/warning";
import type { Style } from "../src/types";
import * as L from "../src/layout";

const load = (n: string) =>
  fontkit.create(readFileSync(new URL(`../src/assets/fonts/Poppins-${n}.ttf`, import.meta.url)));
const REGULAR = load("Regular"), SEMIBOLD = load("SemiBold"), BOLD = load("Bold");
type Face = ReturnType<typeof load>;
type Line = Style & { text: string };

/** Ink extent of a styled line, relative to origin (x=0) and baseline (y=0),
 *  y DOWN. `base` is the face for unmarked text; **bold** runs step up to Bold,
 *  exactly as plan.ts's lineRuns/rotatedRuns choose faces. */
function inkOf(style: Line, size: number, base: Face) {
  const tracking = style.letterSpacing ?? 0;
  let cursor = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const run of parseRuns(style)) {
    const face = run.bold ? BOLD : base;
    const laid = face.layout(run.text);
    const upm = face.unitsPerEm;
    laid.glyphs.forEach((glyph, i) => {
      const b = glyph.bbox;
      if (b.maxX > b.minX) {
        minX = Math.min(minX, cursor + (b.minX / upm) * size);
        maxX = Math.max(maxX, cursor + (b.maxX / upm) * size);
        minY = Math.min(minY, (b.minY / upm) * size);
        maxY = Math.max(maxY, (b.maxY / upm) * size);
      }
      cursor += (laid.positions[i].xAdvance / upm) * size + tracking;
    });
  }
  return { left: minX, right: maxX, top: -maxY, bottom: -minY };
}

/** The outer stroke reaches this far beyond the ink on every side. */
const strokeOf = (style: Style) =>
  !style.stroke || style.stroke === "none" ? 0 : (style.strokeWidth ?? L.DEFAULT_STROKE_PX) * L.PX;

const { verticalMargins: [ML, MR], horizontalMargins: [MT, MB] } = layoutGuides(DEFAULT_MARGIN_PT);
const SPAN = MB - MT;
const cfg = defaultConfig();
const fmt = (n: number) =>
  (n < -0.005 ? "\x1b[31m" : n < 0.5 ? "\x1b[32m" : "") + n.toFixed(2).padStart(8) + "\x1b[0m";
const row = (id: string, x0: number, x1: number, y0: number, y1: number) =>
  console.log(id.padEnd(16) + fmt(x0 - ML) + fmt(MR - x1) + fmt(y0 - MT) + fmt(MB - y1));

/** Rotated 90deg CCW: the run reads bottom-to-top from yStart, so the glyph's
 *  own top/bottom map to page x and its advance maps to page -y. */
function rotated(
  id: string, style: Line, geo: { x: number; yStart: number; size: number },
  base: Face, lengthOverride?: number,
) {
  const i = inkOf(style, geo.size, base);
  const s = strokeOf(style);
  row(id, geo.x + i.top - s, geo.x + i.bottom + s,
    geo.yStart - (lengthOverride ?? i.right) - s, geo.yStart - i.left + s);
}

console.log(`safe area: x ${ML}..${MR}, y ${MT}..${MB}  (span ${SPAN}pt)`);
console.log("slack, negative = past the margin. Includes tracking + outer stroke.\n");
console.log("element           slackL  slackR  slackT  slackB");

rotated("Info", cfg.handleAddress, L.HANDLE_ADDR, SEMIBOLD);
rotated("storeCold", cfg.storeCold, L.STORE_COLD, SEMIBOLD);
// Every warning column is stretched to exactly maxLen by plan.ts's justifiedRotatedRuns,
// so its drawn length is maxLen regardless of what the words measure.
const faceWidth = (face: Face, t: string, size: number) =>
  (face.layout(t).advanceWidth / face.unitsPerEm) * size;
const measure = warningMeasure(
  (t, bold) => faceWidth(bold ? BOLD : REGULAR, t, L.WARNING.size),
  cfg.warning.letterSpacing);
wrapWarning(measure, L.WARNING.maxLen).forEach((line, n) =>
  rotated(`warning c${n + 1}`, { ...cfg.warning, text: line },
    { x: L.WARNING.x + n * L.WARNING.leading, yStart: L.WARNING.yStart, size: L.WARNING.size },
    REGULAR, L.WARNING.maxLen));

const s = strokeOf(cfg.handleAddress);

// Solve for constants that make a rotated run span the safe area exactly,
// stroke included: glyph ink must fill SPAN - 2*stroke, and yStart (the run's
// bottom) sits one stroke inside the bottom margin, plus the first glyph's
// left side bearing.
console.log("\n--- solved constants ---");
const target = SPAN - 2 * s;
let lo = 10, hi = 16;
for (let n = 0; n < 60; n++) {
  const mid = (lo + hi) / 2;
  const i = inkOf(cfg.handleAddress, mid, SEMIBOLD);
  if (i.right - i.left > target) hi = mid; else lo = mid;
}
const size = Math.round(lo * 100) / 100;
const solved = inkOf(cfg.handleAddress, size, SEMIBOLD);
console.log(`HANDLE_ADDR.size  ${size}   (ink ${(solved.right - solved.left).toFixed(2)} vs ${target.toFixed(2)})`);
console.log(`HANDLE_ADDR.yStart ${(MB - s + solved.left).toFixed(2)}`);
const wStroke = strokeOf(cfg.warning);
console.log(`WARNING.maxLen    ${(SPAN - 2 * wStroke).toFixed(2)}`);
console.log(`WARNING.yStart    ${(MB - wStroke).toFixed(2)}`);
const scInk = inkOf(cfg.storeCold, L.STORE_COLD.size, SEMIBOLD);
console.log(`STORE_COLD.yStart ${(MT + (scInk.right - scInk.left) + strokeOf(cfg.storeCold) + scInk.left).toFixed(2)}  (top flush; length ${(scInk.right - scInk.left).toFixed(2)})`);

console.log("\n--- warning size vs column count at maxLen = span - 2*stroke ---");
const wMax = SPAN - 2 * strokeOf(cfg.warning);
for (const size of [6.0, 5.95, 5.9, 5.85, 5.8, 5.75, 5.7, 5.65, 5.6, 5.55, 5.5]) {
  const m = warningMeasure(
    (t, bold) => faceWidth(bold ? BOLD : REGULAR, t, size), cfg.warning.letterSpacing);
  console.log(`  size ${size}: ${wrapWarning(m, wMax).length} cols`);
}
