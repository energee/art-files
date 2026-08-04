// elements.ts — the one registry of stylable label elements. The form and
// the preview both read it, so they cannot disagree about what exists or
// which config field backs it.
import type { LabelConfig, Style, StyledLine } from "./types";
import { GOLD } from "./layout";

export type ElementId =
  | "name" | "styleLine" | "abv" | "description"
  | "volume" | "wordmark" | "logo" | "handleAddress" | "warning" | "storeCold"
  | "qr";

export interface LabelElement {
  id: ElementId;
  /** Shown in the form row and as the properties panel header. */
  label: string;
  /** "beer" changes every time; "template" is set once. */
  group: "beer" | "template";
  /** Whether a bold toggle applies (logo and QR have no text). */
  hasBold: boolean;
  /** Read accessor. Writes go through applyStyle. */
  style(c: LabelConfig): Style;
}

/** The QR's style lives in flat config fields rather than a Style object;
 *  this adapts it so the registry can treat every element uniformly. */
const qrStyle = (c: LabelConfig): Style => ({
  fill: c.qrFill, layer: c.qrLayer, stroke: c.qrStroke, strokeWidth: c.qrStrokeWidth,
});

export const ELEMENTS: LabelElement[] = [
  { id: "name", label: "Beer name", group: "beer", hasBold: false, style: (c) => c.nameStyle },
  { id: "styleLine", label: "Subtitle", group: "beer", hasBold: true, style: (c) => c.styleLine },
  { id: "abv", label: "ABV", group: "beer", hasBold: false, style: (c) => c.abvStyle },
  { id: "description", label: "Description", group: "beer", hasBold: false, style: (c) => c.descStyle },
  { id: "qr", label: "QR", group: "beer", hasBold: false, style: qrStyle },
  { id: "volume", label: "Volume", group: "template", hasBold: true, style: (c) => c.volume },
  { id: "wordmark", label: "Wordmark", group: "template", hasBold: false, style: (c) => c.wordmark },
  { id: "logo", label: "Logo", group: "template", hasBold: false, style: (c) => c.logo },
  { id: "handleAddress", label: "Handle / address", group: "template", hasBold: true, style: (c) => c.handleAddress },
  { id: "warning", label: "Warning", group: "template", hasBold: false, style: (c) => c.warning },
  { id: "storeCold", label: "Store cold", group: "template", hasBold: true, style: (c) => c.storeCold },
];

export function elementById(id: ElementId): LabelElement {
  const e = ELEMENTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown element: ${id}`);
  return e;
}

/** Apply a style patch to whichever config fields back `id`. Widened to
 *  Partial<StyledLine> (rather than Partial<Style>) so a single patch can
 *  also carry `bold`, which lives on StyledLine, not Style; the qr branch
 *  below ignores it since qr text/bold doesn't exist (ELEMENTS marks
 *  hasBold: false for qr, so callers never send it). */
export function applyStyle(c: LabelConfig, id: ElementId, patch: Partial<StyledLine>): void {
  if (id === "qr") {
    if (patch.fill !== undefined) c.qrFill = patch.fill;
    if (patch.layer !== undefined) c.qrLayer = patch.layer;
    if (patch.stroke !== undefined) c.qrStroke = patch.stroke;
    if (patch.strokeWidth !== undefined) c.qrStrokeWidth = patch.strokeWidth;
    return;
  }
  Object.assign(elementById(id).style(c), patch);
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
