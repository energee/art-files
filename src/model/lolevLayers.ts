// src/model/lolevLayers.ts — the Lolev label as v3 master DATA (spec:
// "Lolev master"). Every element the hardcoded layout in layout.ts /
// plan.ts used to place is an ordinary layer here, with explicit positions
// taken from that layout's constants:
//   text top  = baseline - FONT_ASC * size   (FONT_ASC = 1.05)
//   text bottom (for `below` bindings) = last baseline + FONT_DESC * size (0.35)
// The collab block is the `collab` variant: three layers that exist only
// while it is on, chained with `below` bindings exactly as collabLeftFlow /
// collabCenterFrame chained them. Once the renderers draw from this data,
// the layout constants and the built-in branches are deleted.
import type { Master, TextLayer, ImageLayer } from "./layers";
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
 *  to the left of the baseline line (hittest.ts's rotated box) — the same
 *  arithmetic as `top`, on the other axis. */
const left = top;

const text = (l: Omit<TextLayer, "kind" | "enabled" | "align" | "style"> &
  Partial<Pick<TextLayer, "enabled" | "align" | "style">>): TextLayer => ({
  kind: "text", enabled: true, align: "left", style: KEYLINED, ...l,
});
const image = (l: Omit<ImageLayer, "kind" | "enabled" | "style"> &
  Partial<Pick<ImageLayer, "enabled" | "style">>): ImageLayer => ({
  kind: "image", enabled: true, style: { ...GOLD_METAL, strokeLayer: DEFAULT_STROKE_LAYER }, ...l,
});

/** UPC-A geometry in points, from layout.ts's BARCODE (29 modules deep =
 *  the reference plate's 29.88pt). */
const UPC_MOD = 29.88 / 29;

export function lolevMaster(): Master {
  return {
    formatVersion: 3,
    id: "lolev",
    name: "Lolev",
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
        fillable: true, input: "number", min: 0, max: 20, placeholder: "#",
        suffix: "% alc by vol", lines: [{ text: "", ...GOLD_METAL }] }),
      text({ id: "description", name: "Description", x: LEFT_X, anchor: "left",
        y: top(66.68, 9), size: 9, leading: 10.8 / 9, fillable: true,
        lines: [{ text: "HOPS", ...GOLD_METAL, header: true }, { text: "...", ...GOLD_METAL }] }),
      // Center column.
      text({ id: "wordmark", name: "Brand", x: CENTER_X, anchor: "center", y: top(44.96, 22),
        size: 22, align: "center", faces: { base: "bold", bold: "bold" },
        lines: [{ text: "Lolev Beer", ...GOLD_METAL }] }),
      image({ id: "logo", name: "Logo", asset: "builtin:logo", x: CENTER_X, anchor: "center",
        y: 183 - (33.5 * 525 / 480) / 2, w: 33.5, style: KEYLINED }),
      text({ id: "name", name: "Name", x: CENTER_X, anchor: "center", y: top(317.16, 15.83),
        size: 15.83, align: "center", fillable: true, uppercase: true, placeholder: "Name",
        faces: { base: "bold", bold: "bold" },
        lines: [{ text: "", ...GOLD_METAL }] }),
      text({ id: "styleLine", name: "Style", x: CENTER_X, anchor: "center", y: top(337.30, 12.18),
        size: 12.18, align: "center", fillable: true, placeholder: "Style",
        lines: [{ text: "", ...GOLD_METAL }] }),
      // Right column: rotated 90° CCW, reading bottom-to-top, each run's
      // bottom pinned one stroke inside the bottom margin. `x` is the box's
      // left edge (LayerBase.x), so each is layout.ts's baseline x (474.58 /
      // 488.18 / 556.30) less one ascender — see `left`.
      text({ id: "handleAddress", name: "Info", x: left(474.58, 12.91), anchor: "left", y: 339.58,
        vAnchor: "bottom", rotation: 90, size: 12.91, faces: { base: "semibold", bold: "bold" },
        style: { ...KEYLINED, letterSpacing: 0.38 },
        lines: [{ text: "**@LOLEVBEER** 5247 BUTLER ST, PITTSBURGH, PA", ...GOLD_METAL }] }),
      text({ id: "warning", name: "Warning", x: left(488.18, 8.2), anchor: "left", y: 338.64,
        vAnchor: "bottom", rotation: 90, size: 8.2, leading: 10 / 8.2, align: "justify",
        width: TRIM.h - 2 * DEFAULT_MARGIN_PT - 2 * DEFAULT_STROKE_PX * PX, locked: true,
        faces: { base: "regular", bold: "bold" },
        style: { ...KEYLINED, letterSpacing: WARNING_TRACKING },
        lines: [{ text: WARNING_TEXT, ...GOLD_METAL }] }),
      text({ id: "storeCold", name: "Store cold", x: left(556.30, 20.15), anchor: "left", y: 163.15,
        vAnchor: "bottom", rotation: 90, size: 20.15, faces: { base: "bold", bold: "bold" },
        style: { ...GOLD_METAL, strokeLayer: DEFAULT_STROKE_LAYER, letterSpacing: 1.25 },
        lines: [{ text: "STORE COLD", ...GOLD_METAL, bold: true }] }),
      {
        id: "qr", name: "QR", kind: "qr", enabled: true, x: LEFT_X, anchor: "left", y: 281.44,
        size: 59, qrStyle: "dots", ecLevel: "L", value: "https://lolev.beer/beer/{name|slug}",
        style: { ...GOLD_METAL, stroke: KEYLINE.stroke, strokeWidth: KEYLINE.strokeWidth,
          strokeLayer: DEFAULT_STROKE_LAYER },
      },
      {
        id: "barcode", name: "Barcode", kind: "barcode", enabled: true, fillable: true,
        x: 524.71, anchor: "left", y: 226.07, rotation: 90, symbology: "upc-a",
        value: "850051366224", h: 15 * UPC_MOD, moduleW: UPC_MOD,
        style: { fill: "#1A1A1A", layer: "white", stroke: "#FFFFFF", strokeWidth: 20,
          strokeLayer: DEFAULT_STROKE_LAYER },
      },
    ],
    variants: [
      {
        id: "collab", name: "Collab",
        layers: {
          // Lead-in first baseline = description's last baseline + 21.6:
          // minus the description's descent (3.15) and the lead's own
          // ascent (9.45) → a 9pt gap between the boxes.
          collabLead: text({ id: "collabLead", name: "Lead-in", x: LEFT_X, anchor: "left",
            y: { below: "description", gap: 21.6 - 0.35 * 9 - FONT_ASC * 9 }, size: 9,
            leading: 10.8 / 9, style: { ...GOLD_METAL, strokeLayer: DEFAULT_STROKE_LAYER },
            lines: [{ text: "A collaborative", ...GOLD_METAL, bold: true },
              { text: "project with", ...GOLD_METAL, bold: true }] }),
          // Logo top = lead's last baseline + 8 → 8 - descent(3.15).
          collabLeft: image({ id: "collabLeft", name: "Text logo", asset: "", fillable: true,
            x: LEFT_X, anchor: "left", y: { below: "collabLead", gap: 8 - 0.35 * 9 },
            w: 70, h: 44, scale: 1, tintRaster: false }),
          collabCenter: image({ id: "collabCenter", name: "Graphic logo", asset: "", fillable: true,
            x: CENTER_X, anchor: "center", y: { below: "logo", gap: 14 },
            w: 36, h: 36, scale: 1, tintRaster: false }),
        },
      },
    ],
  };
}
