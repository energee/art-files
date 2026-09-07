// generate-lib.ts — DOM-free headless generate: argv, inspect, coerce, build.
// Lives under scripts/ so it is not a desktop binary input (src/ is).
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { rasterKind, tintRgba } from "../src/collab";
import { defaultConfig, parseConfigFile } from "../src/defaults";
import { parseDescription, parseRuns } from "../src/description";
import { FONT_FAMILIES, type FontFamilyId } from "../src/fontCatalog";
import { setBleed } from "../src/layout";
import { convertConfigV1, guideLines } from "../src/model/convert";
import { unpackLabel, unpackMaster, type MasterAssets } from "../src/model/files";
import type { LabelFile, Layer, LayerKind, LayerValue, Master, TextLayer, TextLine } from "../src/model/layers";
import { lolevMaster } from "../src/model/lolevLayers";
import { resolveLayers, widenValue } from "../src/model/resolveLayers";
import type { Face, PlanAssets } from "../src/plan";
import { planLayers } from "../src/planLayers";
import { buildArtPdf, buildMaskPdf, type Assets, type CollabImage } from "../src/pdf/build";
import { buildPsd, type PsdAssets } from "../src/psd/build";
import { machineName } from "../src/qr";
import type { Style } from "../src/types";

export const USAGE =
  "usage: npm run generate -- [master.master] [values.json|-] <outDir> " +
  "[--variant id] [--asset layerId=path] [--set id=value] [--format pdf|psd|all] [--label file.label]\n" +
  "       npm run generate -- [master.master] --inspect\n" +
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
    if (value === undefined || value === "" || value.startsWith("--"))
      throw new Error(`--${name} needs a value\n${USAGE}`);
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
    if (v.variants !== undefined) {
      if (!Array.isArray(v.variants) || !v.variants.every((x) => typeof x === "string"))
        throw new Error("job variants must be an array of strings");
    }
    if (v.files !== undefined) {
      if (!isPlain(v.files) || Object.values(v.files).some((x) => typeof x !== "string" || !x))
        throw new Error("job files must be a map of layer id to path");
    }
    if (v.overrides !== undefined) {
      if (!isPlain(v.overrides)) throw new Error("job overrides must be an object");
      for (const k of Object.keys(v.overrides))
        if (k === "__proto__" || k === "constructor" || k === "prototype")
          throw new Error("job overrides contain a forbidden key");
    }
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

export interface GenerateFile { name: string; bytes: Uint8Array }

export interface GenerateResult {
  title: string;
  basename: string;
  warnings: string[];
  files: GenerateFile[];
}

const plainText = (lines: TextLine[]): string =>
  lines.map((l) => parseRuns(l).map((r) => r.text).join("")).join(" ").trim();

function titleOf(layers: Layer[]): string {
  const name = layers.find((l) => l.id === "name");
  return name?.kind === "text" ? plainText(name.lines) : "";
}

