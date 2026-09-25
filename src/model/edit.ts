// src/model/edit.ts — the pure editing operations on the v3 model (spec:
// docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI" and
// "Removed"). Every function returns a new object and never mutates its
// input, so App can keep undo snapshots by reference.
//
// The one routing rule: WHERE AN EDIT LANDS FOLLOWS THE LAYER. A layer a
// variant's diff ADDS (an id master.layers lacks) is edited in that diff; a
// master layer is edited in master.layers. There is no editing-target
// selector. A variant overriding a MASTER layer (Collab moving the logo) is
// the one explicit case, `setLayerIn`. Bindings (`y: { below, gap }`) are
// validated through parseMaster so Design mode can never save a master the
// loader would reject.
import type {
  BarcodeLayer, ImageLayer, LabelFile, Layer, LayerKind, LayerValue, Master, QrLayer,
  RelativeY, TextLayer, Variant, BindingSide,
} from "./layers";
import type { Box } from "./place";
import { bindingOf, hAnchorOf, parseMaster, validateBindings, vAnchorOf } from "./layers";
import { deepMerge, type DeepPartial } from "./merge";
import { getPath, setPath } from "./path";
import { resolveLayers, valueOf, valuePath, widenValue } from "./resolveLayers";
import { anchorFraction, type GuideLines } from "./position";
import { CENTER_X, GOLD } from "../layout";
import { KEYLINE } from "../defaults";
import { DEFAULT_STROKE_LAYER } from "../strokes";
import { validateFor } from "../barcode";
import { fieldRefs } from "./format";
import { PT_STEP, roundToStep } from "../numeric";

type LayerPatch = DeepPartial<Layer>;
/** A variant's diff entry: a whole layer (variant-added) or a partial
 *  override of a master layer. Same static shape either way. */
type Entry = DeepPartial<Layer>;

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isBound = (y: unknown): y is RelativeY => isPlain(y) && typeof y.below === "string";

