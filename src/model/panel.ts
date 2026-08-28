// src/model/panel.ts — pure: what the layers panel lists, in one place, so
// the panel's rows and the shift-range selection order cannot disagree.
import type { LabelConfig } from "../types";
import type { Master, MasterLayer } from "./types";

export interface PanelRow {
  id: string;
  name: string;
  /** Owning variant's id, when a variant owns this layer. */
  variant?: string;
  /** Owning variant's display name, for the row badge. */
  variantName?: string;
  /** The layer does not draw right now (master-disabled, or its variant is
   *  off) — the panel dims the row. */
  inactive: boolean;
  /** A per-label custom layer rather than a master layer: the only rows that
   *  can be reordered or removed. */
  custom: boolean;
  /** Only meaningful when `custom` is true: whether this row's identity
   *  lives on the master (or a variant) as a `kind`-bearing MasterLayer —
   *  Design mode's "Add layer" (Task 5b) — rather than purely on the
   *  label's own `cfg.customLayers` (a legacy per-label layer, or one
   *  restored from a pre-Task-5b .label file). Lock routes through
   *  `onMaterializedLayerEdit` when true, `update` (a per-label write) when
   *  false — see LayersPanel.tsx's LayerRow. Always false for a master
   *  row. */
  materialized: boolean;
  /** Which list this row's reorder chevrons may move it within — "master"
   *  for a layer on `master.layers`, the variant's id for one on that
   *  variant's own `layers`. Undefined when the row cannot be reordered at
   *  all: a master row (fixed draw order) or a LEGACY custom row (nothing on
   *  the master to move — `moveLayer` only ever swaps two `kind`-bearing
   *  entries of ONE list). The panel derives atBack/atFront from the rows
   *  sharing this value, so an arrow is enabled exactly when `moveLayer` can
   *  act on it (fix round 2, finding 14 — the arrows used to be derived from
   *  the whole flat custom list and rendered enabled for moves that were
   *  silent no-ops). */
  reorderGroup?: string;
  locked: boolean;
  /** The layer's own master-level enable (MasterLayer.enabled, as resolved
   *  for the current variants) — what the panel's enable control writes back
   *  through applyLayerEdit. Distinct from `inactive`, which is ALSO true
   *  when the layer is enabled but its owning variant is off: a row can be
   *  enabled and still not draw. Always true for a custom row, which has no
   *  master-level disable. */
  enabled: boolean;
}

/** The resolved master layers, in draw order, then `cfg.customLayers` in
 *  stored order — one flat list, so the panel's rows and the shift-range
 *  selection order (App reads `panelRows(...).map(r => r.id)`) can't drift
 *  apart. Custom rows are never inactive: a label-level layer either exists
 *  or it doesn't, there is no variant to gate it off. */
export function panelRows(
  master: Master, layers: MasterLayer[], disabledLayers: ReadonlySet<string>,
  cfg: LabelConfig,
): PanelRow[] {
  const masterRows: PanelRow[] = layers.map((l) => ({
    id: l.id,
    name: l.name,
    variant: l.variant,
    variantName: l.variant
      ? master.variants.find((v) => v.id === l.variant)?.name : undefined,
    inactive: disabledLayers.has(l.id),
    custom: false,
    materialized: false,
    locked: !!l.locked,
    enabled: l.enabled,
  }));
  // Every `kind`-bearing layer's id, wherever addLayer put it (the master's
  // own `layers`, or any variant's) — resolve() already filtered these OUT
  // of `layers` above (no phantom master row), but a custom row still needs
  // to know its id is one of them, to route policy (fix round 1: Lock)
  // through the master rather than through `cfg.customLayers` like a
  // genuinely per-label layer. Mirrors model/document.ts's
  // materializedLayerIds, computed inline here because the rows need the
  // OWNER, not just membership.
  // …and, for the ones that are, WHICH list owns them, since that is the only
  // list `moveLayer` will reorder within (see PanelRow.reorderGroup).
  const owner = new Map<string, string>();
  for (const l of master.layers) if (l.kind) owner.set(l.id, "master");
  for (const v of master.variants) for (const l of v.layers ?? []) if (l.kind) owner.set(l.id, v.id);
  const customRows: PanelRow[] = (cfg.customLayers ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    inactive: false,
    custom: true,
    materialized: owner.has(l.id),
    reorderGroup: owner.get(l.id),
    locked: !!l.locked,
    enabled: true,
  }));
  return [...masterRows, ...customRows];
}
