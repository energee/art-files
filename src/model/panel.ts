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
  // genuinely per-label layer.
  const materializedIds = new Set<string>();
  for (const l of master.layers) if (l.kind) materializedIds.add(l.id);
  for (const v of master.variants) for (const l of v.layers ?? []) if (l.kind) materializedIds.add(l.id);
  const customRows: PanelRow[] = (cfg.customLayers ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    inactive: false,
    custom: true,
    materialized: materializedIds.has(l.id),
    locked: !!l.locked,
    enabled: true,
  }));
  return [...masterRows, ...customRows];
}