function variantOf(master: Master, id: string): Variant {
  const v = master.variants.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown variant "${id}"`);
  return v;
}

const withVariant = (master: Master, id: string, fn: (v: Variant) => Variant): Master =>
  ({ ...master, variants: master.variants.map((v) => (v.id === id ? fn(v) : v)) });

const withEntries = (v: Variant, layers: Record<string, Entry>): Variant => ({ ...v, layers });

/** Drops `key` from a record without touching the original. */
const without = <T,>(o: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

// --- Ids and defaults -------------------------------------------------------

export function mintLayerId(kind: LayerKind, taken: Set<string>): string {
  for (;;) {
    const hex = Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0");
    const id = `${kind}-${hex}`;
    if (!taken.has(id)) return id;
  }
}

const GOLD_METAL = { fill: GOLD, layer: "metallic" } as const;
const KEYLINED = { ...GOLD_METAL, ...KEYLINE } as const;

/** A sensible starting layer per kind, dropped at the center guide 100pt
 *  down. Styles mirror lolevLayers' defaults so a new layer looks like it
 *  belongs. */
function defaultLayer(kind: LayerKind, id: string): Layer {
  const base = { id, enabled: true, x: CENTER_X, anchor: "center" as const, y: 100 };
  switch (kind) {
    case "text": {
      const l: TextLayer = { ...base, kind, name: "Text", size: 12, align: "left",
        lines: [{ text: "", ...GOLD_METAL }], style: KEYLINED };
      return l;
    }
    case "image": {
      const l: ImageLayer = { ...base, kind, name: "Image", asset: "", w: 60,
        style: { ...GOLD_METAL, strokeLayer: DEFAULT_STROKE_LAYER } };
      return l;
    }
    case "barcode": {
      const l: BarcodeLayer = { ...base, kind, name: "Barcode", symbology: "upc-a", value: "",
        moduleW: 1, h: 15, style: KEYLINED };
      return l;
    }
    case "qr": {
      const l: QrLayer = { ...base, kind, name: "QR", value: "", size: 40, qrStyle: "square",
        style: KEYLINED };
      return l;
    }
  }
}

function allIds(master: Master): Set<string> {
  const ids = new Set(master.layers.map((l) => l.id));
  for (const v of master.variants) for (const k of Object.keys(v.layers)) ids.add(k);
  return ids;
}

// --- Layer lifecycle --------------------------------------------------------

/** Adds a default layer of `kind`. With `variant`, the complete layer goes
 *  into that variant's diff (it exists only while the variant is on);
 *  otherwise it joins master.layers at the end, or right after `after`. */
export function addLayer(
  master: Master, kind: LayerKind, opts: { variant?: string; after?: string } = {},
): { master: Master; id: string } {
  const id = mintLayerId(kind, allIds(master));
  const layer = defaultLayer(kind, id);
  if (opts.variant !== undefined) {
    variantOf(master, opts.variant);
    return { id, master: withVariant(master, opts.variant, (v) => withEntries(v, { ...v.layers, [id]: layer })) };
  }
  const at = opts.after === undefined ? -1 : master.layers.findIndex((l) => l.id === opts.after);
  const layers = [...master.layers];
  layers.splice(at === -1 ? layers.length : at + 1, 0, layer);
  return { id, master: { ...master, layers } };
}

/** Which record owns the layer: a variant if its diff ADDS the id (the
 *  master lacks it), else the master. Throws for an id nobody has. */
export function whereLayerLives(master: Master, id: string): "master" | { variant: string } {
  if (master.layers.some((l) => l.id === id)) return "master";
  const v = master.variants.find((x) => id in x.layers);
  if (!v) throw new Error(`Unknown layer "${id}"`);
  return { variant: v.id };
}

/** Rewrites the layer's own record — master.layers entry or the adding
 *  variant's diff entry — through `fn`. The one place the routing rule is
 *  spelled out. */
function withLayer(master: Master, id: string, fn: (l: Entry) => Entry): Master {
  const where = whereLayerLives(master, id);
  if (where === "master") {
    return { ...master, layers: master.layers.map((l) => (l.id === id ? (fn(l) as Layer) : l)) };
  }
  return withVariant(master, where.variant, (v) =>
    withEntries(v, { ...v.layers, [id]: fn(v.layers[id]) }));
}

/** The patch removing layer `id` makes to one record `key` that points at
 *  it, or undefined for a record that doesn't. A layer bound below `id` is
 *  re-pointed into the vacated slot so no binding dangles and the layer
 *  beneath does not move: a removed layer that is itself bound below another
 *  hands its `below` binding on (the chain closes up); otherwise the
 *  dependent is pinned at the removed layer's measured top (`boxes`) with no
 *  guide and a top anchor, since the removed layer's raw `y` means nothing
 *  without its own guideY/vAnchor/binding. Without its box the raw `y` is
 *  copied as a best effort. A new-style `binding` to `id` is detached at the
 *  dependent's own measured box (unbindPatch). */
function detacher(master: Master, id: string, boxes?: ReadonlyMap<string, Box>) {
  const where = whereLayerLives(master, id);
  const removed = where === "master"
    ? master.layers.find((l) => l.id === id)!
    : variantOf(master, where.variant).layers[id];
  const y = removed.y as Layer["y"];
  const top = boxes?.get(id)?.y;
  const slot: Entry = isBound(y) || top === undefined
    ? { y }
    : { y: pt(top), vAnchor: "top", guideY: "none" };
  return (entry: Entry, key: string): Entry | undefined => {
    if (entry.binding?.to === id) {
      const box = boxes?.get(key);
      if (!box) throw new Error(`Cannot remove "${id}" without the position of bound layer "${key}"`);
      return unbindPatch(entry as Layer, box);
    }
    if (isBound(entry.y) && entry.y.below === id) return structuredClone(slot);
    return undefined;
  };
}

/** Removes the layer from wherever it lives, strips every variant's entry
 *  for it, and detaches every record pointing at it (see detacher). */
export function removeLayer(master: Master, id: string, boxes?: ReadonlyMap<string, Box>): Master {
  const patchOf = detacher(master, id, boxes);
  const detach = <T extends Entry>(entry: T, key: string): T => {
    const p = patchOf(entry, key);
    return p ? { ...entry, ...p } : entry;
  };
  const layers = master.layers.filter((l) => l.id !== id).map((l) => detach(l, l.id));
  const variants = master.variants.map((v) => withEntries(v,
    Object.fromEntries(Object.entries(without(v.layers, id)).map(([k, e]) => [k, detach(e, k)]))));
  return { ...master, layers, variants };
}

/** removeLayer for the editor's document (issue #220): the label's own
 *  overrides are detached too, and its override for the removed layer
 *  dropped. An override can hold a binding the master never saw (bound in
 *  the inspector, not yet saved), or the y/vAnchor/guideY a promoted binding
 *  left behind — so each is judged by the layer it RESOLVES to, and the
 *  patch lands in an override that holds one of the keys it writes, where it
 *  would otherwise win over the master's. A switched-off version's layers
 *  count too; unmeasured (no box), one bound to `id` refuses the removal. */
export function removeLayerIn(doc: Doc, id: string, boxes?: ReadonlyMap<string, Box>): Doc {
  const master = removeLayer(doc.master, id, boxes);
  const overrides = doc.label.overrides;
  if (!overrides) return { ...doc, master };
  const patchOf = detacher(doc.master, id, boxes);
  // Switched-off versions too, their layers' overrides still bind; the
  // enabled resolve goes last so it wins for the layers you see.
  const resolve = (variants: string[]) =>
    resolveLayers(doc.master, variants, {}, overrides, { keepDisabled: true }).layers;
  const resolved = new Map([...resolve(doc.master.variants.map((v) => v.id)), ...resolve(doc.label.enabledVariants)]
    .map((l) => [l.id, l]));
  const next = Object.fromEntries(Object.entries(without(overrides, id)).map(([k, o]) => {
    const layer = resolved.get(k);
    const p = layer && patchOf(layer, k);
    // Only an override that holds a key the patch writes would win over the
    // master's own detach; patching any other would invent overrides.
    if (!p || !Object.keys(p).some((key) => key in o)) return [k, o];
    // A shallow spread, not setLabelOverride's deepMerge: the patch replaces
    // `y` whole, so no key of an old `{ below, gap }` survives into it.
    return [k, { ...o, ...p }];
  }));
  return { master, label: { ...doc.label, overrides: next } };
}

/** Moves `block` (the members of `list` whose id is in `ids`, keeping their
 *  relative order) so the member at index `at` lands where a solo move of
 *  `delta` would put it; the rest of the block packs around it. Null when
 *  nothing changes. */
function blockShifted<T>(list: readonly T[], ids: ReadonlySet<string>, idOf: (x: T) => string, at: number, delta: number): T[] | null {
  const to = Math.max(0, Math.min(list.length - 1, at + delta));
  const inBlock = (x: T) => ids.has(idOf(x));
  /** Non-block items among the first `k`. */
  const restBefore = (k: number) => list.slice(0, k).filter((x) => !inBlock(x)).length;
  // The anchor lands after `to` itself when moving later.
  const before = restBefore(to <= at ? to : to + 1);
  if (before === restBefore(at)) return null;
  const rest = list.filter((x) => !inBlock(x));
  return [...rest.slice(0, before), ...list.filter(inBlock), ...rest.slice(before)];
}

/** Moves layer `id` `delta` steps through draw order (negative = earlier,
 *  positive = later): within master.layers, or within the adding variant's
 *  added-layer key order (override entries in the same diff are skipped
 *  over). Every other id in `ids` that shares `id`'s container travels with
 *  it as one block (relative order kept); ids elsewhere are ignored, since a
 *  layer only reorders among its peers. The target index is clamped to the
 *  ends; a move that lands where it started returns `master` itself. */
export function moveLayers(master: Master, ids: readonly string[], id: string, delta: number): Master {
  const block = new Set(ids);
  const where = whereLayerLives(master, id);
  if (where === "master") {
    const layers = blockShifted(master.layers, block, (l) => l.id, master.layers.findIndex((l) => l.id === id), delta);
    return layers ? { ...master, layers } : master;
  }
  const v = variantOf(master, where.variant);
  const masterIds = new Set(master.layers.map((l) => l.id));
  const keys = Object.keys(v.layers);
  const added = keys.filter((k) => !masterIds.has(k));
  const reordered = blockShifted(added, block, (k) => k, added.indexOf(id), delta);
  if (!reordered) return master;
  // Added keys take their new order; override keys stay where they were.
  let n = 0;
  const order = keys.map((k) => (masterIds.has(k) ? k : reordered[n++]));
  return withVariant(master, v.id, (x) =>
    withEntries(x, Object.fromEntries(order.map((k) => [k, x.layers[k]]))));
}

// --- Content, policy, position ---------------------------------------------

/** THE write path for Design edits: deep-merges `patch` into the layer's own
 *  record (see withLayer). enabled/locked/fillable/name, position, style and
 *  content all come through here. A `y` patch replaces a number with a
 *  binding or back; a partial `{ y: { gap } }` keeps the binding's `below`. */
export function setLayer(master: Master, id: string, patch: LayerPatch): Master {
  return withLayer(master, id, (l) => deepMerge(l, patch as DeepPartial<Entry>));
}

/** Deletes own keys from the layer's own record (master.layers entry or the
 *  adding variant's diff entry): the write path for an inspector patch that
 *  carries `{ width: undefined }` to CLEAR an optional field, which deepMerge
 *  would otherwise skip. Only top-level keys; the inspector clears nothing
 *  deeper. */
export function unsetLayerKeys(master: Master, id: string, keys: readonly string[]): Master {
  return withLayer(master, id, (l) => {
    const out = { ...l } as Record<string, unknown>;
    for (const k of keys) delete out[k];
    return out as Entry;
  });
}

/** setLayer plus the inspector's clear rule: an own-property `undefined` in
 *  `patch` DELETES that key from the layer's record instead of being skipped
 *  (LayerInspector emits `{ width: undefined }`, `{ h: undefined }`). The one
 *  write path App uses for every inspector / list / drag patch. */
export function patchLayer(master: Master, id: string, patch: LayerPatch): Master {
  const p = patch as Record<string, unknown>;
  const unset = Object.keys(p).filter((k) => p[k] === undefined);
  const kept = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as LayerPatch;
  const next = Object.keys(kept).length ? setLayer(master, id, kept) : master;
  return parseMaster(unset.length ? unsetLayerKeys(next, id, unset) : next);
}

/** A variant's override of a MASTER layer (Collab moving the logo). The
 *  layer must be one the master has, or one this variant already carries. */
export function setLayerIn(master: Master, variant: string, id: string, patch: LayerPatch): Master {
  const v = variantOf(master, variant);
  if (!master.layers.some((l) => l.id === id) && !(id in v.layers))
    throw new Error(`Layer "${id}" is not a master layer; setLayer edits a variant-added layer in place`);
  return withVariant(master, variant, (x) =>
    withEntries(x, { ...x.layers, [id]: deepMerge(x.layers[id] ?? {}, patch as DeepPartial<Entry>) }));
}

/** Variant-targeted inspector edits use the same optional-key clear rule. */
export function patchLayerIn(master: Master, variant: string, id: string, patch: LayerPatch): Master {
  const next = setLayerIn(master, variant, id, patch);
  const entry = variantOf(next, variant).layers[id] as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete entry[key];
  }
  return parseMaster(next);
}

/** Deletes one dot-path in place, pruning any object left empty above it.
 *  No-op when the path doesn't resolve. */
function deletePath(obj: Record<string, unknown>, path: string): void {
  const keys = path.split(".");
  const chain: Record<string, unknown>[] = [obj];
  for (let i = 0; i < keys.length - 1; i++) {
    const at = chain[i][keys[i]];
    if (!isPlain(at)) return;
    chain.push(at);
  }
  delete chain[chain.length - 1][keys[keys.length - 1]];
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]).length === 0) delete chain[i - 1][keys[i - 1]];
  }
}

/** `entries` minus one override: the whole entry for `id`, or one dotted
 *  path inside it (the entry goes too once it is empty). */
function clearEntry(entries: Record<string, Entry>, id: string, path?: string): Record<string, Entry> {
  if (path === undefined || !(id in entries)) return without(entries, id);
  const entry = structuredClone(entries[id]) as Record<string, unknown>;
  deletePath(entry, path);
  return Object.keys(entry).length === 0 ? without(entries, id) : { ...entries, [id]: entry as Entry };
}

/** Removes a variant's override of a master layer (whole entry, or one
 *  dotted path within it). Refuses a layer the variant ADDED — that is a
 *  whole layer, not an override, and removeLayer's job. */
export function clearOverride(master: Master, variant: string, id: string, path?: string): Master {
  variantOf(master, variant);
  if (!master.layers.some((l) => l.id === id))
    throw new Error(`Layer "${id}" is added by variant "${variant}", not overridden; use removeLayer`);
  return withVariant(master, variant, (v) => withEntries(v, clearEntry(v.layers, id, path)));
}

/** Layer keys whose object value is ONE setting: parseMaster validates an
 *  edge `binding` ({to, side, gap}) and a bound `y` ({below, gap}) whole, so
 *  a promote row or reset for just one field would write a half-binding the
 *  master rejects (#92). */
const ATOMIC_KEYS = new Set(["binding", "y"]);

/** Flattens to dotted leaf paths; arrays count as leaves (a `lines` override
 *  is one edit, not one per run), and so do the ATOMIC_KEYS objects. */
function leafPaths(obj: unknown, prefix: string, out: Set<string>): void {
  if (!isPlain(obj) || ATOMIC_KEYS.has(prefix)) { if (prefix) out.add(prefix); return; }
  for (const k of Object.keys(obj)) leafPaths(obj[k], prefix ? `${prefix}.${k}` : k, out);
}

/** Dotted leaf paths the variant overrides on a master layer — the
 *  inspector's override badge. Empty for a layer the variant added (it IS
 *  the layer, it overrides nothing). */
export function overriddenPaths(master: Master, variant: string, id: string): Set<string> {
  const out = new Set<string>();
  if (!master.layers.some((l) => l.id === id)) return out;
  leafPaths(variantOf(master, variant).layers[id], "", out);
  return out;
}

/** Dotted leaf paths the label's own `overrides` set on a layer — the
 *  inspector badge's second source, beside the enabled variants'. */
export function labelOverriddenPaths(label: LabelFile, id: string): Set<string> {
  const out = new Set<string>();
  leafPaths(label.overrides?.[id], "", out);
  return out;
}

/** The reset badges for one inspected layer, kept APART by source: `variant`
 *  paths live in the master file and apply to every label with that variant
 *  on; `label` paths are this label's alone. Merged into one Set they made the
 *  reset gesture ambiguous — the same click could clear your own edit or
 *  rewrite the shipped variant — so the badge names its source and passes it
 *  back to the reset. `variantName` names the variant so it can say whose.
 *
 *  A variant-ADDED layer has no variant-vs-master baseline to diff, so it
 *  shows no variant badge; its LABEL overrides are still the label's own and
 *  still resettable, exactly like a base layer's. Throws for an unknown id
 *  (whereLayerLives), so callers pass a layer the document has. */
export interface OverrideBadges {
  variant: Set<string>;
  label: Set<string>;
  variantName?: string;
}

export function overrideBadges(master: Master, label: LabelFile, id: string): OverrideBadges {
  const variant = new Set<string>();
  let variantName: string | undefined;
  if (whereLayerLives(master, id) === "master") {
    for (const v of master.variants) {
      if (!label.enabledVariants.includes(v.id)) continue;
      for (const p of overriddenPaths(master, v.id, id)) { variant.add(p); variantName = v.name; }
    }
  }
  return { variant, label: labelOverriddenPaths(label, id), variantName };
}

/** Rebinds the label onto `master`, which is what adopting a saved master
 *  must do: Save Master As FORKS — the written template gets a fresh id — and
 *  the open label has to follow it. Left behind, the label keeps pointing at
 *  the master it was forked FROM, so saving the project persists that
 *  reference and reopening loads the original template instead of the fork.
 *  Returns the same object when it already points there, so a plain save
 *  stays the no-op edit it was. */
export function adoptMaster(label: LabelFile, master: Master): LabelFile {
  return label.masterId === master.id ? label : { ...label, masterId: master.id };
}

/** Is an image asset id still reachable from the document: an image layer's
 *  `asset` in the master, any variant's diff or the label's overrides, or a
 *  label value. App's liveImages filter: the in-memory store also keeps
 *  replaced/cleared art for undo, so not every stored id is referenced. */
export function assetReferenced(master: Master, label: LabelFile, assetId: string): boolean {
  const uses = (e: DeepPartial<Layer> | undefined) => !!e && (e as { asset?: string }).asset === assetId;
  if (master.layers.some(uses)) return true;
  if (master.variants.some((v) => Object.values(v.layers).some(uses))) return true;
  if (Object.values(label.overrides ?? {}).some(uses)) return true;
  return Object.values(label.values).some((v) => v === assetId);
}

/** Binds the layer's top edge below another layer's bottom. `vAnchor` is
 *  dropped (meaningless on a bound layer). Throws parseMaster's error for a
 *  binding the loader would reject (cycle, missing layer, a master layer
 *  below a variant-only one). */
export function bindBelow(master: Master, id: string, below: string, gap: number): Master {
  return parseMaster(withLayer(master, id, ({ vAnchor: _v, ...l }) => ({ ...l, y: { below, gap }, guideY: "none", binding: null })));
}

/** Writes the resolved top edge as a plain `y` (the inspector's "Unbind"),
 *  clearing `vAnchor` to top. Re-validated like bindBelow. */
export function unbind(master: Master, id: string, computedTopY: number): Master {
  return parseMaster(withLayer(master, id, ({ vAnchor: _v, ...l }) => ({ ...l, y: computedTopY, guideY: "none", binding: null })));
}

/** A position written from a gesture or a measurement, on the model's 0.01pt
 *  grid (#130). Pointer deltas and measured boxes are raw floats, and without
 *  this their noise went straight into the saved master (x: 193.08552000000003)
 *  where a typed or nudged value is clean. */
const pt = (v: number) => roundToStep(v, PT_STEP);

/** Detach only the bound axis, preserving its current measured position. */
export function unbindPatch(layer: Layer, box: Box): LayerPatch {
  const b = bindingOf(layer);
  return b?.side === "left" || b?.side === "right"
    ? { binding: null, x: pt(box.x), anchor: "left", guideX: "none" }
    : { binding: null, y: pt(box.y), vAnchor: "top", guideY: "none" };
}

/** Switch sides without moving the newly free axis or retaining a conflicting guide. */
export function bindingPatch(layer: Layer, to: string, side: BindingSide, box: Box): LayerPatch {
  const old = bindingOf(layer);
  return {
    ...(old ? unbindPatch(layer, box) : {}),
    ...(side === "left" || side === "right"
      ? { x: pt(box.x), anchor: "left", guideX: "none" } as const
      : { y: pt(box.y), vAnchor: "top", guideY: "none" } as const),
    binding: { to, side, gap: old?.gap ?? 0 },
  };
}

/** One line a gesture can snap to: where it sits on the snapping axis, and
 *  how far the thing that offered it runs along the OTHER axis — a layer's
 *  own span, a guide's the whole page. The extent is what the on-screen
 *  indicator segment is measured from (App's snapMark). `guide` marks the
 *  page's own lines (master margins/centre and manual guides) apart from a
 *  layer's edges, which is what the indicator colours itself by. */
export interface SnapTarget { at: number; min: number; max: number; guide?: boolean }

/** The candidate `at` is closest to, within `snap` — null when nothing is in
 *  range. Ties go to the last candidate, so a layer's own edge wins over the
 *  page guide it sits on. */
export function nearestLine(
  at: number, lines: readonly SnapTarget[], snap: number,
): SnapTarget | null {
  let best: SnapTarget | null = null;
  let bestAbs = snap;
  for (const line of lines) {
    if (Math.abs(line.at - at) <= bestAbs) { bestAbs = Math.abs(line.at - at); best = line; }
  }
  return best;
}

/** The distance a drag ACTUALLY travels on one axis once it has snapped:
 *  `delta` adjusted so the dragged range's near edge, middle or far edge
 *  lands on whichever candidate `line` it comes within `snap` of, and
 *  `delta` unchanged when nothing is in range. `lines` are the master's
 *  guides plus the edges and middles of the layers that are NOT moving —
 *  the Photoshop/Sketch behaviour: things line up with each other, not only
 *  with the page.
 *
 *  App computes this ONCE per axis, from the bounds of the whole selection,
 *  and drags every selected layer by it. Two rules in one:
 *    * a group snaps together or not at all. Snapping only the grabbed layer
 *      re-spaced the selection by up to `snap` every time it crossed a guide.
 *    * what snaps is the SELECTION's bounds, not whichever layer the pointer
 *      happens to be on — "centre this on the label" is about the thing you
 *      can see, and the grabbed layer is rarely centred within it. */
export function snapDelta(
  range: { min: number; size: number }, delta: number, lines: readonly SnapTarget[], snap: number,
): { delta: number; line: number | null } {
  if (delta === 0) return { delta, line: null };
  const start = range.min + delta;
  const edges = [start, start + range.size / 2, start + range.size];
  let best = 0;
  let bestAbs = snap;
  let line: number | null = null;
  for (const edge of edges) {
    const hit = nearestLine(edge, lines, bestAbs);
    if (!hit) continue;
    bestAbs = Math.abs(hit.at - edge); best = hit.at - edge; line = hit.at;
  }
  return { delta: delta + best, line };
}

/** The drag patch. Horizontal: x moves by `dx`, in whatever terms the layer
 *  already states it — an offset from a guide, or an absolute anchored at its
 *  own edge. Vertical: a bound layer moves its `gap` and keeps its binding; an
 *  unbound one moves `y` (bottom-anchored layers included — `y` is their
 *  bottom edge, still += dy). Locked layers return {}. Axes with no movement
 *  are left out of the patch.
 *
 *  It does NOT re-anchor. It used to run positionFromDrag on every move and
 *  adopt whichever anchor came out nearest, which flipped a layer from centre-
 *  to left- or right-anchored as it crossed roughly a quarter and two-thirds
 *  of the way across the page — and since the flip re-reads x against a box
 *  width assumed from the drag's start, any layer whose real box differs
 *  (a rotated column, an image still measuring) jumped at exactly those two
 *  places. Snapping does not need it either: snapDelta already lands the drag
 *  on the guide, and `guideX` is the deliberate way to glue a layer to one.
 *
 *  `moving` is the rest of the dragged SELECTION. A layer bound to another
 *  layer in it already follows that layer, so moving its `gap` as well would
 *  carry it twice as far as the pointer — the axis it is bound on is left out
 *  of the patch instead, and the binding does the work. */
export function moveBy(
  layer: Layer, dx: number, dy: number, moving: ReadonlySet<string> = new Set(),
): LayerPatch {
  if (layer.locked) return {};
  const patch: LayerPatch = {};
  const binding = layer.binding;
  const horizontal = binding?.side === "left" || binding?.side === "right";
  // Legacy `y: { below }` binds vertically without a `binding` record.
  const anchoredTo = bindingOf(layer);
  const carried = !!anchoredTo && moving.has(anchoredTo.to);
  const carriedH = carried && (anchoredTo.side === "left" || anchoredTo.side === "right");
  const carriedV = carried && !carriedH;
  if (carriedH) return moveBy({ ...layer, binding: null }, 0, dy, moving);
  if (binding && !carriedV && (horizontal ? dx !== 0 : dy !== 0)) {
    const delta = horizontal ? dx : dy;
    patch.binding = { ...binding, gap: pt(binding.gap + (binding.side === "left" || binding.side === "top" ? -delta : delta)) };
  }
  if (dx !== 0 && !horizontal) patch.x = pt(layer.x + dx);
  if (dy !== 0 && !carriedV && (!binding || horizontal)) {
    patch.y = isBound(layer.y) ? { below: layer.y.below, gap: pt(layer.y.gap + dy) } : pt(layer.y + dy);
  }
  return patch;
}

// --- Variants ---------------------------------------------------------------

const slugify = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Enable order is significant (later variants win on overlap): enabling
 *  appends, disabling removes in place. */
export function toggleVariant(label: LabelFile, id: string): LabelFile {
  const on = label.enabledVariants.includes(id);
  const enabledVariants = on ? label.enabledVariants.filter((x) => x !== id) : [...label.enabledVariants, id];
  return { ...label, enabledVariants };
}

/** Enables `id` WITHOUT making it the working version. App reads the working
 *  version off the END of `enabledVariants`, so appending here would silently
 *  retarget the master Select — and the next Save Master's promotions — at a
 *  variant the user only meant to switch a layer on inside. One from the end
 *  keeps the chosen version while still winning over everything below it.
 *  (With nothing enabled there is no version to protect, and the slice makes
 *  it the only one.) */
const enableBeneathVersion = (label: LabelFile, id: string): LabelFile => {
  const on = label.enabledVariants;
  return { ...label, enabledVariants: [...on.slice(0, -1), id, ...on.slice(-1)] };
};

/** Switching the WORKING VERSION, on the label: the version you switch to is
 *  shown, the one you switch away from is hidden. The master Select names one
 *  version, and what it names is what the canvas draws — leaving visibility to
 *  the chips meant going back to the base still drew the variant's layers.
 *
 *  Only the two versions being switched between move. `enabledVariants` is
 *  still a list, so a label that deliberately shows two at once keeps the
 *  rest of them (the chips are how it says so). */
export function showVersion(
  label: LabelFile, from: string | null, to: string | null,
): LabelFile {
  if (from === to) return label;
  let out = label;
  if (from !== null && out.enabledVariants.includes(from)) out = toggleVariant(out, from);
  if (to !== null && !out.enabledVariants.includes(to)) out = toggleVariant(out, to);
  return out;
}

export function addVariant(master: Master, name: string): { master: Master; id: string } {
  const stem = slugify(name) || "variant";
  const ids = new Set(master.variants.map((v) => v.id));
  let id = stem;
  for (let n = 2; ids.has(id); n++) id = `${stem}-${n}`;
  return { id, master: { ...master, variants: [...master.variants, { id, name, layers: {} }] } };
}

export function removeVariant(master: Master, id: string): Master {
  variantOf(master, id);
  return { ...master, variants: master.variants.filter((v) => v.id !== id) };
}

export function renameVariant(master: Master, id: string, name: string): Master {
  variantOf(master, id);
  return withVariant(master, id, (v) => ({ ...v, name }));
}

// --- Label ------------------------------------------------------------------

export function setValue(label: LabelFile, id: string, value: LayerValue): LabelFile {
  return { ...label, values: { ...label.values, [id]: structuredClone(value) } };
}

export function clearValue(label: LabelFile, id: string): LabelFile {
  return { ...label, values: without(label.values, id) };
}

/** A label-level deviation from the resolved master (the .label `overrides`).
 *
 *  An own-property `undefined` in `patch` is stored as `null`, the wire
 *  spelling of "unset this key" (LayerInspector emits `{ width: undefined }`
 *  to clear a wrap width). It cannot stay `undefined`: deepMerge skips
 *  undefined, and JSON drops it, so the clear would be lost either at resolve
 *  time or on save. resolveLayers deletes null-valued paths after merging —
 *  see applyDiff there. This mirrors patchLayer's clear rule for the master. */
export function setLabelOverride(label: LabelFile, id: string, patch: LayerPatch): LabelFile {
  const overrides = label.overrides ?? {};
  const p = patch as Record<string, unknown>;
  const withNulls = Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, v === undefined ? null : v]),
  ) as DeepPartial<Entry>;
  return { ...label, overrides: { ...overrides, [id]: deepMerge(overrides[id] ?? {}, withNulls) } };
}

/** The document the editor holds: a master and the label being filled on it.
 *  Mirrors App's own `Doc`; declared here so the routing below is pure. */
export interface Doc { master: Master; label: LabelFile }

/** The FILL CONTRACT: the keys that declare what a filler may put in a layer.
 *  They cannot be per-label — a label overriding its own placeholder or its
 *  own allowed range is meaningless — so they are authored on the master like
 *  structure is, and the Save Master review lists them as such. Everything
 *  else about a layer is the label's to override.
 *
 *  `choices` and `title` are here for the same reason: the vocabulary a filler
 *  picks from, and the caption it is picked under, describe the slot rather
 *  than one label's answer to it (docs/plans/choice-input.md). */
export const MASTER_PATHS: ReadonlySet<string> =
  new Set(["placeholder", "input", "min", "max", "symbology", "suffix",
    "choices", "title"]);

/** THE ROUTING RULE (docs/plans/label-first-editing.md): a property edit is a
 *  LABEL override, never a master edit — except the fill contract above. The
 *  master is the template and otherwise changes only through a reviewed save,
 *  so a patch does not write `master.layers`, not even for a layer a variant
 *  added: the label overrides that the same way it overrides a master layer
 *  (resolveLayers applies variants first, then the label).
 *
 *  A patch carrying both — the inspector never emits one, but a caller may —
 *  is SPLIT, each half taking its own path, rather than sent whole to either.
 *
 *  Several entries in one call so a group drag is one undo step.
 *
 *  The one master-side effect kept: switching a layer ON that only exists
 *  while some variant is enabled also enables that variant. That is a label
 *  edit (`enableBeneathVersion`), not a master one — without it the patch
 *  would set `enabled` on a layer that still does not resolve. It enables
 *  BENEATH the working version so the promote target does not move under
 *  the user.
 *
 *  A design patch on a layer this document does NOT resolve — one only a
 *  disabled variant adds, which the list still shows as a row — is dropped.
 *  Writing it would store an override resolveLayers can only warn about
 *  ("Label overrides unknown layer …") while changing nothing on the canvas.
 *  Dropping it makes the click an honest no-op: no edit, no history entry,
 *  no warning. The fill contract still routes to the master, since those
 *  fields live in the master file whether the variant is on or not.
 *
 *  Bindings are NOT checked here — see checkLabelBindings (#93). */
export function patchLayers(doc: Doc, entries: [string, LayerPatch][]): Doc {
  const masterIds = new Set(doc.master.layers.map((l) => l.id));
  /** Every layer id this document RESOLVES: the master's, plus those the
   *  enabled variants add. Built once per call — patchLayers runs per
   *  pointermove of a drag, and only the rare `enabled: true` branch below
   *  can widen it (by switching a variant on), which re-reads it there. */
  const resolvable = (label: LabelFile) => {
    const ids = new Set(masterIds);
    for (const v of doc.master.variants)
      if (label.enabledVariants.includes(v.id)) for (const k of Object.keys(v.layers)) ids.add(k);
    return ids;
  };
  let resolves = resolvable(doc.label);
  return entries.reduce((d, [id, patch]) => {
    const keys = Object.keys(patch);
    const contract = keys.filter((k) => MASTER_PATHS.has(k));
    const rest = keys.filter((k) => !MASTER_PATHS.has(k));
    const pick = (ks: string[]) =>
      Object.fromEntries(ks.map((k) => [k, (patch as Record<string, unknown>)[k]])) as LayerPatch;

    const master = contract.length ? patchLayer(d.master, id, pick(contract)) : d.master;
    let label = d.label;
    if (patch.enabled === true && !masterIds.has(id)) {
      const owner = d.master.variants.find((v) => id in v.layers);
      if (owner && !label.enabledVariants.includes(owner.id)) {
        label = enableBeneathVersion(label, owner.id);
        resolves = resolvable(label);
      }
    }
    if (rest.length && resolves.has(id)) label = setLabelOverride(label, id, pick(rest));
    return master === d.master && label === d.label ? d : { master, label };
  }, doc);
}

/** Returns `doc` unchanged, or THROWS when its label's resolved layers break
 *  a binding — an enabled layer bound to a disabled or missing one, or a
 *  cycle. The label-side twin of parseMaster's check (the same
 *  validateBindings), run by App's `edit` on every edit — the label can
 *  reshape the graph (a patch, an override reset, a version switch) where
 *  parseMaster never looks. Without it placeLayers throws on preview and
 *  export (issue #93).
 *
 *  Patch functions such as patchLayers do not check bindings themselves: a
 *  patch may switch off a layer another is bound to, and only the whole
 *  edit's result is judged, so switching a layer off together with its
 *  dependents is allowed.
 *
 *  Given `prev` (the doc the edit started from), the check is skipped when
 *  nothing that shapes the binding graph changed — the master's layers and
 *  variants and the label's enabledVariants and overrides are all the same
 *  objects. Values-only edits (typing) then skip a full resolveLayers per
 *  keystroke; `prev` was already checked when it was written. */
export function checkLabelBindings(doc: Doc, prev?: Doc): Doc {
  if (prev
    && doc.master.layers === prev.master.layers && doc.master.variants === prev.master.variants
    && doc.label.enabledVariants === prev.label.enabledVariants && doc.label.overrides === prev.label.overrides)
    return doc;
  const { layers } = resolveLayers(doc.master, doc.label.enabledVariants, {}, doc.label.overrides, { keepDisabled: true });
  validateBindings(layers, "label", (msg) => { throw new Error(`Can't apply this edit: ${msg}`); });
  return doc;
}

