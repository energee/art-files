// golden-diff.mts — raster diff of two PDF (or PNG) goldens, for re-baselining
// a byte-locked golden after an approved rendering change. Run:
//   npx tsx scripts/golden-diff.mts <old.pdf> <new.pdf> <out.png> [--dpi 600]
//       [--threshold N] [--rasterizer auto|pdftoppm|pdfjs]
//
// Both inputs are rasterized at the same DPI (600 by default — the label's
// design DPI, so one raster pixel is one print pixel) and compared pixel for
// pixel. The output PNG is a review aid: the NEW render drawn faded, with every
// pixel that differs from the old render painted solid red. A moved element
// therefore shows as two red silhouettes (where it was, where it is), a
// re-antialiased glyph edge as a thin red outline, and an unchanged label as
// a uniformly faded page. When the two rasters differ in size the diff runs
// over their union and the non-overlapping strip counts as changed.
//
// stdout carries exactly one line, `changed: <n> px (<pct>%), bbox: x,y,w,h`
// (`bbox: none` when nothing changed); everything else goes to stderr. The
// exit code is 1 when the changed pixel count exceeds --threshold (default 0),
// 2 on a usage or I/O error, 0 otherwise — so a CI step can gate on it.
//
// Rasterizer: poppler's pdftoppm when it is on PATH (the same engine
// src/dev/strokecap.ts's reference rasters come from), otherwise pdfjs-dist
// rendering through @napi-rs/canvas, with a warning. The two engines
// anti-alias differently, so both inputs of one diff always go through the
// same one; never compare a pdftoppm raster against a pdfjs raster. The
// pdfjs path has a one-time ~10-15s startup (it loads pdf.worker in-process)
// and is a fallback for machines without poppler, not the reference.
//
// PNG inputs (sniffed by signature) diff directly, which is how a PSD golden
// gets reviewed: the PSD builder stays byte-locked (Node has no canvas to
// composite it), so export the layer or composite to PNG in Photoshop and diff
// those. See docs/goldens.md for the re-baseline procedure.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import { isEntry } from "./is-entry.mjs";

/** An RGBA raster, row-major, 4 bytes per pixel — what pngjs decodes to and
 *  what a 2D canvas's getImageData returns. */
export type Raster = { width: number; height: number; data: Uint8Array };
export type Box = { x: number; y: number; w: number; h: number };
export type DiffResult = {
  /** Pixels that differ in any channel, plus every pixel outside the overlap
   *  when the two rasters differ in size. */
  changed: number;
  /** Pixels in the union of the two rasters. */
  total: number;
  /** Tight bounds of the changed pixels; null when nothing changed. */
  bbox: Box | null;
  width: number;
  height: number;
  /** The review PNG: `b` (the new render) faded, changed pixels solid red. */
  png: Uint8Array;
};
export type Rasterizer = "pdftoppm" | "pdfjs";
export type DiffOptions = {
  /** Render resolution; defaults to the label's 600 DPI design grid. */
  dpi?: number;
  /** Which engine renders both PDFs; "auto" prefers pdftoppm when on PATH. */
  rasterizer?: Rasterizer | "auto";
  /** Where the pdfjs-fallback warning goes; defaults to stderr. */
  warn?: (message: string) => void;
};

const DEFAULT_DPI = 600;
const RED = [255, 0, 0, 255] as const;

/** Faded copy of a channel: keep a quarter of the ink so the new render stays
 *  legible under the red without competing with it. */
const fade = (v: number) => 255 - ((255 - v) >> 2);

/** Diff two RGBA rasters over their union. Pixels present in only one raster
 *  count as changed, so a page that grew or shrank shows its new margin red. */
