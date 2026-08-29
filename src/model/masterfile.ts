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

export const MASTER_EXT = ".master";

/** The template assets a master carries — the master-owned subset of the
 *  .label roles (labelfile.ts's LabelAssets), same shapes and directory
 *  names, so the two containers stay one convention. A label's own embedded
 *  assets, when present, always win over the master's (the label-delta
 *  rule), which is what keeps legacy labels rendering unchanged. */
export interface MasterAssets {
  texture?: { name: string; bytes: Uint8Array };
  mask?: { name: string; bytes: Uint8Array };
  /** Master-baked image layers' bytes, keyed by asset id — the same per-id
   *  store custom image layers use in a .label. */
  customImages?: Record<string, { name: string; bytes: Uint8Array }>;
}

export function serializeMaster(m: Master): string {
  return JSON.stringify(m, null, 2);
}

/** Legacy reader, and the JSON half of unpackMaster. */
export function parseMasterFile(json: string): Master {
  return parseMaster(JSON.parse(json));
}

/** Pack a .master ZIP: master.json plus assets, images stored uncompressed
 *  (level 0) like .label's — PNG/JPG/SVG bytes are already compressed and
 *  stay byte-identical on round-trip. */
export function packMaster(m: Master, assets: MasterAssets): Uint8Array {
  const zip: Zippable = { "master.json": strToU8(serializeMaster(m)) };
  if (assets.texture) zip[`texture/${assets.texture.name}`] = [assets.texture.bytes, { level: 0 }];
  if (assets.mask) zip[`mask/${assets.mask.name}`] = [assets.mask.bytes, { level: 0 }];
  for (const [id, a] of Object.entries(assets.customImages ?? {}))
    zip[`custom/${id}/${a.name}`] = [a.bytes, { level: 0 }];
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
  const assets: MasterAssets = {};
  for (const role of ["texture", "mask"] as const) {
    const path = Object.keys(entries).find((p) => p.startsWith(`${role}/`));
    if (path) assets[role] = { name: path.slice(role.length + 1), bytes: entries[path] };
  }
  const customImages: NonNullable<MasterAssets["customImages"]> = {};
  for (const path of Object.keys(entries)) {
    const m = /^custom\/([^/]+)\/(.+)$/.exec(path);
    if (m) customImages[m[1]] = { name: m[2], bytes: entries[path] };
  }
  if (Object.keys(customImages).length) assets.customImages = customImages;
  return { master: parseMasterFile(strFromU8(masterEntry)), assets };
}
