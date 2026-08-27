// src/model/labelfile.ts — the v2 .label payload: master ref + variant
// toggles + field values BY ID ONLY, never layout (spec: ".label file" —
// that is what makes rebinding meaningful). Legacy v1 files (version: 1,
// embedded LabelConfig) are tagged for the migrator, not parsed here.
import type { LabelFileV2 } from "./types";

export function parseLabelFile(json: unknown): LabelFileV2 | { legacy: unknown } {
  if (!json || typeof json !== "object") throw new Error("Not a label file.");
  const o = json as Record<string, unknown>;
  if (o.formatVersion !== 2) return { legacy: json };   // v1 has {version: 1}
  if (typeof o.masterId !== "string" || !o.masterId)
    throw new Error("Label file is missing its masterId.");
  return {
    formatVersion: 2,
    masterId: o.masterId,
    masterHint: typeof o.masterHint === "string" ? o.masterHint : undefined,
    enabledVariants: Array.isArray(o.enabledVariants) ? (o.enabledVariants as string[]) : [],
    values: (o.values && typeof o.values === "object" ? o.values : {}) as LabelFileV2["values"],
    overrides: o.overrides && typeof o.overrides === "object" ? o.overrides as LabelFileV2["overrides"] : undefined,
  };
}

export function serializeLabelFile(l: LabelFileV2): string {
  return JSON.stringify(
    { formatVersion: 2, masterId: l.masterId, masterHint: l.masterHint,
      enabledVariants: l.enabledVariants, values: l.values, overrides: l.overrides },
    null, 2,
  );
}
