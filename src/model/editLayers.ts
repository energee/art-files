// src/model/editLayers.ts — edit.ts's layer families: ids and default
// layers, the layer lifecycle (add, remove, reorder), the Design write path
// (setLayer/patchLayer and their variant twins), override clearing and the
// inspector's reset badges, and the asset ids a master or document still
// references. The routing rule (where an edit lands follows the layer) is
// spelled out once, in withLayer.
import type {
  BarcodeLayer, ImageLayer, LabelFile, Layer, LayerKind, Master, QrLayer, TextLayer,
} from "./layers";
import type { Box } from "./place";
import { parseMaster } from "./layers";
import { isPlain, deepMerge, type DeepPartial } from "./merge";
import { resolveLayers } from "./resolveLayers";
import { CENTER_X, GOLD } from "../layout";
import { KEYLINE } from "../defaults";
import { DEFAULT_STROKE_LAYER } from "../strokes";
import {
  variantOf, withEntries, withVariant, without, type Doc, type Entry, type LayerPatch,
} from "./editRecords";
import { isBound, pt, unbindPatch } from "./editGestures";

// --- Ids and defaults -------------------------------------------------------

export function mintLayerId(kind: string, taken: Set<string>): string {
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

/** A label-only legacy layer (#264): a whole-layer override (it carries
 *  `kind`) whose id neither the master nor any variant defines. The override
 *  is the layer's ONLY definition, so there is no master value under it. */
export function isLabelOnly(master: Master, label: LabelFile, id: string): boolean {
  return !!label.overrides?.[id]?.kind && !master.layers.some((l) => l.id === id)
    && !master.variants.some((v) => id in v.layers);
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
  const overrides = doc.label.overrides;
  const own = overrides?.[id];
  const labelOnly = isLabelOnly(doc.master, doc.label, id);
  const source = labelOnly ? { ...doc.master, layers: [...doc.master.layers, own as Layer] } : doc.master;
  const master = labelOnly ? doc.master : removeLayer(doc.master, id, boxes);
  if (!overrides) return { ...doc, master };
  const patchOf = detacher(source, id, boxes);
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
  // ponytail: a label-only legacy layer (#264) has no draw-order slot of its
  // own (resolveLayers appends it), so it doesn't reorder; add a label-side
  // order if anyone needs to move one.
  if (!master.layers.some((l) => l.id === id) && !master.variants.some((v) => id in v.layers)) return master;
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
export function clearEntry(entries: Record<string, Entry>, id: string, path?: string): Record<string, Entry> {
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
export function leafPaths(obj: unknown, prefix: string, out: Set<string>): void {
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
 *  still resettable, exactly like a base layer's. A label-only legacy layer
 *  has no badges at all: its override is its only definition, so a "reset"
 *  would delete a required field (x, y, anchor…) rather than restore one. */
export interface OverrideBadges {
  variant: Set<string>;
  label: Set<string>;
  variantName?: string;
}

export function overrideBadges(master: Master, label: LabelFile, id: string): OverrideBadges {
  const variant = new Set<string>();
  let variantName: string | undefined;
  if (master.layers.some((l) => l.id === id)) {
    for (const v of master.variants) {
      if (!label.enabledVariants.includes(v.id)) continue;
      for (const p of overriddenPaths(master, v.id, id)) { variant.add(p); variantName = v.name; }
    }
  }
  const own = isLabelOnly(master, label, id) ? new Set<string>() : labelOverriddenPaths(label, id);
  return { variant, label: own, variantName };
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

/** Does an image `asset` value carry bytes of its own? Empty is unset and
 *  `builtin:` art ships with the app, so neither has anything to bundle. */
export const ownsBytes = (asset: unknown): asset is string =>
  typeof asset === "string" && !!asset && !asset.startsWith("builtin:");

/** Every custom image id the master names — a layer's `asset`, or any
 *  variant's entry — whose bytes a .master must carry. No `kind` check: a
 *  variant that patches an existing layer stores only the changed fields, so
 *  `{ asset }` arrives without one. */
export function masterAssetIds(master: Master): Set<string> {
  const ids = new Set<string>();
  const add = (e: DeepPartial<Layer> | undefined) => {
    const a = (e as { asset?: string } | undefined)?.asset;
    if (ownsBytes(a)) ids.add(a);
  };
  master.layers.forEach(add);
  for (const v of master.variants) Object.values(v.layers).forEach(add);
  return ids;
}

/** Every image asset id still reachable from the document: the master's
 *  (masterAssetIds), the label's overrides, and its values. App's liveImages
 *  filter: the in-memory store also keeps replaced/cleared art for undo, so
 *  not every stored id is referenced. One set per call, so filtering N stored
 *  ids walks the document once, not N times. */
export function referencedAssetIds(master: Master, label: LabelFile): Set<string> {
  const ids = masterAssetIds(master);
  for (const e of Object.values(label.overrides ?? {})) {
    const a = (e as { asset?: string } | undefined)?.asset;
    if (a) ids.add(a);
  }
  for (const v of Object.values(label.values)) if (typeof v === "string") ids.add(v);
  return ids;
}
