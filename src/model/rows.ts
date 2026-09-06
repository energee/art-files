// src/model/rows.ts — what the ONE Layers list shows (spec 2026-09-04: UI).
// The rows are the RESOLVED layers (every enabled variant's diff and the
// label's values merged in, disabled layers kept so they can be switched
// back on), in draw order, plus the layers a switched-OFF variant would add
// — shown raw from that variant's diff, badged and dimmed — so a filler can
// see what turning the variant on brings. Pure; App memoizes it per
// master/label change and hands it to LayerList and the inspector.
import type { LabelFile, Layer, Master } from "./layers";
import { resolveLayers } from "./resolveLayers";

/** A variant as the list's chips and badges see it. */
export interface VariantChip { id: string; name: string; enabled: boolean }

export interface LayerRow {
  /** The resolved layer (or the raw diff entry of an off variant's added layer). */
  layer: Layer;
  /** Set when a variant ADDS this layer (an id the master lacks). */
  variant?: VariantChip;
  /** An enabled VARIANT changes part of this master layer — the variant that
   *  does, so the row can name it. A variant is a whole alternative version of
   *  the template, not a bag of extra layers: it may move, recolour or retype
   *  anything the master set (the Collab variant moves the logo). Kept apart
   *  from `changed` because the two have different blast radii — resetting
   *  this one edits the MASTER FILE. */
  variantOverridden?: VariantChip;
  /** THIS label changed the layer — a fill value or a label override. What
   *  the list's "Changed" filter shows, and the successor to the Fillable
   *  filter now that every layer is fillable. */
  changed?: boolean;
}

export function variantChips(master: Master, label: LabelFile): VariantChip[] {
  return master.variants.map((v) => ({
    id: v.id, name: v.name, enabled: label.enabledVariants.includes(v.id),
  }));
}

/** The list's rows in draw order (back to front). Also the resolver's
 *  warnings/errors, so App resolves once per change. */
export function layerRows(master: Master, label: LabelFile): {
  rows: LayerRow[]; warnings: string[]; errors: Record<string, string>;
} {
  const resolved = resolveLayers(
    master, label.enabledVariants, label.values, label.overrides, { keepDisabled: true });
  const masterIds = new Set(master.layers.map((l) => l.id));
  const chips = new Map(variantChips(master, label).map((c) => [c.id, c]));
  const adder = (id: string) => master.variants.find((v) => id in v.layers && !masterIds.has(id));
  const rows: LayerRow[] = resolved.layers.map((layer) => {
    const v = [...label.enabledVariants].reverse()
      .map((id) => master.variants.find((v) => v.id === id))
      .find((v) => v && layer.id in v.layers) ?? adder(layer.id);
    // Last enabled variant that touches this master layer — the one whose
    // value actually wins, so it is the one worth naming.
    const over = masterIds.has(layer.id)
      ? [...label.enabledVariants].reverse()
        .map((id) => master.variants.find((x) => x.id === id))
        .find((x) => x && layer.id in x.layers)
      : undefined;
    const variantOverridden = over ? chips.get(over.id) : undefined;
    const changed = label.values[layer.id] !== undefined || !!label.overrides?.[layer.id];
    return {
      layer, ...(v ? { variant: chips.get(v.id) } : {}),
      ...(variantOverridden ? { variantOverridden } : {}), ...(changed ? { changed } : {}),
    };
  });
  // Layers only an OFF variant would add, raw from its diff.
  const shown = new Set(rows.map((r) => r.layer.id));
  for (const v of master.variants) {
    if (label.enabledVariants.includes(v.id)) continue;
    for (const [id, entry] of Object.entries(v.layers)) {
      if (masterIds.has(id) || shown.has(id)) continue;
      rows.push({ layer: entry as Layer, variant: chips.get(v.id) });
      shown.add(id);
    }
  }
  return { rows, warnings: resolved.warnings, errors: resolved.errors };
}
