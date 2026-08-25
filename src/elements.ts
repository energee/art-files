// elements.ts — the one registry of stylable label elements. The form and
// the preview both read it, so they cannot disagree about what exists or
// which config field backs it.
import type { LabelConfig, Style, StyledLine } from "./types";
import { defaultConfig } from "./defaults";
import { strokeLayerOf } from "./strokes";

/** The shipped config, for reading any element's factory style. Built once:
 *  defaultConfig() allocates a whole config (description lines included), and
 *  isDefaultStyle runs on every inspector render — i.e. per keystroke while a
 *  layer is selected. Never mutated; the panel edits App's config, not this. */
export const SHIPPED: LabelConfig = defaultConfig();

/** The laurel's effective stack nudge. The nudge exists to make room for the
 *  centre collab mark, so while the collab switch is off the laurel draws at
 *  its laid-out position — the saved offsetY survives in the config for the
 *  next collab release. Renderers and hit-testing read the nudge through
 *  this one gate so they cannot disagree. */
export function logoNudge(cfg: LabelConfig): number {
  return cfg.collabEnabled ? cfg.logo.offsetY ?? 0 : 0;
}

export type ElementId =
  | "name" | "styleLine" | "abv" | "description"
  | "volume" | "wordmark" | "logo" | "handleAddress" | "warning" | "storeCold"
  | "qr" | "barcode"
  | "collabLead" | "collabLeft" | "collabCenter";

export interface LabelElement {
  id: ElementId;
  /** Shown in the form row and as the properties panel header. */
  label: string;
  /** "beer" changes every time; "template" is set once; "collab" appears
   *  only on collab releases (the layers panel dims those rows while the
   *  collab switch is off). */
  group: "beer" | "template" | "collab";
  /** Whether a bold toggle applies. False for the logo (no text at all) and
   *  for the two codes (the barcode's digits are drawn in one fixed face). */
  hasBold: boolean;
  /** Whether this element draws glyphs, i.e. whether letter-spacing means
   *  anything for it. False for the logo (a vector shape) and the two codes —
   *  the QR has no text at all, and the barcode's digits are fixed geometry
   *  whose spacing is part of the symbol, not a style choice. Distinct from
   *  hasBold, which is also false for text set in one fixed face. */
  isText: boolean;
  /** Whether "no ink" is a legal Fill. False for the two codes: an ink-less
   *  QR or barcode isn't scannable, so their Fill control must never offer
   *  that option. */
  allowNone: boolean;
  /** Read accessor. Writes go through applyStyle. */
  style(c: LabelConfig): Style;
}

/** The two code elements keep their style in flat config fields rather than a
 *  Style object, so both the read accessor below and applyStyle's writes need
 *  to know which fields back which element. Naming them once here is what
 *  keeps the two directions from disagreeing. */
const FLAT = {
  qr: {
    fill: "qrFill", layer: "qrLayer", stroke: "qrStroke",
    strokeLayer: "qrStrokeLayer", strokeWidth: "qrStrokeWidth",
  },
  barcode: {
    fill: "barcodeFill", layer: "barcodeLayer",
    stroke: "barcodeStroke", strokeLayer: "barcodeStrokeLayer",
    strokeWidth: "barcodeStrokeWidth",
  },
} as const;
type FlatKeys = (typeof FLAT)[keyof typeof FLAT];

/** Adapts flat config fields to a Style, so the registry can treat every
 *  element uniformly. */
const flatStyle = (k: FlatKeys) => (c: LabelConfig): Style => ({
  fill: c[k.fill], layer: c[k.layer], stroke: c[k.stroke],
  strokeLayer: c[k.strokeLayer], strokeWidth: c[k.strokeWidth],
});

