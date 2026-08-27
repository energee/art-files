// elements.ts — the one registry of stylable label elements. The form and
// the preview both read it, so they cannot disagree about what exists or
// which config field backs it.
import type { LabelConfig, Style, StyledLine } from "./types";
import type { CollabSlots, Face, MeasureFace } from "./plan";
import {
  CUSTOM_BARCODE_DIGIT_GAP_RATIO, CUSTOM_BARCODE_DIGIT_SIZE_RATIO,
  encodeFor, validateFor,
} from "./barcode";
import { DESC, FONT_ASC, FONT_DESC, HANDLE_ADDR, runsWidth } from "./layout";
import { defaultConfig } from "./defaults";
import { strokeLayerOf } from "./strokes";
import { parseRuns } from "./description";
import type { LayerPosition } from "./model/position";

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
  | "collabLead" | "collabLeft" | "collabCenter"
  | `custom-${string}`;

/** True when `id` names a master-variant custom layer rather than one of
 *  the fixed elements above. Every exhaustive switch/lookup over ElementId
 *  must check this first and branch to generic custom-layer handling —
 *  ELEMENTS has no entry for these ids. */
export const isCustomId = (id: ElementId): id is `custom-${string}` =>
  id.startsWith("custom-");

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
 *  edits it in place over the artwork (see PreviewCompare). Every
 *  config-backed text element is here — the wordmark, the government
 *  warning, and the collab lead-in draw fixed text with no backing config
 *  field, so they are the only text elements absent. */
export interface EditableText {
  get(c: LabelConfig): string;
  set(c: LabelConfig, text: string): void;
  /** Restrict typing to digits and a decimal point (the ABV number). */
  numeric?: boolean;
  /** Drawn after the text but NOT stored, so an editor redraws it beside the
   *  field, uneditable, while the element itself is hidden for the session
   *  (the ABV's unit tail). */
  suffix?: string;
  /** Authored in the markdown subset (`**bold**`, `_white ink_`, plus the
   *  description block's `# header`), so both the sidebar and the preview
   *  edit it with the WYSIWYG field (DescriptionEditor) — markers PAINTED as
   *  bold/white runs, never shown as punctuation.
   *
   *  The value is what that field has to draw with: the element's size and
   *  leading in points, and the face pair plan.ts hands the renderers for it
   *  (its `base` / `boldFace`), so the field paints what the canvas would.
   *  Being the flag AND the metrics is deliberate — a separate table of
   *  metrics could disagree with the flag about which elements are rich. */
  rich?: { size: number; leading: number; faces: { base: Face; bold: Face } };
  /** Several lines (the description block). A `rich` element without it
   *  holds one line, matching what the renderer draws for it. */
  multiline?: boolean;
  /** Drawn centred on the label, so the in-place editor centres too. */
  centred?: boolean;
  /** Rendered uppercase (the name); the stored text keeps its case. */
  upper?: boolean;
  /** Drawn rotated 90deg CCW in the right column: the in-place editor
   *  turns with the text, so the field lies on its side over the element
   *  like every other element's does (see PreviewCompare). */
  rotated?: boolean;
}

export const editableText: Partial<Record<ElementId, EditableText>> = {
  name: { get: (c) => c.beerName, set: (c, t) => { c.beerName = t; }, centred: true, upper: true },
  styleLine: { get: (c) => c.styleLine.text, set: (c, t) => { c.styleLine.text = t; }, centred: true },
  abv: {
    get: (c) => c.abv, set: (c, t) => { c.abv = t; },
    numeric: true, suffix: "% alc by vol",
  },
  description: {
    get: (c) => c.description, set: (c, t) => { c.description = t; },
    rich: { size: DESC.size, leading: DESC.leading, faces: { base: "regular", bold: "semibold" } },
    multiline: true,
  },
  volume: { get: (c) => c.volume.text, set: (c, t) => { c.volume.text = t; } },
  // One rotated line in the markdown subset (see parseInfoLine): rich, so
  // the preview paints `**@handle**` bold instead of showing the asterisks.
  // The setter keeps the FIRST line whatever a field hands it — the slot
  // draws one baseline, so a stored second line would silently never
  // appear; every writer goes through here, so no caller repeats the rule.
  handleAddress: {
    get: (c) => c.handleAddress.text,
    set: (c, t) => { c.handleAddress.text = t.split("\n")[0]; },
    // ONE drawn line, so its "leading" is just its em box — which lands the
    // field's line box exactly on the drawn one.
    rich: {
      size: HANDLE_ADDR.size,
      leading: (FONT_ASC + FONT_DESC) * HANDLE_ADDR.size,
      faces: { base: "semibold", bold: "bold" },
    },
    rotated: true,
  },
  storeCold: { get: (c) => c.storeCold.text, set: (c, t) => { c.storeCold.text = t; }, rotated: true },
};

