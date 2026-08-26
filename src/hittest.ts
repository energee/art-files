// hittest.ts — maps a point in label space (points, top-left origin) to the
// element under it, so clicking the preview can select that element. Boxes
// mirror what the PDF renderer draws; Poppins' font box is 1.05em above the
// baseline and 0.35em below (measured with pdftotext -bbox).
import type { LabelConfig } from "./types";
import { logoNudge, type ElementId } from "./elements";
import { parseDescription } from "./description";
// Text boxes are derived from the same display list the renderers draw from,
// so a hit box can't drift from the artwork.
import {
  collabCenterFrame, collabLeftFrame, planLabel,
  type MeasureFace, type PlacedText, type CollabSlots,
} from "./plan";
import * as L from "./layout";

export type Measure = (text: string, size: number, bold: boolean) => number;
export interface Box { x0: number; y0: number; x1: number; y1: number; id: ElementId }

const ASC = L.FONT_ASC;
const DESC = L.FONT_DESC;

/** Drawn logo height: LOGO.w scaled by the SVG's aspect, which lives in
 *  layout.ts next to LOGO itself (see LOGO_ASPECT). */
const LOGO_H = L.LOGO.w * L.LOGO_ASPECT;

/** Which collab logo slots currently hold art. The renderers skip a slot with
 *  nothing in it, so its box has to disappear too. */
export type { CollabSlots };
/** Default: no collab art, hence no collab boxes — the safe answer for any
 *  caller that doesn't track uploads. */
const NO_SLOTS: CollabSlots = { left: false, center: false };

/** Every element's box, in paint order (later entries sit on top): volume,
 *  abv, description, wordmark, logo, name, styleLine, qr, handleAddress,
 *  warning, storeCold, barcode. This matches drawElements' order in
 *  src/pdf/build.ts with one deliberate exception: drawElements actually
 *  draws the QR after storeCold (it was moved there to keep non-overlapping
 *  elements apart), but the QR overlaps nothing else on the label, so its
 *  hit-test position doesn't matter and it stays listed here between
 *  styleLine and handleAddress for readability.
 *  Text boxes are grouped from planLabel's runs, one box per drawn line
 *  (unrotated) or column (rotated); the measure adapter below folds
 *  semibold and bold alike onto Measure's single bold flag, the same
 *  approximation these boxes always made. */
