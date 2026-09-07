// generate-lib.ts — DOM-free headless generate: argv, inspect, coerce, build.
// Lives under scripts/ so it is not a desktop binary input (src/ is).
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { rasterKind, tintRgba } from "../src/collab";
import { defaultConfig, parseConfigFile } from "../src/defaults";
import { parseDescription } from "../src/description";
import { FONT_FAMILIES, type FontFamilyId } from "../src/fontCatalog";
import { setBleed } from "../src/layout";
import { convertConfigV1, guideLines } from "../src/model/convert";
import { unpackLabel, unpackMaster, type MasterAssets } from "../src/model/files";
import { PAGE_ART_ID, type LabelFile, type Layer, type LayerKind, type LayerValue, type Master, type TextLayer, type TextLine } from "../src/model/layers";
import { lolevMaster } from "../src/model/lolevLayers";
import { exportBase, resolveLayers, titleOf, widenValue } from "../src/model/resolveLayers";
import type { Face, PlanAssets } from "../src/plan";
import { planLayers } from "../src/planLayers";
import { buildArtPdf, buildMaskPdf, type Assets, type CollabImage } from "../src/pdf/build";
import { buildPsd, type PsdAssets } from "../src/psd/build";
import type { Style } from "../src/types";

export const USAGE =
  "usage: npm run generate -- [master.master] [values.json|-] <outDir> " +
  "[--variant id] [--asset layerId=path] [--set id=value] [--format pdf|psd|all] [--label file.label]\n" +
  "       npm run generate -- [master.master] --inspect\n" +
  "       npm run generate -- <texture|none> <mask.png|none> <outDir> [config.json] " +
  "[--collab-left=file] [--collab-center=file]";

/** Which plates to write. A closed union, so "nothing" is unrepresentable
 *  and a run can never exit 0 having written zero files. */
export type FormatSet = "pdf" | "psd" | "all";
const wantsPdf = (f: FormatSet) => f !== "psd";
const wantsPsd = (f: FormatSet) => f !== "pdf";

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
      /** Where the fill comes from: a values JSON (path, "-" for stdin, or
       *  nothing for an empty fill) or one saved .label — never both. */
      source: { kind: "values"; path?: string } | { kind: "label"; path: string };
      outDir: string;
      variants: string[];
      assets: Record<string, string>;
      set: Record<string, string>;
      format: FormatSet;
    };

const KNOWN_FLAGS = new Set([
  "inspect", "master", "values", "label", "out", "variant", "asset", "set", "format",
  "collab-left", "collab-center",
]);

function parseFormat(raw: string): FormatSet {
  if (raw === "all" || raw === "pdf" || raw === "psd") return raw;
  throw new Error(`--format must be pdf, psd, or all\n${USAGE}`);
}

function kv(flag: string, raw: string): [string, string] {
  const i = raw.indexOf("=");
  if (i <= 0 || i === raw.length - 1) throw new Error(`--${flag} needs id=value\n${USAGE}`);
  return [raw.slice(0, i), raw.slice(i + 1)];
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
    if (name === "inspect") {
      if (eq >= 0) throw new Error(`--inspect does not take a value\n${USAGE}`);
      inspect = true;
      continue;
    }
    const value = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined || value === "" || value.startsWith("--"))
      throw new Error(`--${name} needs a value\n${USAGE}`);
    if (name === "variant") { variants.push(value); continue; }
    if (name === "asset") { const [id, path] = kv("asset", value); assets[id] = path; continue; }
    if (name === "set") { const [id, v] = kv("set", value); set[id] = v; continue; }
    if (name in singles) throw new Error(`--${name} given twice\n${USAGE}`);
    singles[name] = value;
  }

  const flagMaster = singles.master;
  const posMaster = positional.find((p) => p.endsWith(".master"));
  const masterPath = flagMaster ?? posMaster;
  const rest = positional.filter((p) => p !== masterPath);

  if (inspect) {
    if (singles.values || singles.label || singles.out || rest.length
      || singles.format || variants.length || Object.keys(assets).length || Object.keys(set).length
      || singles["collab-left"] || singles["collab-center"])
      throw new Error(USAGE);
    return { mode: "inspect", ...(masterPath ? { masterPath } : {}) };
  }

  const newForm = !!(singles.master || singles.values || singles.label || masterPath
    || singles.out || singles.format || variants.length || Object.keys(assets).length || Object.keys(set).length);
  if (newForm) {
    if (singles["collab-left"] || singles["collab-center"])
      throw new Error("use --asset collabLeft=file --variant collab\n" + USAGE);
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
      source: singles.label
        ? { kind: "label", path: singles.label }
        : { kind: "values", ...(valuesPath !== undefined ? { path: valuesPath } : {}) },
      outDir,
      variants,
      assets,
      set,
      format: singles.format ? parseFormat(singles.format) : "all",
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
    const { values, variants, files, overrides } = v;
    if (!isPlain(values)) throw new Error("values JSON must be an object or an array of jobs");
    if (variants !== undefined && (!Array.isArray(variants) || !variants.every((x) => typeof x === "string")))
      throw new Error("job variants must be an array of strings");
    if (files !== undefined && (!isPlain(files) || Object.values(files).some((x) => typeof x !== "string" || !x)))
      throw new Error("job files must be a map of layer id to path");
    if (overrides !== undefined) {
      if (!isPlain(overrides)) throw new Error("job overrides must be an object");
      for (const [k, patch] of Object.entries(overrides)) {
        if (k === "__proto__" || k === "constructor" || k === "prototype")
          throw new Error("job overrides contain a forbidden key");
        if (!isPlain(patch)) throw new Error(`job override "${k}" must be an object`);
      }
    }
    return {
      values,
      ...(variants ? { variants: variants as string[] } : {}),
      ...(files ? { files: files as Record<string, string> } : {}),
      ...(overrides ? { overrides: overrides as LabelFile["overrides"] } : {}),
    };
  }
  return { values: v };
}

