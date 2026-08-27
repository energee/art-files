// src/model/document.ts — pure derivations between the live LabelConfig and
// the master model. cfg stays the app's single live document; these functions
// are the boundary: values/diff OUT of cfg at save time, compose INTO cfg at
// open/toggle time (spec: Resolution; Migration — label-level overrides).
import type { LabelConfig } from "../types";
import type { FieldDecl, FieldValue, Master, MasterLayer, Variant } from "./types";
import { deepMerge, type DeepPartial } from "./merge";
import { resolve } from "./resolve";
import { expandFormat, fieldRefs } from "./format";

export function visibleFieldsOf(master: Master, enabledVariants: string[]): FieldDecl[] {
  const out = [...master.fields];
  for (const id of enabledVariants) {
    const v = master.variants.find((x) => x.id === id);
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
  master: Master, enabledVariants: string[], cfg: LabelConfig,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const f of visibleFieldsOf(master, enabledVariants)) {
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
  master: Master, enabledVariants: string[],
  values: Record<string, FieldValue>, overrides: DeepPartial<LabelConfig> | undefined,
): {
  config: LabelConfig; errors: Record<string, string>; warnings: string[];
  disabledLayers: Set<string>; layers: MasterLayer[];
} {
  const r = resolve(master, enabledVariants, values);
  const config = overrides ? stripRemovals(deepMerge(r.config, overrides), overrides) : r.config;
  return { config, errors: r.errors, warnings: r.warnings, disabledLayers: r.disabledLayers, layers: r.layers };
}

/** Re-compose the live config around a variant toggle, preserving the
 *  user's deviations. The diff runs against the OLD enable set's base, so a
 *  variant's own overrides are attributed to the variant, never to the
 *  user — that attribution is what makes disable actually undo them. */
export function toggleVariant(
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

/** Pure half of the pre-Plan-5a collab bridge (I1): a v2 label saved before
 *  layer-visibility moved onto enabledVariants could carry a label-level
 *  `overrides.collabEnabled === true` with "collab" absent from
 *  enabledVariants — resolve() now derives the collab block's layers from
 *  enabledVariants alone (MasterLayer.variant), so such a label would reopen
 *  with `collabEnabled` still true but its layers stuck in disabledLayers.
 *  Called after composeConfig with the resolved config's `collabEnabled`;
 *  when it needs to bridge, enables "collab" and drops the now-redundant
 *  override so it can't fight the variant on the next diff. No-op (changed:
 *  false, same references) whenever there is nothing to bridge — callers can
 *  skip recomposing in that case. */
export function bridgeCollabOverride(
  master: Master, enabledVariants: string[], overrides: DeepPartial<LabelConfig> | undefined,
  resolvedCollabEnabled: boolean,
): { enabledVariants: string[]; overrides: DeepPartial<LabelConfig> | undefined; changed: boolean } {
  const alreadyEnabled = enabledVariants.includes("collab");
  const hasCollabVariant = master.variants.some((v) => v.id === "collab");
  if (!resolvedCollabEnabled || alreadyEnabled || !hasCollabVariant) {
    return { enabledVariants, overrides, changed: false };
  }
  let nextOverrides = overrides;
  if (overrides && (overrides as Record<string, unknown>).collabEnabled === true) {
    const rest = { ...(overrides as Record<string, unknown>) };
    delete rest.collabEnabled;
    nextOverrides = Object.keys(rest).length ? (rest as DeepPartial<LabelConfig>) : undefined;
  }
  return { enabledVariants: [...enabledVariants, "collab"], overrides: nextOverrides, changed: true };
}

// --- Authoring: Design-mode edits recorded into the master or a variant ---
// (spec: "Editing: Master ▾" — a design edit is an ordinary LabelConfig
// mutation whose resulting diff is redirected into the master's own defaults
// or a named variant's overrides, instead of a per-label override.)

/** Where a Design-mode edit is recorded. "master" = master.defaults; any
 *  other value = that variant's overrides (spec: "Editing: Master ▾"). */
export type EditTarget = "master" | { variant: string };

/** authoring diffs (master.defaults / a variant's overrides) never go
 *  through resolve()'s stripRemovals the way a label's own overrides do via
 *  composeConfig — resolve() deepMerges master.defaults and variant.overrides
 *  directly (resolve.ts). A stored REMOVE marker would therefore leak into
 *  every resolved config as a literal `null` forever instead of an absent
 *  key — so REMOVE can never survive into the merged result. But dropping a
 *  REMOVE leaf outright (rather than acting on it) would make an unset edit
 *  a silent no-op: if `master.defaults.abv` already holds a prior value and
 *  `mutate` deletes `abv` from the config, discarding the REMOVE marker
 *  would leave that stale prior value in place forever with no error. So a
 *  REMOVE marker is applied as a real deletion on the target object (via
 *  deletePath, which also prunes any object left empty — the same pruning
 *  resetOverride does), and only the REMOVE-free remainder of the diff is
 *  deep-merged in. Net effect: master.defaults/overrides stay null-free
 *  (the original requirement) AND an unset actually unsets. */
function extractRemovals(
  patch: DeepPartial<LabelConfig>,
): { paths: string[]; rest: DeepPartial<LabelConfig> } {
  const paths: string[] = [];
  const walk = (v: unknown, prefix: string): void => {
    if (!isPlain(v)) return;
    for (const k of Object.keys(v)) {
      const c = (v as Record<string, unknown>)[k];
      const p = prefix ? `${prefix}.${k}` : k;
      if (c === REMOVE) paths.push(p);
      else walk(c, p);
    }
  };
  walk(patch, "");
  // Reuse deletePath's own bottom-up pruning to strip each REMOVE leaf back
  // out of a clone of the diff, so a fully-removed nested object (e.g. every
  // key of `nameStyle` unset) doesn't survive as a stray `{}` in `rest`.
  const rest = structuredClone(patch) as Record<string, unknown>;
  for (const p of paths) deletePath(rest, p);
  return { paths, rest: rest as DeepPartial<LabelConfig> };
}

/** Run an ordinary LabelConfig mutation as an AUTHORING edit: apply it to a
 *  freshly resolved base, diff, and record the diff at `target`. Returns a
 *  NEW master — never mutates the one passed in — so it drops straight into
 *  the app's history stack.
 *
 *  This is the whole semantic flip in one function: every existing editor
 *  (applyStyle, the inspector's fields, drag, lock) keeps mutating a
 *  LabelConfig, and only the destination of the resulting diff changes. */
export function applyDesignEdit(
  master: Master, target: EditTarget, enabledVariants: string[],
  values: Record<string, FieldValue>,
  mutate: (cfg: LabelConfig) => void,
): Master {
  const variantId = target === "master" ? undefined : target.variant;
  // Editing a variant resolves its base WITH that variant enabled —
  // otherwise the diff would re-record everything the variant already
  // changes (it would look like a fresh label deviation from the un-varianted
  // base rather than the variant's own known overrides).
  const resolveEnabled = variantId && !enabledVariants.includes(variantId)
    ? [...enabledVariants, variantId]
    : enabledVariants;
  const base = composeConfig(master, resolveEnabled, values, undefined).config;
  const next = structuredClone(base);
  mutate(next);
  const d = configDiff(base, next);
  if (Object.keys(d).length === 0) return master; // memo/dirty-flag contract: identity, not a clone
  const { paths: removals, rest } = extractRemovals(d);
  if (target === "master") {
    // Master.defaults is typed Partial<LabelConfig> (shallow) but in practice
    // stores arbitrarily deep patches — the same seam resolve.ts already
    // crosses via its own `master.defaults as DeepPartial<LabelConfig>` cast.
    const defaults = structuredClone(master.defaults) as Record<string, unknown>;
    for (const p of removals) deletePath(defaults, p);
    const merged = deepMerge(defaults as DeepPartial<LabelConfig>, rest) as Partial<LabelConfig>;
    return { ...master, defaults: merged };
  }
  const variants = master.variants.map((v) => {
    if (v.id !== target.variant) return v;
    const overrides = structuredClone(v.overrides) as Record<string, unknown>;
    for (const p of removals) deletePath(overrides, p);
    const merged = deepMerge(overrides as DeepPartial<LabelConfig>, rest) as Partial<LabelConfig>;
    return { ...v, overrides: merged };
  });
  return { ...master, variants };
}

/** Patch one layer's policy (name/enabled/locked) at `target`: the master's
 *  own layer entry, or the variant's layerOverrides[id]. Returns a new
 *  master. Layer policy is NOT part of LabelConfig, so it cannot ride
 *  applyDesignEdit's diff and gets its own entry point. */
export function applyLayerEdit(
  master: Master, target: EditTarget, layerId: string, patch: Partial<MasterLayer>,
): Master {
  if (target === "master") {
    const layers = master.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l));
    return { ...master, layers };
  }
  const variants = master.variants.map((v) => {
    if (v.id !== target.variant) return v;
    const layerOverrides = { ...v.layerOverrides, [layerId]: { ...v.layerOverrides[layerId], ...patch } };
    return { ...v, layerOverrides };
  });
  return { ...master, variants };
}

