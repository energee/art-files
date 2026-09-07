// generate.ts — DOM-free headless generate: argv, inspect, coerce, build.
import { parseDescription } from "./description";
import type { FontFamilyId } from "./fontCatalog";
import type { MasterAssets } from "./model/files";
import type { LabelFile, Layer, LayerKind, LayerValue, Master, TextLayer, TextLine } from "./model/layers";
import { widenValue } from "./model/resolveLayers";
import type { Style } from "./types";

export const USAGE =
  "usage: npm run generate -- <master.master> [values.json|-] <outDir> " +
  "[--variant id] [--asset layerId=path] [--set id=value] [--format pdf|psd|all] [--label file.label]\n" +
  "       npm run generate -- <master.master> --inspect\n" +
  "       npm run generate -- <texture|none> <mask.png|none> <outDir> [config.json] " +
  "[--collab-left=file] [--collab-center=file]";

export type FormatSet = { pdf: boolean; psd: boolean };

export type GenerateArgs =
  | {
      mode: "legacy";
      texturePath: string;
      maskPath: string;
      outDir: string;
      configPath?: string;
      collabLeft?: string;
      collabCenter?: string;
    }
  | {
      mode: "inspect";
      masterPath?: string;
    }
  | {
      mode: "generate";
      masterPath?: string;
      valuesPath?: string;
      labelPath?: string;
      outDir: string;
      variants: string[];
      assets: Record<string, string>;
      set: Record<string, string>;
      format: FormatSet;
    };

const BOOL_FLAGS = new Set(["inspect"]);
const KNOWN_FLAGS = new Set([
  "inspect", "master", "values", "label", "out", "variant", "asset", "set", "format",
  "collab-left", "collab-center",
]);

function parseFormat(raw: string): FormatSet {
  if (raw === "all") return { pdf: true, psd: true };
  if (raw === "pdf") return { pdf: true, psd: false };
  if (raw === "psd") return { pdf: false, psd: true };
  throw new Error(`--format must be pdf, psd, or all\n${USAGE}`);
}

function kv(flag: string, raw: string): [string, string] {
  const i = raw.indexOf("=");
  if (i <= 0 || i === raw.length - 1) throw new Error(`--${flag} needs id=value\n${USAGE}`);
  return [raw.slice(0, i), raw.slice(i + 1)];
}

function isMasterPath(p: string): boolean {
  return p.endsWith(".master");
}

/** Parse argv into a generate / inspect / legacy job. `--flag value` and
 *  `--flag=value` both work; `--inspect` is a bare switch. Throws USAGE on
 *  anything malformed. */
