// golden-diff.mts — raster diff of two PDF (or PNG) goldens, for re-baselining
// a byte-locked golden after an approved rendering change. Run:
//   npx tsx scripts/golden-diff.mts <old.pdf> <new.pdf> <out.png> [--dpi 600]
//       [--threshold N]
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
// Rasterizer: poppler's pdftoppm, required on PATH (brew install poppler /
// apt-get install poppler-utils; ci.yml installs it). It is the same engine
// src/dev/strokecap.ts's reference rasters come from, so every golden raster
// in the repo shares one anti-aliasing rule.
//
// PNG inputs (sniffed by signature) diff directly, which is how a PSD golden
// gets reviewed: the PSD builder stays byte-locked (Node has no canvas to
// composite it), so export the layer or composite to PNG in Photoshop and diff
// those. See docs/goldens.md for the re-baseline procedure.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";

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
export type DiffOptions = {
  /** Render resolution; defaults to the label's 600 DPI design grid. */
  dpi?: number;
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
 *  root, so this goes through a scratch directory. A missing binary is the
 *  spawn's own ENOENT, reworded — no probe spawn before the real one. */
function rasterizePdf(pdf: Uint8Array, dpi: number): Raster {
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
  } catch (e) {
    const { code, path } = e as NodeJS.ErrnoException;
    if (code === "ENOENT" && path === "pdftoppm")
      throw new Error("pdftoppm is not on PATH — install poppler (brew install poppler / apt-get install poppler-utils)");
    throw e;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Rasterize both PDFs at one DPI and diff them. */
export function diffPdfs(oldBytes: Uint8Array, newBytes: Uint8Array, opts: DiffOptions = {}): DiffResult {
  const dpi = opts.dpi ?? DEFAULT_DPI;
  return diffRasters(rasterizePdf(oldBytes, dpi), rasterizePdf(newBytes, dpi));
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
  "[--dpi 600] [--threshold 0]";

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
  const num = (name: string, fallback: number) => {
    if (!(name in flags)) return fallback;
    const n = Number(flags[name]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number`);
    return n;
  };
  for (const k of Object.keys(flags))
    if (!["dpi", "threshold"].includes(k)) throw new Error(`unknown flag --${k}\n${USAGE}`);
  const [oldPath, newPath, outPath] = positional;
  return {
    oldPath, newPath, outPath,
    dpi: num("dpi", DEFAULT_DPI), threshold: num("threshold", 0),
  };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const a = readFileSync(args.oldPath), b = readFileSync(args.newPath);
  let result: DiffResult;
  if (isPdf(a) && isPdf(b)) {
    console.error(`golden-diff: rasterizing with pdftoppm at ${args.dpi} dpi`);
    result = diffPdfs(a, b, { dpi: args.dpi });
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

// Thin CLI wrapper, same entry guard as scripts/release-notes.mjs: only run
// when this file is the process's entry point, never on import from tests.
const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entryUrl === import.meta.url) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`golden-diff: ${(e as Error).message}`);
      process.exit(2);
    },
  );
}
