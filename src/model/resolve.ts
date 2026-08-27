// src/model/resolve.ts — the heart of the design: collapse master + enabled
// variations + field values into the LabelConfig the renderers and both
// deliverable builders already consume (spec: Resolution). Pure, synchronous,
// deterministic; anchors/guides (spec step 6) land with the layer work.
import type { LabelConfig } from "../types";
import type { FieldDecl, FieldValue, Master } from "./types";
import { deepMerge, type DeepPartial } from "./merge";
import { validateField } from "./fields";
import { expandFormat } from "./format";
import { defaultConfig } from "../defaults";

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let at = obj;
  for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  at[keys[keys.length - 1]] = value;
}

export function resolve(
  master: Master, enabledVariations: string[], values: Record<string, FieldValue>,
): { config: LabelConfig; visibleFields: FieldDecl[]; errors: Record<string, string>; warnings: string[] } {
  const warnings: string[] = [];
  let config = deepMerge(defaultConfig(), master.defaults as DeepPartial<LabelConfig>);
  const visibleFields = [...master.fields];
  for (const id of enabledVariations) {
    const v = master.variations.find((x) => x.id === id);
    if (!v) { warnings.push(`Unknown variation "${id}" — skipped.`); continue; }
    config = deepMerge(config, v.overrides as DeepPartial<LabelConfig>);
    visibleFields.push(...v.fields);
  }
  const errors: Record<string, string> = {};
  const strings: Record<string, string> = {};
  for (const f of visibleFields) {
    const raw = values[f.id];
    if (raw === undefined) continue;
    const r = validateField(f, raw);
    if (!r.ok) { errors[f.id] = r.error!; continue; }
    strings[f.id] = String(raw);
  }
  const out = config as unknown as Record<string, unknown>;
  for (const f of visibleFields) {
    if (f.format) {
      const { text, missing } = expandFormat(f.format, strings);
      if (missing.length === 0) setPath(out, f.path, text);
    } else if (strings[f.id] !== undefined) {
      const v = values[f.id];
      setPath(out, f.path, f.kind === "toggle" ? v === true : strings[f.id]);
    }
  }
  return { config, visibleFields, errors, warnings };
}
