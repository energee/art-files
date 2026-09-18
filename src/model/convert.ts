// src/model/convert.ts — pure converters from the old model to the v3 layer
// model (spec 2026-09-04: Migration). Three entry points:
//   convertMasterV1  v1 .master (layers + defaults + fields + variants) → Master
//   convertLabelV2   v2 .label (field values + LabelConfig overrides) → LabelFile
//   convertConfigV1  v1 embedded LabelConfig → LabelFile, via the v2 shape
// A built-in Lolev id (name, logo, barcode, …) takes its kind, position and
// default content from the v3 Lolev table (model/lolevLayers.ts); whatever
// the old file's `defaults` said about that element overrides the table.
// Everything that has no v3 home (format strings, unknown config keys) is
// dropped and reported in `warnings` — never silently.
import type { CustomLayer, LabelConfig, Style, StyledLine } from "../types";
import type {
  FieldDecl, FieldValue, LabelFileV2, Master as MasterV1, MasterLayer, Variant as VariantV1,
} from "./types";
import type {
  Guides, LabelFile, Layer, LayerValue, Master, RelativeY, TextLayer, TextLine, Variant,
} from "./layers";
import { isPlain, type DeepPartial } from "./merge";
import type { GuideLines } from "./position";
import type { FontFamilyId } from "../fontCatalog";
import { lolevMaster } from "./lolevLayers";
import { parseDescription } from "../description";
import { segments } from "./format";
import { defaultConfig } from "../defaults";

// --- Old config keys → element patches ------------------------------------

/** What one old LabelConfig entry says about one v3 layer, kind-agnostic:
 *  the two converters turn this into a whole layer (master) or a partial
 *  override (label) with the same rules. */
interface ElementPatch {
  style?: Partial<Style>; text?: string; bold?: boolean;
  asset?: string; value?: string; dy?: number; locked?: boolean;
  scale?: number; tintRaster?: boolean;
}

/** Old Style / StyledLine / Positioned / CollabSlot keys → the layer id. */
const STYLE_OF: Record<string, string> = {
  nameStyle: "name", abvStyle: "abv", descStyle: "description", wordmark: "wordmark",
  warning: "warning", collabLead: "collabLead", logo: "logo", collabLeft: "collabLeft",
  collabCenter: "collabCenter", styleLine: "styleLine", volume: "volume",
  handleAddress: "handleAddress", storeCold: "storeCold",
};
/** Old plain-string content keys → the text layer they fill. */
const TEXT_OF: Record<string, string> = { beerName: "name", abv: "abv", description: "description" };
/** The barcode's and QR's flat style keys → (layer id, Style key). */
const FLAT_OF: Record<string, [string, keyof Style]> = {
  barcodeFill: ["barcode", "fill"], barcodeStroke: ["barcode", "stroke"],
  barcodeStrokeWidth: ["barcode", "strokeWidth"], barcodeLayer: ["barcode", "layer"],
  barcodeStrokeLayer: ["barcode", "strokeLayer"],
  qrFill: ["qr", "fill"], qrStroke: ["qr", "stroke"], qrStrokeWidth: ["qr", "strokeWidth"],
  qrLayer: ["qr", "layer"], qrStrokeLayer: ["qr", "strokeLayer"],
};
const STYLE_KEYS = new Set<keyof Style>(["fill", "layer", "stroke", "strokeLayer", "strokeWidth", "letterSpacing"]);
/** The one old text that was a multi-line markdown block. */
const MULTILINE = new Set(["description"]);
/** Old field ids that were not their layer's id. */
const FIELD_RENAMES: Record<string, string> = { style: "styleLine", upc: "barcode" };
/** Old FieldDecl paths → the layer they filled (generic fields start with
 *  their layer id instead). */
const PATH_LAYER: Record<string, string> = {
  beerName: "name", "styleLine.text": "styleLine", abv: "abv", description: "description",
  upc: "barcode", "collabLeft.image": "collabLeft", "collabCenter.image": "collabCenter",
};

/** Everything in `cfg` that differs from `base`, deep for plain objects,
 *  wholesale for arrays and leaves. A key present in `base` but absent from
 *  `cfg` (a legacy config's unset barcodeStrokeWidth — defaults.ts) comes
 *  back as `null`, not skipped, so elementPatches can report the removal;
 *  null rather than undefined because JSON.stringify would drop the key.
 *  {} = no deviations. */
function configDiff(base: LabelConfig, cfg: LabelConfig): DeepPartial<LabelConfig> {
  return (diffValue(base, cfg) ?? {}) as DeepPartial<LabelConfig>;
}

