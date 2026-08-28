// src/model/document.ts — pure derivations between the live LabelConfig and
// the master model. cfg stays the app's single live document; these functions
// are the boundary: values/diff OUT of cfg at save time, compose INTO cfg at
// open/toggle time (spec: Resolution; Migration — label-level overrides).
import type { CustomLayer, LabelConfig } from "../types";
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
  return (diffValue(base, cfg, true) ?? {}) as DeepPartial<LabelConfig>;
}

/** configDiff's engine, over any two plain values rather than two whole
 *  LabelConfigs — `undefined` when they match. Split out so the custom-layer
 *  routing below (routeCustomLayers) can diff ONE materialized layer's stored
 *  style with exactly the same plain-vs-leaf rules the config diff uses. */
function diffValue(b: unknown, c: unknown, cHasKey: boolean): unknown {
  if (!cHasKey) return REMOVE;
  if (isPlain(b) && isPlain(c)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(b)) {
      const d = diffValue(b[k], c[k], k in c);
      if (d !== undefined) out[k] = d;
    }
    for (const k of Object.keys(c)) {
      if (k in b) continue;
      out[k] = c[k];
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(b) === JSON.stringify(c) ? undefined : c;
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
  // deepMerge replaces an array WHOLESALE (merge.ts), so a label carrying its
  // own `customLayers` override used to swallow the master's materialized
  // array outright: a layer added to the master after that override was
  // recorded never rendered (fix round 2, finding 10). The deliberate rule
  // now is MERGE BY ID, chosen over "prefer one side with a warning" because
  // both sides are legitimate and neither is a subset of the other — the
  // resolved side is the master's authored draw order, the override side is
  // this label's own deviations from it plus any purely per-label layer:
  //   · an override entry whose id IS materialized is a per-label deviation
  //     on that layer (a filler's nudge) and is deep-merged ONTO it, keeping
  //     the master's draw position;
  //   · an override entry with an unmatched id is a per-label (legacy) layer
  //     and is appended, in its stored order, after the materialized ones;
  //   · a materialized layer the override array simply omits still renders —
  //     omission is not a per-label delete (there is no such concept: the
  //     inspector's Remove now goes to the master, see routeCustomLayers).
  const ownLayers = (overrides as { customLayers?: CustomLayer[] } | undefined)?.customLayers;
  if (Array.isArray(ownLayers)) {
    const byId = new Map(ownLayers.map((l) => [l.id, l]));
    const resolved = r.config.customLayers ?? [];
    config.customLayers = [
      ...resolved.map((l) => {
        const own = byId.get(l.id);
        return own ? deepMerge(l, own as DeepPartial<CustomLayer>) : l;
      }),
      ...ownLayers.filter((l) => !resolved.some((x) => x.id === l.id)),
    ];
  }
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

// (bridgeCollabOverride lived here: it repaired a v2 label whose
// `overrides.collabEnabled === true` disagreed with its enabledVariants.
// `collabEnabled` no longer exists on LabelConfig — Collab is an ordinary
// variant — so no override can carry the key and there is nothing left to
// bridge. Deleted with the flag.)

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
  // resolve() OWNS `config.customLayers` for every materialized layer, so a
  // whole-array diff recorded at `defaults.customLayers` would be recomposed
  // away and left behind as junk (fix round 2, findings 1–4). Decompose it
  // here — once, at the seam — instead of at each of the four call sites:
  // every custom-layer editor (drag, applyStyle, the inspector's payload
  // fields, Name, Lock, Remove) mutates the array and reaches this one
  // function through `update`, and several of them live in src/elements.ts,
  // which the pure model may not reach into anyway.
  const routed = routeCustomLayers(master, base, next, d);
  const at = routed.master; // master + whatever layer identity/removal routing recorded
  // The whole edit was layer identity or removal — already recorded on `at`,
  // nothing left for defaults/overrides.
  if (Object.keys(routed.diff).length === 0) return at;
  const { paths: removals, rest } = extractRemovals(routed.diff);
  if (target === "master") {
    // Master.defaults is typed Partial<LabelConfig> (shallow) but in practice
    // stores arbitrarily deep patches — the same seam resolve.ts already
    // crosses via its own `master.defaults as DeepPartial<LabelConfig>` cast.
    const defaults = structuredClone(at.defaults) as Record<string, unknown>;
    for (const p of removals) deletePath(defaults, p);
    const merged = deepMerge(defaults as DeepPartial<LabelConfig>, rest) as Partial<LabelConfig>;
    return { ...at, defaults: merged };
  }
  const variants = at.variants.map((v) => {
    if (v.id !== target.variant) return v;
    const overrides = structuredClone(v.overrides) as Record<string, unknown>;
    for (const p of removals) deletePath(overrides, p);
    const merged = deepMerge(overrides as DeepPartial<LabelConfig>, rest) as Partial<LabelConfig>;
    return { ...v, overrides: merged };
  });
  return { ...at, variants };
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

/** The fields a `target` currently declares on its own — the master's own
 *  list for "master", a variant's own list (never the master's too) for a
 *  variant. Mirrors TargetFields' scoping (EditingTarget.tsx). Undefined
 *  when `target` names a variant the master doesn't declare. Exported so
 *  App.tsx's removeFieldDoc can look a field up by id before removing it
 *  (to bench its current value — see removeFieldDoc's own doc comment). */
export function fieldsAt(master: Master, target: EditTarget): FieldDecl[] | undefined {
  if (target === "master") return master.fields;
  return master.variants.find((v) => v.id === target.variant)?.fields;
}

/** Every dot-path declared ANYWHERE in the master — its own fields plus
 *  every variant's, ENABLED OR NOT. This, not fieldsAt's per-target list, is
 *  addField's collision set (fix round 1, Critical): a variant that is
 *  currently disabled can still be enabled later, at which point a path it
 *  shares with the master (or with another variant) becomes a live
 *  collision — `visibleFieldsOf` just concatenates without deduping, and
 *  Fill mode would render two independently-labelled rows editing one
 *  underlying config value. Refusing the collision up front, regardless of
 *  which variants happen to be enabled right now, is the conservative rule;
 *  addField has no `enabledVariants` parameter to check "currently visible"
 *  with, and this makes it need none. Exported so the UI's "already
 *  fillable" check (StyleProperties.tsx's MakeFillable, via App's
 *  `declaredPaths`) can use the exact same set the model refuses against —
 *  see that file for the one deliberate trade-off this rule accepts. */
export function declaredFieldPaths(master: Master): Set<string> {
  const out = new Set(master.fields.map((f) => f.path));
  for (const v of master.variants) for (const f of v.fields) out.add(f.path);
  return out;
}

/** Declare a field for a layer at `target` (the master, or one of its
 *  variants) — Design mode's "Make fillable" (spec: a selected layer becomes
 *  something a filler can fill). The caller supplies the WHOLE FieldDecl,
 *  path and kind included: those are inferred from the layer's registry
 *  entry in the UI (src/elements.ts's editableText/FLAT), which this pure
 *  model must not import (see this file's header). Returns a NEW master —
 *  never mutates `master` — or `master` itself, unchanged, when `target`
 *  names a variant the master doesn't declare, or `decl.path` is already
 *  declared ANYWHERE in the master (declaredFieldPaths above) — not just at
 *  `target`. A field the MASTER already declares blocks a VARIANT from also
 *  declaring one over the same path, and vice versa: one path, one field,
 *  full stop (fix round 1 — the brief's original "visible field" wording,
 *  read correctly). The one accepted trade-off: two variants meant to be
 *  mutually exclusive can no longer each bind the same path; if that's ever
 *  needed, the answer is one field on the master, not two on the variants. */
export function addField(master: Master, target: EditTarget, decl: FieldDecl): Master {
  const existing = fieldsAt(master, target);
  if (!existing) return master; // target names a variant that doesn't exist
  if (declaredFieldPaths(master).has(decl.path)) return master;
  if (target === "master") return { ...master, fields: [...master.fields, decl] };
  const variants = master.variants.map((v) =>
    v.id === target.variant ? { ...v, fields: [...v.fields, decl] } : v);
  return { ...master, variants };
}

/** Rename one field's label at `target`, in place in its declared list — the
 *  inline edit TargetFields offers once a field is unlocked (spec: "no
 *  read-only fields" — a field ships locked, but never permanently frozen).
 *  Returns a new master, or `master` itself when the id isn't declared at
 *  `target` or is already called `label`. */
export function renameField(
  master: Master, target: EditTarget, fieldId: string, label: string,
): Master {
  const existing = fieldsAt(master, target);
  const cur = existing?.find((f) => f.id === fieldId);
  if (!cur || cur.label === label) return master;
  if (target === "master")
    return { ...master, fields: master.fields.map((f) => (f.id === fieldId ? { ...f, label } : f)) };
  const variants = master.variants.map((v) =>
    v.id === target.variant ? { ...v, fields: v.fields.map((f) => (f.id === fieldId ? { ...f, label } : f)) } : v);
  return { ...master, variants };
}

/** Drop one field from `target`'s declared list — TargetFields' remove,
 *  offered once a field is unlocked, same gate as renameField above. Returns
 *  a new master, or `master` itself when the id isn't declared at `target`. */
export function removeField(master: Master, target: EditTarget, fieldId: string): Master {
  const existing = fieldsAt(master, target);
  if (!existing?.some((f) => f.id === fieldId)) return master;
  if (target === "master") return { ...master, fields: master.fields.filter((f) => f.id !== fieldId) };
  const variants = master.variants.map((v) =>
    v.id === target.variant ? { ...v, fields: v.fields.filter((f) => f.id !== fieldId) } : v);
  return { ...master, variants };
}

const slugify = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Add a layer to the master (or the editing variant) — Design mode's "Add
 *  layer" (spec: a filler-invisible, master-authored layer). Returns a NEW
 *  master; never mutates `master`, and always allocates (every call mints a
 *  fresh layer, so there is no no-op case the way applyDesignEdit has).
 *
 *  `layer`'s identity and policy (id, name, enabled, `kind`) land in
 *  `layers` — `master.layers` for target "master", the target variant's OWN
 *  `layers` (the appended-layer path Variant.layers already exists for, not
 *  `layerOverrides`, which only patches an EXISTING master layer) for a
 *  variant target. `style` — the rest of the CustomLayer shape (position,
 *  and whichever of line/asset/value/size/style the layer's `kind`
 *  needs) — lands in `defaults` (or the variant's `overrides`) keyed by
 *  `layer.id`, exactly like every built-in layer's own styling already sits
 *  at `defaults[builtinId]`. resolve() reads it back out at that same key
 *  when it materializes the layer into `config.customLayers` (see
 *  resolve.ts) — this split keeps identity and style in separate places, so
 *  a rename or lock (layer policy) never touches the stored style, and a
 *  style edit (an ordinary applyDesignEdit through `config[layer.id]`) never
 *  touches the layer's identity. */
export function addLayer(
  master: Master, target: EditTarget, layer: MasterLayer, style: unknown,
): Master {
  if (target === "master") {
    const defaults = { ...master.defaults, [layer.id]: style } as Partial<LabelConfig>;
    return { ...master, layers: [...master.layers, layer], defaults };
  }
  const variants = master.variants.map((v) => {
    if (v.id !== target.variant) return v;
    const overrides = { ...v.overrides, [layer.id]: style } as Partial<LabelConfig>;
    return { ...v, overrides, layers: [...(v.layers ?? []), layer] };
  });
  return { ...master, variants };
}

/** Move one `kind`-bearing (custom) layer one place earlier (delta -1) or
 *  later (delta 1) among its OWN list's other `kind`-bearing entries only —
 *  the master's `layers` if Design mode added it there, or the owning
 *  variant's `layers` if added there instead. Built-in layers interleaved in
 *  the same list never move and are never swapped with (the panel offers no
 *  reorder control for them — spec: their draw order is fixed in
 *  planLabel). Mirrors the pre-Task-5b `cfg.customLayers` splice this
 *  replaces: an adjacent swap, since delta is always ±1. Returns `master`
 *  itself when `layerId` isn't a `kind`-bearing layer anywhere in the master,
 *  or the move would run off either end of its own custom range. */
export function moveLayer(master: Master, layerId: string, delta: -1 | 1): Master {
  const moveWithin = (list: MasterLayer[]): MasterLayer[] | null => {
    const at = list.findIndex((l) => l.id === layerId);
    if (at === -1 || list[at].kind === undefined) return null;
    const customIdx = list.reduce<number[]>((acc, l, i) => (l.kind ? [...acc, i] : acc), []);
    const swapWith = customIdx[customIdx.indexOf(at) + delta];
    if (swapWith === undefined) return null;
    const next = [...list];
    [next[at], next[swapWith]] = [next[swapWith], next[at]];
    return next;
  };
  const masterNext = moveWithin(master.layers);
  if (masterNext) return { ...master, layers: masterNext };
  for (const v of master.variants) {
    const vNext = moveWithin(v.layers ?? []);
    if (vNext) {
      return { ...master, variants: master.variants.map((x) => (x.id === v.id ? { ...x, layers: vNext } : x)) };
    }
  }
  return master;
}

/** Patch one MATERIALIZED (`kind`-bearing) layer's own entry directly,
 *  wherever `addLayer` put it — `master.layers`, or the owning variant's OWN
 *  `layers` (the Variant.layers appended-layer path, not `layerOverrides`).
 *  This is `applyLayerEdit`'s counterpart for a layer whose identity IS a
 *  `layers` entry rather than a built-in resolve() always finds in
 *  `master.layers` first: `applyLayerEdit`'s variant branch always writes
 *  into `layerOverrides`, which resolve() only ever applies to a layer it
 *  already found in `master.layers`, BEFORE a variant's own `layers` are
 *  appended (see resolve.ts) — it can never reach an entry that lives in
 *  `v.layers` itself, so using it here would silently drop the edit for any
 *  materialized layer added to a variant (fix round 1, Important). Search
 *  by id alone, not by the current editing target, on purpose: a
 *  materialized row's owner is fixed at add time, not by whatever the
 *  editing-target selector happens to show right now — the same reasoning
 *  moveLayer already follows. Returns `master` unchanged when `layerId`
 *  isn't a `kind`-bearing layer anywhere, or the patch is already what it
 *  stores. */
export function applyMaterializedLayerEdit(
  master: Master, layerId: string, patch: Partial<MasterLayer>,
): Master {
  const isNoop = (l: MasterLayer) =>
    Object.entries(patch).every(
      ([k, v]) => (l as unknown as Record<string, unknown>)[k] === v);
  const mi = master.layers.findIndex((l) => l.id === layerId && l.kind !== undefined);
  if (mi !== -1) {
    if (isNoop(master.layers[mi])) return master;
    return { ...master, layers: master.layers.map((l, i) => (i === mi ? { ...l, ...patch } : l)) };
  }
  for (const v of master.variants) {
    const vi = (v.layers ?? []).findIndex((l) => l.id === layerId && l.kind !== undefined);
    if (vi === -1) continue;
    if (isNoop(v.layers![vi])) return master;
    const layers = v.layers!.map((l, i) => (i === vi ? { ...l, ...patch } : l));
    return { ...master, variants: master.variants.map((x) => (x.id === v.id ? { ...x, layers } : x)) };
  }
  return master;
}

/** Every `kind`-bearing (MATERIALIZED) layer's id, wherever `addLayer` put
 *  it — `master.layers`, or any variant's own `layers`. This is THE
 *  discriminator between a materialized custom layer, whose identity, policy
 *  and style live on the master and whose `config.customLayers` entry is
 *  rebuilt by resolve() on every recompose, and a LEGACY per-label custom
 *  layer, which lives only in a `customLayers` array and is still edited as
 *  ordinary config. `PanelRow.materialized` (model/panel.ts) is this same set,
 *  read once per row. */
export function materializedLayerIds(master: Master): Set<string> {
  const out = new Set<string>();
  for (const l of master.layers) if (l.kind) out.add(l.id);
  for (const v of master.variants) for (const l of v.layers ?? []) if (l.kind) out.add(l.id);
  return out;
}

/** Delete one MATERIALIZED layer from the master — the inspector's "Remove
 *  layer" (StyleProperties' CustomAdvanced), which is the ONLY delete
 *  affordance a custom layer has. Removes BOTH halves of what `addLayer`
 *  wrote: the `layers` entry carrying its identity and the stored style at
 *  the same owner's `defaults[layerId]` / `overrides[layerId]`, plus any
 *  variant `layerOverrides[layerId]` that patched it. Owner is found by id
 *  search, not by the current editing target — same reasoning as
 *  `applyMaterializedLayerEdit`: a materialized layer's owner is fixed at add
 *  time. Returns a NEW master, or `master` itself when `layerId` isn't a
 *  `kind`-bearing layer anywhere (a LEGACY per-label layer is not this
 *  function's business — its removal stays an ordinary `customLayers` array
 *  edit). */
export function removeLayer(master: Master, layerId: string): Master {
  const dropOverride = (v: Variant): Variant =>
    layerId in v.layerOverrides
      ? { ...v, layerOverrides: Object.fromEntries(
          Object.entries(v.layerOverrides).filter(([k]) => k !== layerId)) }
      : v;
  const without = (o: object): Partial<LabelConfig> =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== layerId)) as Partial<LabelConfig>;
  if (master.layers.some((l) => l.id === layerId && l.kind !== undefined)) {
    return {
      ...master,
      layers: master.layers.filter((l) => l.id !== layerId),
      defaults: without(master.defaults),
      variants: master.variants.map(dropOverride),
    };
  }
  for (const v of master.variants) {
    if (!(v.layers ?? []).some((l) => l.id === layerId && l.kind !== undefined)) continue;
    return {
      ...master,
      variants: master.variants.map((x) => (x.id === v.id
        ? dropOverride({ ...x, layers: x.layers!.filter((l) => l.id !== layerId),
            overrides: without(x.overrides) })
        : dropOverride(x))),
    };
  }
  return master;
}

/** Rename one MATERIALIZED layer — the inspector's Name input (StyleProperties'
 *  NameLockRow), which is the only rename path a custom row has (the layers
 *  panel deliberately refuses inline rename for custom rows). The name is
 *  MasterLayer identity, not style: resolve() re-stamps it onto the
 *  CustomLayer it materializes, so writing it into `cfg.customLayers` would
 *  be recomposed away. Returns `master` unchanged when the id isn't
 *  materialized anywhere, or already carries that name. */
export function renameLayer(master: Master, layerId: string, name: string): Master {
  return applyMaterializedLayerEdit(master, layerId, { name });
}

/** The identity/style keys resolve() STAMPS onto every materialized
 *  CustomLayer from its MasterLayer (see resolve.ts). They are layer
 *  identity, never stored style, so they must be stripped before diffing one
 *  materialized layer's style — otherwise a rename would also be recorded as
 *  a style deviation at `defaults[layerId].name` and win over the rename. */
const STAMPED_KEYS = ["id", "name", "type", "locked"];
const stylePart = (l: CustomLayer): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(l as unknown as Record<string, unknown>)
      .filter(([k]) => !STAMPED_KEYS.includes(k)));

