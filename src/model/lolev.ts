// Lolev master fixture — the coverage bridge proving the model can express
// today's product. Resolution of this master with no variations reproduces
// the shipped defaults exactly. Used as the migration seed and proof the
// model expresses the existing product (spec: Migration).
import type { Master } from "./types";

// Physical dimensions sourced from src/layout.ts:
// TRIM = { w: 576, h: 360 } (points)
// MEASURED_BLEED = 4.56 (points)
// CAN_DIAM_IN = 2.6 (inches)
// Converted to inches (72pt = 1in):
// labelWidthIn = (576 + 2*4.56) / 72 = 585.12 / 72 ≈ 8.127
// labelHeightIn = (360 + 2*4.56) / 72 = 369.12 / 72 ≈ 5.127
// bleedIn = 4.56 / 72 ≈ 0.0633

export function lolevMaster(): Master {
  return {
    formatVersion: 1,
    id: "lolev",
    name: "Lolev",
    physical: {
      labelWidthIn: 585.12 / 72,
      labelHeightIn: 369.12 / 72,
      bleedIn: 4.56 / 72,
      canDiameterIn: 2.6,
    },
    defaults: {},
    guides: { left: 24.12, center: "auto", right: 24.12, top: 24.12, bottom: 24.12 },
    fields: [
      { id: "name", label: "Beer name", kind: "text", path: "beerName" },
      { id: "style", label: "Style", kind: "text", path: "styleLine.text" },
      { id: "abv", label: "ABV", kind: "number", path: "abv", min: 0, max: 20 },
      { id: "description", label: "Description", kind: "text", path: "description" },
      { id: "upc", label: "UPC", kind: "code", symbology: "upc-a", path: "upc" },
    ],
    variations: [
      { id: "collab", name: "Collab", overrides: { collabEnabled: true }, layerOverrides: {}, fields: [] },
    ],
  };
}