/** The text a LayerValue draws: a plain string as itself, styled runs joined,
 *  since the vocabulary stores what appears on the label, not how it is set. */
const drawnText = (value: LayerValue): string =>
  typeof value === "string" ? value : value.map((r) => r.text).join("");

/** Teaches a layer's fill vocabulary a value it does not already offer
 *  (docs/plans/choice-input.md). Returns the master UNCHANGED — by identity,
 *  so callers make no history entry — when the value is blank, already
 *  offered, the layer does not exist, or it is a literal barcode code that
 *  fails its symbology's validator.
 *
 *  Matching is on `value`, what the label draws, never on a choice's `title`:
 *  typing the words that happen to be a title means a different value than the
 *  one that title stands for. */
export function learnChoice(master: Master, id: string, text: string): Master {
  const value = text.trim();
  const layer = master.layers.find((l) => l.id === id);
  if (!value || !layer || layer.choices?.some((c) => c.value === value)) return master;
  // Never learn a literal barcode that cannot encode (#94); templates are
  // judged after expansion, by resolveLayers.
  if (layer.kind === "barcode" && !fieldRefs(value).length
    && !validateFor(layer.symbology, value).ok) return master;
  return patchLayer(master, id, { choices: [...(layer.choices ?? []), { value }] });
}