export const ELEMENTS: LabelElement[] = [
  { id: "name", label: "Name", group: "beer", hasBold: false, isText: true, allowNone: true, style: (c) => c.nameStyle },
  { id: "styleLine", label: "Style", group: "beer", hasBold: true, isText: true, allowNone: true, style: (c) => c.styleLine },
  { id: "abv", label: "ABV", group: "beer", hasBold: false, isText: true, allowNone: true, style: (c) => c.abvStyle },
  { id: "description", label: "Description", group: "beer", hasBold: false, isText: true, allowNone: true, style: (c) => c.descStyle },
  // The two codes must always carry ink — see allowNone's doc. Both are
  // "beer": the QR payload follows the beer name and the UPC digits change
  // per release, so neither is a set-once brand-template element.
  // Barcode precedes QR because the layers panel lists each group in registry
  // order, and the spec's stacking puts the barcode first.
  { id: "barcode", label: "Barcode", group: "beer", hasBold: false, isText: false, allowNone: false, style: flatStyle(FLAT.barcode) },
  { id: "qr", label: "QR", group: "beer", hasBold: false, isText: false, allowNone: false, style: flatStyle(FLAT.qr) },
  // Collab block — its own group: a collab partner changes per release like
  // "beer", but the block exists only while the collab switch is on, and the
  // layers panel shows it as its own section. The two logo slots draw
  // uploaded art, not glyphs, so they
  // get neither bold nor letter-spacing; the lead-in is text, but it is drawn
  // in one fixed SemiBold face like the handle/address, hence hasBold: false.
  { id: "collabLead", label: "Lead-In", group: "collab", hasBold: false, isText: true, allowNone: true, style: (c) => c.collabLead },
  // The two slots are named for what goes in them, not where they sit: the
  // left slot takes the partner's text/wordmark art, the centre one their
  // graphic mark (it hangs under the laurel in the centre stack).
  { id: "collabLeft", label: "Text Logo", group: "collab", hasBold: false, isText: false, allowNone: true, style: (c) => c.collabLeft },
  { id: "collabCenter", label: "Graphic Logo", group: "collab", hasBold: false, isText: false, allowNone: true, style: (c) => c.collabCenter },
  { id: "volume", label: "Volume", group: "template", hasBold: true, isText: true, allowNone: true, style: (c) => c.volume },
  { id: "wordmark", label: "Wordmark", group: "template", hasBold: false, isText: true, allowNone: true, style: (c) => c.wordmark },
  { id: "logo", label: "Logo", group: "template", hasBold: false, isText: false, allowNone: true, style: (c) => c.logo },
  { id: "handleAddress", label: "Info", group: "template", hasBold: true, isText: true, allowNone: true, style: (c) => c.handleAddress },
  { id: "warning", label: "Warning", group: "template", hasBold: false, isText: true, allowNone: true, style: (c) => c.warning },
  { id: "storeCold", label: "Store cold", group: "template", hasBold: true, isText: true, allowNone: true, style: (c) => c.storeCold },
];

/** Elements whose text can be edited from the preview: double-clicking one
 *  floats an editor panel over its outline (see PreviewCompare). Every
 *  config-backed text element is here — the wordmark, the government
 *  warning, and the collab lead-in draw fixed text with no backing config
 *  field, so they are the only text elements absent. */
export interface EditableText {
  get(c: LabelConfig): string;
  set(c: LabelConfig, text: string): void;
  /** Restrict typing to digits and a decimal point (the ABV number — its
   *  "% alc by vol" tail is drawn, not stored, and never editable). */
  numeric?: boolean;
  /** The description's markdown block: edited through the sidebar's
   *  DescriptionEditor (WYSIWYG buttons over rendered lines, raw markdown
   *  only behind its own edit-as-markdown toggle) floated over the block,
   *  instead of a plain input. */
  multiline?: boolean;
  /** Drawn centred on the label, so the in-place editor centres too. */
  centred?: boolean;
  /** Rendered uppercase (the name); the stored text keeps its case. */
  upper?: boolean;
  /** Drawn rotated in the right column: a horizontal caret can't sit on
   *  vertical glyphs, so these edit in a small floating field at the
   *  element instead of truly in place. */
  rotated?: boolean;
}

export const editableText: Partial<Record<ElementId, EditableText>> = {
  name: { get: (c) => c.beerName, set: (c, t) => { c.beerName = t; }, centred: true, upper: true },
  styleLine: { get: (c) => c.styleLine.text, set: (c, t) => { c.styleLine.text = t; }, centred: true },
  abv: { get: (c) => c.abv, set: (c, t) => { c.abv = t; }, numeric: true },
  description: { get: (c) => c.description, set: (c, t) => { c.description = t; }, multiline: true },
  volume: { get: (c) => c.volume.text, set: (c, t) => { c.volume.text = t; } },
  handleAddress: { get: (c) => c.handleAddress.text, set: (c, t) => { c.handleAddress.text = t; }, rotated: true },
  storeCold: { get: (c) => c.storeCold.text, set: (c, t) => { c.storeCold.text = t; }, rotated: true },
};

