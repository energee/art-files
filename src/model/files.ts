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
import { linesProblem, parseMaster, patchProblem, validateLayer, type Layer, type LayerValue } from "./layers";
import { t } from "@/i18n";
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

/** The newest file format this build reads and writes. */
const FORMAT_VERSION = 3;

/** A file saved by a later Label Lab must not be read as an older format:
 *  converting it as legacy, then saving, would silently downgrade it (#429). */
function rejectNewerFormat(version: unknown, kind: string): void {
  if (typeof version === "number" && version > FORMAT_VERSION)
    throw new Error(t("This {{kind}} was made by a newer version of Label Lab (format {{version}}). Update Label Lab to open it.", { kind, version }));
}

// --- .master --------------------------------------------------------------

export function serializeMaster(m: Master): string {
  return JSON.stringify(m, null, 2);
}

/** A master.json of either generation → v3. A v1 file converts (with the
 *  converter's warnings); a newer format is refused; anything else must
 *  already be v3 and goes through parseMaster's own loud fail(). */
export function parseMasterJson(json: unknown): { master: Master; warnings: string[] } {
  const version = (json as { formatVersion?: unknown } | null)?.formatVersion;
  if (version === 1) return convertMasterV1(parseMasterV1(json));
  rejectNewerFormat(version, "master");
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
  if (!entry) throw new Error(t("Not a .master file: missing master.json"));
  return { ...parseMasterJson(JSON.parse(strFromU8(entry))), assets: extractAssets(entries) };
}

// --- .label ---------------------------------------------------------------

export function serializeLabel(l: LabelFile): string {
  return JSON.stringify(l, null, 2);
}

function badLabel(message: string): never { throw new Error(t("Invalid label file: {{message}}", { message })); }

