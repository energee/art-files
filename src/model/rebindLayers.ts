// src/model/rebindLayers.ts — re-aim a v3 .label at a different master (the
// cross-brewery collab flow), the successor to rebind.ts on the layer model.
// Values match by LAYER id against the layers the target HAS — in its own
// layers or in any variant's diff. NON-DESTRUCTIVE: anything the target does
// not have is REPORTED and benched on the label's `dormant`
// store, and anything already benched gets another shot at the new target,
// so A→B→A loses nothing (spec: `.label` file — dormant).
import type { LabelFile, Layer, LayerValue, Master } from "./layers";
import type { DeepPartial } from "./merge";

/** ids in order with repeats dropped — dormant ids first, live ids after. */
function dedupe(ids: string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) === i);
}

/** Layer kind by id for every layer the master can resolve — its own, plus
 *  the ones a variant adds. Every such layer is fillable now that the
 *  `fillable` flag is gone (docs/plans/label-first-editing.md), so having the
 *  id is the whole test; the kind decides whether a value FITS. */
function layerKinds(master: Master): Map<string, Layer["kind"] | undefined> {
  const kinds = new Map<string, Layer["kind"] | undefined>();
  for (const l of master.layers) kinds.set(l.id, l.kind);
  for (const v of master.variants) {
    for (const [id, e] of Object.entries(v.layers) as [string, DeepPartial<Layer>][]) {
      if (!kinds.has(id)) kinds.set(id, e.kind ?? master.layers.find((l) => l.id === id)?.kind);
    }
  }
  return kinds;
}

/** A text layer fills from lines, every other kind from a string. */
const fits = (kind: Layer["kind"] | undefined, value: LayerValue): boolean =>
  kind === "text" ? Array.isArray(value) : typeof value === "string";

/** `from` is the master the label is leaving; the v3 match is by layer id
 *  alone so it is not consulted, but it stays in the signature so the App
 *  call site (which has both) is stable. */
export function rebindLabel(
  label: LabelFile, _from: Master | undefined, to: Master,
): { label: LabelFile; dropped: { values: string[]; variants: string[] } } {
  // Live values win over benched ones with the same id (they are what the
  // operator has been looking at); variant order keeps dormant first.
  const candidateValues: Record<string, LayerValue> = { ...label.dormant?.values, ...label.values };
  const candidateVariants = dedupe([...(label.dormant?.variants ?? []), ...label.enabledVariants]);

  const kinds = layerKinds(to);
  const values: Record<string, LayerValue> = {};
  const dormantValues: Record<string, LayerValue> = {};
  for (const [id, v] of Object.entries(candidateValues)) {
    if (kinds.has(id) && fits(kinds.get(id), v)) values[id] = v;
    else dormantValues[id] = v;
  }

  const variantIds = new Set(to.variants.map((v) => v.id));
  const enabledVariants = candidateVariants.filter((id) => variantIds.has(id));
  const dormantVariants = candidateVariants.filter((id) => !variantIds.has(id));

  const dropped = { values: Object.keys(dormantValues), variants: dormantVariants };
  // A clean rebind carries no bench at all, so it serializes like a label
  // that never left its master.
  const { dormant: _d, masterHint: _h, ...rest } = label;
  const bench = dropped.values.length > 0 || dormantVariants.length > 0
    ? { dormant: { values: dormantValues, variants: dormantVariants } }
    : {};
  return {
    label: { ...rest, masterId: to.id, enabledVariants, values, ...bench },
    dropped,
  };
}
