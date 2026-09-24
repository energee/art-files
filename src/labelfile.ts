// labelfile.ts — pack/unpack the .label project file: a ZIP holding
// config.json (the ConfigFile JSON, v1) or label.json (the LabelFileV2 JSON, v2)
// plus the original source images under role directories (texture/<name>,
// mask/<name>, and — READ-ONLY LEGACY — collab-left/<name>,
// collab-center/<name>). Images are stored
// uncompressed (level 0): PNG/JPG bytes are already compressed, and storing
// them untouched keeps the file lossless and byte-identical on round-trip.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { LabelConfig } from "@/types";
import { toConfigFile } from "@/defaults";
import { serializeLabelFile } from "@/model/labelfile";
import type { LabelFileV2 } from "@/model/types";

/** The project file's suffix — owned here with the format itself, so the
 *  pickers, the hidden input, and the download names can't drift apart. */
export const LABEL_EXT = ".label";

export type LabelAsset = { name: string; bytes: Uint8Array };
/** A custom-layer image asset — same shape as LabelAsset, named separately
 *  since it's stored one per assetId rather than one per fixed role. */
export type CustomImageAsset = { name: string; bytes: Uint8Array };
export type LabelAssets = {
  texture?: LabelAsset;
  mask?: LabelAsset;
  /** LEGACY, read-only. The collab logos were fixed one-per-project roles
   *  until they became ordinary image FIELDS on the Collab variant; their
   *  bytes now ride in `customImages` under a minted asset id like any other
   *  per-id image. Unpack still reads these two so a file saved before that
   *  change opens with its art (App.tsx mints an id for each on open); pack
   *  never writes them again. */
  collabLeft?: LabelAsset;
  collabCenter?: LabelAsset;
  /** Master-variant custom image layers' bytes, keyed by CustomImageLayer's
   *  `asset` (the id minted at drop). Stored under `custom/<assetId>/<name>`
   *  — a directory per id, since each custom layer owns exactly one file and
   *  the id (not the filename) is the stable key. */
  customImages?: Record<string, CustomImageAsset>;
};

/** The fixed one-per-project asset roles — everything in LabelAssets except
 *  customImages, which is dynamically keyed and packed/unpacked separately. */
type FixedAssetRole = "texture" | "mask" | "collabLeft" | "collabCenter";

/** ZIP directory name for each fixed asset role. The original filename lives
 *  as the entry's basename, so a re-save round-trips it for free. */
const ROLE_DIRS: Record<FixedAssetRole, string> = {
  texture: "texture",
  mask: "mask",
  collabLeft: "collab-left",
  collabCenter: "collab-center",
};

/** ZIP directory custom image assets live under: `custom/<assetId>/<name>`. */
const CUSTOM_DIR = "custom";

/** Write the asset roles and per-id custom images into `zip` — the ONE
 *  spelling of the container's asset convention (role dirs, custom/<id>/,
 *  level-0 image entries), shared by both .label packers and .master's
 *  packMaster (model/masterfile.ts), so the two containers cannot drift. */
export function packAssets(zip: Zippable, assets: LabelAssets): void {
  for (const [role, dir] of Object.entries(ROLE_DIRS) as [FixedAssetRole, string][]) {
    const a = assets[role];
    if (a) zip[`${dir}/${a.name}`] = [a.bytes, { level: 0 }];
  }
  for (const [id, a] of Object.entries(assets.customImages ?? {}))
    zip[`${CUSTOM_DIR}/${id}/${a.name}`] = [a.bytes, { level: 0 }];
}

/** The unpack half of packAssets: pull every asset role and per-id custom
 *  image out of an unzipped entry map. Shared with unpackMaster. Directory
 *  entries (names ending in `/`) are skipped: packAssets never writes them,
 *  but a file re-zipped by Finder or `zip -r` carries a zero-byte `texture/`
 *  ahead of `texture/<name>`, and it must not be taken as the asset (#100). */
export function extractAssets(entries: Record<string, Uint8Array>): LabelAssets {
  const assets: LabelAssets = {};
  const files = Object.keys(entries).filter((p) => !p.endsWith("/"));
  for (const [role, dir] of Object.entries(ROLE_DIRS) as [FixedAssetRole, string][]) {
    const path = files.find((p) => p.startsWith(`${dir}/`));
    if (path) assets[role] = { name: path.slice(dir.length + 1), bytes: entries[path] };
  }
  // Custom image assets: one directory per assetId under custom/, each
  // holding exactly one file (name is whatever comes after the id).
  const customImages: Record<string, CustomImageAsset> = {};
  for (const path of files) {
    const m = /^custom\/([^/]+)\/(.+)$/.exec(path);
    if (m) customImages[m[1]] = { name: m[2], bytes: entries[path] };
  }
  if (Object.keys(customImages).length) assets.customImages = customImages;
  return assets;
}

/** Pack a v1 label file: config.json (legacy writer kept for tests and Node
 *  harness until Plan 6). For new code, use packLabelV2. */
export function packLabel(config: LabelConfig, assets: LabelAssets): Uint8Array {
  const zip: Zippable = {
    "config.json": strToU8(JSON.stringify(toConfigFile(config), null, 2)),
  };
  packAssets(zip, assets);
  return zipSync(zip);
}

/** Pack a v2 label file: label.json (LabelFileV2 JSON) plus assets, including
 *  each custom image layer's bytes under `custom/<assetId>/<name>` (level 0,
 *  same as every other image role — already-compressed PNG/JPG/SVG bytes). */
export function packLabelV2(label: LabelFileV2, assets: LabelAssets): Uint8Array {
  const zip: Zippable = { "label.json": strToU8(serializeLabelFile(label)) };
  packAssets(zip, assets);
  return zipSync(zip);
}

/** Unpack a .label ZIP (either generation). Returns exactly one of config
 *  (v1, config.json) or label (v2, label.json) plus whichever assets the
 *  file holds. Throws a readable error when neither is present. */
export function unpackLabel(bytes: Uint8Array): { config?: string; label?: string; assets: LabelAssets } {
  const entries = unzipSync(bytes);
  const configEntry = entries["config.json"];
  const labelEntry = entries["label.json"];
  if (!configEntry && !labelEntry) {
    throw new Error("Not a .label file: missing label.json/config.json");
  }
  return {
    config: configEntry ? strFromU8(configEntry) : undefined,
    label: labelEntry ? strFromU8(labelEntry) : undefined,
    assets: extractAssets(entries),
  };
}
