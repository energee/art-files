import { FONT_FAMILIES } from "../fontCatalog";
// src/model/files.ts — v3 .master / .label file containers. Same ZIP layout
// as before: master.json or label.json plus the asset role directories
// labelfile.ts's packAssets/extractAssets own (texture/<name>, mask/<name>,
// custom/<assetId>/<name>), so the two containers cannot drift. Opening
// converts on the way in (a v1 master.json through convertMasterV1; a v2
// label.json is handed back as `v2` because it needs the master to convert;
// a v1 config.json comes back raw for parseConfigFile + convertConfigV1) and
// saving always writes v3. The legacy '{' sniff for JSON-only .master files
// stays. Replaces the v1 .master packer and the v2 half of src/labelfile.ts.
import { strFromU8, strToU8, zipSync, type Zippable } from "fflate";
import type { LabelFile, Master } from "./layers";
import { parseMaster, validateLayer, type Layer, type LayerValue } from "./layers";
import { applyDiff } from "./resolveLayers";
import type { LabelFileV2 } from "./types";
import { parseMaster as parseMasterV1 } from "./types";
import { parseLabelFile } from "./labelfile";
import { convertMasterV1 } from "./convert";
import { unpackArchive, extractAssets, legacyJsonText, packAssets, type LabelAssets } from "../labelfile";

/** The template assets a master carries: the master-owned subset of the
 *  .label roles. A label's own embedded art always wins over the master's. */
export type MasterAssets = Pick<LabelAssets, "texture" | "mask" | "customImages">;

export const MASTER_EXT = ".master";

// --- .master --------------------------------------------------------------

export function serializeMaster(m: Master): string {
  return JSON.stringify(m, null, 2);
}

/** A master.json of either generation → v3. A v1 file converts (with the
 *  converter's warnings); anything else must already be v3 and goes through
 *  parseMaster's own loud fail(). */
export function parseMasterJson(json: unknown): { master: Master; warnings: string[] } {
  if ((json as { formatVersion?: unknown } | null)?.formatVersion === 1)
    return convertMasterV1(parseMasterV1(json));
  return { master: parseMaster(json), warnings: [] };
}

/** The display name a master forked by Save Master As… takes: the file the
 *  user just named it, minus directories and extension. Without it the library
 *  would list two masters called "Lolev" — there is no master-name field
 *  anywhere in the UI to tell them apart afterwards. Empty for a path with no
 *  usable basename, which the caller reads as "keep the name you had".
 *  Accepts a POSIX path, a Windows path, or a bare file name. */
export function masterNameFromFile(file: string): string {
  return file.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "").trim() ?? "";
}

export function packMaster(m: Master, assets: MasterAssets): Uint8Array {
  const zip: Zippable = { "master.json": strToU8(serializeMaster(m)) };
  packAssets(zip, assets);
  return zipSync(zip);
}

export function unpackMaster(bytes: Uint8Array): { master: Master; assets: MasterAssets; warnings: string[] } {
  const legacy = legacyJsonText(bytes); // a legacy JSON-only master, no assets
  if (legacy !== undefined) return { ...parseMasterJson(JSON.parse(legacy)), assets: {} };
  const entries = unpackArchive(bytes);
  const entry = entries["master.json"];
  if (!entry) throw new Error("Not a .master file: missing master.json");
  return { ...parseMasterJson(JSON.parse(strFromU8(entry))), assets: extractAssets(entries) };
}

// --- .label ---------------------------------------------------------------

export function serializeLabel(l: LabelFile): string {
  return JSON.stringify(l, null, 2);
}

function badLabel(msg: string): never { throw new Error(`Invalid label file: ${msg}`); }

/** A JSON object (not null, not an array). */
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Only the strings of an untrusted array; anything else becomes []. */
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** A stored value is a string or text lines whose `text` is a string —
 *  the two shapes resolveLayers' putValue can place (#392). */
function parseValues(v: unknown): Record<string, LayerValue> {
  if (!isRecord(v)) return {};
  for (const [id, val] of Object.entries(v)) {
    const ok = typeof val === "string"
      || (Array.isArray(val) && val.every((ln) => isRecord(ln) && typeof ln.text === "string"));
    if (!ok) badLabel(`value for "${id}" is not text or a string`);
  }
  return v as Record<string, LayerValue>;
}

/** Override keys the renderer does geometry with: a finite number, or null
 *  (applyDiff's "delete this key"). */
