// src/model/masterfile.ts — .master file serialization. Since the 2026-08-29
// spec amendment a .master is a ZIP — master.json (the same shape parseMaster
// validates) plus the TEMPLATE assets under the same role directories .label
// uses (texture/<name>, mask/<name>, custom/<assetId>/<name>), so the master
// carries the art every label shares and a new label needs nothing dropped.
// Legacy JSON-only .master files still open: unpackMaster sniffs the first
// byte ('{' = pretty-printed JSON, asset-less; anything else is unzipped).
// Files on disk are the source of truth; the library index (src/masters.ts)
// is only a resolver cache built from them, never the other way around.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { Master } from "./types";
import { parseMaster } from "./types";
import { extractAssets, packAssets, type LabelAssets } from "../labelfile";

/** The template assets a master carries — the master-owned subset of the
 *  .label roles, by construction (one Pick, one convention: labelfile.ts's
 *  packAssets/extractAssets do the actual reading and writing for both
 *  containers). A label's own embedded assets, when present, always win over
 *  the master's (the label-delta rule), which is what keeps legacy labels
 *  rendering unchanged. */
export type MasterAssets = Pick<LabelAssets, "texture" | "mask" | "customImages">;

export function serializeMaster(m: Master): string {
  return JSON.stringify(m, null, 2);
}

/** Legacy reader, and the JSON half of unpackMaster. */
export function parseMasterFile(json: string): Master {
  return parseMaster(JSON.parse(json));
}

/** Pack a .master ZIP: master.json plus assets, via the same packAssets the
 *  .label packers use (role dirs, level-0 image entries). */
export function packMaster(m: Master, assets: MasterAssets): Uint8Array {
  const zip: Zippable = { "master.json": strToU8(serializeMaster(m)) };
  packAssets(zip, assets);
  return zipSync(zip);
}

/** Unpack a .master of either generation. A corrupt archive or a ZIP without
 *  master.json throws a readable error; a bad master.json fails through
 *  parseMaster's own loud fail() — nothing half-applies. */
export function unpackMaster(bytes: Uint8Array): { master: Master; assets: MasterAssets } {
  if (bytes[0] === 0x7b) // '{' — a legacy JSON-only master, no assets
    return { master: parseMasterFile(strFromU8(bytes)), assets: {} };
  const entries = unzipSync(bytes);
  const masterEntry = entries["master.json"];
  if (!masterEntry) throw new Error("Not a .master file: missing master.json");
  return { master: parseMasterFile(strFromU8(masterEntry)), assets: extractAssets(entries) };
}
