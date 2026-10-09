// Model types and parser for the v1 Master/Variant label model (spec:
// docs/superpowers/specs/2026-08-27-master-variation-design.md). Pure types +
// a defensive parser; no DOM, no rendering. Still live: files.ts parses a v1
// .master with parseMaster before convert.ts lifts it into the layer model
// (model/layers.ts), and FieldDecl/FieldValue/LabelFileV2 type the v2 label
// readers (model/labelfile.ts, src/labelfile.ts) and model/fields.ts.
import type { LabelConfig } from "../types";
import type { DeepPartial } from "./merge";
import type { Guides } from "./layers";

type FieldKind = "text" | "number" | "image" | "code" | "select" | "toggle";
export type FieldValue = string | number | boolean;

/** What a .label may fill. `path` binds the value into the resolved
 *  LabelConfig (dot path, e.g. "beerName", "styleLine.text") — the Plan-1
 *  bridge until layers generalize in Plan 2. */
export interface FieldDecl {
  id: string;
  label: string;
  kind: FieldKind;
  path: string;
  /** Derived content: a format string over field values (format.ts); when
   *  set, the expanded string is written to `path` instead of the raw value. */
  format?: string;
  /** number kind */
  min?: number; max?: number;
  /** select kind */
  options?: string[];
  /** code kind: which validator applies. Mirrors barcode.ts's `Symbology`
   *  (re-declared, not imported, to avoid a circular import). */
  symbology?: "upc-a" | "ean-13" | "code-128";
}

/** One layer on the master: identity and POLICY only — never style or
 *  content (those stay in `defaults`, which resolves into LabelConfig).
 *  Built-in `id`s are the renderer's own element ids (see src/elements.ts's
 *  ElementId: "name" | "styleLine" | "abv" | "description" | "volume" |
 *  "wordmark" | "logo" | "handleAddress" | "warning" | "storeCold" | "qr" |
 *  "barcode" | "collabLead" | "collabLeft" | "collabCenter"), re-declared
 *  here rather than imported so the pure model never depends on the UI
 *  registry — keep the two in sync. */
export interface MasterLayer {
  id: string;
  /** Shown in the layers panel. */
  name: string;
  /** Master-level disable: the layer never draws on any label. */
  enabled: boolean;
  /** Fillers cannot move it (spec: Lock). Absent = unlocked. */
  locked?: boolean;
  /** Which variant owns this layer; absent = the master owns it. A layer
   *  owned by a disabled variant does not draw — and since `collabEnabled`
   *  was deleted from LabelConfig, this tag is the ONLY thing that stops the
   *  collab block drawing: its three layers are ordinary master layers
   *  tagged `variant: "collab"`, and no renderer knows the word "collab"
   *  means anything special any more. Deliberate extension of the spec's
   *  `variant.layers` (which stays, for layers a variant APPENDS): the
   *  collab layers sit at fixed positions in the draw order, which an
   *  appended list cannot express. */
  variant?: string;
  /** Custom layers only: which renderer shape this layer is. Absent = a
   *  built-in layer whose id planLabel already knows. convert.ts reads it to
   *  reconstruct the CustomLayer's `type` from the config's styling at this
   *  layer's own id. Never set on a built-in id. */
  kind?: "text" | "image" | "barcode" | "qr";
}

/** A pure diff on the master — never a copy. */
export interface Variant {
  id: string;
  name: string;
  /** DeepPartial, not Partial: a variant overrides LEAVES (an authored
   *  `nameStyle.fill`, say), applied by deepMerge. The shipped v1 Collab
   *  variant overrides nothing (`overrides: {}`). */
  overrides: DeepPartial<LabelConfig>;
  layerOverrides: Record<string, Partial<MasterLayer>>;
  fields: FieldDecl[];
  /** Layers this variant APPENDS to the master's draw order when enabled —
   *  distinct from MasterLayer.variant, which tags an existing master layer
   *  as owned by this variant. Absent = none; no shipped master uses this
   *  yet (spec's appended-layer path, kept for a future variant that adds
   *  wholly new layers rather than reusing a master one). */
  layers?: MasterLayer[];
}

export interface Master {
  formatVersion: 1;
  id: string;
  name: string;
  physical: { labelWidthIn: number; labelHeightIn: number; bleedIn: number; canDiameterIn: number };
  defaults: Partial<LabelConfig>;
  guides: Guides;
  fields: FieldDecl[];
  variants: Variant[];
  /** Every layer, in DRAW ORDER (the order planLabel emits them). */
  layers: MasterLayer[];
}