/** One job from a values-map or job object; N jobs from an array. */
export function parseJobs(json: unknown): JobInput[] {
  if (Array.isArray(json)) {
    if (!json.length) throw new Error("values JSON contains no jobs");
    return json.map(asJob);
  }
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
  return Array.isArray(v) && v.every((l) =>
    isPlain(l) && typeof l.text === "string" && typeof l.fill === "string"
    && (l.layer === "metallic" || l.layer === "white"));
}

/** Whole layers each variant adds (an id the master already has is just an
 *  override of the master layer, not an addition). */
function addedLayers(master: Master): { layer: Layer; variant: string }[] {
  const masterIds = new Set(master.layers.map((l) => l.id));
  return master.variants.flatMap((v) => Object.entries(v.layers)
    .filter(([id, p]) => !masterIds.has(id) && p.kind)
    .map(([, p]) => ({ layer: p as Layer, variant: v.id })));
}

/** Layers a CLI job may fill: the master's, plus what the enabled variants add. */
function fillableById(master: Master, enabledVariants: string[]): Map<string, Layer> {
  const map = new Map(master.layers.map((l) => [l.id, l] as const));
  for (const { layer, variant } of addedLayers(master))
    if (enabledVariants.includes(variant)) map.set(layer.id, layer);
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
  layers = fillableById(master, enabledVariants),
): { values: Record<string, LayerValue>; errors: Record<string, string> } {
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
  const layers = [
    ...master.layers.map((l) => inspectRow(l)),
    ...addedLayers(master).map(({ layer, variant }) => inspectRow(layer, variant)),
  ];
  return {
    id: master.id,
    name: master.name,
    fontFamily: master.fontFamily ?? "poppins",
    variants: master.variants.map((v) => ({ id: v.id, name: v.name })),
    layers,
  };
}

/** Override patches must fit the layer they patch: every field the layer
 *  already has keeps its type. Catches a hand-edited `size: "big"` here, with
 *  the layer id, instead of deep inside planning with no id at all. Fields
 *  the layer lacks pass — resolveLayers merges those as-is. */
export function checkOverrides(
  layers: Map<string, Layer>, overrides: LabelFile["overrides"],
): string[] {
  const errors: string[] = [];
  const walk = (path: string, have: unknown, patch: unknown) => {
    if (!isPlain(patch) || !isPlain(have)) {
      if (have !== undefined && typeof have !== typeof patch)
        errors.push(`override ${path}: expected ${typeof have}, got ${typeof patch}`);
      return;
    }
    for (const [k, v] of Object.entries(patch)) walk(`${path}.${k}`, have[k], v);
  };
  for (const [id, patch] of Object.entries(overrides ?? {})) {
    const layer = layers.get(id);
    if (!layer) { errors.push(`Unknown layer "${id}".`); continue; }
    walk(id, layer, patch);
  }
  return errors;
}