/** configDiff's engine, over any two plain values — `undefined` when they match. */
function diffValue(b: unknown, c: unknown): unknown {
  if (isPlain(b) && isPlain(c)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(b)) {
      if (!(k in c)) { out[k] = null; continue; }
      const d = diffValue(b[k], c[k]);
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

/** Sort an old DeepPartial<LabelConfig> into per-layer patches. Keys with no
 *  v3 home come back in `unknown` for the caller to consume (custom-layer
 *  styling lives at `defaults[layerId]`) or warn about. A `null` leaf is
 *  configDiff's "unset" marker: v3 patches cannot express removal, so it is
 *  reported and the master's value stands. */
function elementPatches(patch: Record<string, unknown>): {
  byId: Record<string, ElementPatch>; custom: CustomLayer[]; fontFamily?: FontFamilyId;
  unknown: string[]; warnings: string[];
} {
  const byId: Record<string, ElementPatch> = {};
  const at = (id: string) => (byId[id] ??= {});
  const unknown: string[] = [];
  const warnings: string[] = [];
  let custom: CustomLayer[] = [];
  let fontFamily: FontFamilyId | undefined;
  const unset = (k: string) => warnings.push(`"${k}" was unset in the old file; the master's value stands.`);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) { unset(k); continue; }
    if (k === "fontFamily") fontFamily = v as FontFamilyId;
    else if (k === "customLayers") custom = Array.isArray(v) ? (v as CustomLayer[]) : [];
    else if (k in TEXT_OF) at(TEXT_OF[k]).text = String(v);
    else if (k === "upc") at("barcode").value = String(v);
    else if (k in FLAT_OF) {
      const [id, key] = FLAT_OF[k];
      (at(id).style ??= {})[key] = v as never;
    } else if (k in STYLE_OF && isPlain(v)) {
      const p = at(STYLE_OF[k]);
      for (const [sk, sv] of Object.entries(v)) {
        if (sv === undefined) continue;
        if (sv === null) unset(`${k}.${sk}`);
        else if (STYLE_KEYS.has(sk as keyof Style)) (p.style ??= {})[sk as keyof Style] = sv as never;
        else if (sk === "text") p.text = String(sv);
        else if (sk === "bold") p.bold = !!sv;
        else if (sk === "offsetY") { if (sv) p.dy = Number(sv); }
        else if (sk === "locked") p.locked = !!sv;
        else if (sk === "image") p.asset = String(sv);
        else if (sk === "scale") p.scale = Number(sv);
        else if (sk === "tintRaster") p.tintRaster = !!sv;
        else unknown.push(`${k}.${sk}`);
      }
    } else unknown.push(k);
  }
  return { byId, custom, fontFamily, unknown, warnings };
}

// --- Lines -----------------------------------------------------------------

const line = (text: string, s: Style, bold?: boolean): TextLine =>
  ({ text, fill: s.fill, layer: s.layer, ...(bold ? { bold: true } : {}) });

/** Old text → v3 lines. The description was the one markdown block (header
 *  line + `_white_` / `**bold**` lines); every other text was one line whose
 *  inline markers v3 keeps verbatim in the run text. */
function textLines(id: string, text: string, base: Style, bold?: boolean): TextLine[] {
  if (!MULTILINE.has(id)) return [line(text, base, bold)];
  const d = parseDescription(text, base);
  return [
    ...(d.header ? [{ ...line(d.header.text, base), header: true }] : []),
    ...d.lines.map((l) => line(l.text, { ...base, layer: l.layer }, l.bold)),
  ];
}

const shiftY = (y: number | RelativeY, dy: number): number | RelativeY =>
  typeof y === "number" ? y + dy : { ...y, gap: y.gap + dy };

/** Apply one element patch to a whole layer. A restyle reaches the lines
 *  too (a run's own fill/layer wins over the block style at render time),
 *  and new text is re-laid as lines in the merged style. */
