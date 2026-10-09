// src/model/editRecords.ts — the record plumbing every editing family in
// edit.ts shares: the patch/entry shapes, the editor's Doc, and the
// copy-on-write helpers for a variant's diff. Nothing here edits a layer on
// its own; see edit.ts for the public surface.
import type { LabelFile, Layer, Master, Variant } from "./layers";
import type { DeepPartial } from "./merge";

export type LayerPatch = DeepPartial<Layer>;
/** A variant's diff entry: a whole layer (variant-added) or a partial
 *  override of a master layer. Same static shape either way. */
export type Entry = DeepPartial<Layer>;

/** The document the editor holds: a master and the label being filled on it.
 *  Mirrors App's own `Doc`; declared here so the routing is pure. */
export interface Doc { master: Master; label: LabelFile }

export function variantOf(master: Master, id: string): Variant {
  const v = master.variants.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown variant "${id}"`);
  return v;
}

export const withVariant = (master: Master, id: string, fn: (v: Variant) => Variant): Master =>
  ({ ...master, variants: master.variants.map((v) => (v.id === id ? fn(v) : v)) });

export const withEntries = (v: Variant, layers: Record<string, Entry>): Variant => ({ ...v, layers });

/** Drops `key` from a record without touching the original. */
export const without = <T,>(o: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