export function assertVariants(master: Master, ids: string[]): void {
  const unknown = ids.filter((id) => !master.variants.some((v) => v.id === id));
  if (unknown.length) throw new Error(`Unknown variant "${unknown.join('", "')}".`);
}

/** Job/label variants first, then CLI `--variant` ids that are not already on.
 *  A `.label` always carries `enabledVariants` (possibly `[]`), so `??` would
 *  drop the flag; union is how `--label x.label --variant collab` turns collab on. */
function mergeVariants(job: string[] | undefined, cli: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(job ?? []), ...cli]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export interface GenerateFile { name: string; bytes: Uint8Array }

export interface GenerateResult {
  title: string;
  basename: string;
  warnings: string[];
  files: GenerateFile[];
}

const errorText = (errors: Record<string, string>): string =>
  Object.entries(errors).map(([id, e]) => `${id}: ${e}`).join("\n");

// ponytail: per-process read cache; fonts and the logo are identical across a
// batch, so a 50-job run reads each file once instead of 50 times.
const assetCache = new Map<string, Buffer>();
function readAsset(assetRoot: string, ...parts: string[]): Buffer {
  const p = join(assetRoot, ...parts);
  let b = assetCache.get(p);
  if (!b) { b = readFileSync(p); assetCache.set(p, b); }
  return b;
}

function fontPack(assetRoot: string, id: FontFamilyId): Assets["fonts"] {
  const files = FONT_FAMILIES[id].files;
  const file = (n: string) => readAsset(assetRoot, "fonts", n);
  return { regular: file(files.regular), semibold: file(files.semibold), bold: file(files.bold) };
}

function asImage(name: string, bytes: Uint8Array): CollabImage {
  if (/\.svg$/i.test(name)) return { kind: "svg", svg: new TextDecoder().decode(bytes) };
  return { kind: rasterKind(name), bytes };
}

function roleLayerId(master: Master, role: "background" | "mask"): string | undefined {
  return master.layers.find((l) => l.kind === "image" && l.role === role)?.id;
}

function pageFile(
  assets: MasterAssets, extra: GenerateInput["extraImages"], role: "background" | "mask",
  roleId?: string,
): { name: string; bytes: Uint8Array } | undefined {
  if (roleId && extra[roleId]) return extra[roleId];
  if (extra[role]) return extra[role];
  return role === "background" ? assets.texture : assets.mask;
}

