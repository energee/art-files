// src/model/layers.ts — the v3 label model (spec:
// docs/superpowers/specs/2026-09-04-master-as-layers-design.md).
//
// A LAYER is the only unit. A master is its layers in draw order plus the
// variants that diff them; a label is a master reference, the variants it
// turned on, and the values filled into fillable layers. There is no
// separate field list, no defaults bag, no Document group: background and
// mask are the two bottom image layers, and every built-in Lolev element is
// an ordinary layer in model/lolevLayers.ts.
//
// This file replaces model/types.ts's Master/Variant/MasterLayer/FieldDecl/
// LabelFileV2 and LabelConfig's per-element fields. Pure types + parser; no
// DOM, no rendering. Converters for v1/v2 files live in model/convert.ts.
import type { Style, StyledLine } from "../types";
import type { Anchor } from "./position";
import type { FontFamilyId } from "../fontCatalog";
import type { DeepPartial } from "./merge";

export type Symbology = "upc-a" | "ean-13" | "code-128";
export type LayerKind = "text" | "image" | "barcode" | "qr";

/** Vertical binding: this layer's top edge sits at layer `below`'s resolved
 *  bottom edge plus `gap` points (positive = down). Chains resolve in
 *  dependency order; a cycle or a reference to a missing/disabled layer is
 *  a load-time fail() on the master (only Design mode can create one). */
export interface RelativeY { below: string; gap: number }

export interface LayerBase {
  id: string;
  /** Shown in the Layers list. */
  name: string;
  kind: LayerKind;
  /** Off = never draws. The only visibility switch (no session "eye"). */
  enabled: boolean;
  /** Fillers cannot move it. Universal — every kind honors it. */
  locked?: boolean;
  /** Listed in the Fillable filter; its content is what a .label fills. */
  fillable?: boolean;
  /** Horizontal position in PDF points, measured from the page origin
   *  (bleed included, like layout.ts's constants), interpreted per `anchor`:
   *  left = the box's left edge, center = its center, right = its right
   *  edge. */
  x: number;
  anchor: Anchor;
  /** TOP edge of the layer's box in PDF points from the page origin, or a
   *  binding to another layer. For text the box top is the first line's
   *  ascender (baseline - FONT_ASC * size); for a rotated layer it is the
   *  rotated box's top. */
  y: number | RelativeY;
  /** Which edge `y` (a number) places: the box's top (absent) or its
   *  bottom — a bottom-anchored layer grows upward, which is how the Lolev
   *  right-hand column hangs from the bottom margin. Ignored when `y` is a
   *  binding (a bound layer's top follows the layer above). */
  vAnchor?: "top" | "bottom";
  /** 90 = rotated counter-clockwise, reading bottom-to-top (the Lolev
   *  right-hand column). Absent = 0. */
  rotation?: 0 | 90;
}

/** One line of a text layer: the description's per-run rich model, plus the
 *  header flag the description's `# ` line used to carry. Every run keeps
 *  its own fill / white-ink layer / bold, exactly as StyledLine does. */
export interface TextLine extends StyledLine { header?: boolean }

export interface TextLayer extends LayerBase {
  kind: "text";
  /** The content. A fillable text layer's .label value is this array. */
  lines: TextLine[];
  /** Type size in points. */
  size: number;
  /** Line height as a multiple of `size`. Absent = 1.2 (DESC: 10.8 / 9). */
  leading?: number;
  /** Header lines are set at `size * headerScale`. Absent = 1. */
  headerScale?: number;
  align: "left" | "center" | "right" | "justify";
  /** Wrap width in points (along the reading direction, so for a rotated
   *  layer it is the column length). Absent = never wrap. */
  width?: number;
  /** Fill-mode widget hint. Absent = the rich text editor. `number` shows a
   *  number box writing one plain line; `code` shows a validated code box
   *  for `symbology`. */
  input?: "number" | "code";
  min?: number; max?: number;
  symbology?: Symbology;
  /** number/code inputs: fixed text drawn after the filled value on the
   *  same line ("% alc by vol"). Fill mode never edits it. */
  suffix?: string;
  /** Fill-mode placeholder while the layer is empty (e.g. "Name"). */
  placeholder?: string;
  /** Renders every run uppercase (the beer name). Absent = as typed. */
  uppercase?: boolean;
  /** Block style: base fill / plate, outer stroke, tracking. A run's own
   *  fill/layer/bold wins over it (parseRuns semantics). */
  style: Style;
}

