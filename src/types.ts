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
}

export interface StyledLine extends Style {
  text: string;
  /** Render with the SemiBold face (e.g. the highlighted hops line). */
  bold?: boolean;
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
   *  are default gold (#D0B070). Parsed by src/description.ts. */
  description: string;
  /** 12-digit UPC-A. The barcode block is always white-ink with black bars. */
  upc: string;
  /** QR payload is derived: https://lolev.beer/beer/<machineName(beerName)>.
   *  Fill is free hex; qrStroke "none" = no stroke, else modules are
   *  outlined in that color (like the barcode's white stroke). */
  qrFill: Fill;
  qrStroke: Fill;
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