function fontPack(assetRoot: string, id: FontFamilyId): Assets["fonts"] {
  const files = FONT_FAMILIES[id].files;
  const file = (n: string) => readFileSync(join(assetRoot, "fonts", n));
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
  if (Object.keys(resolved.errors).length)
    throw new Error(Object.entries(resolved.errors).map(([id, e]) => `${id}: ${e}`).join("\n"));

  const title = titleOf(resolved.layers);
  const basename = machineName(title) || "label";
  const defaultFamily: FontFamilyId = input.master.fontFamily ?? "poppins";
  const needed = new Set<FontFamilyId>([defaultFamily]);
  for (const l of resolved.layers)
    if (l.kind === "text" && l.fontFamily) needed.add(l.fontFamily);

  const logoSvg = readFileSync(join(input.assetRoot, "logo2025.svg"), "utf8");
  const fonts = fontPack(input.assetRoot, defaultFamily);
  const fontFamilies: NonNullable<Assets["fontFamilies"]> = {};
  for (const id of needed) if (id !== defaultFamily) fontFamilies[id] = fontPack(input.assetRoot, id);

  const images: Record<string, CollabImage> = {};
  const planCustom: NonNullable<PlanAssets["custom"]> = {};
  const psdImages: NonNullable<PsdAssets["images"]> = {};

  const put = async (id: string, img: CollabImage, metrics: PDFDocument) => {
    images[id] = img;
    if (img.kind === "svg") { planCustom[id] = { aspect: 1, art: img }; return; }
    const embedded = img.kind === "png" ? await metrics.embedPng(img.bytes) : await metrics.embedJpg(img.bytes);
    planCustom[id] = { aspect: embedded.width / embedded.height };
    if (img.kind === "png") {
      const png = PNG.sync.read(Buffer.from(img.bytes));
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
    const png = PNG.sync.read(Buffer.from(img.bytes));
    tintRgba(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length), l.style.fill);
    const bytes = PNG.sync.write(png);
    images[l.asset] = { kind: "png", bytes };
    psdImages[l.asset] = { data: new Uint8Array(png.data), width: png.width, height: png.height };
  }

  const embedded: Record<Face, Awaited<ReturnType<PDFDocument["embedFont"]>>> = {
    regular: await metrics.embedFont(fonts.regular),
    semibold: await metrics.embedFont(fonts.semibold),
    bold: await metrics.embedFont(fonts.bold),
  };
  const embeddedFamilies: Partial<Record<FontFamilyId, typeof embedded>> = {};
  for (const [id, pack] of Object.entries(fontFamilies) as [FontFamilyId, Assets["fonts"]][]) {
    embeddedFamilies[id] = {
      regular: await metrics.embedFont(pack.regular),
      semibold: await metrics.embedFont(pack.semibold),
      bold: await metrics.embedFont(pack.bold),
    };
  }
  const measure = (text: string, size: number, face: Face, family?: FontFamilyId) =>
    (family && embeddedFamilies[family] ? embeddedFamilies[family]! : embedded)[face]
      .widthOfTextAtSize(text, size);

  const plan = planLayers(resolved.layers, measure, {
    logoSvg, guides: guideLines(input.master), custom: planCustom,
  });
  const pdfAssets: Assets = { fonts, fontFamilies, title, images };
  const psdAssets: PsdAssets = { fonts, fontFamily: defaultFamily, images: psdImages };
  const files: GenerateFile[] = [];
  if (input.format.pdf) {
    files.push({ name: `${basename}.pdf`, bytes: await buildArtPdf(plan, pdfAssets) });
    files.push({ name: `${basename}-mask.pdf`, bytes: await buildMaskPdf(plan, pdfAssets) });
  }
  if (input.format.psd) {
    files.push({ name: `${basename}.psd`, bytes: await buildPsd(plan, psdAssets, "art", { layers: resolved.layers }) });
    files.push({ name: `${basename}-mask.psd`, bytes: await buildPsd(plan, psdAssets, "mask", { layers: resolved.layers }) });
  }
  return { title, basename, warnings, files };
}

const DEFAULT_ASSET_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "assets");

export interface GenerateIo {
  argv: string[];
  cwd: string;
  stdin?: string;
  readStdin?: () => string;
  readFile: (p: string) => Uint8Array;
  readFileText: (p: string) => string;
  writeFile: (p: string, bytes: Uint8Array) => void;
  mkdir: (p: string) => void;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  assetRoot?: string;
}

function resolveUnder(cwd: string, p: string): string {
  return isAbsolute(p) ? p : join(cwd, p);
}

function fileName(p: string): string {
  return p.split(/[/\\]/).pop() || p;
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
  if (format.pdf) names.push(`${stem}.pdf`, `${stem}-mask.pdf`);
  if (format.psd) names.push(`${stem}.psd`, `${stem}-mask.psd`);
  return names;
}

function resolvedStem(
  master: Master, variants: string[], values: Record<string, LayerValue>,
  overrides: LabelFile["overrides"],
): string {
  const r = resolveLayers(master, variants, values, overrides);
  return machineName(titleOf(r.layers)) || "label";
}

function loadMaster(io: GenerateIo, path: string | undefined): { master: Master; assets: MasterAssets; warnings: string[] } {
  if (!path) return { master: lolevMaster(), assets: {}, warnings: [] };
  return unpackMaster(io.readFile(resolveUnder(io.cwd, path)));
}

function readImage(io: GenerateIo, p: string): { name: string; bytes: Uint8Array } {
  const abs = resolveUnder(io.cwd, p);
  return { name: fileName(p), bytes: io.readFile(abs) };
}

