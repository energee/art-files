// src/model/labelfile.ts — the v2 .label payload: master ref + variant
// toggles + field values BY ID ONLY, never layout (spec: ".label file" —
// that is what makes rebinding meaningful). Legacy v1 files (version: 1,
// embedded LabelConfig) are tagged for the migrator, not parsed here.
import type { FieldValue, LabelFileV2 } from "./types";

/** Defensively parse the `dormant` bench (Task 4b): a hand-edited or
 *  half-written file with a mangled `dormant` block should open with an
 *  empty bench rather than fail the whole file — matching parseMaster's
 *  "fall back rather than crash" posture for its own optional fields. */
function parseDormant(v: unknown): LabelFileV2["dormant"] {
  if (!v || typeof v !== "object") return undefined;
  const d = v as Record<string, unknown>;
  const values = (d.values && typeof d.values === "object"
    ? d.values : {}) as Record<string, FieldValue>;
  const variants = Array.isArray(d.variants) ? (d.variants as string[]) : [];
  return { values, variants };
}

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
    dormant: parseDormant(o.dormant),
  };
}

export function serializeLabelFile(l: LabelFileV2): string {
  return JSON.stringify(
    { formatVersion: 2, masterId: l.masterId, masterHint: l.masterHint,
      enabledVariants: l.enabledVariants, values: l.values, overrides: l.overrides,
      dormant: l.dormant },
    null, 2,
  );
}