export function parseGenerateArgs(argv: string[]): GenerateArgs {
  const positional: string[] = [];
  const singles: Record<string, string> = {};
  const variants: string[] = [];
  const assets: Record<string, string> = {};
  const set: Record<string, string> = {};
  let inspect = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { positional.push(a); continue; }
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (!KNOWN_FLAGS.has(name)) throw new Error(`unknown flag --${name}\n${USAGE}`);
    if (BOOL_FLAGS.has(name)) {
      if (eq >= 0) throw new Error(`--${name} does not take a value\n${USAGE}`);
      inspect = true;
      continue;
    }
    const value = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value\n${USAGE}`);
    if (name === "variant") { variants.push(value); continue; }
    if (name === "asset") { const [id, path] = kv("asset", value); assets[id] = path; continue; }
    if (name === "set") { const [id, v] = kv("set", value); set[id] = v; continue; }
    if (name in singles) throw new Error(`--${name} given twice\n${USAGE}`);
    singles[name] = value;
  }

  const flagMaster = singles.master;
  const posMaster = positional.find(isMasterPath);
  const masterPath = flagMaster ?? posMaster;
  const rest = positional.filter((p) => p !== masterPath);

  if (inspect) {
    if (singles.values || singles.label || singles.out || rest.length)
      throw new Error(USAGE);
    return { mode: "inspect", ...(masterPath ? { masterPath } : {}) };
  }

  const newForm = !!(singles.master || singles.values || singles.label || masterPath);
  if (newForm) {
    if (singles.label && singles.values) throw new Error(`--label cannot be combined with --values\n${USAGE}`);
    let valuesPath = singles.values;
    let outDir = singles.out;
    const leftover = [...rest];
    if (!outDir) {
      if (!leftover.length) throw new Error(USAGE);
      outDir = leftover.pop()!;
    }
    if (valuesPath === undefined && leftover.length && !singles.label)
      valuesPath = leftover.shift()!;
    if (leftover.length) throw new Error(USAGE);
    return {
      mode: "generate",
      ...(masterPath ? { masterPath } : {}),
      ...(valuesPath !== undefined ? { valuesPath } : {}),
      ...(singles.label ? { labelPath: singles.label } : {}),
      outDir,
      variants,
      assets,
      set,
      format: singles.format ? parseFormat(singles.format) : { pdf: true, psd: true },
    };
  }

  if (positional.length >= 3) {
    const [texturePath, maskPath, outDir, configPath] = positional;
    if (positional.length > 4) throw new Error(USAGE);
    return {
      mode: "legacy",
      texturePath, maskPath, outDir,
      ...(configPath ? { configPath } : {}),
      ...(singles["collab-left"] ? { collabLeft: singles["collab-left"] } : {}),
      ...(singles["collab-center"] ? { collabCenter: singles["collab-center"] } : {}),
    };
  }

  throw new Error(USAGE);
}

const JOB_KEYS = new Set(["values", "variants", "files", "overrides"]);

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export interface JobInput {
  values: Record<string, unknown>;
  variants?: string[];
  files?: Record<string, string>;
  overrides?: LabelFile["overrides"];
}

function asJob(v: unknown): JobInput {
  if (!isPlain(v)) throw new Error("values JSON must be an object or an array of jobs");
  const asObject = Object.keys(v).every((k) => JOB_KEYS.has(k));
  if (asObject && "values" in v) {
    if (!isPlain(v.values)) throw new Error("values JSON must be an object or an array of jobs");
    return {
      values: v.values,
      ...(Array.isArray(v.variants) ? { variants: v.variants as string[] } : {}),
      ...(isPlain(v.files) ? { files: v.files as Record<string, string> } : {}),
      ...(isPlain(v.overrides) ? { overrides: v.overrides as LabelFile["overrides"] } : {}),
    };
  }
  return { values: v };
}

/** One job from a values-map or job object; N jobs from an array. */
export function parseJobs(json: unknown): JobInput[] {
  if (Array.isArray(json)) return json.map(asJob);
  return [asJob(json)];
}

function linesFromText(src: string, base: Style): TextLine[] {
  const d = parseDescription(src, base);
  const out: TextLine[] = [];
  if (d.header) out.push({ ...d.header, header: true });
  for (const l of d.lines) out.push(l);
  return out;
}

function isTextLines(v: unknown): v is TextLine[] {
  return Array.isArray(v) && v.every((l) => isPlain(l) && typeof l.text === "string");
}

/** Layers a CLI job may fill: the master's, plus whole layers each enabled
 *  variant adds (an id the master already has is just an override — still
 *  filled against the master layer). */
function fillableById(master: Master, enabledVariants: string[]): Map<string, Layer> {
  const map = new Map(master.layers.map((l) => [l.id, l] as const));
  for (const vid of enabledVariants) {
    const v = master.variants.find((x) => x.id === vid);
    if (!v) continue;
    for (const [id, p] of Object.entries(v.layers)) {
      if (map.has(id) || !p.kind) continue;
      map.set(id, p as Layer);
    }
  }
  return map;
}

function coerceOne(layer: Layer, raw: unknown): { value: LayerValue } | { error: string } {
  if (layer.kind === "text") {
    if (isTextLines(raw)) return { value: raw };
    if (typeof raw === "string" || typeof raw === "number") {
      const s = String(raw);
      if (layer.input === "number" || layer.input === "code") return { value: widenValue(layer, s) };
      return { value: linesFromText(s, layer.style) };
    }
    return { error: "Expected text." };
  }
  if (typeof raw !== "string")
    return { error: layer.kind === "image" ? "Expected an image." : "Expected a code value." };
  return { value: raw };
}

/** JSON layer values → LabelFile.values. Unknown ids are errors, not dormant. */
export function coerceValues(
  master: Master,
  raw: Record<string, unknown>,
  enabledVariants: string[],
): { values: Record<string, LayerValue>; errors: Record<string, string> } {
  const layers = fillableById(master, enabledVariants);
  const values: Record<string, LayerValue> = {};
  const errors: Record<string, string> = {};
  for (const [id, v] of Object.entries(raw)) {
    const layer = layers.get(id);
    if (!layer) { errors[id] = `Unknown layer "${id}".`; continue; }
    const r = coerceOne(layer, v);
    if ("error" in r) errors[id] = r.error;
    else values[id] = r.value;
  }
  return { values, errors };
}

export const PAGE_ART_ID = { background: "texture", mask: "mask" } as const;

export interface InspectReport {
  id: string;
  name: string;
  fontFamily: FontFamilyId;
  variants: { id: string; name: string }[];
  layers: {
    id: string;
    name: string;
    kind: LayerKind;
    input?: TextLayer["input"];
    symbology?: string;
    placeholder?: string;
    role?: "background" | "mask";
    variant?: string;
  }[];
}

export interface GenerateInput {
  master: Master;
  masterAssets: MasterAssets;
  values: Record<string, LayerValue>;
  enabledVariants: string[];
  overrides?: LabelFile["overrides"];
  extraImages: Record<string, { name: string; bytes: Uint8Array }>;
  format: FormatSet;
  assetRoot: string;
}

function inspectRow(l: Layer, variant?: string): InspectReport["layers"][number] {
  return {
    id: l.id,
    name: l.name,
    kind: l.kind,
    ...(l.kind === "text" && l.input ? { input: l.input } : {}),
    ...(l.kind === "barcode" || (l.kind === "text" && l.symbology) ? { symbology: l.symbology } : {}),
    ...(l.kind === "text" && l.placeholder ? { placeholder: l.placeholder } : {}),
    ...(l.kind === "image" && (l.role === "background" || l.role === "mask") ? { role: l.role } : {}),
    ...(variant ? { variant } : {}),
  };
}

/** The fill contract a values JSON can key: master layers, then layers each
 *  variant adds (not overrides of existing ids). */
export function inspectMaster(master: Master): InspectReport {
  const masterIds = new Set(master.layers.map((l) => l.id));
  const layers = master.layers.map((l) => inspectRow(l));
  for (const v of master.variants) {
    for (const [id, p] of Object.entries(v.layers)) {
      if (masterIds.has(id) || !p.kind) continue;
      layers.push(inspectRow(p as Layer, v.id));
    }
  }
  return {
    id: master.id,
    name: master.name,
    fontFamily: master.fontFamily ?? "poppins",
    variants: master.variants.map((v) => ({ id: v.id, name: v.name })),
    layers,
  };
}

export function assertVariants(master: Master, ids: string[]): void {
  const unknown = ids.filter((id) => !master.variants.some((v) => v.id === id));
  if (unknown.length) throw new Error(`Unknown variant "${unknown.join('", "')}".`);
}
