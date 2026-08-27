// src/model/resolve.ts — the heart of the design: collapse master + enabled
// variants + field values into the LabelConfig the renderers and both
// deliverable builders already consume (spec: Resolution). Pure, synchronous,
// deterministic; anchors/guides (spec step 6) land with the layer work.
import type { LabelConfig } from "../types";
import type { FieldDecl, FieldValue, Master, MasterLayer } from "./types";
import { deepMerge, type DeepPartial } from "./merge";
import { validateField } from "./fields";
import { expandFormat } from "./format";
import { defaultConfig } from "../defaults";

/** Positioned config fields a MasterLayer's `locked` may stamp (spec 5a:
 *  the master's lock is a default, not a label fact — composeConfig's later
 *  override merge lets a label's own `locked` still win). */
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
    const appended = (v as unknown as { layers?: MasterLayer[] }).layers;
    if (appended) layers.push(...appended.map((l) => ({ ...l })));
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
  return { config, visibleFields, errors, warnings, disabledLayers, layers };
}
