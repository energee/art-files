// src/model/resolveLayers.ts — the v3 resolver (spec 2026-09-04: Resolution).
// master.layers → deep-merge each enabled variant's diff in enable order
// (an id the master lacks appends a whole layer) → the label's overrides →
// the label's values into its layers → format refs in barcode/qr
// values expanded over the text layers' plain text → every drawn barcode's
// expanded value validated, whatever tier supplied it → layers with
// enabled === false dropped. Pure and synchronous. Relative `y` bindings
// are NOT resolved here: that needs measured heights and is the renderer's
// step. The layers come back in draw order, ready to measure and place.
import type { Layer, LayerValue, Master, TextLayer, TextLine } from "./layers";
import { uppercaseOf } from "./layers";
import { deepMerge, type DeepPartial } from "./merge";
import { validateField } from "./fields";
import { expandFormat, fieldRefs } from "./format";
import { parseRuns } from "../description";
import { machineName } from "../qr";
import { validateFor } from "../barcode";

type Result = { layer: Layer } | { error: string };

/** A stored value in the shape the LAYER holds it: a string on a text layer
 *  is one plain line in the layer's style — what the number and code widgets
 *  write. The inverse of `valueOf`, and the one spelling of the widening, so
 *  the Save Master review diffs a value against exactly what the canvas would
 *  resolve from it (edit.ts's masterChanges). */
export const widenValue = (l: Layer, v: LayerValue): LayerValue =>
  l.kind === "text" && typeof v === "string"
    ? [{ text: v, fill: l.style.fill, layer: l.style.layer }] : v;

/** One value onto one layer, UNVALIDATED — the per-kind shaping applyValue
 *  and withRejectedValue share. Undefined when the value has the wrong shape
 *  for the layer (a .label is parsed JSON, so the guard is real). */
function putValue(l: Layer, v: LayerValue): Layer | undefined {
  if (l.kind === "text") {
    const lines = widenValue(l, v);
    return Array.isArray(lines) ? { ...l, lines } : undefined;
  }
  if (typeof v !== "string") return undefined;
  return l.kind === "image" ? { ...l, asset: v } : { ...l, value: v };
}

/** A stored value the resolver REJECTED, put back on its layer for display
 *  only (#128/#129): applyValue skips an invalid value so the canvas and
 *  exports never draw it, but the fill field must show what the label holds —
 *  not the master's fallback — beside the error. No `format`: a rejected value
 *  never reached ref expansion, so it is its own template. A value of the
 *  wrong shape for the layer leaves the layer as it was. */
export function withRejectedValue(l: Layer, v: LayerValue): Layer {
  const shown = putValue(l, v);
  if (!shown) return l;
  return shown.kind === "barcode" || shown.kind === "qr" ? { ...shown, format: undefined } : shown;
}

/** One value into one layer, validated per kind. */
function applyValue(l: Layer, v: LayerValue): Result {
  const layer = putValue(l, v);
  if (!layer) {
    return { error: l.kind === "text" ? "Expected text." : l.kind === "image" ? "Expected an image." : "Expected a code value." };
  }
  // ponytail: validateField still speaks FieldDecl; build one on the fly.
  if (layer.kind === "text" && layer.input) {
    const r = validateField({ id: l.id, label: l.name, kind: layer.input, path: "",
      min: layer.min, max: layer.max, symbology: layer.symbology }, plainText(layer.lines));
    if (!r.ok) return { error: r.error! };
  }
  // A literal code is checked here so a bad one keeps the master's value; a
  // template ("{textId}") can only be judged once expanded — resolveLayers'
  // post-expansion check covers it, and every other tier's value too.
  if (layer.kind === "barcode" && !fieldRefs(layer.value).length) {
    const r = validateFor(layer.symbology, layer.value);
    if (!r.ok) return { error: r.error! };
  }
  return { layer };
}

/** Lines as one plain string: runs joined with their markers stripped. */
export const plainText = (lines: TextLine[]): string =>
  lines.map((l) => parseRuns(l).map((r) => r.text).join("")).join(" ");

/** What the tab strip and export names call the document: the `name` text
 *  layer's filled text, if the master has one. */
export function titleOf(layers: Layer[]): string {
  const name = layers.find((l) => l.id === "name");
  return name?.kind === "text" ? plainText(name.lines).trim() : "";
}

/** Filename stem for every export (PDF, PSD, and their mask plates): the
 *  title slugged the way the QR URL is. One fallback, so an unnamed label
 *  is "label.*" in the app and the CLI alike. */
export const exportBase = (layers: Layer[]): string => machineName(titleOf(layers)) || "label";

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
  // Validate the code the renderer will actually draw, whichever tier (master,
  // variant, override, label) supplied it — prepareBarcode silently drops an
  // invalid one, so this error is what blocks export instead (#94). Blank is
  // "not filled yet" and a switched-off layer never draws: neither blocks.
  for (const l of layers) {
    if (l.kind !== "barcode" || l.enabled === false || !l.value.trim() || errors[l.id]) continue;
    const r = validateFor(l.symbology, l.value);
    if (!r.ok) errors[l.id] = r.error!;
  }
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