export interface ImageLayer extends LayerBase {
  kind: "image";
  /** Asset id into the master's or label's image store, or the bundled
   *  "builtin:logo" (the Lolev laurel SVG). "" = nothing loaded, draws
   *  nothing. A fillable image layer's .label value is this string. */
  asset: string;
  /** Box width in points. */
  w: number;
  /** Box height in points. Absent = follow the asset's aspect at `w`. */
  h?: number;
  /** How the asset meets a w×h box. contain = fit inside (collab slots),
   *  cover = fill and crop (background texture, mask). Absent = contain. */
  fit?: "contain" | "cover";
  /** Multiplier on the fitted size (collab slots' scale). Absent = 1. */
  scale?: number;
  /** Raster art only: repaint non-transparent pixels in `style.fill`. */
  tintRaster?: boolean;
  /** The background texture ("background") and the metallic mask ("mask")
   *  are ordinary image layers drawn by their special roles; every other
   *  image is `art`. Absent = art. */
  role?: "background" | "mask" | "art";
  style: Style;
}

export interface BarcodeLayer extends LayerBase {
  kind: "barcode";
  symbology: Symbology;
  /** Payload. May be a format string over text-layer ids ("{upc}"), see
   *  model/format.ts. A fillable barcode layer's .label value is this. */
  value: string;
  /** Bar-area height in points. */
  h: number;
  /** Module width in points. */
  moduleW: number;
  /** Human-readable digits. Absent = true. */
  showDigits?: boolean;
  /** fill/plate + stroke-as-halo. */
  style: Style;
}

export interface QrLayer extends LayerBase {
  kind: "qr";
  /** Payload; format string over text-layer ids with format.ts transforms
   *  ("https://lolev.beer/beer/{name|slug}"). */
  value: string;
  size: number;
  qrStyle: "square" | "rounded" | "dots";
  ecLevel?: "L" | "M" | "Q" | "H";
  style: Style;
}

export type Layer = TextLayer | ImageLayer | BarcodeLayer | QrLayer;

/** What a .label stores for a fillable layer: text lines, or an asset id /
 *  code value. */
export type LayerValue = TextLine[] | string;

export interface Guides {
  left: number | null; center: "auto" | null; right: number | null;
  top: number | null; bottom: number | null;
}

/** A diff on the master's layers, keyed by layer id. An id the master has
 *  = a deep-partial override; an id it lacks = a whole new layer that exists
 *  only while the variant is on (validated complete at load). New layers
 *  draw after the master's, in the order they appear here. */
export interface Variant {
  id: string;
  name: string;
  layers: Record<string, DeepPartial<Layer>>;
}

export interface Master {
  formatVersion: 3;
  id: string;
  name: string;
  physical: { labelWidthIn: number; labelHeightIn: number; bleedIn: number; canDiameterIn: number };
  guides: Guides;
  /** One typeface for the whole label — the single font gate. Absent =
   *  "poppins". */
  fontFamily?: FontFamilyId;
  /** DRAW ORDER, back to front. */
  layers: Layer[];
  variants: Variant[];
}

export interface LabelFile {
  formatVersion: 3;
  masterId: string;
  masterHint?: string;
  enabledVariants: string[];
  values: Record<string, LayerValue>;
  /** Label-level deviations from the resolved master, by layer id. */
  overrides?: Record<string, DeepPartial<Layer>>;
  dormant?: { values: Record<string, LayerValue>; variants: string[] };
}

function fail(msg: string): never { throw new Error(`Invalid master file: ${msg}`); }

const KINDS = new Set<LayerKind>(["text", "image", "barcode", "qr"]);
const SYMBOLOGIES = new Set<Symbology>(["upc-a", "ean-13", "code-128"]);
const ANCHORS = new Set<Anchor>(["left", "center", "right"]);