/** Flattens a plain object/array-leaved value to dot-path leaves, arrays
 *  counting as leaves (mirrors configDiff's own plain-vs-leaf split). */
function leafPaths(obj: unknown, prefix: string, out: Set<string>): void {
  if (!isPlain(obj)) {
    if (prefix) out.add(prefix);
    return;
  }
  for (const k of Object.keys(obj)) {
    leafPaths(obj[k], prefix ? `${prefix}.${k}` : k, out);
  }
}

/** Every dot-path a variant currently overrides — what the inspector badges
 *  as "overridden" (spec: touched properties show a badge with per-property
 *  reset). Empty for the master, which overrides nothing by definition. */
export function overriddenPaths(master: Master, target: EditTarget): Set<string> {
  const out = new Set<string>();
  if (target === "master") return out;
  const v = master.variants.find((x) => x.id === target.variant);
  if (v) leafPaths(v.overrides, "", out);
  return out;
}

/** Deletes one dot-path from an object in place, then prunes any object
 *  left empty by the deletion (so a fully-reset nested style doesn't leave a
 *  stray `{}` in overrides). No-op if the path doesn't resolve. */
function deletePath(obj: Record<string, unknown>, path: string): void {
  const keys = path.split(".");
  const chain: Record<string, unknown>[] = [obj];
  for (let i = 0; i < keys.length - 1; i++) {
    const at = chain[i][keys[i]];
    if (!isPlain(at)) return;
    chain.push(at);
  }
  delete chain[chain.length - 1][keys[keys.length - 1]];
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]).length === 0) delete chain[i - 1][keys[i - 1]];
  }
}

/** Drop one overridden path from a variant, restoring the master's value.
 *  Returns a new master; a no-op for the master target. */
export function resetOverride(master: Master, target: EditTarget, path: string): Master {
  if (target === "master") return master;
  const variants = master.variants.map((v) => {
    if (v.id !== target.variant) return v;
    const overrides = structuredClone(v.overrides) as Record<string, unknown>;
    deletePath(overrides, path);
    return { ...v, overrides: overrides as Partial<LabelConfig> };
  });
  return { ...master, variants };
}

const slugify = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Add a variant and return the new master. Ids are slugged from `name`
 *  and de-duplicated with a numeric suffix, so the caller only supplies a
 *  human name (spec: inline creation, no dialogs). */
export function addVariant(master: Master, name: string): { master: Master; id: string } {
  const stem = slugify(name);
  const ids = new Set(master.variants.map((v) => v.id));
  let id = stem;
  for (let n = 2; ids.has(id); n++) id = `${stem}-${n}`;
  const variant: Variant = { id, name, overrides: {}, layerOverrides: {}, fields: [] };
  return { master: { ...master, variants: [...master.variants, variant] }, id };
}
