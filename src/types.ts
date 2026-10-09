// types.ts — the label config data model. This is also the schema of the
// Save/Load JSON: a LabelConfig serializes as-is (plus {version: 1}). Still
// version 1: `customLayers` (master-variant free-floating text/image
// layers) is additive — absent on every pre-existing file, which loads as
// "no custom layers" with no migration needed.

import type { FontFamilyId } from "./fontCatalog";
import type { LayerPosition } from "./model/position";

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
  /** White-ink plate assignment for the outer stroke, independent of the
   *  fill's layer. Absent in older version-1 files resolves to "white". */
  strokeLayer?: Layer;
  /** Stroke width in px at the 600dpi deliverable (default 15 ≈ 1.8pt). */
  strokeWidth?: number;
  /** Extra space between glyphs (tracking), in PDF points; absent = 0.
   *  Points, not px@600dpi like strokeWidth, because tracking is judged
   *  against the type size — which layout.ts also authors in points. Applies
   *  to every text element; the logo and the two codes have no glyphs of
   *  their own to space (the barcode's digits are fixed geometry). */
  letterSpacing?: number;
  /** Renders every run uppercase without touching the stored text, so a
   *  filler still types (and the QR's {name|slug} still reads) the typed
   *  case. Lives in Style — not on the text layer — because Style is the
   *  master-sets-it / label-overrides-it channel: a master authors it, a
   *  label turns it off through the ordinary `style.uppercase` override.
   *  Text only; the codes and the logo have no glyphs of their own. */
  uppercase?: boolean;
}

export interface StyledLine extends Style {
  text: string;
  /** Render with the SemiBold face (e.g. the highlighted hops line). */
  bold?: boolean;
}

/** Mixed into the styles of elements whose vertical placement is adjustable.
 *  Only the logo-like elements carry it: the text elements are positioned by
 *  baselines in layout.ts, and the left collab block deliberately FLOWS under
 *  the description (see collabLeftFlow) rather than sitting at a fixed y —
 *  offsetY nudges that computed position, it does not replace it. */
interface Positioned {
  /** Vertical nudge in PDF points, positive = down. Absent/0 = as laid out.
   *  For the laurel this is the "stack nudge": it exists to clear the centre
   *  collab mark. Applied UNCONDITIONALLY — logoNudge in elements.ts is just
   *  `logo.offsetY ?? 0` — because it is a real position knob, not a
   *  collab-only one: it ships absent (= 0), it is whatever the master or the
   *  label has authored, and no variant overrides it (the Collab variant
   *  deliberately declares no `logo` override, so a master-level nudge is not
   *  stomped when Collab is enabled — see model/lolevLayers.ts). */
  offsetY?: number;
  /** Freezes the element in place: dragTarget/dragTarget2 return null while
   *  set, same as a locked custom layer (see CustomLayerBase.locked).
   *  Absent = unlocked, so every pre-existing file is unaffected. */
  locked?: boolean;
}

/** Styling for one collab-logo slot, plus the id of the art filling it. The
 *  image BYTES are still not part of the config (they are supplied at build
 *  time via Assets, like the texture and mask) — `image` is only the key
 *  that says which stored asset this slot points at. */
