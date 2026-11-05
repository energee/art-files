// src/model/starterLayers.ts — the Starter label as v3 master DATA: the
// neutral built-in master new tabs open on (docs/plans/starter-master.md).
// It keeps the Lolev master's page size, guides, font and the positions and
// styles of its generic layers (page art, volume, ABV, description, name,
// style, government warning), so a brewery's own design starts from a
// familiar layout. It carries no brand: no logo, wordmark, address, QR,
// barcode or variants, and no assets. Positions use the same arithmetic as
// the Lolev master:
//   text top  = baseline - FONT_ASC * size   (FONT_ASC = 1.05)
// The small helpers below are local copies on purpose; this file must not
// depend on the Lolev master, which is leaving the app.
import type { Choice, Master, TextLayer, ImageLayer } from "./layers";
import {
  CENTER_X, GOLD, LEFT_X, PAGE, WARNING_TRACKING, DEFAULT_STROKE_PX, PX,
  TRIM, DEFAULT_MARGIN_PT,
} from "../layout";
import { KEYLINE, WARNING_TEXT } from "../defaults";
import { DEFAULT_STROKE_LAYER } from "../strokes";

const FONT_ASC = 1.05;
const GOLD_METAL = { fill: GOLD, layer: "metallic" } as const;
const KEYLINED = { ...GOLD_METAL, ...KEYLINE } as const;
const top = (baseline: number, size: number) => baseline - FONT_ASC * size;
/** A rotated column's box LEFT edge from its baseline's x: the glyphs' "up"
 *  points left under the quarter turn, so the ascender sits one FONT_ASC
 *  to the left of the baseline line (hittest.ts's rotated box). */
const left = top;

const text = (l: Omit<TextLayer, "kind" | "enabled" | "align" | "style"> &
  Partial<Pick<TextLayer, "enabled" | "align" | "style">>): TextLayer => ({
  kind: "text", enabled: true, align: "left", style: KEYLINED, ...l,
});
const image = (l: Omit<ImageLayer, "kind" | "enabled" | "style"> &
  Partial<Pick<ImageLayer, "enabled" | "style">>): ImageLayer => ({
  kind: "image", enabled: true, style: { ...GOLD_METAL, strokeLayer: DEFAULT_STROKE_LAYER }, ...l,
});

/** Generic beer styles the Style picker offers; it still takes anything typed. */
const STARTER_STYLES: Choice[] = [
  { value: "Hazy India Pale Ale" },
  { value: "Hazy Pale Ale" },
];

export function starterMaster(): Master {
  return {
    formatVersion: 3,
    id: "starter",
    name: "Starter",
    physical: {
      labelWidthIn: 585.12 / 72,
      labelHeightIn: 369.12 / 72,
      bleedIn: 4.56 / 72,
      canDiameterIn: 2.6,
    },
    guides: { left: 24.12, center: "auto", right: 24.12, top: 24.12, bottom: 24.12 },
    layers: [
      // Page art: texture then metallic mask, cover-fit to the full page.
      // `asset` is the id inside the .master ZIP (texture/<name>, mask/<name>).
      image({ id: "background", name: "Background", role: "background", asset: "", fit: "cover",
        x: 0, anchor: "left", y: 0, w: PAGE.w, h: PAGE.h, locked: true }),
      image({ id: "mask", name: "Metallic mask", role: "mask", asset: "", fit: "cover",
        x: 0, anchor: "left", y: 0, w: PAGE.w, h: PAGE.h, locked: true }),
      // Left column, hanging from the top margin.
      text({ id: "volume", name: "Volume", x: LEFT_X, anchor: "left", y: top(35.49, 9), size: 9,
        lines: [{ text: "1 PINT", ...GOLD_METAL, bold: true }] }),
      text({ id: "abv", name: "ABV", x: LEFT_X, anchor: "left", y: top(46.29, 9), size: 9,
        input: "number", min: 0, max: 20, placeholder: "#",
        suffix: "% alc by vol", lines: [{ text: "", ...GOLD_METAL }] }),
      text({ id: "description", name: "Description", x: LEFT_X, anchor: "left",
        y: top(66.68, 9), size: 9, leading: 10.8 / 9,
        lines: [{ text: "HOPS", ...GOLD_METAL, header: true }, { text: "...", ...GOLD_METAL }] }),
      // Center column, near the bottom.
      text({ id: "name", name: "Name", x: CENTER_X, anchor: "center", y: top(317.16, 15.83),
        size: 15.83, align: "center", placeholder: "Name",
        style: { ...KEYLINED, uppercase: true },
        faces: { base: "bold", bold: "bold" },
        lines: [{ text: "", ...GOLD_METAL }] }),
      text({ id: "styleLine", name: "Style", x: CENTER_X, anchor: "center", y: top(337.30, 12.18),
        size: 12.18, align: "center", placeholder: "Style", choices: STARTER_STYLES,
        lines: [{ text: "", ...GOLD_METAL }] }),
      // Right column: rotated 90° CCW, reading bottom-to-top, its bottom
      // pinned one stroke inside the bottom margin. `x` is the box's left
      // edge, the baseline x (488.18) less one ascender — see `left`.
      text({ id: "warning", name: "Warning", x: left(488.18, 8.2), anchor: "left", y: 338.64,
        vAnchor: "bottom", rotation: 90, size: 8.2, leading: 10 / 8.2, align: "justify",
        width: TRIM.h - 2 * DEFAULT_MARGIN_PT - 2 * DEFAULT_STROKE_PX * PX, locked: true,
        faces: { base: "regular", bold: "bold" },
        style: { ...KEYLINED, letterSpacing: WARNING_TRACKING },
        lines: [{ text: WARNING_TEXT, ...GOLD_METAL }] }),
    ],
    variants: [],
  };
}
