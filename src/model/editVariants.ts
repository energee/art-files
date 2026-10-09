// src/model/editVariants.ts — edit.ts's variant family: switching a
// label's enabled versions, and adding, removing and renaming a master's
// variants.
import type { LabelFile, Master } from "./layers";
import type { Box } from "./place";
import { bindingOf } from "./layers";
import { variantOf, withEntries, withVariant, type Doc } from "./editRecords";
import { mintLayerId, removeLayerIn, whereLayerLives } from "./editLayers";

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
export const enableBeneathVersion = (label: LabelFile, id: string): LabelFile => {
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

export function addVariant(master: Master, name?: string): { master: Master; id: string } {
  if (name === undefined) {
    const names = new Set(master.variants.map((v) => v.name));
    let n = 1;
    while (names.has(`Variant ${n}`)) n++;
    name = `Variant ${n}`;
  }
  // A random suffix, like mintLayerId: the master forgets a deleted variant,
  // but labels on disk may still list its id in enabledVariants, and a reused
  // id would silently switch the new variant on for them.
  const id = mintLayerId(slugify(name) || "variant", new Set(master.variants.map((v) => v.id)));
  return { id, master: { ...master, variants: [...master.variants, { id, name, layers: {} }] } };
}

export function removeVariant(master: Master, id: string): Master {
  variantOf(master, id);
  return { ...master, variants: master.variants.filter((v) => v.id !== id) };
}

/** removeVariant for the editor's document (issue #236): each layer the
 *  version adds is removed first with removeLayerIn, so a layer bound to one
 *  of them — in the master or in the label's overrides — lets go and stays
 *  where it was (`boxes`) instead of dangling. Nothing that goes away with the
 *  version may be detached — that demands a box a switched-off version's
 *  layers don't have — so the version's patches to master layers and the
 *  added layers' label overrides are dropped up front, and the added layers
 *  go deepest dependent first (bindings are acyclic: parseMaster). The label
 *  stops showing the deleted version and keeps showing every other one. */
export function removeVariantIn(doc: Doc, id: string, boxes?: ReadonlyMap<string, Box>): Doc {
  const { layers } = variantOf(doc.master, id);
  const added = new Set(Object.keys(layers).filter((k) => whereLayerLives(doc.master, k) !== "master"));
  /** The entries of `o` whose key is (or, with false, is not) an added layer. */
  const keep = <T,>(o: Record<string, T>, isAdded: boolean) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => added.has(k) === isAdded));
  const depth = (k: string): number => {
    const to = bindingOf(layers[k])?.to;
    return to !== undefined && added.has(to) ? 1 + depth(to) : 0;
  };
  const depths = new Map([...added].map((k) => [k, depth(k)]));
  const order = [...added].sort((a, b) => depths.get(b)! - depths.get(a)!);
  const start: Doc = {
    master: withVariant(doc.master, id, (v) => withEntries(v, keep(v.layers, true))),
    label: { ...doc.label, overrides: doc.label.overrides && keep(doc.label.overrides, false) },
  };
  const d = order.reduce((acc, k) => removeLayerIn(acc, k, boxes), start);
  return { master: removeVariant(d.master, id), label: showVersion(d.label, id, null) };
}

export function renameVariant(master: Master, id: string, name: string): Master {
  variantOf(master, id);
  return withVariant(master, id, (v) => ({ ...v, name }));
}