function applyPatch(layer: Layer, p: ElementPatch | undefined): Layer {
  if (!p) return layer;
  const out = { ...layer } as Layer;
  if (p.style) out.style = { ...layer.style, ...p.style };
  if (p.dy) out.y = shiftY(out.y, p.dy);
  if (p.locked !== undefined) out.locked = p.locked;
  if (out.kind === "text") {
    if (p.text !== undefined) out.lines = textLines(out.id, p.text, out.style, p.bold);
    else if (p.style || p.bold !== undefined) {
      out.lines = out.lines.map((l) => {
        const bold = p.bold ?? l.bold;
        const { bold: _b, ...rest } = l;
        return { ...rest, fill: out.style.fill, layer: out.style.layer, ...(bold ? { bold: true } : {}) };
      });
    }
  } else if (out.kind === "image") {
    if (p.asset !== undefined) out.asset = p.asset;
    if (p.scale !== undefined) out.scale = p.scale;
    if (p.tintRaster !== undefined) out.tintRaster = p.tintRaster;
  } else if (out.kind === "barcode" && p.value !== undefined) out.value = p.value;
  return out;
}

/** The label-side twin of applyPatch: only the keys the patch touched.
 *
 *  A restyle has to reach a text layer's LINES, because a run's own fill wins
 *  over the block style — a `style.fill` override alone would never change
 *  the drawn runs. Where the label carries a VALUE for the layer, that value
 *  holds the restyled lines instead (convertLabelV2 styles it with the same
 *  patch) and writing them here too would duplicate the content. `hasValue`
 *  says which case this is; it used to be spelled `base.fillable`, which was
 *  only ever a proxy for the same question. */
function overrideFrom(base: Layer, p: ElementPatch, hasValue = false): DeepPartial<Layer> {
  const applied = applyPatch(base, p) as Layer & Record<string, unknown>;
  const o: Record<string, unknown> = {};
  if (p.style) o.style = p.style;
  if (p.dy) o.y = applied.y;
  if (p.locked !== undefined) o.locked = p.locked;
  if (base.kind === "text") {
    const restyled = p.style?.fill !== undefined || p.style?.layer !== undefined;
    if (p.text !== undefined || p.bold !== undefined || (restyled && !hasValue)) o.lines = applied.lines;
  }
  for (const k of ["asset", "value", "scale", "tintRaster"] as const)
    if (p[k] !== undefined) o[k] = applied[k];
  return o as DeepPartial<Layer>;
}

// --- Custom (kind-bearing) layers -----------------------------------------

/** The guide lines a master's anchored positions resolve against, from its
 *  own physical size and guides (page-absolute points, bleed included). Used
 *  by the converters here and by App's drag snapping (moveBy). */
export function guideLines(m: { physical: Master["physical"]; guides: Guides }): GuideLines {
  const bleed = m.physical.bleedIn * 72;
  const w = m.physical.labelWidthIn * 72;
  const h = m.physical.labelHeightIn * 72;
  const g = m.guides;
  return {
    left: bleed + (g.left ?? 0), right: w - bleed - (g.right ?? 0), center: w / 2,
    top: bleed + (g.top ?? 0), bottom: h - bleed - (g.bottom ?? 0),
  };
}

type OldCustomStyle = Omit<CustomLayer, "id" | "name"> & { locked?: boolean };

/** An old CustomLayer (its stored styling plus the MasterLayer's policy) →
 *  a v3 layer: anchor/vAnchor/offsets over the guides become x/y numbers. */
function customToLayer(
  id: string, name: string, enabled: boolean, locked: boolean | undefined,
  c: OldCustomStyle, kind: NonNullable<MasterLayer["kind"]>, g: ReturnType<typeof guideLines>,
): Layer {
  const pos = c.position;
  const base = {
    id, name, enabled, anchor: pos.anchor,
    x: (pos.anchor === "left" ? g.left : pos.anchor === "center" ? g.center : g.right) + pos.offsetX,
    y: (pos.vAnchor === "top" ? g.top : g.bottom) + pos.offsetY,
    ...(pos.vAnchor === "bottom" ? { vAnchor: "bottom" as const } : {}),
    ...((locked ?? c.locked) !== undefined ? { locked: locked ?? c.locked } : {}),
  };
  switch (kind) {
    case "text": {
      const t = c as Extract<CustomLayer, { type: "text" }>;
      const { text, bold, ...style } = t.line as StyledLine;
      return { ...base, kind: "text", lines: [line(text, style, bold)], size: t.size, align: pos.anchor, style };
    }
    case "image": {
      const i = c as Extract<CustomLayer, { type: "image" }>;
      return { ...base, kind: "image", asset: i.asset, w: i.w,
        ...(i.aspect ? { h: i.w / i.aspect } : {}), style: i.style };
    }
    case "barcode": {
      const b = c as Extract<CustomLayer, { type: "barcode" }>;
      return { ...base, kind: "barcode", symbology: b.symbology, value: b.value, h: b.h,
        moduleW: b.moduleW, ...(b.showDigits !== undefined ? { showDigits: b.showDigits } : {}),
        style: b.style };
    }
    case "qr": {
      const q = c as Extract<CustomLayer, { type: "qr" }>;
      return { ...base, kind: "qr", value: q.value, size: q.size, qrStyle: q.qrStyle,
        ...(q.ecLevel ? { ecLevel: q.ecLevel } : {}), style: q.style };
    }
  }
}