/** A layer's CONTENT — this beer's name, this collab's logo, this label's
 *  barcode. Always a label value, for ANY layer: the `fillable` flag that
 *  used to gate this is gone, so every content-bearing layer is fillable.
 *
 *  The one thing it also writes is the MASTER's vocabulary, when the layer has
 *  one: a value nobody authored joins `choices`, so the next label opens with
 *  it offered. That is the fill contract's rule (MASTER_PATHS above) rather
 *  than an exception to routing — the vocabulary declares what a filler may
 *  put in a layer, which is master data — and the Save Master review is what
 *  stands between it and the file. */
export function setContentIn(doc: Doc, id: string, value: LayerValue): Doc {
  return {
    master: doc.master.layers.some((l) => l.id === id && l.choices)
      ? learnChoice(doc.master, id, drawnText(value)) : doc.master,
    label: setValue(doc.label, id, value),
  };
}

/** Drops a label override (whole entry or one dotted path); the `overrides`
 *  key itself goes once nothing is left, so a clean label has none. */
export function clearLabelOverride(label: LabelFile, id: string, path?: string): LabelFile {
  const overrides = clearEntry(label.overrides ?? {}, id, path);
  const { overrides: _o, ...rest } = label;
  return Object.keys(overrides).length === 0 ? rest : { ...rest, overrides };
}

