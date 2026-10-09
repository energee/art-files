// src/model/editSave.ts — edit.ts's save family: the master's dirty check
// (masterDiff), the Untitled restore (structureOnlyMaster), the Save Master
// review's itemised changes (masterChanges) and folding its ticked promote
// rows back in (applyPromotions).
import type { LabelFile, Layer, Master, Variant } from "./layers";
import { isPlain, deepMerge } from "./merge";
import { valueOf, valuePath, widenValue } from "./resolveLayers";
import { variantOf, withEntries, type Entry, type LayerPatch } from "./editRecords";
import { labelOverriddenPaths, leafPaths, ownsBytes, patchLayer, patchLayerIn } from "./editLayers";
import { clearLabelOverride, clearValue } from "./editLabel";

/** Dot-path read; undefined when the path doesn't resolve. */
function getPath(obj: unknown, path: string): unknown {
  let at: unknown = obj;
  for (const k of path.split(".")) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[k];
  }
  return at;
}

/** Dot-path write, creating intermediate objects on the way down. */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let at = obj;
  for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  at[keys[keys.length - 1]] = value;
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
 *  values and per-beer art so a new tab is not the last beer. Per-beer art
 *  is a background/mask (`role`) or a variant's image (the Collab slots).
 *  Template copy (volume, wordmark, warning) and the master's own images
 *  (a script logo, `builtin:` assets) stay. Fillable text is anything with
 *  a placeholder or a number/code input. */
export function structureOnlyMaster(master: Master): Master {
  const byId = new Map(master.layers.map((l) => [l.id, l]));
  return {
    ...master,
    layers: master.layers.map((l) => structureOnlyEntry(l, undefined, l.kind === "image" && !l.role) as Layer),
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
function structureOnlyEntry(p: Entry, base?: Layer, keepArt = false): Entry {
  const rec = p as Entry & { lines?: unknown; asset?: unknown };
  const next = { ...rec };
  if ((isFillableText(rec) || isFillableText(base)) && Array.isArray(rec.lines)) {
    next.lines = rec.lines.map((line) =>
      line && typeof line === "object" ? { ...line as object, text: "" } : line);
  }
  if (!keepArt && ownsBytes(rec.asset)) {
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
  for (const key of ["guides", "physical", "fontFamily"] as const)
    for (const path of changedPaths({ [key]: base[key] }, { [key]: edited[key] }))
      out.push({ kind: "property", layerId: "master", layerName: "Master settings", path,
        from: getPath(base, path), to: getPath(edited, path) });
  if (base.name !== edited.name)
    out.push({ kind: "renamed", layerId: "master", layerName: edited.name, from: base.name, to: edited.name });

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
      if (!(id in v.layers)) {
        if (!baseById.has(id))
          out.push({ kind: "removed", layerId: id, layerName: nameOf(id, was.layers[id]) });
        else for (const path of changedPaths(was.layers[id], {}))
          out.push({ kind: "property", layerId: id, layerName: nameOf(id, was.layers[id]), path,
            from: getPath(was.layers[id], path), to: getPath(editedById.get(id), path) });
      }
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