// --- Fields → fillable ----------------------------------------------------

function fieldLayerId(f: FieldDecl, ids: Set<string>): string | undefined {
  if (PATH_LAYER[f.path]) return PATH_LAYER[f.path];
  const head = f.path.split(".")[0];
  if (ids.has(head)) return head;
  return ids.has(f.id) ? f.id : undefined;
}

/** What a FieldDecl adds to its layer: `fillable`, the Fill-mode widget hint
 *  for number/code text inputs, and a `{id}<literal>` format's literal as
 *  the suffix — v3 has no format strings, so any other format is dropped. */
function fillableProps(f: FieldDecl, kind: Layer["kind"], warnings: string[]): Partial<TextLayer> {
  const p: Partial<TextLayer> = {};
  if (kind === "text") {
    if (f.kind === "number") {
      p.input = "number";
      if (f.min !== undefined) p.min = f.min;
      if (f.max !== undefined) p.max = f.max;
    } else if (f.kind === "code") {
      p.input = "code";
      p.symbology = f.symbology ?? "upc-a";
    } else if (f.kind === "select" || f.kind === "toggle") {
      warnings.push(`Field "${f.id}" (${f.kind}) has no v3 widget; it fills as text.`);
    }
  }
  if (f.format) {
    const s = segments(f.format);
    const suffixOnly = kind === "text" && s.length === 2 && "id" in s[0] && s[0].id === f.id
      && !s[0].tr && "lit" in s[1];
    if (suffixOnly) p.suffix = (s[1] as { lit: string }).lit;
    else warnings.push(`Field "${f.id}" format "${f.format}" dropped: v3 has no format strings — author fixed text in the layer's lines.`);
  }
  return p;
}

// --- Master ---------------------------------------------------------------