// --- Dirty check ------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

/** Is `edited` different from `base` — the cheap half of the master's dirty
 *  flag, and all App needs on the edit path. masterChanges answers the same
 *  question itemised, but walks every layer and every variant diff to do it,
 *  which is too much to run per pointermove. Order of keys is ignored; order
 *  of layers (draw order) is not — including a variant's added layers, whose
 *  draw order IS their key order (#198). */
export function masterDiff(base: Master, edited: Master): boolean {
  if (base === edited) return false;
  if (!deepEqual(base, edited)) return true;
  // Equal up to key order, so the variants line up by index.
  const masterIds = new Set(base.layers.map((l) => l.id));
  const order = (v: Variant) => addedIds(v, masterIds).join("\0");
  return edited.variants.some((v, i) => order(v) !== order(base.variants[i]));
}

/** A variant's added layers in draw order: its keys that are not master
 *  layers (those are overrides, whose key order means nothing). */
function addedIds(v: Variant, masterIds: { has(id: string): boolean }): string[] {
  return Object.keys(v.layers).filter((id) => !masterIds.has(id));
}

/** Untitled restore: keep the template's layers and positions, drop fill
 *  values and raster art so a new tab is not the last beer. Template copy
 *  (volume, wordmark, warning) and bundled assets (`builtin:`) stay.
 *  Fillable text is anything with a placeholder or a number/code input. */