export function elementById(id: ElementId): LabelElement {
  const e = ELEMENTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown element: ${id}`);
  return e;
}

/** Apply a style patch to whichever config fields back `id`. Widened to
 *  Partial<StyledLine> (rather than Partial<Style>) so a single patch can
 *  also carry `bold`, which lives on StyledLine, not Style. Two things this
 *  function guards itself against, since the wider type would otherwise
 *  type-check both:
 *  - `bold` is dropped for elements where ELEMENTS marks hasBold: false, so
 *    a stray `{ bold }` can never get Object.assign'd onto a plain Style
 *    object (e.g. the logo) even if some future caller sends one.
 *  - `letterSpacing` is dropped the same way for isText: false, tracking
 *    being meaningless for a vector mark. Both capability rules live here
 *    rather than at the call sites: the inspector applies one patch to a
 *    whole multi-element selection whose members disagree about what they
 *    accept, and Reset sends every field unconditionally.
 *  - the flat elements' strokeWidth write uses `"strokeWidth" in patch`
 *    rather than `!== undefined`, so a patch that explicitly carries
 *    `strokeWidth: undefined` (Reset, restoring a shipped default of
 *    "unset") actually clears it instead of being silently ignored. That
 *    matters most for the barcode, whose unset width means "keep the halo
 *    measured off the finished labels" (see drawBarcode). fill/layer/stroke
 *    stay on `!== undefined`: unlike strokeWidth they're required fields on
 *    the flat configs, so an accidental explicit-undefined in a patch should
 *    stay a no-op, not null one out.
 *  The flat branch also silently drops `letterSpacing`, having no config
 *  field for it: qr and barcode are isText: false, so the panel never offers
 *  tracking and Reset's unconditional `letterSpacing: undefined` is a no-op
 *  for them. */
export function applyStyle(c: LabelConfig, id: ElementId, patch: Partial<StyledLine>): void {
  const el = elementById(id);
  if (!el.hasBold && "bold" in patch) {
    const { bold: _bold, ...rest } = patch;
    patch = rest;
  }
  if (!el.isText && "letterSpacing" in patch) {
    const { letterSpacing: _ls, ...rest } = patch;
    patch = rest;
  }
  if (id in FLAT) {
    const k = FLAT[id as keyof typeof FLAT];
    if (patch.fill !== undefined) c[k.fill] = patch.fill;
    if (patch.layer !== undefined) c[k.layer] = patch.layer;
    if (patch.stroke !== undefined) c[k.stroke] = patch.stroke;
    if (patch.strokeLayer !== undefined) c[k.strokeLayer] = patch.strokeLayer;
    if ("strokeWidth" in patch) c[k.strokeWidth] = patch.strokeWidth;
    return;
  }
  Object.assign(el.style(c), patch);
}

/** True when `s` still matches THIS element's shipped appearance — i.e. what
 *  StyleProperties' Reset would restore — so the UI knows whether to show a
 *  deviation marker and offer that reset.
 *
 *  Compared against defaultConfig(), not a hardcoded gold/metallic/no-stroke
 *  triple: several elements ship a deliberate deviation from gold (the logo's
 *  dark keyline, the barcode's near-black bars in a white halo over white
 *  ink). Against a hardcoded triple those read as permanently "dirty", and —
 *  worse — restyling the barcode TO gold/metallic/no-stroke, which is exactly
 *  the unscannable state, would read as "default" and unmount the Reset button
 *  that undoes it. bold and strokeWidth count too: they are both editable in
 *  the panel and both restored by Reset, so leaving them out would leave a
 *  changed element claiming to be untouched. */
export function isDefaultStyle(id: ElementId, s: Style): boolean {
  const d = elementById(id).style(SHIPPED);
  // An absent stroke and an explicit "none" are the same thing to every
  // renderer (see strokeOf in pdf/build.ts), so normalize before comparing;
  // strokeWidth only matters while a stroke is actually drawn.
  const strokeOf = (x: Style) => (x.stroke === undefined ? "none" : x.stroke);
  const widthOf = (x: Style) => (strokeOf(x) === "none" ? undefined : x.strokeWidth);
  const plateOf = (x: Style) =>
    strokeOf(x) === "none" ? undefined : strokeLayerOf(x);
  const boldOf = (x: Style) =>
    elementById(id).hasBold ? ((x as StyledLine).bold ?? false) : false;
  // Absent tracking and an explicit 0 are the same to every renderer, and
  // tracking is editable and reset like the rest — leaving it out would let a
  // respaced element claim to be untouched.
  const trackOf = (x: Style) => x.letterSpacing ?? 0;
  // Same reasoning as tracking: a nudged logo has been positioned by hand, so
  // it must not report itself as shipped-default (and must keep its Reset).
  const offsetOf = (x: Style) => (x as { offsetY?: number }).offsetY ?? 0;
  return (
    s.fill === d.fill &&
    s.layer === d.layer &&
    strokeOf(s) === strokeOf(d) &&
    plateOf(s) === plateOf(d) &&
    widthOf(s) === widthOf(d) &&
    trackOf(s) === trackOf(d) &&
    offsetOf(s) === offsetOf(d) &&
    boldOf(s) === boldOf(d)
  );
}