export function diffRasters(a: Raster, b: Raster): DiffResult {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const out = new PNG({ width, height });
  let changed = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inA = x < a.width && y < a.height;
      const inB = x < b.width && y < b.height;
      let same = inA && inB;
      if (same) {
        const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4;
        same = a.data[ia] === b.data[ib] && a.data[ia + 1] === b.data[ib + 1] &&
          a.data[ia + 2] === b.data[ib + 2] && a.data[ia + 3] === b.data[ib + 3];
      }
      if (same) {
        const ib = (y * b.width + x) * 4;
        out.data[o] = fade(b.data[ib]);
        out.data[o + 1] = fade(b.data[ib + 1]);
        out.data[o + 2] = fade(b.data[ib + 2]);
        out.data[o + 3] = 255;
      } else {
        out.data.set(RED, o);
        changed++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bbox = changed ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
  const png = PNG.sync.write(out);
  return {
    changed, total: width * height, bbox, width, height,
    png: new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
  };
}

const rasterOf = (png: PNG): Raster => ({
  width: png.width, height: png.height,
  data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
});

/** Diff two PNG files (the PSD review path — see the header). */
export function diffPngs(a: Uint8Array, b: Uint8Array): DiffResult {
  return diffRasters(rasterOf(PNG.sync.read(Buffer.from(a))), rasterOf(PNG.sync.read(Buffer.from(b))));
}

/** True when poppler's pdftoppm is on PATH. */
export function hasPdftoppm(): boolean {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Page 1 through pdftoppm. Poppler 26 writes nothing to stdout for a `-`
 *  root, so this goes through a scratch directory. */
function rasterizeWithPdftoppm(pdf: Uint8Array, dpi: number): Raster {
  const dir = mkdtempSync(join(tmpdir(), "golden-diff-"));
  try {
    const input = join(dir, "in.pdf");
    writeFileSync(input, pdf);
    execFileSync(
      "pdftoppm",
      ["-r", String(dpi), "-f", "1", "-l", "1", "-png", "-singlefile", input, join(dir, "out")],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    return rasterOf(PNG.sync.read(readFileSync(join(dir, "out.png"))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The canvas surface pdfjs draws on, narrowed to what this file touches.
type NodeCanvas = {
  getContext(kind: "2d"): {
    fillStyle: string;
    fillRect(x: number, y: number, w: number, h: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  };
};
type NapiCanvas = {
  createCanvas(width: number, height: number): NodeCanvas;
  Path2D: unknown; DOMMatrix: unknown; ImageData: unknown;
};
type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsLoad: Promise<{ pdfjs: Pdfjs; napi: NapiCanvas; standardFontDataUrl: string }> | undefined;

/** Load pdfjs's legacy (Node) build together with THE SAME @napi-rs/canvas
 *  instance it resolves internally. pdfjs polyfills Path2D/DOMMatrix from its
 *  own resolution of that package; a canvas created from a second copy of the
 *  native module (pnpm can hoist one) rejects those paths with InvalidArg, so
 *  the surface must come from pdfjs's copy — and its globals must be in place
 *  before pdfjs is imported. */
function loadPdfjs() {
  return (pdfjsLoad ??= (async () => {
    const require = createRequire(import.meta.url);
    const pdfjsPath = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    let napi: NapiCanvas;
    try {
      napi = createRequire(pdfjsPath)("@napi-rs/canvas") as NapiCanvas;
    } catch (e) {
      throw new Error(
        "golden-diff: the pdfjs fallback needs @napi-rs/canvas (pdfjs-dist's optional " +
          `dependency); install it or put pdftoppm on PATH. ${(e as Error).message}`,
      );
    }
    const g = globalThis as Record<string, unknown>;
    g.Path2D ??= napi.Path2D;
    g.DOMMatrix ??= napi.DOMMatrix;
    g.ImageData ??= napi.ImageData;
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Plain path with a trailing slash — pdfjs's Node fetcher hands it to
    // fs.readFile after appending the font file name.
    const standardFontDataUrl = join(dirname(pdfjsPath), "..", "..", "standard_fonts") + "/";
    return { pdfjs, napi, standardFontDataUrl };
  })());
}

/** Page 1 through pdfjs onto a white @napi-rs/canvas surface. */
async function rasterizeWithPdfjs(pdf: Uint8Array, dpi: number): Promise<Raster> {
  const { pdfjs, napi, standardFontDataUrl } = await loadPdfjs();
  const task = pdfjs.getDocument({
    // A copy: pdfjs takes ownership of the buffer it is handed.
    data: new Uint8Array(pdf),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    standardFontDataUrl,
  });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    const canvas = napi.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
    const { data } = ctx.getImageData(0, 0, width, height);
    return { width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } finally {
    await task.destroy();
  }
}

/** Resolve "auto" to a concrete engine, warning when poppler is absent. */
export function pickRasterizer(
  choice: Rasterizer | "auto" = "auto", warn: (m: string) => void = (m) => console.error(m),
): Rasterizer {
  if (choice !== "auto") return choice;
  if (hasPdftoppm()) return "pdftoppm";
  warn(
    "golden-diff: pdftoppm not found on PATH — rendering with pdfjs-dist instead " +
      "(slower; its anti-aliasing differs from poppler's, so never compare this " +
      "run's rasters against pdftoppm ones).",
  );
  return "pdfjs";
}

/** Rasterize page 1 of a PDF at `dpi` with the chosen engine. */
export async function rasterizePdf(
  pdf: Uint8Array, dpi: number, rasterizer: Rasterizer,
): Promise<Raster> {
  return rasterizer === "pdftoppm" ? rasterizeWithPdftoppm(pdf, dpi) : rasterizeWithPdfjs(pdf, dpi);
}

/** Rasterize both PDFs with one engine at one DPI and diff them. */
export async function diffPdfs(
  oldBytes: Uint8Array, newBytes: Uint8Array, opts: DiffOptions = {},
): Promise<DiffResult> {
  const dpi = opts.dpi ?? DEFAULT_DPI;
  const rasterizer = pickRasterizer(opts.rasterizer, opts.warn);
  const a = await rasterizePdf(oldBytes, dpi, rasterizer);
  const b = await rasterizePdf(newBytes, dpi, rasterizer);
  return diffRasters(a, b);
}

/** The stdout contract: one line, machine-readable. */
export function summaryLine(r: DiffResult): string {
  const pct = ((100 * r.changed) / r.total).toFixed(4);
  const bbox = r.bbox ? `${r.bbox.x},${r.bbox.y},${r.bbox.w},${r.bbox.h}` : "none";
  return `changed: ${r.changed} px (${pct}%), bbox: ${bbox}`;
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

const USAGE =
  "usage: npx tsx scripts/golden-diff.mts <old.pdf|png> <new.pdf|png> <out.png> " +
  "[--dpi 600] [--threshold 0] [--rasterizer auto|pdftoppm|pdfjs]";

/** Parse argv into the three paths and the flags; `--flag value` and
 *  `--flag=value` both work. Throws on anything malformed. */
export function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { positional.push(a); continue; }
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    const value = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined) throw new Error(`--${name} needs a value\n${USAGE}`);
    flags[name] = value;
  }
  if (positional.length !== 3) throw new Error(USAGE);
  // --dpi must be positive: pdftoppm reads `-r 0` as "use the default" and
  // renders at 150 dpi while the log reports 0 (#111). --threshold may be 0.
  const num = (name: string, fallback: number, min: "positive" | "non-negative") => {
    if (!(name in flags)) return fallback;
    const n = Number(flags[name]);
    if (!Number.isFinite(n) || n < 0 || (min === "positive" && n === 0))
      throw new Error(`--${name} must be a ${min} number`);
    return n;
  };
  const rasterizer = flags.rasterizer ?? "auto";
  if (!["auto", "pdftoppm", "pdfjs"].includes(rasterizer))
    throw new Error(`--rasterizer must be auto, pdftoppm or pdfjs`);
  for (const k of Object.keys(flags))
    if (!["dpi", "threshold", "rasterizer"].includes(k)) throw new Error(`unknown flag --${k}\n${USAGE}`);
  const [oldPath, newPath, outPath] = positional;
  return {
    oldPath, newPath, outPath,
    dpi: num("dpi", DEFAULT_DPI, "positive"), threshold: num("threshold", 0, "non-negative"),
    rasterizer: rasterizer as Rasterizer | "auto",
  };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const a = readFileSync(args.oldPath), b = readFileSync(args.newPath);
  let result: DiffResult;
  if (isPdf(a) && isPdf(b)) {
    const rasterizer = pickRasterizer(args.rasterizer);
    console.error(`golden-diff: rasterizing with ${rasterizer} at ${args.dpi} dpi`);
    result = await diffPdfs(a, b, { dpi: args.dpi, rasterizer });
  } else if (isPng(a) && isPng(b)) {
    result = diffPngs(a, b);
  } else {
    throw new Error("inputs must both be PDFs or both be PNGs (sniffed by signature)");
  }
  writeFileSync(args.outPath, result.png);
  console.log(summaryLine(result));
  console.error(`golden-diff: ${result.width}x${result.height} diff written to ${args.outPath}`);
  return result.changed > args.threshold ? 1 : 0;
}

// Thin CLI wrapper: only run when this file is the process's entry point,
// never on import from tests (scripts/is-entry.mjs).
if (isEntry(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`golden-diff: ${(e as Error).message}`);
      process.exit(2);
    },
  );
}
