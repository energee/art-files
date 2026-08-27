// src/model/rebind.ts — re-aim a .label at a different master (the
// cross-brewery collab flow). Values match by field ID — that is why field
// IDs are stable and human-readable; anything unmatched is REPORTED, never
// silently lost (spec: Resolution / rebinding).
import type { LabelFileV2, Master } from "./types";

export function rebind(
  label: LabelFileV2, target: Master,
): { label: LabelFileV2; dropped: string[]; disabledVariations: string[] } {
  const fieldIds = new Set(
    [...target.fields, ...target.variations.flatMap((v) => v.fields)].map((f) => f.id),
  );
  const values: LabelFileV2["values"] = {};
  const dropped: string[] = [];
  for (const [id, v] of Object.entries(label.values))
    (fieldIds.has(id) ? (values[id] = v) : dropped.push(id));
  const varIds = new Set(target.variations.map((v) => v.id));
  const enabledVariations = label.enabledVariations.filter((id) => varIds.has(id));
  const disabledVariations = label.enabledVariations.filter((id) => !varIds.has(id));
  return {
    label: { ...label, masterId: target.id, masterHint: undefined, enabledVariations, values },
    dropped, disabledVariations,
  };
}