export interface CollabSlot extends Style, Positioned {
  /** Asset id of the logo loaded into this slot, into the label's per-id
   *  image store (`custom/<assetId>/<name>` in the .label ZIP — the same
   *  store custom image layers use). This is the value of the Collab
   *  variant's `collabLeft` / `collabCenter` image FIELD, written through
   *  its path like any other field value. Absent or "" = no art loaded, and
   *  the slot draws nothing even with the variant on. */
  image?: string;
  /** Multiplier on the fit-to-box size: 1 = fill the slot box, 0.5 = half. */
  scale: number;
  /** Raster art only (PNG/JPG): repaint every non-transparent pixel in this
   *  slot's `fill`, keeping alpha — the color overlay a one-color partner logo
   *  needs. Off by default, because a full-color logo must keep its own
   *  colors, and because a logo with an opaque background tints to a solid
   *  block (see tintRgba). Vector art ignores it: an SVG always takes the
   *  slot's fill, which is what its Fill control has always done. */
  tintRaster?: boolean;
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
   *  the header, outer stroke and tracking for every description line. The
   *  `_white_` marker overrides the LAYER only — a white-ink line keeps the
   *  block's fill, like fill and layer stay independent on every other
   *  element's panel. */
  descStyle: Style;
  /** 12-digit UPC-A. */
  upc: string;
  /** Collab labels. There is no master switch here any more: "Collab" is an
   *  ordinary master VARIANT (see model/lolevLayers.ts), and with it off the
   *  resolver puts `collabLead` / `collabLeft` / `collabCenter` in its
   *  disabled-layer set, which is what stops them drawing. With it on, each
   *  slot draws only once its art is supplied in Assets: `collabLeft` flows
   *  under the description below an automatic bold "A collaborative project
   *  with" lead-in (styled by `collabLead`); `collabCenter` hangs under the
   *  laurel. */
  collabLead: Style;
  collabLeft: CollabSlot;
  /** Its `offsetY` is deliberately unused: the centre mark hangs off the
   *  laurel's nudged bottom, so `logo.offsetY` moves the pair as one stack
   *  and they keep their gap. The form exposes no separate nudge for it. */
  collabCenter: CollabSlot;
  /** The UPC barcode's style. Flat fields like the QR's, for the same reason:
   *  it is drawn from geometry, not from a StyledLine. barcodeFill paints the
   *  bars and the digits; barcodeStroke "none" = no white halo, else both get
   *  an outer stroke in that color, barcodeStrokeWidth px @600dpi wide — the
   *  shipped default sets 20; left unset it keeps the halo measured off the
   *  old finished labels (L.BARCODE.stroke ≈ 15.5px), which is how pre-style
   *  configs migrate. barcodeLayer "white" is the white ink the code needs
   *  to scan over the texture; barcodeStrokeLayer assigns the halo to its
   *  own plate and also defaults to white/non-metallic. */
  barcodeFill: Fill;
  barcodeStroke: Fill;
  barcodeStrokeWidth?: number;
  barcodeLayer: Layer;
  barcodeStrokeLayer: Layer;
  /** QR payload is derived: https://lolev.beer/beer/<machineName(beerName)>.
   *  Fill is free hex; qrStroke "none" = no stroke, else modules get an
   *  outer stroke in that color, qrStrokeWidth px @600dpi wide. Its plate is
   *  independent of qrLayer and defaults to white/non-metallic. */
  qrFill: Fill;
  qrStroke: Fill;
  qrStrokeWidth?: number;
  qrLayer: Layer;
  qrStrokeLayer: Layer;
  // Static template elements (text fixed, style assignable):
  volume: StyledLine; // "1 PINT"
  wordmark: Style; // "Lolev Beer"
  logo: Style & Positioned; // laurel
  handleAddress: StyledLine; // "@LOLEVBEER  5247 BUTLER ST, PITTSBURGH, PA"
  warning: Style; // government warning paragraph
  storeCold: StyledLine; // "STORE COLD"
  /** Label typeface, one of fontCatalog's families. Absent = "poppins" —
   *  the fallback every pre-0.1.22 file relies on (see fontFamilyOf). */
  fontFamily?: FontFamilyId;
  /** Free-floating layers added on a master variant: extra text lines or
   *  small images positioned by anchor rather than by the fixed layout.
   *  Absent = none, which is every file saved before this feature. */
  customLayers?: CustomLayer[];
}

/** Shared shape of every custom layer: identity, display name, and anchored
 *  position. `id` is `custom-${string}` (see isCustomId in elements.ts) so
 *  it can never collide with a fixed ElementId. */
interface CustomLayerBase {
  /** Unique per layer, e.g. "custom-a1b2c3". */
  id: `custom-${string}`;
  /** Shown in the layers panel. */
  name: string;
  position: LayerPosition;
  locked?: boolean;
}

/** A custom line of text, styled like any other StyledLine. */
export interface CustomTextLayer extends CustomLayerBase {
  type: "text";
  line: StyledLine;
  /** Type size in points. */
  size: number;
}

/** A custom image layer: an SVG/raster asset tinted like the collab logos. */
export interface CustomImageLayer extends CustomLayerBase {
  type: "image";
  /** Asset key into the plan's custom images (PlanAssets.custom / the app's
   *  customImages state, keyed by the id minted at drop). */
  asset: string;
  /** Box width in points; height follows the image's aspect. */
  w: number;
  /** Intrinsic aspect (w/h), captured at drop time so hit and drag boxes are
   *  exact before (and independent of) asset decode. Absent on older layers:
   *  square fallback, as before. */
  aspect?: number;
  /** Fill/layer for SVG tint and white-ink behavior. */
  style: Style;
}

/** A custom barcode layer: an independent, freely-positioned symbol, styled
 *  like the template barcode (fill/layer + stroke-as-halo) but sized by its
 *  own moduleW/h rather than layout.ts's fixed BARCODE constants. `value` is
 *  RAW like the other layers' payloads — see the comment on it below. */
export interface CustomBarcodeLayer extends CustomLayerBase {
  type: "barcode";
  symbology: "upc-a" | "ean-13" | "code-128";
  /** Payload — RAW: may be a format string over field values ("{upc}").
   *  Expansion to the drawn value happens in expandCustomFormats (Task 5);
   *  until Task 5 lands, planLabel draws the raw string when it encodes. An
   *  unexpandable/invalid raw string simply fails the symbology's validator,
   *  and the layer emits nothing rather than a garbage symbol. */
  value: string;
  /** Bar-area height in points. */
  h: number;
  /** Module width in points; run width follows the pattern length. */
  moduleW: number;
  /** Human-readable digits under the symbol (P3). Absent = true. */
  showDigits?: boolean;
  style: Style; // fill/layer + stroke-as-halo, like the template barcode
}

/** A custom QR layer: same freely-positioned model as the barcode above, but
 *  its EC level defaults to "M" for layers (P2) — the module-level qrShapes
 *  default of "L" stays the template QR's default, unrelated to this. */
export interface CustomQrLayer extends CustomLayerBase {
  type: "qr";
  value: string; // payload, RAW like the barcode's
  size: number; // side in points
  qrStyle: "square" | "rounded" | "dots";
  /** Error correction; ABSENT means "M" for layers (P2) — never L. */
  ecLevel?: "L" | "M" | "Q" | "H";
  style: Style;
}

export type CustomLayer =
  | CustomTextLayer | CustomImageLayer | CustomBarcodeLayer | CustomQrLayer;