/** Decompose a design edit's whole-array `customLayers` diff into writes that
 *  actually stick. THE fix for the seam this file and resolve.ts share:
 *  resolve() rebuilds `config.customLayers` for every materialized layer on
 *  every recompose, while `configDiff` treats an array as one leaf — so an
 *  edit recorded as `defaults.customLayers` is both recomposed away AND left
 *  behind as a stale snapshot in the saved `.master`.
 *
 *  Given the edit's before/after configs and its diff, returns the master
 *  with every MATERIALIZED layer's identity change already applied
 *  (`renameLayer` / `applyMaterializedLayerEdit` for lock / `removeLayer`)
 *  and a diff in which the array leaf has been replaced by:
 *    · `defaults[layerId]` (or the editing variant's `overrides[layerId]` —
 *      the caller's own target decides) per-layer STYLE patches, the exact
 *      key `addLayer` stores a layer's style at and `resolve()` reads it back
 *      from, so drag and every style/payload control land where they resolve;
 *    · a `customLayers` array holding the LEGACY (non-materialized) layers
 *      only, and only when those actually changed — a legacy layer is still
 *      pure config, exactly as before this fix, and the materialized entries
 *      no longer ride along as junk.
 *  Identity contract: returns the same `master` and the same `d` when the
 *  diff carries no `customLayers` key at all. */
