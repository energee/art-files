import { isPlain } from "./merge";
// src/model/convert.ts — pure converters from the old model to the v3 layer
// model (spec 2026-09-04: Migration). Two entry points:
//   convertLabelV2   v2 .label (field values + LabelConfig overrides) → LabelFile
//   convertConfigV1  v1 embedded LabelConfig → LabelFile, via the v2 shape
// A v1 config has no master at all: it converts onto the master it opens
// against. (v1 .master files are refused at open; see model/files.ts.)
// Everything that has no v3 home (format strings, unknown config keys) is
// dropped and reported in `warnings` — never silently.
import type { CustomLayer, LabelConfig, Style, StyledLine } from "../types";
import type { FieldValue, LabelFileV2 } from "./types";
import type { Guides, LabelFile, Layer, LayerValue, Master, RelativeY, TextLine } from "./layers";
import type { DeepPartial } from "./merge";
import type { GuideLines } from "./position";
import type { FontFamilyId } from "../fontCatalog";
import { foldScale } from "./layers";
import { parseDescription } from "../description";
import { defaultConfig, stripPercent } from "../defaults";

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
const v3Id = (fid: string) => FIELD_RENAMES[fid] ?? fid;
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
    // The old slot scale multiplied the drawn size; v3 has only w/h.
    if (p.scale !== undefined) foldScale(Object.assign(out, { scale: p.scale }));
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
  for (const k of ["asset", "value", "tintRaster"] as const)
    if (p[k] !== undefined) o[k] = applied[k];
  // A scale arrives as the size it drew at (applyPatch folded it).
  if (p.scale !== undefined && applied.kind === "image") {
    o.w = applied.w;
    if (applied.h !== undefined) o.h = applied.h;
  }
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
  c: OldCustomStyle, kind: CustomLayer["type"], g: ReturnType<typeof guideLines>,
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

// --- Label ----------------------------------------------------------------

const layerIn = (master: Master, id: string): Layer | undefined =>
  master.layers.find((l) => l.id === id)
  ?? master.variants.flatMap((v) => Object.values(v.layers) as Layer[]).find((l) => l.id === id && !!l.kind);

/** An old FieldValue → the layer's LayerValue: text is laid as lines in the
 *  layer's style (with the label's own restyle applied), everything else is
 *  the string it was. A number layer drops the trailing "%" an old ABV could
 *  carry ("6.5%"), which would otherwise fail its number validation. */
function toLayerValue(layer: Layer, v: FieldValue, p: ElementPatch | undefined, warnings: string[]): LayerValue | undefined {
  if (typeof v === "boolean") { warnings.push(`Value for "${layer.id}" is on/off, which no v3 layer takes; dropped.`); return undefined; }
  const s = String(v);
  if (layer.kind !== "text") return s;
  return textLines(layer.id, layer.input === "number" ? stripPercent(s) : s, { ...layer.style, ...p?.style }, p?.bold);
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
  // Benched under the v3 layer id (v3Id), so a later rebind onto a
  // master with that layer finds it — for live values the master lacks and
  // for the old bench alike.
  const bench = (fid: string, v: FieldValue) => {
    if (typeof v === "boolean") warnings.push(`Dormant on/off value "${fid}" dropped.`);
    else dormant[v3Id(fid)] = String(v);
  };
  for (const [fid, v] of Object.entries(old.values)) {
    const id = v3Id(fid);
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
  // whole layer, which resolveLayers appends (the old composeConfig rule).
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
 *  override set and its filled fields the values, through the v2 shape,
 *  converted onto `master` (the open tab's, or the CLI's). Values for layers
 *  it lacks are benched, and so is the Collab checkbox when it has no
 *  `collab` variant, for a master that has them. */
export function convertConfigV1(cfg: LabelConfig, collabEnabled: boolean, master: Master): { label: LabelFile; warnings: string[] } {
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
  const collab = collabEnabled ? ["collab"] : [];
  const hasCollab = master.variants.some((v) => v.id === "collab");
  return convertLabelV2({
    formatVersion: 2, masterId: master.id, enabledVariants: hasCollab ? collab : [],
    values, ...(Object.keys(diff).length ? { overrides: diff as LabelFileV2["overrides"] } : {}),
    ...(!hasCollab && collab.length ? { dormant: { values: {}, variants: collab } } : {}),
  }, master);
}