/** Resolve a master + values into print bytes (PDF and/or PSD). */
export async function buildLabel(input: GenerateInput): Promise<GenerateResult> {
  assertVariants(input.master, input.enabledVariants);
  // Process-local PAGE/BLEED_SHIFT. This Node process is one generate run.
  setBleed(input.master.physical.bleedIn);
  const warnings: string[] = [];
  const overrides: NonNullable<LabelFile["overrides"]> = { ...input.overrides };
  const bgId = roleLayerId(input.master, "background");
  const maskId = roleLayerId(input.master, "mask");
  const tex = pageFile(input.masterAssets, input.extraImages, "background", bgId);
  const mask = pageFile(input.masterAssets, input.extraImages, "mask", maskId);
  if (bgId) overrides[bgId] = { ...overrides[bgId], asset: tex ? PAGE_ART_ID.background : "" };
  if (maskId) overrides[maskId] = { ...overrides[maskId], asset: mask ? PAGE_ART_ID.mask : "" };
  const pageIds = new Set([bgId, maskId, "background", "mask"].filter((id): id is string => !!id));

  const values = { ...input.values };
  for (const layerId of Object.keys(input.extraImages)) {
    if (pageIds.has(layerId)) continue;
    const assetId = `cli-${layerId}`;
    overrides[layerId] = { ...overrides[layerId], asset: assetId };
    values[layerId] = assetId;
  }

  const resolved = resolveLayers(input.master, input.enabledVariants, values, overrides);
  warnings.push(...resolved.warnings);
  if (Object.keys(resolved.errors).length) throw new Error(errorText(resolved.errors));

  const title = titleOf(resolved.layers);
  const stem = exportBase(resolved.layers);
  const defaultFamily: FontFamilyId = input.master.fontFamily ?? "poppins";
  const needed = new Set<FontFamilyId>([defaultFamily]);
  for (const l of resolved.layers)
    if (l.kind === "text" && l.fontFamily) needed.add(l.fontFamily);

  const logoSvg = readAsset(input.assetRoot, "logo2025.svg").toString("utf8");
  const fonts = fontPack(input.assetRoot, defaultFamily);
  const fontFamilies: NonNullable<Assets["fontFamilies"]> = {};
  for (const id of needed) if (id !== defaultFamily) fontFamilies[id] = fontPack(input.assetRoot, id);

  const images: Record<string, CollabImage> = {};
  const planCustom: NonNullable<PlanAssets["custom"]> = {};
  const psdImages: NonNullable<PsdAssets["images"]> = {};
  const decoded: Record<string, PNG> = {};

  const put = async (id: string, img: CollabImage, metrics: PDFDocument) => {
    images[id] = img;
    if (img.kind === "svg") { planCustom[id] = { aspect: 1, art: img }; return; }
    const embedded = img.kind === "png" ? await metrics.embedPng(img.bytes) : await metrics.embedJpg(img.bytes);
    planCustom[id] = { aspect: embedded.width / embedded.height };
    if (img.kind === "png") {
      const png = PNG.sync.read(Buffer.from(img.bytes));
      decoded[id] = png;
      psdImages[id] = { data: new Uint8Array(png.data), width: png.width, height: png.height };
    } else {
      warnings.push(`warning: ${id} is JPEG — PSD will omit this raster layer`);
    }
  };

  const metrics = await PDFDocument.create();
  metrics.registerFontkit(fontkit);
  if (tex) await put(PAGE_ART_ID.background, asImage(tex.name, tex.bytes), metrics);
  if (mask) {
    const img = asImage(mask.name, mask.bytes);
    if (img.kind !== "png") throw new Error("mask: mask must be a PNG");
    await put(PAGE_ART_ID.mask, img, metrics);
  }
  for (const [id, a] of Object.entries(input.masterAssets.customImages ?? {}))
    await put(id, asImage(a.name, a.bytes), metrics);
  for (const [layerId, file] of Object.entries(input.extraImages)) {
    if (pageIds.has(layerId)) continue;
    await put(`cli-${layerId}`, asImage(file.name, file.bytes), metrics);
  }

  for (const l of resolved.layers) {
    if (l.kind !== "image" || !l.asset || l.asset.startsWith("builtin:")) continue;
    if (!images[l.asset]) throw new Error(`${l.id}: missing image asset "${l.asset}"`);
  }

  for (const l of resolved.layers) {
    if (l.kind !== "image" || !l.tintRaster || !l.asset) continue;
    const img = images[l.asset];
    if (!img || img.kind === "svg") continue;
    if (img.kind !== "png") {
      warnings.push(`warning: ${l.asset} — tint is PNG-only here, embedding untinted`);
      continue;
    }
    const png = decoded[l.asset];
    tintRgba(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length), l.style.fill);
    images[l.asset] = { kind: "png", bytes: PNG.sync.write(png) };
    psdImages[l.asset] = { data: new Uint8Array(png.data), width: png.width, height: png.height };
  }

  type Embedded = Record<Face, Awaited<ReturnType<PDFDocument["embedFont"]>>>;
  const embedPack = async (pack: Assets["fonts"]): Promise<Embedded> => {
    const [regular, semibold, bold] = await Promise.all(
      [pack.regular, pack.semibold, pack.bold].map((f) => metrics.embedFont(f)));
    return { regular, semibold, bold };
  };
  const packs = { [defaultFamily]: fonts, ...fontFamilies } as Record<FontFamilyId, Assets["fonts"]>;
  const embedded: Partial<Record<FontFamilyId, Embedded>> = {};
  await Promise.all((Object.keys(packs) as FontFamilyId[]).map(async (id) => {
    embedded[id] = await embedPack(packs[id]);
  }));
  const measure = (text: string, size: number, face: Face, family?: FontFamilyId) =>
    (embedded[family ?? defaultFamily] ?? embedded[defaultFamily]!)[face].widthOfTextAtSize(text, size);

  const plan = planLayers(resolved.layers, measure, {
    logoSvg, guides: guideLines(input.master), custom: planCustom,
  });
  const pdfAssets: Assets = { fonts, fontFamilies, title, images };
  const psdAssets: PsdAssets = { fonts, fontFamily: defaultFamily, images: psdImages };
  const psdOpts = { layers: resolved.layers };
  const builds: [string, () => Promise<Uint8Array>][] = [];
  if (wantsPdf(input.format)) builds.push(
    [`${stem}.pdf`, () => buildArtPdf(plan, pdfAssets)],
    [`${stem}-mask.pdf`, () => buildMaskPdf(plan, pdfAssets)]);
  if (wantsPsd(input.format)) builds.push(
    [`${stem}.psd`, () => buildPsd(plan, psdAssets, "art", psdOpts)],
    [`${stem}-mask.psd`, () => buildPsd(plan, psdAssets, "mask", psdOpts)]);
  const files = await Promise.all(builds.map(async ([name, build]) => ({ name, bytes: await build() })));
  return { title, basename: stem, warnings, files };
}

