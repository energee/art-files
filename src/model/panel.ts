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
  locked: boolean;
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
    locked: !!l.locked,
  }));
  const customRows: PanelRow[] = (cfg.customLayers ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    inactive: false,
    custom: true,
    locked: !!l.locked,
  }));
  return [...masterRows, ...customRows];
}