export function convertMasterV1(old: MasterV1): { master: Master; warnings: string[] } {
  const warnings: string[] = [];
  const table = lolevMaster();
  const tableLayers = new Map<string, Layer>(
    [...table.layers, ...(Object.values(table.variants[0].layers) as Layer[])].map((l) => [l.id, l]));
  const g = guideLines(old);
  const defaults = old.defaults as Record<string, unknown>;
  const dp = elementPatches(defaults);
  warnings.push(...dp.warnings);

  const oldLayers: { l: MasterLayer; owner?: string; appended?: boolean }[] = [
    ...old.layers.map((l) => ({ l, owner: l.variant })),
    ...old.variants.flatMap((v) => (v.layers ?? []).map((l) => ({ l, owner: v.id, appended: true }))),
  ];
  const ids = new Set(oldLayers.map((x) => x.l.id));
  const consumed = new Set<string>();

  /** One old layer → one whole v3 layer, or undefined (warned). */
  const convert = (l: MasterLayer, patches: Record<string, ElementPatch>, styleSrc: Record<string, unknown>[]): Layer | undefined => {
    let layer: Layer;
    if (l.kind) {
      const src = styleSrc.find((s) => isPlain(s[l.id]));
      if (!src) { warnings.push(`Layer "${l.id}" has no stored styling; dropped.`); return undefined; }
      consumed.add(l.id);
      layer = customToLayer(l.id, l.name, l.enabled, l.locked, src[l.id] as OldCustomStyle, l.kind, g);
    } else {
      const t = tableLayers.get(l.id);
      if (!t) { warnings.push(`Layer "${l.id}" is not a Lolev element and has no kind; dropped.`); return undefined; }
      layer = applyPatch(structuredClone(t), patches[l.id]);
      layer = { ...layer, name: l.name, enabled: l.enabled, ...(l.locked !== undefined ? { locked: l.locked } : {}) };
    }
    return layer;
  };

  // Master layers: background and mask first (every v3 master has them),
  // then the old draw order minus the variant-owned layers.
  const layers: Layer[] = [];
  for (const id of ["background", "mask"]) if (!ids.has(id)) layers.push(structuredClone(tableLayers.get(id)!));
  for (const { l, owner } of oldLayers) {
    if (owner) continue;
    const c = convert(l, dp.byId, [defaults]);
    if (c) layers.push(c);
  }
  // ponytail: a legacy raw `defaults.customLayers` array (pre-Task-5b
  // masters) appends after the built-ins, where the v1 resolver placed it.
  for (const c of dp.custom) {
    if (ids.has(c.id)) { warnings.push(`Legacy custom layer "${c.id}" collides with a layer id; dropped.`); continue; }
    layers.push(customToLayer(c.id, c.name, true, c.locked, c, c.type, g));
  }

  const variants: Variant[] = old.variants.map((v: VariantV1) => {
    const diff: Record<string, DeepPartial<Layer>> = {};
    const vp = elementPatches(v.overrides as Record<string, unknown>);
    warnings.push(...vp.warnings);
    const styleSrc = [v.overrides as Record<string, unknown>, defaults];
    for (const { l, owner } of oldLayers) {
      if (owner !== v.id) continue;
      const c = convert(l, { ...dp.byId, ...vp.byId }, styleSrc);
      if (c) diff[l.id] = c;
    }
    for (const c of vp.custom) {
      if (ids.has(c.id) || diff[c.id]) { warnings.push(`Legacy custom layer "${c.id}" collides with a layer id; dropped.`); continue; }
      diff[c.id] = customToLayer(c.id, c.name, true, c.locked, c, c.type, g);
    }
    for (const [id, p] of Object.entries(vp.byId)) {
      if (diff[id]) continue; // a variant-owned layer already took its patch
      const base = layers.find((l) => l.id === id);
      if (!base) { warnings.push(`Variant "${v.id}" styles unknown layer "${id}"; dropped.`); continue; }
      diff[id] = overrideFrom(base, p);
    }
    for (const [id, p] of Object.entries(v.layerOverrides)) {
      const { name, enabled, locked } = p;
      const policy = { ...(name !== undefined ? { name } : {}), ...(enabled !== undefined ? { enabled } : {}),
        ...(locked !== undefined ? { locked } : {}) };
      if (!layers.some((l) => l.id === id) && !diff[id]) { warnings.push(`Variant "${v.id}" overrides unknown layer "${id}"; dropped.`); continue; }
      diff[id] = { ...diff[id], ...policy };
    }
    for (const k of vp.unknown) if (!consumed.has(k)) warnings.push(`Variant "${v.id}" override "${k}" has no v3 home; dropped.`);
    if (vp.fontFamily) warnings.push(`Variant "${v.id}" fontFamily dropped: the font is a master setting.`);
    return { id: v.id, name: v.name, layers: diff };
  });
  for (const k of dp.unknown) if (!consumed.has(k)) warnings.push(`Master default "${k}" has no v3 home; dropped.`);

  // Fields: each one marks its layer fillable (and its widget). A variant's
  // field on a master layer records as a partial in that variant's diff.
  const layerIds = new Set([...layers.map((l) => l.id), ...variants.flatMap((v) => Object.keys(v.layers))]);
  const mark = (f: FieldDecl, owner: Variant | undefined) => {
    const id = fieldLayerId(f, layerIds);
    if (!id) { warnings.push(`Field "${f.id}" (path "${f.path}") matches no layer; dropped.`); return; }
    const inMaster = layers.find((l) => l.id === id);
    const inOwner = owner?.layers[id];
    const target = (inOwner ?? inMaster) as Layer | undefined;
    const kind = (target ?? variants.flatMap((v) => Object.values(v.layers)).find((l) => l.id === id))?.kind ?? "text";
    const props = fillableProps(f, kind as Layer["kind"], warnings);
    if (owner && !inOwner) owner.layers[id] = { ...owner.layers[id], ...props } as DeepPartial<Layer>;
    else if (target) Object.assign(target, props);
    else { const v = variants.find((x) => x.layers[id]); Object.assign(v!.layers[id], props); }
  };
  for (const f of old.fields) mark(f, undefined);
  for (const v of old.variants) for (const f of v.fields ?? []) mark(f, variants.find((x) => x.id === v.id));

  const master: Master = {
    formatVersion: 3, id: old.id, name: old.name, physical: old.physical, guides: old.guides,
    ...(dp.fontFamily ? { fontFamily: dp.fontFamily } : {}),
    layers, variants,
  };
  return { master, warnings };
}

// --- Label ----------------------------------------------------------------

const layerIn = (master: Master, id: string): Layer | undefined =>
  master.layers.find((l) => l.id === id)
  ?? master.variants.flatMap((v) => Object.values(v.layers) as Layer[]).find((l) => l.id === id && !!l.kind);