function routeCustomLayers(
  master: Master, base: LabelConfig, next: LabelConfig, d: DeepPartial<LabelConfig>,
): { master: Master; diff: DeepPartial<LabelConfig> } {
  const dd = d as unknown as Record<string, unknown>;
  if (!("customLayers" in dd)) return { master, diff: d };
  const ids = materializedLayerIds(master);
  const baseArr = base.customLayers ?? [];
  // A REMOVE marker means the key itself is gone from `next` — no layers left.
  const nextArr = dd.customLayers === REMOVE ? [] : (next.customLayers ?? []);
  const out: Record<string, unknown> = { ...dd };
  delete out.customLayers;
  let m = master;
  const nextIds = new Set(nextArr.map((l) => l.id));
  for (const b of baseArr) {
    if (ids.has(b.id) && !nextIds.has(b.id)) m = removeLayer(m, b.id);
  }
  for (const n of nextArr) {
    if (!ids.has(n.id)) continue;
    const b = baseArr.find((x) => x.id === n.id);
    if (!b) continue; // a materialized id absent from `base`: only addLayer mints those
    if (n.name !== b.name) m = renameLayer(m, n.id, n.name);
    if (!!n.locked !== !!b.locked) m = applyMaterializedLayerEdit(m, n.id, { locked: n.locked });
    const style = diffValue(stylePart(b), stylePart(n), true);
    if (style === undefined) continue;
    out[n.id] = isPlain(out[n.id]) && isPlain(style) ? deepMerge(out[n.id], style) : style;
  }
  const legacy = (arr: CustomLayer[]) => arr.filter((l) => !ids.has(l.id));
  if (JSON.stringify(legacy(baseArr)) !== JSON.stringify(legacy(nextArr)))
    out.customLayers = legacy(nextArr);
  return { master: m, diff: out as DeepPartial<LabelConfig> };
}

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