/** A JSON object (not null, not an array). */
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Only the strings of an untrusted array; anything else becomes []. */
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** What is wrong with one stored value, or undefined. A value is a string or
 *  text lines — the two shapes resolveLayers' putValue can place (#392) —
 *  and each line needs string text and a printable fill and ink plate (a
 *  3-digit hex is widened in place; see layers.ts's styleProblem). */
function valueProblem(val: unknown): string | undefined {
  if (typeof val === "string") return undefined;
  return Array.isArray(val) ? linesProblem(val) : t("is not text or a string");
}

function parseValues(v: unknown): Record<string, LayerValue> {
  if (!isRecord(v)) return {};
  for (const [id, val] of Object.entries(v)) {
    const problem = valueProblem(val);
    if (problem) badLabel(t("value for \"{{id}}\" {{problem}}", { id, problem }));
  }
  return v as Record<string, LayerValue>;
}

/** Override keys the renderer does geometry with: a finite number, or null
 *  (applyDiff's "delete this key"). `scale` is read from older files only,
 *  then folded into w/h when the label opens (resolveLayers.ts foldLabelScale). */
const NUMERIC_KEYS = ["x", "size", "leading", "headerScale", "width", "min", "max", "w", "h", "scale", "moduleW"];

/** Overrides by layer id (#392). A patch carrying `kind` is a whole added
 *  layer: it must name its own id, and the layer resolveLayers builds from it
 *  (applyDiff, so a null-cleared optional field is simply absent) must pass
 *  validateLayer like a master's. Any other patch is a partial diff, so only
 *  its geometry and font are checked. */
function parseOverrides(v: unknown): LabelFile["overrides"] {
  if (v == null) return undefined;
  if (!isRecord(v)) badLabel(t("overrides is not an object"));
  for (const [id, p] of Object.entries(v)) {
    if (!isRecord(p)) badLabel(t("override \"{{id}}\" is not an object", { id }));
    const family = p.fontFamily;
    if (family != null && (typeof family !== "string" || !Object.hasOwn(FONT_FAMILIES, family)))
      throw new Error(t("Unknown label font family: {{family}}", { family }));
    const problem = patchProblem(p);
    if (problem) badLabel(t("override \"{{id}}\" {{problem}}", { id, problem }));
    if (p.kind !== undefined) {
      if (p.id !== id) badLabel(t("added layer \"{{id}}\" has a mismatched id", { id }));
      try { validateLayer(applyDiff({} as Layer, p as never), "label override"); }
      catch (err) {
        const prefix = t("Invalid master file: {{message}}", { message: "" });
        const message = (err as Error).message;
        badLabel(message.startsWith(prefix) ? message.slice(prefix.length) : message);
      }
      continue;
    }
    for (const k of NUMERIC_KEYS)
      if (p[k] != null && !Number.isFinite(p[k])) badLabel(t("override \"{{id}}\" has invalid {{key}}", { id, key: k }));
    const y = p.y;
    if (y != null && !Number.isFinite(y) && !(isRecord(y) && typeof y.below === "string" && Number.isFinite(y.gap)))
      badLabel(t("override \"{{id}}\" has invalid y", { id }));
  }
  return v as LabelFile["overrides"];
}

/** The bench of values and variants a rebind set aside. A bad benched value is
 *  dropped, not fatal: nothing draws it, and refusing the whole label over it
 *  would lose everything else (the v2 parser in labelfile.ts is as lenient). */
function parseDormant(v: unknown): LabelFile["dormant"] {
  if (!v || typeof v !== "object") return undefined;
  const d = v as Record<string, unknown>;
  const values = isRecord(d.values)
    ? Object.fromEntries(Object.entries(d.values).filter(([, val]) => !valueProblem(val))) : {};
  return {
    values: values as Record<string, LayerValue>,
    variants: strings(d.variants),
    ...(Array.isArray(d.variantOrder) && d.variantOrder.every((id) => typeof id === "string")
      ? { variantOrder: d.variantOrder as string[] } : {}),
  };
}

/** A label.json of any generation: v3 parses here; v2 comes back tagged
 *  (convertLabelV2 needs the master); only a missing formatVersion (the v1
 *  `{version: 1}` config) or 1 is tagged legacy for parseConfigFile +
 *  convertConfigV1. A newer or unrecognized formatVersion throws (#429). */
export function parseLabel(json: unknown): LabelFile | { v2: LabelFileV2 } | { legacy: unknown } {
  if (!json || typeof json !== "object") throw new Error(t("Not a label file."));
  const o = json as Record<string, unknown>;
  if (o.formatVersion === 2) return { v2: parseLabelFile(json) as LabelFileV2 };
  if (o.formatVersion === undefined || o.formatVersion === 1) return { legacy: json };
  rejectNewerFormat(o.formatVersion, "label");
  if (o.formatVersion !== 3) throw new Error(t("Unsupported label formatVersion: {{version}}", { version: JSON.stringify(o.formatVersion) }));
  if (typeof o.masterId !== "string" || !o.masterId) throw new Error(t("Label file is missing its masterId."));
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
 *  label.json with no formatVersion or formatVersion 1), plus whatever assets
 *  it holds. A newer or unrecognized label.json formatVersion throws. */
export function unpackLabel(bytes: Uint8Array): {
  label?: LabelFile; v2?: LabelFileV2; legacy?: string; assets: LabelAssets;
} {
  const entries = unpackArchive(bytes);
  const configEntry = entries["config.json"];
  const labelEntry = entries["label.json"];
  // Checked before extractAssets, so a wrong ZIP says "not a .label" rather
  // than an asset error (same order as unpackMaster).
  if (!configEntry && !labelEntry) throw new Error(t("Not a .label file: missing label.json/config.json"));
  const assets = extractAssets(entries);
  if (!labelEntry) return { legacy: strFromU8(configEntry), assets };
  const text = strFromU8(labelEntry);
  const parsed = parseLabel(JSON.parse(text));
  if ("v2" in parsed) return { v2: parsed.v2, assets };
  if ("legacy" in parsed) return { legacy: text, assets };
  return { label: parsed, assets };
}