const DEFAULT_ASSET_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets");

export interface GenerateIo {
  argv: string[];
  cwd: string;
  readStdin?: () => string;
  readFile: (p: string) => Uint8Array;
  readFileText: (p: string) => string;
  writeFile: (p: string, bytes: Uint8Array) => void;
  mkdir: (p: string) => void;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  assetRoot?: string;
}

function parseValuesJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`invalid values JSON: ${e instanceof Error ? e.message : e}`);
  }
}

function outputNames(stem: string, format: FormatSet): string[] {
  const names: string[] = [];
  if (wantsPdf(format)) names.push(`${stem}.pdf`, `${stem}-mask.pdf`);
  if (wantsPsd(format)) names.push(`${stem}.psd`, `${stem}-mask.psd`);
  return names;
}

function loadMaster(io: GenerateIo, path: string | undefined): { master: Master; assets: MasterAssets; warnings: string[] } {
  if (!path) return { master: lolevMaster(), assets: {}, warnings: [] };
  return unpackMaster(io.readFile(resolve(io.cwd, path)));
}

function readImage(io: GenerateIo, p: string): { name: string; bytes: Uint8Array } {
  const abs = resolve(io.cwd, p);
  return { name: basename(p), bytes: io.readFile(abs) };
}

/** Argv + filesystem → generate / inspect. Exit 0 ok, 1 validation, 2 usage. */
export async function runGenerate(io: GenerateIo): Promise<number> {
  let args: GenerateArgs;
  try {
    args = parseGenerateArgs(io.argv);
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : e}\n`);
    return 2;
  }
  try {
    return await runGenerateJob(io, args);
  } catch (e) {
    io.stderr(`${e instanceof Error ? e.message : e}\n`);
    return 1;
  }
}

async function runGenerateJob(io: GenerateIo, args: GenerateArgs): Promise<number> {
  const assetRoot = io.assetRoot ?? DEFAULT_ASSET_ROOT;
  const warn = (w: string) => io.stderr(w.endsWith("\n") ? w : `${w}\n`);
  const emit = (result: GenerateResult, outDir: string) => {
    for (const w of result.warnings) warn(w);
    for (const f of result.files) {
      const dest = join(outDir, f.name);
      io.writeFile(dest, f.bytes);
      io.stdout(`wrote ${dest} (${(f.bytes.length / 1e6).toFixed(1)}MB)\n`);
    }
  };

  if (args.mode === "inspect") {
    const { master, warnings } = loadMaster(io, args.masterPath);
    for (const w of warnings) warn(w);
    io.stdout(`${JSON.stringify(inspectMaster(master), null, 2)}\n`);
    return 0;
  }

  if (args.mode === "legacy") {
    const cfg = args.configPath
      ? parseConfigFile(io.readFileText(resolve(io.cwd, args.configPath)))
      : defaultConfig();
    const extraImages: GenerateInput["extraImages"] = {};
    if (args.texturePath !== "none") extraImages.background = readImage(io, args.texturePath);
    if (args.maskPath !== "none") extraImages.mask = readImage(io, args.maskPath);
    if (args.collabLeft) extraImages.collabLeft = readImage(io, args.collabLeft);
    if (args.collabCenter) extraImages.collabCenter = readImage(io, args.collabCenter);
    const converted = convertConfigV1(cfg, !!(args.collabLeft || args.collabCenter));
    for (const w of converted.warnings) warn(w);
    const master = lolevMaster();
    const coerced = coerceValues(master, converted.label.values, converted.label.enabledVariants);
    if (Object.keys(coerced.errors).length) throw new Error(errorText(coerced.errors));
    const result = await buildLabel({
      master,
      masterAssets: {},
      values: coerced.values,
      enabledVariants: converted.label.enabledVariants,
      overrides: converted.label.overrides,
      extraImages,
      format: "all",
      assetRoot,
    });
    const outDir = resolve(io.cwd, args.outDir);
    io.mkdir(outDir);
    emit(result, outDir);
    return 0;
  }

  const { master, assets: masterAssets, warnings } = loadMaster(io, args.masterPath);
  for (const w of warnings) warn(w);

  let jobs: JobInput[];
  let labelExtras: GenerateInput["extraImages"] = {};
  if (args.source.kind === "label") {
    const unpacked = unpackLabel(io.readFile(resolve(io.cwd, args.source.path)));
    if (!unpacked.label)
      throw new Error("this CLI opens v3 .label files; open and re-save in Label Lab first");
    const lab = unpacked.label;
    if (lab.masterId !== master.id)
      throw new Error(`label masterId "${lab.masterId}" does not match master "${master.id}"`);
    jobs = [{ values: lab.values, variants: lab.enabledVariants, overrides: lab.overrides }];
    if (unpacked.assets.texture) labelExtras.background = unpacked.assets.texture;
    if (unpacked.assets.mask) labelExtras.mask = unpacked.assets.mask;
    for (const [id, a] of Object.entries(unpacked.assets.customImages ?? {}))
      masterAssets.customImages = { ...masterAssets.customImages, [id]: a };
  } else {
    let raw: unknown = {};
    const valuesPath = args.source.path;
    if (valuesPath === "-") {
      const text = io.readStdin?.();
      if (text === undefined || text === "") throw new Error("values JSON on stdin is empty");
      raw = parseValuesJson(text);
    } else if (valuesPath) {
      raw = parseValuesJson(io.readFileText(resolve(io.cwd, valuesPath)));
    }
    jobs = parseJobs(raw);
  }

  // Pass 1: validate every job, read every input, and claim every output
  // name before anything is built or written, so a batch fails whole.
  const errors: string[] = [];
  const fail = (e: unknown) => { errors.push(e instanceof Error ? e.message : String(e)); };
  const dests = new Set<string>();
  const prepared = jobs.map((job) => {
    const variants = mergeVariants(job.variants, args.variants);
    try { assertVariants(master, variants); }
    catch (e) { fail(e); return null; }
    const fillable = fillableById(master, variants);
    const coerced = coerceValues(master, { ...job.values, ...args.set }, variants, fillable);
    if (Object.keys(coerced.errors).length) errors.push(errorText(coerced.errors));
    errors.push(...checkOverrides(fillable, job.overrides));
    const files = { ...job.files, ...args.assets };
    const extraImages: GenerateInput["extraImages"] = { ...labelExtras };
    for (const [id, path] of Object.entries(files)) {
      if (id === "background" || id === "mask") {
        if (!roleLayerId(master, id)) { errors.push(`master "${master.id}" has no ${id} layer to take "${path}"`); continue; }
      } else if (!fillable.has(id)) { errors.push(`Unknown layer "${id}".`); continue; }
      try { extraImages[id] = readImage(io, path); } catch (e) { fail(e); }
    }
    // ponytail: resolves once here for the name and again inside buildLabel;
    // resolution is a pure data walk, so cheap. Pass resolved layers into
    // buildLabel if it ever shows up in a profile.
    const stem = exportBase(resolveLayers(master, variants, coerced.values, job.overrides).layers);
    for (const name of outputNames(stem, args.format)) {
      if (dests.has(name)) errors.push(`duplicate output file "${name}"`);
      dests.add(name);
    }
    return { variants, values: coerced.values, extraImages, overrides: job.overrides };
  });
  if (errors.length) throw new Error(errors.join("\n"));

  // Pass 2: build every job in memory, then write. A decode or build failure
  // in job N leaves nothing of jobs 1..N-1 on disk. (ponytail: whole batch
  // buffered; stage to a temp dir instead if batches outgrow RAM.)
  const results: GenerateResult[] = [];
  for (const p of prepared) {
    if (!p) continue;
    results.push(await buildLabel({
      master, masterAssets, values: p.values, enabledVariants: p.variants,
      overrides: p.overrides, extraImages: p.extraImages, format: args.format, assetRoot,
    }));
  }
  const outDir = resolve(io.cwd, args.outDir);
  io.mkdir(outDir);
  for (const r of results) emit(r, outDir);
  return 0;
}