export function boxesOf(cfg: LabelConfig, m: Measure, slots: CollabSlots = NO_SLOTS): Box[] {
  const desc = parseDescription(cfg.description, cfg.descStyle);

  // The laurel's nudged centre, shared by the logo box and the collab-centre
  // box hanging off its bottom (same value drawElements draws with).
  const logoCy = L.LOGO.cy + logoNudge(cfg);

  // Text boxes from the plan, one box per drawn line/column. The measure
  // adapter maps faces onto the existing bold-boolean Measure so every
  // number matches today's boxes exactly: semibold AND bold both measure as
  // the "bold" metrics, the same approximation these boxes always made.
  const mf: MeasureFace = (t, s, face) => m(t, s, face !== "regular");
  const plan = planLabel(cfg, mf, { collab: slots });
  const textBoxes: Box[] = [];
  const groups = new Map<string, PlacedText[]>();
  for (const r of plan) {
    if (r.kind !== "text") continue;
    // Unrotated runs of one drawn line share a baseline; rotated runs of one
    // column share their x. Group on that, per element.
    const key = `${r.id}:${r.rotated ? `r${r.x}` : `f${r.y}`}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  for (const runs of groups.values()) {
    const { id, rotated, size } = runs[0];
    textBoxes.push(rotated
      ? {
          id, x0: runs[0].x - ASC * size, x1: runs[0].x + DESC * size,
          y0: Math.min(...runs.map((r) => r.y - r.w)), y1: Math.max(...runs.map((r) => r.y)),
        }
      : {
          id, x0: Math.min(...runs.map((r) => r.x)), x1: Math.max(...runs.map((r) => r.x + r.w)),
          y0: runs[0].y - ASC * size, y1: runs[0].y + DESC * size,
        });
  }
  // Runs of the same id land in the group in plan order, and groups.values()
  // walks in first-seen order, so filtering by id keeps each element's lines
  // (or the warning's columns) in drawn order.
  const textFor = (id: ElementId) => textBoxes.filter((b) => b.id === id);

  const boxes: Box[] = [
    // Left column
    ...textFor("volume"),
    ...textFor("abv"),
    ...textFor("description"),
    // Center column. Wordmark and beer name always render with the Bold face.
    ...textFor("wordmark"),
    // Logo is a box, not text. It is drawn at LOGO.w wide and whatever height
    // the SVG's aspect gives (logo2025.svg is viewBox "0 0 480 525", so ~1.09
    // x the width — see parseLogo, which both renderers scale by width alone),
    // NOT square: using w for both would leave the top and bottom of the
    // laurel unclickable and crop the selection ring.
    // The stack nudge moves the drawn laurel (see drawElements and
    // logoNudge — it only applies while collab is on), so the box has to
    // move with it or the click target drifts off the artwork.
    { id: "logo",
      x0: L.LOGO.cx - L.LOGO.w / 2, x1: L.LOGO.cx + L.LOGO.w / 2,
      y0: logoCy - LOGO_H / 2,
      y1: logoCy + LOGO_H / 2 },
    ...textFor("name"),
    ...textFor("styleLine"),
    // QR is a box, not text.
    { id: "qr",
      x0: L.QR.x, x1: L.QR.x + L.QR.size,
      y0: L.QR.yTop, y1: L.QR.yTop + L.QR.size },
    // Right rotated column.
    ...textFor("handleAddress"),
    // The warning is a wrapped paragraph in rotated, justified columns
    // sharing one style, painted after handleAddress and before storeCold —
    // one box per column, from the plan's own wrap and justification.
    ...textFor("warning"),
  ];
  // Collab block, drawn after the description and before the centre column.
  // Only present when the switch is on: with it off the renderers skip the
  // block entirely, and a box with nothing under it would swallow clicks
  // meant for the artwork behind.
  //
  // The two logo slots use their fit ENVELOPE (the slot box scaled by the
  // slot's own scale knob), not the art's drawn size: the renderers fit the
  // uploaded art inside that envelope by its aspect, and the hit-tester has
  // no image in hand to derive an aspect from. The target is therefore a
  // superset of the art — every pixel of the logo, plus its letterboxing.
  //
  // `slots` says which logos are actually loaded. The switch alone is not
  // enough: the renderers draw a slot only when its art exists, so a box
  // keyed off the switch would swallow clicks over blank stock.
  if (cfg.collabEnabled && slots.left) {
    // The lead-in only exists to introduce a left logo, so it is gated on the
    // same slot the renderers gate it on.
    boxes.push(...textFor("collabLead"));
    // Frames from plan.ts — the one spelling of each slot's envelope — with
    // the scale/offsetY knobs applied here exactly as collabItems applies
    // them, so drag-to-move and draw agree by construction.
    const left = collabLeftFrame(desc.lines.length);
    const leftW = left.maxW * cfg.collabLeft.scale;
    const leftTop = left.top + (cfg.collabLeft.offsetY ?? 0);
    boxes.push({
      id: "collabLeft",
      x0: left.x, x1: left.x + leftW,
      y0: leftTop, y1: leftTop + left.maxH * cfg.collabLeft.scale,
    });
  }
  if (cfg.collabEnabled && slots.center) {
    // Hangs off the laurel's nudged bottom, exactly like drawElements — the
    // centre stack moves as one, so this box follows the logo's offsetY.
    // (LOGO_H approximates the parsed SVG's height; see its comment.)
    const center = collabCenterFrame(logoCy + LOGO_H / 2);
    const centerW = center.maxW * cfg.collabCenter.scale;
    const centerTop = center.top + (cfg.collabCenter.offsetY ?? 0);
    boxes.push({
      id: "collabCenter",
      x0: center.cx - centerW / 2, x1: center.cx + centerW / 2,
      y0: centerTop, y1: centerTop + center.maxH * cfg.collabCenter.scale,
    });
  }
  boxes.push(...textFor("storeCold"));
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
  // Every box above is built from layout.ts's page-absolute constants, which
  // are measured at MEASURED_BLEED; the preview that clicks into here and
  // draws these outlines is at the CURRENT bleed. One shift at the end is this
  // file's whole share of that (see layout.BLEED_SHIFT) — the two renderers do
  // the same thing once each, so a box can't drift off the art it describes.
  //
  // Deliberately here rather than on hitTest's incoming point: boxesFor/boxOf
  // hand these straight to the selection-outline renderer, so shifting the
  // point alone would fix clicking and leave the outlines behind.
  return boxes.map((b) => ({
    ...b,
    x0: b.x0 + L.BLEED_SHIFT, x1: b.x1 + L.BLEED_SHIFT,
    y0: b.y0 + L.BLEED_SHIFT, y1: b.y1 + L.BLEED_SHIFT,
  }));
}

export function hitTest(
  xPt: number, yPt: number, m: Measure, cfg: LabelConfig, slots: CollabSlots = NO_SLOTS,
): ElementId | null {
  const boxes = boxesOf(cfg, m, slots);
  // Topmost first, matching paint order.
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (xPt >= b.x0 && xPt <= b.x1 && yPt >= b.y0 && yPt <= b.y1) return b.id;
  }
  return null;
}

/** The union box per id, in the order asked for, for drawing selection
 *  outlines. Ids the renderer isn't drawing (an empty collab slot) are simply
 *  absent from the result.
 *
 *  One boxesOf pass covers the whole selection: boxesOf re-measures every
 *  element — the description parse and the warning's word-by-word column wrap
 *  included — so asking per element made an N-layer selection N full
 *  measurement passes, on a path that re-runs per pointer-move frame while
 *  the compare divider is dragged. */
export function boxesFor(
  ids: readonly ElementId[], cfg: LabelConfig, m: Measure, slots: CollabSlots = NO_SLOTS,
): Box[] {
  const want = new Set(ids);
  const union = new Map<ElementId, Box>();
  for (const b of boxesOf(cfg, m, slots)) {
    if (!want.has(b.id)) continue;
    const a = union.get(b.id);
    union.set(b.id, a
      ? {
          id: b.id, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
          x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
        }
      : b);
  }
  return ids.map((id) => union.get(id)).filter((b): b is Box => b !== undefined);
}

/** The union box for one element. */
export function boxOf(
  id: ElementId, cfg: LabelConfig, m: Measure, slots: CollabSlots = NO_SLOTS,
): Box | null {
  return boxesFor([id], cfg, m, slots)[0] ?? null;
}
