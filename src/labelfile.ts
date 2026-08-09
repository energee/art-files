// labelfile.ts — pack/unpack the .label project file: a ZIP holding
// config.json (the ConfigFile JSON) plus the original source images under
// role directories (texture/<name>, mask/<name>, collab-left/<name>,
// collab-center/<name>). Images are stored uncompressed (level 0): PNG/JPG
// bytes are already compressed, and storing them untouched keeps the file
// lossless and byte-identical on round-trip.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { LabelConfig } from "@/types";
import { toConfigFile } from "@/defaults";

export type LabelAsset = { name: string; bytes: Uint8Array };
export type LabelAssets = {
  texture?: LabelAsset;
  mask?: LabelAsset;
  collabLeft?: LabelAsset;
  collabCenter?: LabelAsset;
};

/** ZIP directory name for each asset role. The original filename lives as
 *  the entry's basename, so a re-save round-trips it for free. */
const ROLE_DIRS: Record<keyof LabelAssets, string> = {
  texture: "texture",
  mask: "mask",
  collabLeft: "collab-left",
  collabCenter: "collab-center",
};

export function packLabel(config: LabelConfig, assets: LabelAssets): Uint8Array {
  const zip: Zippable = {
    "config.json": strToU8(JSON.stringify(toConfigFile(config), null, 2)),
  };
  for (const [role, dir] of Object.entries(ROLE_DIRS) as [keyof LabelAssets, string][]) {
    const a = assets[role];
    if (a) zip[`${dir}/${a.name}`] = [a.bytes, { level: 0 }];
  }
  return zipSync(zip);
}

/** Unpack a .label ZIP. Returns the raw config JSON (callers run it through
 *  parseConfigFile, which owns validation and migration) and whichever
 *  assets the file holds. Throws a readable error when config.json is
 *  absent — the one thing that makes bytes not a .label file. */
export function unpackLabel(bytes: Uint8Array): { json: string; assets: LabelAssets } {
  const entries = unzipSync(bytes);
  const config = entries["config.json"];
  if (!config) throw new Error("Not a .label file: missing config.json");
  const assets: LabelAssets = {};
  for (const [role, dir] of Object.entries(ROLE_DIRS) as [keyof LabelAssets, string][]) {
    const path = Object.keys(entries).find((p) => p.startsWith(`${dir}/`));
    if (path) assets[role] = { name: path.slice(dir.length + 1), bytes: entries[path] };
  }
  return { json: strFromU8(config), assets };
}