/** The new .label payload: IDs and values only — no layout, no styling. */
export interface LabelFileV2 {
  formatVersion: 2;
  masterId: string;
  masterHint?: string;
  enabledVariants: string[];        // in enable order
  values: Record<string, FieldValue>; // keyed by FieldDecl.id; dormant values kept
  /** Label-level deviations from the resolved master, applied after resolve
   *  (spec: Migration — "preserves nonstandard styling as label-level
   *  overrides"). Absent = none. */
  overrides?: DeepPartial<LabelConfig>;
  /** Values and variant toggles that the CURRENT master does not declare,
   *  kept verbatim so aiming a label at another master and back loses
   *  nothing. Matching is by id, so a variant id the new master also
   *  declares comes straight back off the bench. */
  dormant?: { values: Record<string, FieldValue>; variants: string[] };
}

function fail(msg: string): never { throw new Error(`Invalid master file: ${msg}`); }

export function parseMaster(json: unknown): Master {
  const m = json as Master;
  if (!m || typeof m !== "object") fail("not an object");
  if (m.formatVersion !== 1) fail(`unsupported formatVersion (expected 1)`);
  if (!m.id || typeof m.id !== "string") fail("missing id");
  if (!m.name || typeof m.name !== "string") fail("missing name");
  const p = m.physical;
  if (!p || [p.labelWidthIn, p.labelHeightIn, p.bleedIn, p.canDiameterIn].some((n) => typeof n !== "number"))
    fail("missing or incomplete physical dimensions");
  if (!m.defaults || typeof m.defaults !== "object") fail("missing defaults");
  if (!m.guides || typeof m.guides !== "object") fail("missing guides");
  const fields = m.fields ?? fail("missing fields");
  const variants = m.variants ?? fail("missing variants");
  const seen = new Set<string>();
  for (const v of variants) {
    if (!v.id) fail("variant without id");
    if (seen.has(v.id)) fail(`duplicate variant id "${v.id}"`);
    seen.add(v.id);
  }
  const kinds = new Set<FieldKind>(["text", "number", "image", "code", "select", "toggle"]);
  const symbologies = new Set(["upc-a", "ean-13", "code-128"]);
  const fids = new Set<string>();
  for (const f of [...fields, ...variants.flatMap((v) => v.fields ?? [])]) {
    if (!f.id || !f.kind || !f.path) fail(`field "${f.id ?? "?"}" missing id/kind/path`);
    if (!kinds.has(f.kind)) fail(`field "${f.id}" has unknown kind "${f.kind}"`);
    if (f.symbology !== undefined && !symbologies.has(f.symbology))
      fail(`field "${f.id}" has unknown symbology "${f.symbology}"`);
    if (fids.has(f.id)) fail(`duplicate field id "${f.id}"`);
    fids.add(f.id);
  }
  const layers = m.layers ?? fail("missing layers");
  if (!Array.isArray(layers)) fail("layers must be an array");
  const lids = new Set<string>();
  const layerKinds = new Set(["text", "image", "barcode", "qr"]);
  const validateLayer = (l: MasterLayer, context: string) => {
    if (!l.id || typeof l.id !== "string") fail(`${context} layer missing id`);
    if (!l.name || typeof l.name !== "string") fail(`${context} layer "${l.id}" missing name`);
    if (typeof l.enabled !== "boolean") fail(`${context} layer "${l.id}" missing enabled`);
    if (lids.has(l.id)) fail(`duplicate layer id "${l.id}"`);
    lids.add(l.id);
    if (l.variant !== undefined && !seen.has(l.variant))
      fail(`${context} layer "${l.id}" names undeclared variant "${l.variant}"`);
    // `kind` is the one field this task adds: validated the same way
    // FieldDecl.symbology already is above, so a hand-edited or corrupted
    // .master with a bogus kind fails to open loudly instead of resolving
    // into a CustomLayer with an unrenderable `type`.
    if (l.kind !== undefined && !layerKinds.has(l.kind))
      fail(`${context} layer "${l.id}" has unknown kind "${l.kind}"`);
  };
  for (const l of layers) validateLayer(l, "master");
  // Variant.layers (the appended-layer path — see its own doc comment): same
  // shape rules as a master layer, and checked against the SAME `lids` set
  // built above, so an appended id colliding with a master layer id (or
  // another variant's appended id) fails here rather than surfacing later as
  // duplicate panel rows / duplicate React keys (M2).
  for (const v of variants) {
    for (const l of v.layers ?? []) validateLayer(l, `variant "${v.id}"`);
  }
  return m;
}
