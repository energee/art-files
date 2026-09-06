// src/model/resolveLayers.ts — the v3 resolver (spec 2026-09-04: Resolution).
// master.layers → deep-merge each enabled variant's diff in enable order
// (an id the master lacks appends a whole layer) → the label's overrides →
// the label's values into its layers → format refs in barcode/qr
// values expanded over the text layers' plain text → layers with
// enabled === false dropped. Pure and synchronous. Relative `y` bindings
// are NOT resolved here: that needs measured heights and is the renderer's
// step. The layers come back in draw order, ready to measure and place.
import type { Layer, LayerValue, Master, TextLayer, TextLine } from "./layers";
import { uppercaseOf } from "./layers";
import { deepMerge, type DeepPartial } from "./merge";
import { validateField } from "./fields";
import { expandFormat, fieldRefs } from "./format";
import { parseRuns } from "../description";

type Result = { layer: Layer } | { error: string };

/** A stored value in the shape the LAYER holds it: a string on a text layer
 *  is one plain line in the layer's style — what the number and code widgets
 *  write. The inverse of `valueOf`, and the one spelling of the widening, so
 *  the Save Master review diffs a value against exactly what the canvas would
 *  resolve from it (edit.ts's masterChanges). */
export const widenValue = (l: Layer, v: LayerValue): LayerValue =>
  l.kind === "text" && typeof v === "string"
    ? [{ text: v, fill: l.style.fill, layer: l.style.layer }] : v;

/** One value into one layer, validated per kind. */
function applyValue(l: Layer, v: LayerValue): Result {
  if (l.kind === "text") {
    const lines = widenValue(l, v);
    if (!Array.isArray(lines)) return { error: "Expected text." };
    if (l.input) {
      // ponytail: validateField still speaks FieldDecl; build one on the fly.
      const r = validateField({ id: l.id, label: l.name, kind: l.input, path: "",
        min: l.min, max: l.max, symbology: l.symbology }, plainText(lines));
      if (!r.ok) return { error: r.error! };
    }
    return { layer: { ...l, lines } };
  }
  if (typeof v !== "string") return { error: l.kind === "image" ? "Expected an image." : "Expected a code value." };
  if (l.kind === "image") return { layer: { ...l, asset: v } };
  if (l.kind === "barcode") {
    const r = validateField({ id: l.id, label: l.name, kind: "code", path: "", symbology: l.symbology }, v);
    if (!r.ok) return { error: r.error! };
  }
  return { layer: { ...l, value: v } };
}

/** Lines as one plain string: runs joined with their markers stripped. */
const plainText = (lines: TextLine[]): string =>
  lines.map((l) => parseRuns(l).map((r) => r.text).join("")).join(" ");

/** What a `{layerId}` ref in a barcode/qr value reads: the layer's plain
 *  text, uppercased if the layer draws that way, or its placeholder while
 *  blank (the old displayName rule, so a blank name still encodes "name"). */
function refText(l: TextLayer): string {
  const t = plainText(l.lines).trim() || l.placeholder || "";
  return uppercaseOf(l) ? t.toUpperCase() : t;
}

/** A diff onto a layer: deepMerge, then honour `null` as "unset this key".
 *  A label override spells a cleared optional field (wrap width back to none,
 *  image height back to auto) as null, because deepMerge skips `undefined`
 *  and JSON cannot store it — see setLabelOverride. Variant diffs never carry
 *  null today, so this is a no-op for them. */
function applyDiff<T extends object>(base: T, p: DeepPartial<T>): T {
  const merged = deepMerge(base, p) as Record<string, unknown>;
  stripNulls(merged, p as Record<string, unknown>);
  return merged as T;
}

/** Delete every key the diff set to null, recursing only where the diff does
 *  — an untouched subtree keeps whatever the master put there. */
function stripNulls(out: Record<string, unknown>, diff: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(diff)) {
    if (v === null) delete out[k];
    else if (v && typeof v === "object" && !Array.isArray(v)
      && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]))
      stripNulls(out[k] as Record<string, unknown>, v as Record<string, unknown>);
  }
}

export interface ResolveOpts {
  /** Keep `enabled: false` layers in the list (the Layers list shows them
   *  dimmed, the inspector edits them); the renderer's callers leave this
   *  off and get only what draws. */
  keepDisabled?: boolean;
}

export function resolveLayers(
  master: Master, enabledVariants: string[], values: Record<string, LayerValue>,
  overrides?: Record<string, DeepPartial<Layer>>,
  opts: ResolveOpts = {},
): { layers: Layer[]; warnings: string[]; errors: Record<string, string> } {
  const warnings: string[] = [];
  const errors: Record<string, string> = {};
  let layers: Layer[] = master.layers.map((l) => structuredClone(l));
  const patch = (id: string, p: DeepPartial<Layer>, ctx: string) => {
    const i = layers.findIndex((l) => l.id === id);
    if (i >= 0) layers[i] = applyDiff(layers[i], p);
    else if (p.kind) layers.push(applyDiff({} as Layer, p)); // a whole added layer
    else warnings.push(`${ctx} overrides unknown layer "${id}"; skipped.`);
  };
  for (const id of enabledVariants) {
    const v = master.variants.find((x) => x.id === id);
    if (!v) { warnings.push(`Unknown variant "${id}"; skipped.`); continue; }
    for (const [lid, p] of Object.entries(v.layers)) patch(lid, p, `Variant "${id}"`);
  }
  for (const [id, p] of Object.entries(overrides ?? {})) patch(id, p, "Label");
  for (const [id, v] of Object.entries(values)) {
    const i = layers.findIndex((l) => l.id === id);
    // Any layer the master HAS can be filled — the `fillable` flag that used
    // to gate this is gone (docs/plans/label-first-editing.md). A value for an
    // id this master lacks stays dormant, not an error: it belongs to another
    // master the label was rebound from.
    if (i < 0) continue;
    const r = applyValue(layers[i], v);
    if ("error" in r) errors[id] = r.error;
    else layers[i] = r.layer;
  }
  const texts: Record<string, string> = {};
  for (const l of layers) if (l.kind === "text") texts[l.id] = refText(l);
  layers = layers.map((l) => {
    if ((l.kind !== "barcode" && l.kind !== "qr") || !fieldRefs(l.value).length) return l;
    const { text, missing } = expandFormat(l.value, texts);
    if (missing.length) warnings.push(`Layer "${l.id}" value refers to missing layers: ${missing.join(", ")}.`);
    // Keep the template: the inspector edits `format`, everything downstream
    // (renderers, PSD/PDF builders) reads the expanded `value`.
    return { ...l, value: text, format: l.value };
  });
  return { layers: opts.keepDisabled ? layers : layers.filter((l) => l.enabled !== false), warnings, errors };
}

/** A layer's content, in the shape a .label stores it. */
export const valueOf = (layer: Layer): LayerValue =>
  layer.kind === "text" ? layer.lines : layer.kind === "image" ? layer.asset : layer.value;

/** The dotted path `valueOf` reads — what a value-sourced promote row in the
 *  Save Master review writes into the master. Kept beside valueOf so the two
 *  switches cannot drift. */
export const valuePath = (layer: Layer): string =>
  layer.kind === "text" ? "lines" : layer.kind === "image" ? "asset" : "value";
