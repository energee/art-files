// src/model/document.ts — pure derivations between the live LabelConfig and
// the master model. cfg stays the app's single live document; these functions
// are the boundary: values/diff OUT of cfg at save time, compose INTO cfg at
// open/toggle time (spec: Resolution; Migration — label-level overrides).
import type { LabelConfig } from "../types";
import type { FieldDecl, FieldValue, Master } from "./types";
import { deepMerge, type DeepPartial } from "./merge";
import { resolve } from "./resolve";
import { expandFormat, fieldRefs } from "./format";

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

/** Display seam: clone `cfg` with each custom barcode/qr layer's raw `value`
 *  replaced by its expansion over the label's current field values (Format
 *  strings — a barcode/qr `value` may be a "{fieldId|transform}" string).
 *  The raw cfg stays the edited/saved document — only planning/export (and
 *  the preview) consume this. Identity (===) return whenever there is
 *  nothing to expand — no custom layers, or none whose value carries a ref —
 *  so memo consumers keyed on this don't re-render for a plain payload.
 *  Text/image custom layers are untouched: only barcode/qr `value`s are
 *  format strings by contract (CustomBarcodeLayer/CustomQrLayer docs). */
export function expandCustomFormats(
  cfg: LabelConfig, values: Record<string, string>,
): LabelConfig {
  const layers = cfg.customLayers;
  if (!layers || !layers.length) return cfg;
  let changed = false;
  const next = layers.map((l) => {
    if ((l.type === "barcode" || l.type === "qr") && fieldRefs(l.value).length) {
      changed = true;
      return { ...l, value: expandFormat(l.value, values).text };
    }
    return l;
  });
  return changed ? { ...cfg, customLayers: next } : cfg;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

// `null` is the removal marker configDiff emits for a key present in `base`
// but absent from `cfg` (the one real case: a legacy config's unset
// barcodeStrokeWidth — see defaults.ts's parseConfigFile comments). It has
// to be `null`, not `undefined`: JSON.stringify drops undefined-valued keys
// entirely, which would silently lose the removal across a save. composeConfig
// strips every null-valued key back out to ABSENT after the deepMerge below.
// DeepPartial<LabelConfig> has no room for this marker, so the two spots that
// write or read it are cast — kept to just those two lines.
const REMOVE: null = null;

/** Everything in `cfg` that differs from `base`, deep for plain objects,
 *  wholesale for arrays and leaves. A key present in `base` but absent from
 *  `cfg` is recorded as REMOVE, not skipped — otherwise composeConfig would
 *  resurrect it from the master/defaults on reopen (see REMOVE above).
 *  {} = no deviations. */
export function configDiff(base: LabelConfig, cfg: LabelConfig): DeepPartial<LabelConfig> {
  const walk = (b: unknown, c: unknown, cHasKey: boolean): unknown => {
    if (!cHasKey) return REMOVE;
    if (isPlain(b) && isPlain(c)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(b)) {
        const d = walk(b[k], c[k], k in c);
        if (d !== undefined) out[k] = d;
      }
      for (const k of Object.keys(c)) {
        if (k in b) continue;
        out[k] = c[k];
      }
      return Object.keys(out).length ? out : undefined;
    }
    return JSON.stringify(b) === JSON.stringify(c) ? undefined : c;
  };
  return (walk(base, cfg, true) ?? {}) as DeepPartial<LabelConfig>;
}

/** Deletes every REMOVE-marked key `patch` carries, deep, after the merge
 *  already applied its other values — turns the marker back into an absent
 *  key rather than leaving a stray `null` in the composed config. */
function stripRemovals(config: LabelConfig, patch: DeepPartial<LabelConfig>): LabelConfig {
  const walk = (c: unknown, p: unknown): void => {
    if (!isPlain(c) || !isPlain(p)) return;
    for (const k of Object.keys(p)) {
      if ((p as Record<string, unknown>)[k] === REMOVE) delete c[k];
      else walk(c[k], (p as Record<string, unknown>)[k]);
    }
  };
  walk(config, patch);
  return config;
}

export function composeConfig(
  master: Master, enabledVariations: string[],
  values: Record<string, FieldValue>, overrides: DeepPartial<LabelConfig> | undefined,
): { config: LabelConfig; errors: Record<string, string>; warnings: string[] } {
  const r = resolve(master, enabledVariations, values);
  const config = overrides ? stripRemovals(deepMerge(r.config, overrides), overrides) : r.config;
  return { config, errors: r.errors, warnings: r.warnings };
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