export function structureOnlyMaster(master: Master): Master {
  const byId = new Map(master.layers.map((l) => [l.id, l]));
  return {
    ...master,
    layers: master.layers.map((l) => structureOnlyEntry(l) as Layer),
    variants: master.variants.map((v) => withEntries(v, Object.fromEntries(
      Object.entries(v.layers).map(([id, patch]) =>
        [id, structureOnlyEntry(patch, byId.get(id))]),
    ))),
  };
}

function isFillableText(layer: unknown): boolean {
  return isPlain(layer) && !!(layer.placeholder || layer.input);
}

/** A variant override is not a complete Layer (parseMaster validates the
 *  merge). Fillable is the merged layer: base placeholder/input, else the
 *  patch for a variant-added id. Blank `lines` only when they are present. */
function structureOnlyEntry(p: Entry, base?: Layer): Entry {
  const rec = p as Entry & { lines?: unknown; asset?: unknown };
  const next = { ...rec };
  if ((isFillableText(rec) || isFillableText(base)) && Array.isArray(rec.lines)) {
    next.lines = rec.lines.map((line) =>
      line && typeof line === "object" ? { ...line as object, text: "" } : line);
  }
  if (typeof rec.asset === "string" && rec.asset && !rec.asset.startsWith("builtin:")) {
    next.asset = "";
  }
  return next;
}