/** An old FieldValue → the layer's LayerValue: text is laid as lines in the
 *  layer's style (with the label's own restyle applied), everything else is
 *  the string it was. */
function toLayerValue(layer: Layer, v: FieldValue, p: ElementPatch | undefined, warnings: string[]): LayerValue | undefined {
  if (typeof v === "boolean") { warnings.push(`Value for "${layer.id}" is on/off, which no v3 layer takes; dropped.`); return undefined; }
  if (layer.kind !== "text") return String(v);
  return textLines(layer.id, String(v), { ...layer.style, ...p?.style }, p?.bold);
}

export function convertLabelV2(old: LabelFileV2, master: Master): { label: LabelFile; warnings: string[] } {
  const warnings: string[] = [];
  const g = guideLines(master);
  const op = elementPatches((old.overrides ?? {}) as Record<string, unknown>);
  warnings.push(...op.warnings);
  // Values first: an override only carries restyled LINES for a layer with no
  // value of its own (see overrideFrom), so the values must be known before
  // the overrides are built.
  const values: Record<string, LayerValue> = {};
  const dormant: Record<string, LayerValue> = {};
  const bench = (id: string, v: FieldValue) => {
    if (typeof v === "boolean") warnings.push(`Dormant on/off value "${id}" dropped.`);
    else dormant[id] = String(v);
  };
  for (const [fid, v] of Object.entries(old.values)) {
    const id = FIELD_RENAMES[fid] ?? fid;
    const layer = layerIn(master, id);
    if (!layer) { bench(fid, v); continue; }
    const lv = toLayerValue(layer, v, op.byId[id], warnings);
    if (lv !== undefined) values[id] = lv;
  }

  const overrides: Record<string, DeepPartial<Layer>> = {};
  for (const [id, p] of Object.entries(op.byId)) {
    const base = layerIn(master, id);
    if (!base) { warnings.push(`Override for "${id}" matches no layer; dropped.`); continue; }
    overrides[id] = overrideFrom(base, p, values[id] !== undefined);
  }
  // A per-label custom layer has no master row to override: it rides as a
  // whole layer, which resolveLayers appends after the master's rows.
  for (const c of op.custom) overrides[c.id] = customToLayer(c.id, c.name, true, c.locked, c, c.type, g);
  for (const k of op.unknown) warnings.push(`Override "${k}" has no v3 home; dropped.`);
  if (op.fontFamily) warnings.push("fontFamily dropped: the font is a master setting.");
  for (const [id, v] of Object.entries(old.dormant?.values ?? {})) bench(id, v);
  const dormantVariants = old.dormant?.variants ?? [];
  const label: LabelFile = {
    formatVersion: 3, masterId: old.masterId,
    ...(old.masterHint !== undefined ? { masterHint: old.masterHint } : {}),
    enabledVariants: [...old.enabledVariants], values,
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(Object.keys(dormant).length || dormantVariants.length
      ? { dormant: { values: dormant, variants: [...dormantVariants] } } : {}),
  };
  return { label, warnings };
}

/** A v1 embedded-config label: its deviations from defaultConfig() are the
 *  override set and its filled fields the values, through the v2 shape. */
export function convertConfigV1(cfg: LabelConfig, collabEnabled: boolean): { label: LabelFile; warnings: string[] } {
  const diff = configDiff(defaultConfig(), cfg) as Record<string, unknown>;
  for (const k of ["beerName", "abv", "description", "upc"]) delete diff[k];
  for (const [k, sub] of [["styleLine", "text"], ["collabLeft", "image"], ["collabCenter", "image"]]) {
    const o = diff[k];
    if (!isPlain(o)) continue;
    delete o[sub];
    if (!Object.keys(o).length) delete diff[k];
  }
  const values: Record<string, FieldValue> = {
    name: cfg.beerName, style: cfg.styleLine.text, abv: cfg.abv,
    description: cfg.description, upc: cfg.upc,
    ...(cfg.collabLeft.image ? { collabLeft: cfg.collabLeft.image } : {}),
    ...(cfg.collabCenter.image ? { collabCenter: cfg.collabCenter.image } : {}),
  };
  return convertLabelV2({
    formatVersion: 2, masterId: "lolev", enabledVariants: collabEnabled ? ["collab"] : [],
    values, ...(Object.keys(diff).length ? { overrides: diff as LabelFileV2["overrides"] } : {}),
  }, lolevMaster());
}
