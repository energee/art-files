// types.ts — the label config data model. This is also the schema of the
// Save/Load JSON: a LabelConfig serializes as-is (plus {version: 1}).

/** Fill color drawn in the art PDF: a "#rrggbb" hex string, or "none"
 *  meaning no ink (draws white; stock/white ink shows through). */
export type Fill = `#${string}` | "none";

/** White-ink layer assignment: "metallic" knocks the glyphs out of the white
 *  layer (silver stock shows through); "white" paints white ink under them. */
export type Layer = "metallic" | "white";

export interface Style {
  fill: Fill;
  layer: Layer;
  /** Outer stroke drawn behind the element in the art PDF; "none"/absent = off. */
  stroke?: Fill;
  /** Stroke width in px at the 600dpi deliverable (default 15 ≈ 1.8pt). */
  strokeWidth?: number;
  /** Extra space between glyphs (tracking), in PDF points; absent = 0.
   *  Points, not px@600dpi like strokeWidth, because tracking is judged
   *  against the type size — which layout.ts also authors in points. Applies
   *  to every text element; the logo and the two codes have no glyphs of
   *  their own to space (the barcode's digits are fixed geometry). */
  letterSpacing?: number;
}

export interface StyledLine extends Style {
  text: string;
  /** Render with the SemiBold face (e.g. the highlighted hops line). */
  bold?: boolean;
}

/** Styling for one collab-logo slot. The uploaded image itself is *not* part
 *  of the config (it is supplied at build time via Assets, like the texture and
 *  mask) — only how it is drawn. */
export interface CollabSlot extends Style {
  /** Multiplier on the fit-to-box size: 1 = fill the slot box, 0.5 = half. */
  scale: number;
}

export interface LabelConfig {
  /** Displayed uppercase, also names the output files. */
  beerName: string;
  nameStyle: Style;
  /** Subtitle under the name, e.g. "Ultra Hopped Ale". */
  styleLine: StyledLine;
  /** Numeric string, e.g. "8" -> "8% alc by vol". */
  abv: string;
  abvStyle: Style;
  /** Description block as a markdown subset — one line per label line:
   *  `# text` = header, `**text**` = bold, `_text_` = white ink; plain lines
   *  and the header take descStyle. Parsed by src/description.ts. */
  description: string;
  /** Base style for the description block: fill/layer for plain lines and
   *  the header (the `_white_` marker overrides those), outer stroke for
   *  every description line. */
  descStyle: Style;
  /** 12-digit UPC-A. */
  upc: string;
  /** The UPC barcode's style. Flat fields like the QR's, for the same reason:
   *  it is drawn from geometry, not from a StyledLine. barcodeFill paints the
   *  bars and the digits; barcodeStroke "none" = no white halo, else both get
   *  an outer stroke in that color, barcodeStrokeWidth px @600dpi wide — the
   *  shipped default sets 20; left unset it keeps the halo measured off the
   *  old finished labels (L.BARCODE.stroke ≈ 15.5px), which is how pre-style
   *  configs migrate. barcodeLayer "white" is the white ink the code needs
   *  to scan over the texture. */
  /** Collab labels: the master switch for the whole collab block. Off, nothing
   *  collab draws and the form hides its fields, whatever art is loaded. On,
   *  each slot draws only once its image is supplied in Assets: `collabLeft`
   *  flows under the description below an automatic bold "A collaborative
   *  project with" lead-in (styled by `collabLead`); `collabCenter` hangs
   *  under the laurel. */
  collabEnabled: boolean;
  collabLead: Style;
  collabLeft: CollabSlot;
  collabCenter: CollabSlot;
  barcodeFill: Fill;
  barcodeStroke: Fill;
  barcodeStrokeWidth?: number;
  barcodeLayer: Layer;
  /** QR payload is derived: https://lolev.beer/beer/<machineName(beerName)>.
   *  Fill is free hex; qrStroke "none" = no stroke, else modules get an
   *  outer stroke in that color, qrStrokeWidth px @600dpi wide. */
  qrFill: Fill;
  qrStroke: Fill;
  qrStrokeWidth?: number;
  qrLayer: Layer;
  // Static template elements (text fixed, style assignable):
  volume: StyledLine; // "1 PINT"
  wordmark: Style; // "Lolev Beer"
  logo: Style; // laurel
  handleAddress: StyledLine; // "@LOLEVBEER  5247 BUTLER ST, PITTSBURGH, PA"
  warning: Style; // government warning paragraph
  storeCold: StyledLine; // "STORE COLD"
}

export interface ConfigFile extends LabelConfig {
  version: 1;
}