function validateLayer(l: Layer, ctx: string): void {
  if (!l.id || typeof l.id !== "string") fail(`${ctx} layer missing id`);
  if (!l.name || typeof l.name !== "string") fail(`${ctx} layer "${l.id}" missing name`);
  if (!KINDS.has(l.kind)) fail(`${ctx} layer "${l.id}" has unknown kind "${l.kind}"`);
  if (typeof l.enabled !== "boolean") fail(`${ctx} layer "${l.id}" missing enabled`);
  if (typeof l.x !== "number") fail(`${ctx} layer "${l.id}" missing x`);
  if (!ANCHORS.has(l.anchor)) fail(`${ctx} layer "${l.id}" has unknown anchor "${l.anchor}"`);
  const y = l.y as unknown;
  const relOk = !!y && typeof y === "object"
    && typeof (y as RelativeY).below === "string" && typeof (y as RelativeY).gap === "number";
  if (typeof y !== "number" && !relOk) fail(`${ctx} layer "${l.id}" has invalid y`);
  if (l.rotation !== undefined && l.rotation !== 0 && l.rotation !== 90)
    fail(`${ctx} layer "${l.id}" has invalid rotation`);
  if (l.kind === "text") {
    if (!Array.isArray(l.lines)) fail(`text layer "${l.id}" missing lines`);
    if (typeof l.size !== "number") fail(`text layer "${l.id}" missing size`);
    if (!["left", "center", "right", "justify"].includes(l.align)) fail(`text layer "${l.id}" has invalid align`);
    if (l.symbology !== undefined && !SYMBOLOGIES.has(l.symbology))
      fail(`text layer "${l.id}" has unknown symbology "${l.symbology}"`);
  } else if (l.kind === "image") {
    if (typeof l.asset !== "string") fail(`image layer "${l.id}" missing asset`);
    if (typeof l.w !== "number") fail(`image layer "${l.id}" missing w`);
  } else if (l.kind === "barcode") {
    if (!SYMBOLOGIES.has(l.symbology)) fail(`barcode layer "${l.id}" has unknown symbology "${l.symbology}"`);
    if (typeof l.value !== "string") fail(`barcode layer "${l.id}" missing value`);
    if (typeof l.h !== "number" || typeof l.moduleW !== "number") fail(`barcode layer "${l.id}" missing h/moduleW`);
  } else {
    if (typeof l.value !== "string") fail(`qr layer "${l.id}" missing value`);
    if (typeof l.size !== "number") fail(`qr layer "${l.id}" missing size`);
  }
  if (!l.style || typeof l.style !== "object") fail(`${ctx} layer "${l.id}" missing style`);
}

/** Every `below` reference must name a layer in the list, and the graph
 *  must be acyclic. Runs over the master's own layers and again per variant
 *  with that variant's diff merged in. */
function validateBindings(layers: { id: string; y: number | RelativeY }[], ctx: string): void {
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const l of layers) {
    const seen = new Set<string>([l.id]);
    let at = l;
    while (typeof at.y === "object") {
      const next = byId.get(at.y.below);
      if (!next) fail(`${ctx} layer "${at.id}" is bound below missing layer "${at.y.below}"`);
      if (seen.has(next.id)) fail(`${ctx} layer "${l.id}" has a cyclic y binding`);
      seen.add(next.id);
      at = next;
    }
  }
}

export function parseMaster(json: unknown): Master {
  const m = json as Master;
  if (!m || typeof m !== "object") fail("not an object");
  if (m.formatVersion !== 3) fail("unsupported formatVersion (expected 3)");
  if (!m.id || typeof m.id !== "string") fail("missing id");
  if (!m.name || typeof m.name !== "string") fail("missing name");
  const p = m.physical;
  if (!p || [p.labelWidthIn, p.labelHeightIn, p.bleedIn, p.canDiameterIn].some((n) => typeof n !== "number"))
    fail("missing or incomplete physical dimensions");
  if (!m.guides || typeof m.guides !== "object") fail("missing guides");
  if (!Array.isArray(m.layers)) fail("missing layers");
  if (!Array.isArray(m.variants)) fail("missing variants");
  const ids = new Set<string>();
  for (const l of m.layers) {
    validateLayer(l, "master");
    if (ids.has(l.id)) fail(`duplicate layer id "${l.id}"`);
    ids.add(l.id);
  }
  validateBindings(m.layers, "master");
  const vids = new Set<string>();
  for (const v of m.variants) {
    if (!v.id || typeof v.id !== "string") fail("variant without id");
    if (!v.name || typeof v.name !== "string") fail(`variant "${v.id}" missing name`);
    if (vids.has(v.id)) fail(`duplicate variant id "${v.id}"`);
    vids.add(v.id);
    if (!v.layers || typeof v.layers !== "object") fail(`variant "${v.id}" missing layers`);
    const merged: { id: string; y: number | RelativeY }[] = m.layers.map((l) => ({ id: l.id, y: l.y }));
    for (const [id, patch] of Object.entries(v.layers)) {
      if (ids.has(id)) {
        if (patch.y !== undefined) {
          const i = merged.findIndex((l) => l.id === id);
          merged[i] = { id, y: patch.y as number | RelativeY };
        }
        continue;
      }
      validateLayer({ ...(patch as Layer), id }, `variant "${v.id}"`);
      merged.push({ id, y: patch.y as number | RelativeY });
    }
    validateBindings(merged, `variant "${v.id}"`);
  }
  return m;
}