/** One line in the Save Master review: a change the save is about to write.
 *  `promote` is the odd one — it is not in `edited` yet, it is a label
 *  override the reviewer may fold into the template (the ONLY promotion path;
 *  the inspector's override badge resets, it does not promote). */
export interface MasterChange {
  kind: "added" | "removed" | "moved" | "renamed" | "property" | "promote";
  layerId: string;
  layerName: string;
  /** Dotted leaf path, for `property` and `promote` only. */
  path?: string;
  from?: unknown;
  to?: unknown;
  /** Which of the label's two stores a `promote` row came from. Absent is
   *  `"override"` (design), the original and commonest source; `"value"` is
   *  content. Both write one layer path; only the CLEAR differs, so
   *  applyPromotions drops the right one instead of re-deriving the source. */
  source?: "value";
}

/** Every leaf path where `a` and `b` differ, `name` excluded (a rename is its
 *  own entry) — the same flattening the override badges use, so an array-valued
 *  key like `lines` counts as one change. */
function changedPaths(a: unknown, b: unknown): string[] {
  const paths = new Set<string>();
  leafPaths(a, "", paths);
  leafPaths(b, "", paths);
  return [...paths].filter((p) => p !== "name" && !deepEqual(getPath(a, p), getPath(b, p)));
}

/** The items NOT on a longest run whose `rank` (old position) increases in
 *  their current order: the fewest items whose moving explains the new
 *  order. Quadratic, which is nothing at a master's layer count. */
function movedOutOfOrder<T>(items: readonly T[], rank: (t: T) => number): T[] {
  const order = items.map(rank);
  const len = order.map(() => 1);
  const prev = order.map(() => -1);
  let end = -1;
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < i; j++) {
      if (order[j] < order[i] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
    if (end < 0 || len[i] > len[end]) end = i;
  }
  const kept = new Set<number>();
  for (let i = end; i >= 0; i = prev[i]) kept.add(i);
  return items.filter((_, i) => !kept.has(i));
}

/** What saving this master would write, itemised for review: the structural
 *  and fill-contract edits already in `edited`, then the label's overrides
 *  offered for promotion into the template. Pure and synchronous — the dialog
 *  renders it (docs/plans/label-first-editing.md, Task 6).
 *
 *  `target` is the WORKING VERSION a promotion would land in (Task 12).
 *  Undefined — the default — is the base master; a variant id means promote
 *  rows are compared against, and written into, that variant's diff. Merely
 *  ENABLING a variant does not make it the target: showing a version and
 *  changing it are different acts. */
export function masterChanges(
  base: Master, edited: Master, label: LabelFile, target?: string,
): MasterChange[] {
  const baseById = new Map(base.layers.map((l) => [l.id, l]));
  const editedById = new Map(edited.layers.map((l) => [l.id, l]));
  const out: MasterChange[] = [];

  for (const l of base.layers)
    if (!editedById.has(l.id)) out.push({ kind: "removed", layerId: l.id, layerName: l.name });
  for (const l of edited.layers)
    if (!baseById.has(l.id)) out.push({ kind: "added", layerId: l.id, layerName: l.name });

  // Draw order, comparing only the layers both have, so a neighbour's add or
  // remove displaces nothing. The layers that kept their relative order are
  // the longest run still in base order (#99); only the rest were moved —
  // moving one layer to the front is one row, not one per layer it passed.
  const baseIndex = new Map(base.layers.map((l, i) => [l.id, i]));
  const common = edited.layers.filter((l) => baseIndex.has(l.id));
  for (const l of movedOutOfOrder(common, (l) => baseIndex.get(l.id)!))
    out.push({ kind: "moved", layerId: l.id, layerName: l.name });

  for (const l of edited.layers) {
    const was = baseById.get(l.id);
    if (!was) continue;
    if (was.name !== l.name)
      out.push({ kind: "renamed", layerId: l.id, layerName: l.name, from: was.name, to: l.name });
    for (const path of changedPaths(was, l))
      out.push({ kind: "property", layerId: l.id, layerName: l.name, path,
                 from: getPath(was, path), to: getPath(l, path) });
  }

  // The variants live in the same .master file, so an edit inside one is just
  // as much a template change — and a patch on a variant-added layer lands
  // there without the caller choosing it (see whereLayerLives). A change this
  // list cannot see is one that saves unannounced, or cannot be saved at all:
  // masterDirty is this list's length.
  const baseVariants = new Map(base.variants.map((v) => [v.id, v]));
  for (const v of base.variants)
    if (!edited.variants.some((x) => x.id === v.id))
      out.push({ kind: "removed", layerId: v.id, layerName: v.name });
  for (const v of edited.variants) {
    const was = baseVariants.get(v.id);
    if (!was) { out.push({ kind: "added", layerId: v.id, layerName: v.name }); continue; }
    if (was.name !== v.name)
      out.push({ kind: "renamed", layerId: v.id, layerName: v.name, from: was.name, to: v.name });
    const nameOf = (id: string, e: unknown) =>
      (e as { name?: string }).name ?? editedById.get(id)?.name ?? id;
    for (const id of Object.keys(was.layers))
      if (!(id in v.layers))
        out.push({ kind: "removed", layerId: id, layerName: nameOf(id, was.layers[id]) });
    // A variant's added layers draw in key order (moveLayers), so compare that
    // order the way the base layers' is compared above (#198).
    const wasIndex = new Map(addedIds(was, baseById).map((id, i) => [id, i]));
    const kept = addedIds(v, editedById).filter((id) => wasIndex.has(id));
    for (const id of movedOutOfOrder(kept, (id) => wasIndex.get(id)!))
      out.push({ kind: "moved", layerId: id, layerName: nameOf(id, v.layers[id]) });
    for (const [id, entry] of Object.entries(v.layers)) {
      const before = was.layers[id];
      if (before === undefined && !editedById.has(id)) {
        out.push({ kind: "added", layerId: id, layerName: nameOf(id, entry) });
        continue;
      }
      for (const path of changedPaths(before ?? {}, entry))
        out.push({ kind: "property", layerId: id, layerName: nameOf(id, entry), path,
                   from: getPath(before, path), to: getPath(entry, path) });
    }
  }

  // A promote row's "from" is what the TARGET version currently resolves to:
  // the master layer under the working variant's own diff, if there is one.
  const variant = target === undefined ? undefined : variantOf(edited, target);
  /** The layer as the TARGET version resolves it: the master layer under the
   *  working variant's own diff, a layer the target ADDS, or — for neither —
   *  undefined, an entry for a layer this version does not have at all. */
  const resolvedLayer = (id: string): Layer | undefined => {
    const own = editedById.get(id);
    const diff = variant?.layers[id];
    return own ? (diff ? deepMerge(own, diff) as Layer : own) : diff as Layer | undefined;
  };
  for (const [id, entry] of Object.entries(label.overrides ?? {})) {
    const l = resolvedLayer(id);
    if (!l) continue;
    // The same path set the badges use, so "the badge resets it" and "the
    // review promotes it" can never disagree about what an override covers.
    for (const path of labelOverriddenPaths(label, id)) {
      const to = getPath(entry, path);
      const from = getPath(l, path);
      if (deepEqual(from, to)) continue;
      out.push({ kind: "promote", layerId: id, layerName: l.name, path, from, to });
    }
  }

  // Content is a promote row on the same footing: typing into a layer, or
  // emptying one, deviates from the template exactly as an override does, and
  // without this there is no way to change the master's own default text
  // (the "HOPS" placeholder) from inside the app. A text value may arrive as
  // a bare string; applyValue widens it to lines, so compare it widened.
  for (const [id, v] of Object.entries(label.values)) {
    const l = resolvedLayer(id);
    if (!l) continue;
    const from = valueOf(l);
    const to = widenValue(l, v);
    if (deepEqual(from, to)) continue;
    out.push({ kind: "promote", layerId: id, layerName: l.name, path: valuePath(l), from, to, source: "value" });
  }
  return out;
}