/** Generic registry entry for any `custom-${string}` id — no ELEMENTS row
 *  backs these (they are user-added, not part of the fixed template), so
 *  this stands in wherever code looks an element up by id alone. No bold
 *  toggle and no letter-spacing capability by default; label falls back to
 *  the id itself since elementById has no config to read the layer's name
 *  from (callers with the config should prefer that name directly).
 *
 *  style() has no config here (elementById only gets the id), so it can't
 *  reach the real CustomLayer entry — applyStyle below routes custom-id
 *  writes into cfg.customLayers directly instead of through this accessor.
 *  A fresh object per call (never a shared singleton) means any other
 *  reader that calls style() can't have its result mutated by someone
 *  else's Object.assign. */
const customFallback = (id: `custom-${string}`): LabelElement => ({
  id, label: id, group: "beer", hasBold: false, isText: false, allowNone: true,
  style: () => ({ fill: "none", layer: "white" }),
});

export function elementById(id: ElementId): LabelElement {
  if (isCustomId(id)) return customFallback(id);
  const e = ELEMENTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown element: ${id}`);
  return e;
}

/** Capability row for one custom layer, read from the ACTUAL layer in `cfg`
 *  — unlike elementById's customFallback above, which stays blind (no config
 *  to read) for callers that only have an id. text layers take a bold toggle
 *  and tracking like any glyph-drawing element; image/barcode/QR take
 *  neither, matching the fixed logo/QR/barcode rows. allowNone follows the
 *  same "must stay scannable" rule as the two fixed codes: false for
 *  barcode/qr, true otherwise. label is the layer's own display name, so the
 *  panel/inspector show what the user named it rather than its id.
 *  A stale/vanished id (mid-delete) falls back to customFallback so callers
 *  never crash on it. */
export function customElement(cfg: LabelConfig, id: `custom-${string}`): LabelElement {
  const layer = cfg.customLayers?.find((l) => l.id === id);
  if (!layer) return customFallback(id);
  const label = layer.name;
  // A fresh find per style() call (not the closed-over `layer`), so a caller
  // that mutates `c` and reads again — e.g. StyleProperties' multi-select
  // loop — sees the current value, not the snapshot taken when this
  // LabelElement was built. `.find`'s inline predicate can't narrow the
  // union by itself (a compound `l.id === id && l.type === "text"` boolean
  // doesn't propagate to `?.line`), so each accessor narrows on its own `l`.
  if (layer.type === "text")
    return {
      id, label, group: "beer", hasBold: true, isText: true, allowNone: true,
      style: (c) => {
        const l = c.customLayers?.find((x) => x.id === id);
        return l && l.type === "text" ? l.line : layer.line;
      },
    };
  if (layer.type === "image")
    return {
      id, label, group: "beer", hasBold: false, isText: false, allowNone: true,
      style: (c) => {
        const l = c.customLayers?.find((x) => x.id === id);
        return l && l.type === "image" ? l.style : layer.style;
      },
    };
  // barcode / qr — an ink-less code isn't scannable, same rule as the fixed
  // "barcode"/"qr" rows in ELEMENTS. Both carry a plain `style: Style` field
  // (unlike text's StyledLine/image's tint Style), so no per-type narrowing
  // is needed here beyond ruling text/image back out.
  return {
    id, label, group: "beer", hasBold: false, isText: false, allowNone: false,
    style: (c) => {
      const l = c.customLayers?.find((x) => x.id === id);
      return l && l.type !== "text" && l.type !== "image" ? l.style : layer.style;
    },
  };
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
  // Custom ids read their capabilities off the actual layer (customElement)
  // rather than elementById's blind customFallback — otherwise a custom TEXT
  // layer's bold/tracking would be stripped below before ever reaching the
  // isCustomId routing further down, since customFallback always reports
  // hasBold/isText false.
  const el = isCustomId(id) ? customElement(c, id) : elementById(id);
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
  if (isCustomId(id)) {
    // elementById's customFallback has no config to write through (see its
    // comment), so route the patch into the actual CustomLayer entry here —
    // its line's Style fields for text, its style for image — instead of
    // Object.assign'ing a throwaway object that no one reads back.
    const layer = c.customLayers?.find((l) => l.id === id);
    if (!layer) return;
    Object.assign(layer.type === "text" ? layer.line : layer.style, patch);
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

/** A custom text layer's drawn width in points, for dragTarget2's box() —
 *  the same run-width calc plan.ts uses to place it (parseRuns + tracked
 *  runsWidth), kept in one small local copy so dragTarget2 doesn't need a
 *  runtime import of plan.ts (plan.ts already imports THIS file, and a
 *  value import back would make the two modules mutually dependent). */
function customTextWidth(line: StyledLine, size: number, m: MeasureFace): number {
  const runs = parseRuns(line);
  const faceOf = (r: StyledLine): Face => (r.bold ? "semibold" : "regular");
  return runsWidth(runs, (r) => m(r.text, size, faceOf(r)), line.letterSpacing ?? 0);
}

/** A custom barcode layer's drag box size — pattern length x moduleW wide, h
 *  tall plus the digit band when shown — null for a payload that fails its
 *  symbology's validator (no box, matching planLabel's emits-nothing rule).
 *  A local copy of plan.ts's customBarcodeBox FUNCTION (same reasoning as
 *  customTextWidth above: a runtime value-import back into plan.ts would
 *  make the two modules mutually dependent, since plan.ts already imports
 *  this file for logoNudge/ElementId) — but the digit-size/gap RATIOS
 *  themselves are shared, imported from barcode.ts (which both plan.ts and
 *  this file already import at runtime), so this box and plan.ts's
 *  customBarcodeItem can't drift apart on the two numbers that matter. */
function customBarcodeDragBox(layer: {
  symbology: "upc-a" | "ean-13" | "code-128"; value: string;
  h: number; moduleW: number; showDigits?: boolean;
}): { w: number; h: number } | null {
  if (!validateFor(layer.symbology, layer.value).ok) return null;
  const pattern = encodeFor(layer.symbology, layer.value);
  const showDigits = layer.showDigits ?? true;
  const textSize = layer.h * CUSTOM_BARCODE_DIGIT_SIZE_RATIO;
  const gap = layer.h * CUSTOM_BARCODE_DIGIT_GAP_RATIO;
  return {
    w: pattern.modules.length * layer.moduleW,
    h: layer.h + (showDigits ? gap + textSize : 0),
  };
}

/** Drag-to-move targets: either the legacy single-axis "offsetY" knob (the
 *  laurel/collab logos) or, for an unlocked custom layer, the full two-axis
 *  "position" form driven by model/position.ts's anchor+offset math. Null =
 *  not draggable right now: a locked custom layer, a locked logo/collab
 *  slot, the laurel's offsetY off the collab switch, an empty collab slot,
 *  or an unknown custom id.
 *
 *  `m` (a text measurer) is only needed for a text custom layer's box() —
 *  every other branch ignores it, so callers that never touch a custom text
 *  layer (this file's own dragTarget wrapper, most tests) can omit it. */
export function dragTarget2(
  cfg: LabelConfig, slots: CollabSlots, id: ElementId, m?: MeasureFace,
):
  | { kind: "position"; get(): LayerPosition; box(): { w: number; h: number } | null; set(c: LabelConfig, p: LayerPosition): void }
  | { kind: "offsetY"; get(): number; set(c: LabelConfig, v: number): void }
  | null {
  if (isCustomId(id)) {
    const layer = cfg.customLayers?.find((l) => l.id === id);
    if (!layer || layer.locked) return null;
    return {
      kind: "position",
      get: () => layer.position,
      box: () => {
        if (layer.type === "text") {
          if (!m) return null;
          return { w: customTextWidth(layer.line, layer.size, m), h: layer.size };
        }
        if (layer.type === "barcode") return customBarcodeDragBox(layer);
        if (layer.type === "qr") return { w: layer.size, h: layer.size };
        // Image layers keep only their box WIDTH in config (types.ts's
        // CustomImageLayer.w); the drawn height follows the layer's own
        // stored `aspect` (captured at drop time), so the drag box is exact
        // without needing the loaded PlanAssets this call has no access to.
        // Absent on an older layer with no stored aspect: square fallback.
        return { w: layer.w, h: layer.aspect ? layer.w / layer.aspect : layer.w };
      },
      set: (c, p) => {
        const l = c.customLayers?.find((x) => x.id === id);
        if (l) l.position = p;
      },
    };
  }
  const legacy = dragTarget(cfg, slots, id);
  return legacy ? { kind: "offsetY", ...legacy } : null;
}

/** Drag-to-move targets: the elements whose vertical position is a persisted
 *  config knob (see types.ts's Positioned). Null = not draggable right now —
 *  the laurel's offsetY only applies while collab is on (logoNudge's gate),
 *  an empty collab slot draws nothing to drag, and a locked slot (Positioned.
 *  locked) is frozen regardless of collab/asset state. Horizontal position is
 *  not a knob anywhere, so dragging is vertical by construction.
 *
 *  Kept as the underlying "offsetY" implementation dragTarget2 wraps for
 *  logo/collab ids, and as its own export since existing call sites (the
 *  form-side style panels) only ever ask about those ids and want the plain
 *  `{get,set}` shape, not dragTarget2's tagged union. */
export function dragTarget(
  cfg: LabelConfig, slots: CollabSlots, id: ElementId,
): { get(): number; set(c: LabelConfig, v: number): void } | null {
  if (id === "logo" && cfg.collabEnabled && !cfg.logo.locked)
    return { get: () => cfg.logo.offsetY ?? 0, set: (c, v) => { c.logo.offsetY = v; } };
  if (id === "collabLeft" && cfg.collabEnabled && slots.left && !cfg.collabLeft.locked)
    return { get: () => cfg.collabLeft.offsetY ?? 0, set: (c, v) => { c.collabLeft.offsetY = v; } };
  if (id === "collabCenter" && cfg.collabEnabled && slots.center && !cfg.collabCenter.locked)
    return { get: () => cfg.collabCenter.offsetY ?? 0, set: (c, v) => { c.collabCenter.offsetY = v; } };
  return null;
}
