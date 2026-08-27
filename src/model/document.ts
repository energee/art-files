// src/model/document.ts — pure derivations between the live LabelConfig and
// the master model. cfg stays the app's single live document; these functions
// are the boundary: values/diff OUT of cfg at save time, compose INTO cfg at
// open/toggle time (spec: Resolution; Migration — label-level overrides).
import type { LabelConfig } from "../types";
import type { FieldDecl, FieldValue, Master } from "./types";
import { deepMerge, type DeepPartial } from "./merge";
import { resolve } from "./resolve";

export function visibleFieldsOf(master: Master, enabledVariations: string[]): FieldDecl[] {
  const out = [...master.fields];
  for (const id of enabledVariations) {
    const v = master.variations.find((x) => x.id === id);
    if (v) out.push(...v.fields);
  }
  return out;
}

/** Dot-path read, the mirror of resolve.ts's setPath. */
export function getPath(obj: unknown, path: string): unknown {
  let at: unknown = obj;
  for (const k of path.split(".")) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[k];
  }
  return at;
}

export function valuesFromConfig(
  master: Master, enabledVariations: string[], cfg: LabelConfig,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const f of visibleFieldsOf(master, enabledVariations)) {
    if (f.format) continue; // derived content — the filler edits the refs
    const v = getPath(cfg, f.path);
    if (f.kind === "toggle") { if (typeof v === "boolean") values[f.id] = v; }
    else if (typeof v === "string" || typeof v === "number") values[f.id] = v;
  }
  return values;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Everything in `cfg` that differs from `base`, deep for plain objects,
 *  wholesale for arrays and leaves. {} = no deviations. */
export function configDiff(base: LabelConfig, cfg: LabelConfig): DeepPartial<LabelConfig> {
  const walk = (b: unknown, c: unknown): unknown => {
    if (isPlain(b) && isPlain(c)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(c)) {
        if (!(k in b)) { out[k] = c[k]; continue; }
        const d = walk(b[k], c[k]);
        if (d !== undefined) out[k] = d;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return JSON.stringify(b) === JSON.stringify(c) ? undefined : c;
  };
  return (walk(base, cfg) ?? {}) as DeepPartial<LabelConfig>;
}

export function composeConfig(
  master: Master, enabledVariations: string[],
  values: Record<string, FieldValue>, overrides: DeepPartial<LabelConfig> | undefined,
): { config: LabelConfig; errors: Record<string, string>; warnings: string[] } {
  const r = resolve(master, enabledVariations, values);
  return {
    config: overrides ? deepMerge(r.config, overrides) : r.config,
    errors: r.errors, warnings: r.warnings,
  };
}

/** Re-compose the live config around a variation toggle, preserving the
 *  user's deviations. The diff runs against the OLD enable set's base, so a
 *  variation's own overrides are attributed to the variation, never to the
 *  user — that attribution is what makes disable actually undo them. */
export function toggleVariation(
  master: Master, cfg: LabelConfig, enabled: string[], id: string, on: boolean,
): { enabled: string[]; config: LabelConfig } {
  const values = valuesFromConfig(master, enabled, cfg);
  const base = composeConfig(master, enabled, values, undefined).config;
  const overrides = configDiff(base, cfg);
  const next = on
    ? (enabled.includes(id) ? enabled : [...enabled, id])
    : enabled.filter((x) => x !== id);
  return { enabled: next, config: composeConfig(master, next, values, overrides).config };
}
