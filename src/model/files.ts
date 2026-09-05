// src/model/files.ts — v3 .master / .label file containers. Same ZIP layout
// as before: master.json or label.json plus the asset role directories
// labelfile.ts's packAssets/extractAssets own (texture/<name>, mask/<name>,
// custom/<assetId>/<name>), so the two containers cannot drift. Opening
// converts on the way in (a v1 master.json through convertMasterV1; a v2
// label.json is handed back as `v2` because it needs the master to convert;
// a v1 config.json comes back raw for parseConfigFile + convertConfigV1) and
// saving always writes v3. The legacy '{' sniff for JSON-only .master files
// stays. Replaces model/masterfile.ts, model/labelfile.ts and the v2 half of
// src/labelfile.ts once the app is rewired.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { LabelFile, Master } from "./layers";
import { parseMaster } from "./layers";
import type { LabelFileV2 } from "./types";
import { parseMaster as parseMasterV1 } from "./types";
import { parseLabelFile } from "./labelfile";
import { convertMasterV1 } from "./convert";
import { extractAssets, packAssets, type LabelAssets } from "../labelfile";

/** The template assets a master carries: the master-owned subset of the
 *  .label roles. A label's own embedded art always wins over the master's. */
export type MasterAssets = Pick<LabelAssets, "texture" | "mask" | "customImages">;

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

export function packMaster(m: Master, assets: MasterAssets): Uint8Array {
  const zip: Zippable = { "master.json": strToU8(serializeMaster(m)) };
  packAssets(zip, assets);
  return zipSync(zip);
}

export function unpackMaster(bytes: Uint8Array): { master: Master; assets: MasterAssets; warnings: string[] } {
  if (bytes[0] === 0x7b) // '{' — a legacy JSON-only master, no assets
    return { ...parseMasterJson(JSON.parse(strFromU8(bytes))), assets: {} };
  const entries = unzipSync(bytes);
  const entry = entries["master.json"];
  if (!entry) throw new Error("Not a .master file: missing master.json");
  return { ...parseMasterJson(JSON.parse(strFromU8(entry))), assets: extractAssets(entries) };
}

// --- .label ---------------------------------------------------------------

export function serializeLabel(l: LabelFile): string {
  return JSON.stringify(l, null, 2);
}

function parseDormant(v: unknown): LabelFile["dormant"] {
  if (!v || typeof v !== "object") return undefined;
  const d = v as Record<string, unknown>;
  return {
    values: (d.values && typeof d.values === "object" ? d.values : {}) as LabelFile["values"],
    variants: Array.isArray(d.variants) ? (d.variants as string[]) : [],
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
  return {
    formatVersion: 3,
    masterId: o.masterId,
    ...(typeof o.masterHint === "string" ? { masterHint: o.masterHint } : {}),
    enabledVariants: Array.isArray(o.enabledVariants) ? (o.enabledVariants as string[]) : [],
    values: (o.values && typeof o.values === "object" ? o.values : {}) as LabelFile["values"],
    ...(o.overrides && typeof o.overrides === "object" ? { overrides: o.overrides as LabelFile["overrides"] } : {}),
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
  const entries = unzipSync(bytes);
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
