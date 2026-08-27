// Lolev master fixture — the coverage bridge proving the model can express
// today's product. Resolution of this master with no variants reproduces
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
    // Collab is an ORDINARY variant — no boolean on LabelConfig, no special
    // case in any renderer. It carries exactly what a collab label adds:
    // three fields (the lead-in's text and the two logo slots' asset ids)
    // and the laurel's stack nudge, which used to be gated on the deleted
    // `collabEnabled` flag and now simply arrives with the variant. The
    // nudge ships at 0 because that is what today's collab labels render
    // with (the master's own `logo` declares no offsetY); it is a real,
    // overridable knob, not a placeholder. What stops the collab block
    // drawing when the variant is off is the resolver's disabled-layer set
    // alone — the three layers below are tagged `variant: "collab"`.
    variants: [
      {
        id: "collab", name: "Collab",
        overrides: { logo: { offsetY: 0 } },
        layerOverrides: {},
        fields: [
          { id: "collabLead", label: "Lead-in", kind: "text", path: "collabLead.text" },
          { id: "collabLeft", label: "Text Logo", kind: "image", path: "collabLeft.image" },
          { id: "collabCenter", label: "Graphic Logo", kind: "image", path: "collabCenter.image" },
        ],
      },
    ],
    // Draw order per planLabel (src/plan.ts) — read top-to-bottom, not the
    // registry order in src/elements.ts. Names reuse ELEMENTS' labels
    // except the wordmark, renamed to "Brand" per the spec. The three collab
    // layers are tagged `variant: "collab"` rather than living in the
    // variant's own layer list (see MasterLayer.variant's doc); that tag is
    // now the ONLY thing suppressing them on a non-collab label. The warning
    // ships locked: it is correct-by-default and fillers must not move it.
    layers: [
      { id: "volume", name: "Volume", enabled: true },
      { id: "abv", name: "ABV", enabled: true },
      { id: "description", name: "Description", enabled: true },
      { id: "collabLead", name: "Lead-In", enabled: true, variant: "collab" },
      { id: "collabLeft", name: "Text Logo", enabled: true, variant: "collab" },
      { id: "wordmark", name: "Brand", enabled: true },
      { id: "logo", name: "Logo", enabled: true },
      { id: "collabCenter", name: "Graphic Logo", enabled: true, variant: "collab" },
      { id: "name", name: "Name", enabled: true },
      { id: "styleLine", name: "Style", enabled: true },
      { id: "handleAddress", name: "Info", enabled: true },
      { id: "warning", name: "Warning", enabled: true, locked: true },
      { id: "storeCold", name: "Store cold", enabled: true },
      { id: "qr", name: "QR", enabled: true },
      { id: "barcode", name: "Barcode", enabled: true },
    ],
  };
}