const NUMERIC_KEYS = ["x", "size", "leading", "headerScale", "width", "min", "max", "w", "h", "scale", "moduleW"];

/** Overrides by layer id (#392). A patch carrying `kind` is a whole added
 *  layer: it must name its own id, and the layer resolveLayers builds from it
 *  (applyDiff, so a null-cleared optional field is simply absent) must pass
 *  validateLayer like a master's. Any other patch is a partial diff, so only
 *  its geometry and font are checked. */
function parseOverrides(v: unknown): LabelFile["overrides"] {
  if (v == null) return undefined;
  if (!isRecord(v)) badLabel("overrides is not an object");
  for (const [id, p] of Object.entries(v)) {
    if (!isRecord(p)) badLabel(`override "${id}" is not an object`);
    const family = p.fontFamily;
    if (family != null && (typeof family !== "string" || !Object.hasOwn(FONT_FAMILIES, family)))
      throw new Error(`Unknown label font family: ${family}`);
    if (p.kind !== undefined) {
      if (p.id !== id) badLabel(`added layer "${id}" has a mismatched id`);
      try { validateLayer(applyDiff({} as Layer, p as never), "label override"); }
      catch (err) { badLabel((err as Error).message.replace(/^Invalid master file: /, "")); }
      continue;
    }
    for (const k of NUMERIC_KEYS)
      if (p[k] != null && !Number.isFinite(p[k])) badLabel(`override "${id}" has invalid ${k}`);
    const y = p.y;
    if (y != null && !Number.isFinite(y) && !(isRecord(y) && typeof y.below === "string" && Number.isFinite(y.gap)))
      badLabel(`override "${id}" has invalid y`);
  }
  return v as LabelFile["overrides"];
}

function parseDormant(v: unknown): LabelFile["dormant"] {
  if (!v || typeof v !== "object") return undefined;
  const d = v as Record<string, unknown>;
  return {
    values: parseValues(d.values),
    variants: strings(d.variants),
    ...(Array.isArray(d.variantOrder) && d.variantOrder.every((id) => typeof id === "string")
      ? { variantOrder: d.variantOrder as string[] } : {}),
  };
}

/** A label.json of any generation: v3 parses here; v2 comes back tagged
 *  (convertLabelV2 needs the master); `{version: 1}` is tagged legacy for
 *  parseConfigFile + convertConfigV1. */
export function parseLabel(json: unknown): LabelFile | { v2: LabelFileV2 } | { legacy: unknown } {
  if (!json || typeof json !== "object") throw new Error("Not a label file.");
  const o = json as Record<string, unknown>;
  if (o.formatVersion === 2) return { v2: parseLabelFile(json) as LabelFileV2 };
  if (o.formatVersion !== 3) return { legacy: json };
  if (typeof o.masterId !== "string" || !o.masterId) throw new Error("Label file is missing its masterId.");
  const dormant = parseDormant(o.dormant);
  const overrides = parseOverrides(o.overrides);
  return {
    formatVersion: 3,
    masterId: o.masterId,
    ...(typeof o.masterHint === "string" ? { masterHint: o.masterHint } : {}),
    enabledVariants: strings(o.enabledVariants),
    values: parseValues(o.values),
    ...(overrides ? { overrides } : {}),
    ...(dormant ? { dormant } : {}),
  };
}

export function packLabel(l: LabelFile, assets: LabelAssets): Uint8Array {
  const zip: Zippable = { "label.json": strToU8(serializeLabel(l)) };
  packAssets(zip, assets);
  return zipSync(zip);
}

/** Unpack a .label ZIP of any generation: exactly one of `label` (v3),
 *  `v2` (label.json v2) or `legacy` (the raw config.json v1 string, or a
 *  label.json that is neither v2 nor v3), plus whatever assets it holds. */
export function unpackLabel(bytes: Uint8Array): {
  label?: LabelFile; v2?: LabelFileV2; legacy?: string; assets: LabelAssets;
} {
  const entries = unpackArchive(bytes);
  const assets = extractAssets(entries);
  const configEntry = entries["config.json"];
  const labelEntry = entries["label.json"];
  if (!configEntry && !labelEntry) throw new Error("Not a .label file: missing label.json/config.json");
  if (!labelEntry) return { legacy: strFromU8(configEntry), assets };
  const text = strFromU8(labelEntry);
  const parsed = parseLabel(JSON.parse(text));
  if ("v2" in parsed) return { v2: parsed.v2, assets };
  if ("legacy" in parsed) return { legacy: text, assets };
  return { label: parsed, assets };
}
