// labelfile.ts — pack/unpack the .label project file: a ZIP holding
// config.json (the legacy v1 config, read by parseConfigFile) or label.json
// (the LabelFileV2 JSON, v2)
// plus the original source images under role directories (texture/<name>,
// mask/<name>, and — READ-ONLY LEGACY — collab-left/<name>,
// collab-center/<name>). Images are stored
// uncompressed (level 0): PNG/JPG bytes are already compressed, and storing
// them untouched keeps the file lossless and byte-identical on round-trip.
import { strFromU8, Unzip, UnzipInflate, type Zippable } from "fflate";

/** The project file's suffix — owned here with the format itself, so the
 *  pickers, the hidden input, and the download names can't drift apart. */
export const LABEL_EXT = ".label";

/** One packed asset: its file name and raw bytes. */
export type LabelAsset = { name: string; bytes: Uint8Array };
/** A custom-layer image asset — an alias of LabelAsset, named separately
 *  since it's stored one per assetId rather than one per fixed role. */
type CustomImageAsset = LabelAsset;
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
 *  level-0 image entries, the size limits), shared by both .label packers and .master's
 *  packMaster (model/files.ts), so the two containers cannot drift. */
export function packAssets(zip: Zippable, assets: LabelAssets): void {
  for (const [role, dir] of Object.entries(ROLE_DIRS) as [FixedAssetRole, string][]) {
    const a = assets[role];
    if (a) zip[`${dir}/${a.name}`] = [a.bytes, { level: 0 }];
  }
  for (const [id, a] of Object.entries(assets.customImages ?? {}))
    zip[`${CUSTOM_DIR}/${id}/${a.name}`] = [a.bytes, { level: 0 }];
  // The limits unpackArchive enforces on open, checked on save too, so a
  // save never writes a file its own app refuses to reopen.
  let total = 0;
  for (const [name, entry] of Object.entries(zip)) {
    // Every entry here is a file (bytes, or [bytes, options]), never a nested directory.
    const size = ((Array.isArray(entry) ? entry[0] : entry) as Uint8Array).length;
    total += size;
    if (size > FILE_CAP || total > TOTAL_CAP) throw tooLarge(name);
  }
}

/** Only real files in the container layout, excluding Finder metadata. */
const assetEntry = (path: string) =>
  /^(?:(?:texture|mask|collab-left|collab-center)\/[^/]+|custom\/[^/]+\/[^/]+)$/.test(path)
  && path.split("/").every((part) => part !== "." && part !== ".." && part !== ".DS_Store" && !part.startsWith("._"));

const FILE_CAP = 128 * 1024 * 1024;
const TOTAL_CAP = 256 * 1024 * 1024;
const tooLarge = (name: string) =>
  new Error(`Archive is too large: "${name}" exceeds the 128 MiB file or 256 MiB total limit.`);

/** Streams the archive through fflate's Unzip in 64 KiB slices, counting the
 *  bytes each entry REALLY inflates to: a central directory can understate an
 *  entry's size, so the declared size alone bounds neither memory nor the
 *  work of inflating. Unknown files never inflate. The limits allow large
 *  print assets without an unbounded ZIP; packAssets enforces the same ones
 *  on save, so the app never writes a file it would refuse to reopen. */
export function unpackArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  const unzip = new Unzip((file) => {
    if (!/^(?:master|label|config)\.json$/.test(file.name) && !assetEntry(file.name)) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      size += chunk.length;
      total += chunk.length;
      if (size > FILE_CAP || total > TOTAL_CAP || (file.originalSize !== undefined && size > file.originalSize))
        throw tooLarge(file.name);
      chunks.push(chunk);
      if (final) files[file.name] = chunks.length === 1 ? chunks[0] : concat(chunks, size);
    };
    // Refuse before inflating anything when the directory already admits it.
    if ((file.originalSize ?? 0) > FILE_CAP) throw tooLarge(file.name);
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let at = 0; at < bytes.length; at += 65536)
    unzip.push(bytes.subarray(at, at + 65536), at + 65536 >= bytes.length);
  return files;
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** The unpack half of packAssets: pull every asset role and per-id custom
 *  image out of an unzipped entry map. Shared with unpackMaster. Directory
 *  entries (names ending in `/`) are skipped: packAssets never writes them,
 *  but a file re-zipped by Finder or `zip -r` carries a zero-byte `texture/`
 *  ahead of `texture/<name>`, and it must not be taken as the asset (#100). */
export function extractAssets(entries: Record<string, Uint8Array>): LabelAssets {
  const assets: LabelAssets = {};
  const files = Object.keys(entries).filter(assetEntry);
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

/** The text of a legacy JSON-only file (the pre-ZIP .master), or undefined
 *  when the bytes are anything else — in practice a ZIP. Sniffs for the
 *  opening '{' past a UTF-8 BOM and leading whitespace, which an editor may
 *  add on save (#101), and drops the BOM from the text, since JSON.parse
 *  rejects it (whitespace it accepts). Shared by both unpackMasters. */
export function legacyJsonText(bytes: Uint8Array): string | undefined {
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d) i++;
  return bytes[i] === 0x7b ? strFromU8(bytes.subarray(i)) : undefined;
}
