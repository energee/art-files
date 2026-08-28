// src/model/resolve.ts — the heart of the design: collapse master + enabled
// variants + field values into the LabelConfig the renderers and both
// deliverable builders already consume (spec: Resolution). Pure, synchronous,
// deterministic; anchors/guides (spec step 6) land with the layer work.
import type { CustomLayer, LabelConfig } from "../types";
import type { FieldDecl, FieldValue, Master, MasterLayer } from "./types";
import { deepMerge, type DeepPartial } from "./merge";
import { validateField } from "./fields";
import { expandFormat } from "./format";
import { defaultConfig } from "../defaults";

/** Positioned config fields a MasterLayer's `locked` may stamp (spec 5a:
 *  the master's lock is a default, not a label fact — composeConfig's later
 *  override merge lets a label's own `locked` still win). The two collab
 *  slots are in here because they carry Positioned knobs like the laurel
 *  does, not because collab is special: it is an ordinary variant. */
const LOCKABLE_IDS = new Set(["logo", "collabLeft", "collabCenter"]);

/** Dot-path write, the mirror of document.ts's getPath. Exported for
 *  FieldList's onValue plumbing (App.tsx), which writes a single field
 *  straight into the live config the same way resolve() composes one. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let at = obj;
  for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  at[keys[keys.length - 1]] = value;
}

export function resolve(
  master: Master, enabledVariants: string[], values: Record<string, FieldValue>,
): {
  config: LabelConfig; visibleFields: FieldDecl[]; errors: Record<string, string>; warnings: string[];
  disabledLayers: Set<string>; layers: MasterLayer[];
} {
  const warnings: string[] = [];
  let config = deepMerge(defaultConfig(), master.defaults as DeepPartial<LabelConfig>);
  const visibleFields = [...master.fields];
  // Layer resolution (spec: Approach 1's disabledLayers/layers pair). Start
  // from master.layers in draw order; each enabled variant patches its
  // owned layers via layerOverrides, then appends its own `layers` (the
  // appended-layer path — none ship today, but the code path is exercised).
  const layers: MasterLayer[] = master.layers.map((l) => ({ ...l }));
  const enabledSet = new Set(enabledVariants);
  for (const id of enabledVariants) {
    const v = master.variants.find((x) => x.id === id);
    if (!v) { warnings.push(`Unknown variant "${id}" — skipped.`); continue; }
    config = deepMerge(config, v.overrides as DeepPartial<LabelConfig>);
    visibleFields.push(...v.fields);
    for (let i = 0; i < layers.length; i++) {
      const patch = v.layerOverrides[layers[i].id];
      if (patch) layers[i] = { ...layers[i], ...patch };
    }
    if (v.layers) layers.push(...v.layers.map((l) => ({ ...l })));
  }
  const disabledLayers = new Set<string>();
  for (const l of layers) {
    if (l.enabled === false) disabledLayers.add(l.id);
    else if (l.variant !== undefined && !enabledSet.has(l.variant)) disabledLayers.add(l.id);
  }
  const out0 = config as unknown as Record<string, Record<string, unknown>>;
  for (const l of layers) {
    if (l.locked === true && LOCKABLE_IDS.has(l.id)) {
      out0[l.id] = { ...out0[l.id], locked: true };
    }
  }
  // Materialize every `kind`-bearing layer into config.customLayers, in
  // master.layers draw order — the whole safety argument for Task 5b: a
  // MasterLayer with `kind` carries only identity/policy (id, name, enabled,
  // locked); its styling was written by addLayer to `config[id]`, exactly
  // where a built-in layer's own styling already sits (config.name,
  // config.qr, ...). Reading it back out here and stamping the layer's own
  // id/name/type/locked over whatever the stored style carries (so a rename
  // or a lock toggle — MasterLayer edits, not style edits — take effect
  // without touching the stored style) reproduces precisely the CustomLayer
  // object Design mode used to build inline. planLabel and the three
  // backends never see this step: they only ever see config.customLayers.
  // A layer that doesn't resolve (master-disabled, or its variant is off —
  // `disabledLayers` above already covers both) contributes nothing, same
  // as the collab layers. `kept` — the non-`kind` layers — is what's
  // returned as `layers` below: a materialized layer never appears there, so
  // it can't also show up as a phantom master row in the panel (which
  // builds its custom rows off config.customLayers already, via panelRows).
  const kept: MasterLayer[] = [];
  const materialized: CustomLayer[] = [];
  for (const l of layers) {
    if (!l.kind) { kept.push(l); continue; }
    if (disabledLayers.has(l.id)) continue;
    const style = out0[l.id];
    if (!style) continue; // addLayer always records one — defensive only
    materialized.push({
      ...(style as object), id: l.id, name: l.name, type: l.kind, locked: l.locked,
    } as CustomLayer);
  }
  // Materialized layers OWN the head of `config.customLayers`, in master draw
  // order — but they no longer erase whatever `master.defaults.customLayers`
  // (or a variant's `overrides.customLayers`) already carried. A LEGACY
  // per-master custom layer — one stored as a raw `customLayers` entry rather
  // than as a `kind`-bearing MasterLayer — survives, appended AFTER the
  // materialized ones so a label-local addition draws in front (spec fix
  // round 2, finding 10: the wholesale overwrite silently swallowed them).
  // Any legacy entry whose id IS materialized is dropped rather than merged:
  // that shape can only come from the pre-fix bug, where a Design-mode edit
  // recorded a stale whole-array snapshot into `defaults.customLayers` that
  // resolve() then ignored. Filtering it out here makes such a saved master
  // self-heal instead of resurrecting the stale copy.
  if (materialized.length) {
    const own = (config as unknown as { customLayers?: CustomLayer[] }).customLayers ?? [];
    const ids = new Set(materialized.map((l) => l.id));
    (config as unknown as { customLayers: CustomLayer[] }).customLayers =
      [...materialized, ...own.filter((l) => !ids.has(l.id))];
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
      else warnings.push(`Field "${f.id}" format is missing: ${missing.join(", ")}.`);
    } else if (strings[f.id] !== undefined) {
      const v = values[f.id];
      setPath(out, f.path, f.kind === "toggle" ? v === true : strings[f.id]);
    }
  }
  return { config, visibleFields, errors, warnings, disabledLayers, layers: kept };
}