/** Folds the reviewer's ticked `promote` rows into the master and drops them
 *  from the label — the ONE promotion path (docs/plans/label-first-editing.md,
 *  Task 6/7). Everything left in `label.overrides` stays this label's alone.
 *
 *  `target` is the working version, as in masterChanges: undefined writes the
 *  base master, a variant id writes that variant's diff (Task 12).
 *
 *  ponytail: a `null` value (setLabelOverride's wire spelling of "unset this
 *  key") only unsets a TOP-LEVEL key, matching patchLayer's own clear rule —
 *  the inspector clears nothing deeper. */
export function applyPromotions(
  master: Master, label: LabelFile, promote: readonly MasterChange[], target?: string,
): { master: Master; label: LabelFile } {
  return promote.reduce((acc, c) => {
    if (c.kind !== "promote" || c.path === undefined) return acc;
    // An own-property `undefined` is patchLayer's "delete this key"; null is
    // setLabelOverride's wire spelling of the same thing, and only ever sits
    // at the top level (see there).
    //
    // Which of the two a clear becomes depends on the TARGET. The base master
    // owns the property outright, so deleting the key is the clear. A variant
    // only holds a diff, where a missing key means "inherit from the master" —
    // deleting there would hand back the very value the clear removed — so the
    // variant keeps the null tombstone and resolveLayers' applyDiff strips the
    // key after merging.
    const clears = c.to === null && !c.path.includes(".");
    const patch: Record<string, unknown> = {};
    setPath(patch, c.path, clears && target === undefined ? undefined : c.to);
    return {
      master: target === undefined
        ? patchLayer(acc.master, c.layerId, patch as LayerPatch)
        : patchLayerIn(acc.master, target, c.layerId, patch as LayerPatch),
      label: c.source === "value"
        ? clearValue(acc.label, c.layerId)
        : clearLabelOverride(acc.label, c.layerId, c.path),
    };
  }, { master, label });
}

/** Which handle a resize drag grabbed: -1 = left/top edge, 0 = the axis is
 *  not grabbed (a side handle), 1 = right/bottom edge. */
export interface ResizeHandle { hx: -1 | 0 | 1; hy: -1 | 0 | 1 }

/** The resize patch for a drag on any of the eight selection handles.
 *  `dx`/`dy` are the pointer's page-space deltas; the grabbed edge follows the pointer and the opposite edge stays
 *  put, whatever the layer's anchor (the anchor only decides how that
 *  translates into x/y — a center-anchored box dragged by its left edge
 *  shifts x by half). A bound axis keeps its binding and only sizes. Image
 *  and barcode stretch freely unless `uniform` (shift), which applies the
 *  grabbed axis's factor to both; QR, and an image without `h`, are always
 *  uniform. Text resizes only its wrap width — type size stays the
 *  inspector's — so for text only the width axis (page-vertical when rotated)
 *  does anything. Locked layers and degenerate boxes return {}. */
export function resizeBy(
  layer: Layer, box: { w: number; h: number }, handle: ResizeHandle, dx: number, dy: number, uniform: boolean,
): LayerPatch {
  if (layer.locked || box.w <= 0 || box.h <= 0) return {};
  const rot = layer.rotation === 90;
  // Page-space box deltas, clamped so a box never inverts.
  let dw = handle.hx === 0 ? 0 : Math.max(handle.hx * dx, 0.05 * box.w - box.w);
  let dh = handle.hy === 0 ? 0 : Math.max(handle.hy * dy, 0.05 * box.h - box.h);
  const lockAspect = uniform || layer.kind === "qr" || (layer.kind === "image" && layer.h == null);
  if (lockAspect) {
    // The grabbed axis drives; a corner drives by the larger relative pull.
    const byW = handle.hy === 0 || (handle.hx !== 0 && Math.abs(dw) / box.w >= Math.abs(dh) / box.h);
    if (byW) dh = box.h * (dw / box.w); else dw = box.w * (dh / box.h);
  }
  // Text: only the width axis exists (page-vertical when rotated).
  if (layer.kind === "text") { if (rot) dw = 0; else dh = 0; }
  if (!dw && !dh) return {};
  // Layer-space size deltas.
  const [lw, lh] = rot ? [dh, dw] : [dw, dh];
  const [bw, bh] = rot ? [box.h, box.w] : [box.w, box.h];
  const sx = (bw + lw) / bw, sy = (bh + lh) / bh;
  const size = ((): LayerPatch => {
    switch (layer.kind) {
      // Sizes on the same 0.01pt grid as positions; moduleW keeps its own,
      // finer precision (a module is under a point).
      case "text": return { width: pt(Math.max((layer.width ?? bw) + lw, 1)) };
      case "qr": return { size: pt(layer.size * sx) };
      case "barcode": return { h: pt(layer.h * sy), moduleW: layer.moduleW * sx };
      case "image": return { w: pt(layer.w * sx), ...(layer.h != null ? { h: pt(layer.h * sy) } : {}) };
    }
  })();
  // Keep the opposite edge still: the anchored point moves by its share of
  // the size change, minus the whole change when the left/top edge was grabbed.
  // Both axes read the guide before the raw anchor (hAnchorOf / vAnchorOf),
  // the same rule place.ts positions them by.
  const b = bindingOf(layer);
  const ax = dw * (anchorFraction(hAnchorOf(layer)) - (handle.hx === -1 ? 1 : 0));
  const ay = dh * (anchorFraction(vAnchorOf(layer)) - (handle.hy === -1 ? 1 : 0));
  const pos: LayerPatch = {};
  if (ax && !(b?.side === "left" || b?.side === "right")) pos.x = pt(layer.x + ax);
  if (ay && typeof layer.y === "number" && !(b?.side === "top" || b?.side === "bottom")) pos.y = pt(layer.y + ay);
  return { ...size, ...pos };
}