function mergeFiles(job: JobInput, assets: Record<string, string>): Record<string, string> {
  return { ...job.files, ...assets };
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

  if (args.mode === "inspect") {
    const { master, warnings } = loadMaster(io, args.masterPath);
    for (const w of warnings) warn(w);
    io.stdout(`${JSON.stringify(inspectMaster(master), null, 2)}\n`);
    return 0;
  }

  if (args.mode === "legacy") {
    const cfg = args.configPath
      ? parseConfigFile(io.readFileText(resolveUnder(io.cwd, args.configPath)))
      : defaultConfig();
    const extraImages: GenerateInput["extraImages"] = {};
    if (args.texturePath !== "none") extraImages.background = readImage(io, args.texturePath);
    if (args.maskPath !== "none") extraImages.mask = readImage(io, args.maskPath);
    if (args.collabLeft) extraImages.collabLeft = readImage(io, args.collabLeft);
    if (args.collabCenter) extraImages.collabCenter = readImage(io, args.collabCenter);
    const converted = convertConfigV1(cfg, !!(args.collabLeft || args.collabCenter));
    for (const w of converted.warnings) warn(w);
    const coerced = coerceValues(
      lolevMaster(), converted.label.values, converted.label.enabledVariants,
    );
    if (Object.keys(coerced.errors).length)
      throw new Error(Object.entries(coerced.errors).map(([id, e]) => `${id}: ${e}`).join("\n"));
    const result = await buildLabel({
      master: lolevMaster(),
      masterAssets: {},
      values: coerced.values,
      enabledVariants: converted.label.enabledVariants,
      overrides: converted.label.overrides,
      extraImages,
      format: { pdf: true, psd: true },
      assetRoot,
    });
    for (const w of result.warnings) warn(w);
    const outDir = resolveUnder(io.cwd, args.outDir);
    io.mkdir(outDir);
    for (const f of result.files) {
      const dest = join(outDir, f.name);
      io.writeFile(dest, f.bytes);
      io.stdout(`wrote ${dest} (${(f.bytes.length / 1e6).toFixed(1)}MB)\n`);
    }
    return 0;
  }

  const { master, assets: masterAssets, warnings } = loadMaster(io, args.masterPath);
  for (const w of warnings) warn(w);

  let jobs: JobInput[];
  let labelExtras: GenerateInput["extraImages"] = {};
  if (args.labelPath) {
    const unpacked = unpackLabel(io.readFile(resolveUnder(io.cwd, args.labelPath)));
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
    if (args.valuesPath === "-") {
      const text = io.stdin ?? io.readStdin?.();
      if (text === undefined || text === "") throw new Error("values JSON on stdin is empty");
      raw = parseValuesJson(text);
    } else if (args.valuesPath) {
      raw = parseValuesJson(io.readFileText(resolveUnder(io.cwd, args.valuesPath)));
    }
    jobs = parseJobs(raw);
  }

  const prepared: {
    job: JobInput; variants: string[]; values: Record<string, LayerValue>;
    extraImages: GenerateInput["extraImages"];
  }[] = [];
  const errors: string[] = [];
  for (const job of jobs) {
    const variants = job.variants ?? args.variants;
    try { assertVariants(master, variants); }
    catch (e) { errors.push(e instanceof Error ? e.message : String(e)); continue; }
    const raw = { ...job.values, ...args.set };
    const coerced = coerceValues(master, raw, variants);
    for (const [id, e] of Object.entries(coerced.errors)) errors.push(`${id}: ${e}`);
    const files = mergeFiles(job, args.assets);
    const fillable = fillableById(master, variants);
    for (const id of Object.keys(files)) {
      if (id === "background" || id === "mask") continue;
      if (!fillable.has(id)) errors.push(`Unknown layer "${id}".`);
    }
    if (errors.length) continue;
    const extraImages: GenerateInput["extraImages"] = { ...labelExtras };
    for (const [id, p] of Object.entries(files)) extraImages[id] = readImage(io, p);
    prepared.push({
      job, variants, values: coerced.values, extraImages,
    });
  }
  if (errors.length) throw new Error(errors.join("\n"));

  const dests = new Set<string>();
  for (const p of prepared) {
    const stem = resolvedStem(master, p.variants, p.values, p.job.overrides);
    for (const name of outputNames(stem, args.format)) {
      if (dests.has(name)) throw new Error(`duplicate output file "${name}"`);
      dests.add(name);
    }
  }

  const outDir = resolveUnder(io.cwd, args.outDir);
  io.mkdir(outDir);
  for (const p of prepared) {
    const result = await buildLabel({
      master, masterAssets, values: p.values, enabledVariants: p.variants,
      overrides: p.job.overrides, extraImages: p.extraImages, format: args.format, assetRoot,
    });
    for (const w of result.warnings) warn(w);
    for (const f of result.files) {
      const dest = join(outDir, f.name);
      io.writeFile(dest, f.bytes);
      io.stdout(`wrote ${dest} (${(f.bytes.length / 1e6).toFixed(1)}MB)\n`);
    }
  }
  return 0;
}
