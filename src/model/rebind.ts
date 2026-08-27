// src/model/rebind.ts — re-aim a .label at a different master (the
// cross-brewery collab flow). Values match by field ID — that is why field
// IDs are stable and human-readable. NON-DESTRUCTIVE (Task 4b): anything the
// target master doesn't declare is REPORTED and benched onto the returned
// label's `dormant` store instead of being discarded, so re-aiming at
// another master and back loses nothing (spec: Resolution / rebinding).
import type { FieldValue, LabelFileV2, Master } from "./types";

/** ids in `later`'s order, with anything already in `earlier` dropped —
 *  used to keep dormant ids first and live ids after, without a duplicate id
 *  ever appearing twice in the merged pool (spec: "preserving enable order
 *  with dormant ones first"). */
function dedupeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function rebind(
  label: LabelFileV2, target: Master,
): { label: LabelFileV2; dropped: string[]; disabledVariants: string[] } {
  // Fold any existing dormant store back into the candidate pool BEFORE
  // matching: a value/variant benched by an earlier rebind gets another shot
  // at the new target. Live values win on collision (the label's own
  // `values`/`enabledVariants` are what the operator has been looking at);
  // variant enable order keeps the dormant ones first, then the live ones,
  // each de-duplicated against what came before.
  const candidateValues: LabelFileV2["values"] = { ...label.dormant?.values, ...label.values };
  const candidateVariants = dedupeIds([...(label.dormant?.variants ?? []), ...label.enabledVariants]);

  const fieldIds = new Set(
    [...target.fields, ...target.variants.flatMap((v) => v.fields)].map((f) => f.id),
  );
  const values: LabelFileV2["values"] = {};
  const dormantValues: Record<string, FieldValue> = {};
  const dropped: string[] = [];
  for (const [id, v] of Object.entries(candidateValues)) {
    if (fieldIds.has(id)) values[id] = v;
    else { dormantValues[id] = v; dropped.push(id); }
  }

  const varIds = new Set(target.variants.map((v) => v.id));
  const enabledVariants = candidateVariants.filter((id) => varIds.has(id));
  const disabledVariants = candidateVariants.filter((id) => !varIds.has(id));

  // Omit `dormant` entirely once it would be empty — a clean rebind (target
  // declares everything the label had) should serialize exactly like a v2
  // label that never fell off a master, not carry an empty bench forward.
  const dormant = Object.keys(dormantValues).length || disabledVariants.length
    ? { values: dormantValues, variants: disabledVariants }
    : undefined;

  return {
    label: { ...label, masterId: target.id, masterHint: undefined, enabledVariants, values, dormant },
    dropped, disabledVariants,
  };
}
