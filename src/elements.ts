// elements.ts — the one registry of stylable label elements. The form and
// the preview both read it, so they cannot disagree about what exists or
// which config field backs it.
import type { LabelConfig, Style, StyledLine } from "./types";
import { GOLD } from "./layout";

export type ElementId =
  | "name" | "styleLine" | "abv" | "description"
  | "volume" | "wordmark" | "logo" | "handleAddress" | "warning" | "storeCold"
  | "qr" | "barcode";

export interface LabelElement {
  id: ElementId;
  /** Shown in the form row and as the properties panel header. */
  label: string;
  /** "beer" changes every time; "template" is set once. */
  group: "beer" | "template";
  /** Whether a bold toggle applies. False for the logo (no text at all) and
   *  for the two codes (the barcode's digits are drawn in one fixed face). */
  hasBold: boolean;
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
  qr: { fill: "qrFill", layer: "qrLayer", stroke: "qrStroke", strokeWidth: "qrStrokeWidth" },
  barcode: {
    fill: "barcodeFill", layer: "barcodeLayer",
    stroke: "barcodeStroke", strokeWidth: "barcodeStrokeWidth",
  },
} as const;
type FlatKeys = (typeof FLAT)[keyof typeof FLAT];

/** Adapts flat config fields to a Style, so the registry can treat every
 *  element uniformly. */
const flatStyle = (k: FlatKeys) => (c: LabelConfig): Style => ({
  fill: c[k.fill], layer: c[k.layer], stroke: c[k.stroke], strokeWidth: c[k.strokeWidth],
});

export const ELEMENTS: LabelElement[] = [
  { id: "name", label: "Beer name", group: "beer", hasBold: false, allowNone: true, style: (c) => c.nameStyle },
  { id: "styleLine", label: "Subtitle", group: "beer", hasBold: true, allowNone: true, style: (c) => c.styleLine },
  { id: "abv", label: "ABV", group: "beer", hasBold: false, allowNone: true, style: (c) => c.abvStyle },
  { id: "description", label: "Description", group: "beer", hasBold: false, allowNone: true, style: (c) => c.descStyle },
  // The two codes must always carry ink — see allowNone's doc. Both are
  // "beer": the QR payload follows the beer name and the UPC digits change
  // per release, so neither is a set-once brand-template element.
  { id: "qr", label: "QR", group: "beer", hasBold: false, allowNone: false, style: flatStyle(FLAT.qr) },
  { id: "barcode", label: "Barcode", group: "beer", hasBold: false, allowNone: false, style: flatStyle(FLAT.barcode) },
  { id: "volume", label: "Volume", group: "template", hasBold: true, allowNone: true, style: (c) => c.volume },
  { id: "wordmark", label: "Wordmark", group: "template", hasBold: false, allowNone: true, style: (c) => c.wordmark },
  { id: "logo", label: "Logo", group: "template", hasBold: false, allowNone: true, style: (c) => c.logo },
  { id: "handleAddress", label: "Handle / address", group: "template", hasBold: true, allowNone: true, style: (c) => c.handleAddress },
  { id: "warning", label: "Warning", group: "template", hasBold: false, allowNone: true, style: (c) => c.warning },
  { id: "storeCold", label: "Store cold", group: "template", hasBold: true, allowNone: true, style: (c) => c.storeCold },
];

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
 *  - the flat elements' strokeWidth write uses `"strokeWidth" in patch`
 *    rather than `!== undefined`, so a patch that explicitly carries
 *    `strokeWidth: undefined` (Reset, restoring a shipped default of
 *    "unset") actually clears it instead of being silently ignored. That
 *    matters most for the barcode, whose unset width means "keep the halo
 *    measured off the finished labels" (see drawBarcode). fill/layer/stroke
 *    stay on `!== undefined`: unlike strokeWidth they're required fields on
 *    the flat configs, so an accidental explicit-undefined in a patch should
 *    stay a no-op, not null one out. */
export function applyStyle(c: LabelConfig, id: ElementId, patch: Partial<StyledLine>): void {
  const el = elementById(id);
  if (!el.hasBold && "bold" in patch) {
    const { bold: _bold, ...rest } = patch;
    patch = rest;
  }
  if (id === "qr" || id === "barcode") {
    const k = FLAT[id];
    if (patch.fill !== undefined) c[k.fill] = patch.fill;
    if (patch.layer !== undefined) c[k.layer] = patch.layer;
    if (patch.stroke !== undefined) c[k.stroke] = patch.stroke;
    if ("strokeWidth" in patch) c[k.strokeWidth] = patch.strokeWidth;
    return;
  }
  Object.assign(el.style(c), patch);
}

/** True when nothing deviates from the silent gold/metallic default, so the
 *  UI knows whether to show a deviation marker and a reset. */
export function isDefaultStyle(s: Style): boolean {
  return (
    s.fill === GOLD &&
    s.layer === "metallic" &&
    (s.stroke === undefined || s.stroke === "none")
  );
}
