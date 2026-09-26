// golden-diff.test.ts — the contract of scripts/golden-diff.mts, the raster
// diff a golden is re-baselined through (docs/goldens.md): identical inputs
// diff to zero, a moved element diffs to red where it was and where it is
// with a bbox spanning both, a size mismatch counts the new strip as changed,
// the review PNG decodes at the union's size, and the CLI's one-line summary
// plus exit code hold. PDFs rasterize through poppler's pdftoppm, which is
// required (ci.yml installs poppler-utils; docs/goldens.md for dev machines):
// without it the PDF tests fail with the script's own "install poppler" error.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { PNG } from "pngjs";
import {
  diffPdfs, diffPngs, diffRasters, parseArgs, summaryLine, type Raster,
} from "../scripts/golden-diff.mjs";

// The CLI tests spawn tsx, which compiles the script on every run.
const SLOW = 30_000;

/** A 200x100pt page with one 40x40pt black square whose left edge is at `x`
 *  pt, 30pt up from the bottom — so at 72 dpi it covers raster x..x+40,
 *  rows 30..70 from the top. Object streams off so the file is trivially
 *  re-readable; the bytes themselves are not under test. */
async function squarePdf(x: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  page.drawRectangle({ x, y: 30, width: 40, height: 40, color: rgb(0, 0, 0) });
  return doc.save({ useObjectStreams: false });
}

/** A solid RGBA raster. */
function solid(width: number, height: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}

/** Paint an axis-aligned block into a raster (in place) and return it. */
function paint(r: Raster, x0: number, y0: number, w: number, h: number, rgba: [number, number, number, number]) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) r.data.set(rgba, (y * r.width + x) * 4);
  return r;
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const RED = [255, 0, 0, 255];
const FADED_BLACK = [192, 192, 192, 255]; // 255 - (255 >> 2): a quarter of the ink kept

const decode = (png: Uint8Array) => PNG.sync.read(Buffer.from(png));
const px = (png: PNG, x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
const encode = (r: Raster) => {
  const png = new PNG({ width: r.width, height: r.height });
  png.data.set(r.data);
  return new Uint8Array(PNG.sync.write(png));
};

describe("diffRasters", () => {
  it("reports zero change for identical rasters and fades the whole page", () => {
    const a = paint(solid(40, 30, WHITE), 10, 10, 10, 10, BLACK);
    const r = diffRasters(a, a);
    expect({ changed: r.changed, total: r.total, bbox: r.bbox, w: r.width, h: r.height })
      .toEqual({ changed: 0, total: 1200, bbox: null, w: 40, h: 30 });
    const png = decode(r.png);
    expect([png.width, png.height]).toEqual([40, 30]);
    expect(px(png, 15, 15)).toEqual(FADED_BLACK);
    expect(px(png, 0, 0)).toEqual(WHITE);
  });

  it("paints a moved block red at both its old and new places, bbox spanning both", () => {
    const a = paint(solid(40, 30, WHITE), 10, 10, 10, 10, BLACK);
    const b = paint(solid(40, 30, WHITE), 20, 10, 10, 10, BLACK);
    const r = diffRasters(a, b);
    expect(r.changed).toBe(200); // two disjoint 10x10 silhouettes
    expect(r.bbox).toEqual({ x: 10, y: 10, w: 20, h: 10 });
    const png = decode(r.png);
    expect(px(png, 15, 15)).toEqual(RED); // where it was
    expect(px(png, 25, 15)).toEqual(RED); // where it is
    expect(px(png, 5, 5)).toEqual(WHITE); // untouched paper
  });

  it("diffs over the union and counts the non-overlap as changed", () => {
    const a = solid(20, 20, WHITE);
    const b = solid(30, 20, WHITE);
    const r = diffRasters(a, b);
    expect({ changed: r.changed, total: r.total, bbox: r.bbox, w: r.width, h: r.height })
      .toEqual({ changed: 200, total: 600, bbox: { x: 20, y: 0, w: 10, h: 20 }, w: 30, h: 20 });
    const png = decode(r.png);
    expect([png.width, png.height]).toEqual([30, 20]);
    expect(px(png, 25, 10)).toEqual(RED);
    expect(px(png, 10, 10)).toEqual(WHITE);
    // Symmetric: the old raster being the larger one is a change too.
    expect(diffRasters(b, a).changed).toBe(200);
  });

  it("treats an alpha-only difference as a change", () => {
    const a = solid(4, 4, [0, 0, 0, 255]);
    const b = solid(4, 4, [0, 0, 0, 128]);
    expect(diffRasters(a, b).changed).toBe(16);
  });
});

describe("diffPngs", () => {
  it("decodes both PNGs and diffs them like rasters", () => {
    const a = paint(solid(40, 30, WHITE), 10, 10, 10, 10, BLACK);
    const b = paint(solid(40, 30, WHITE), 20, 10, 10, 10, BLACK);
    expect(diffPngs(encode(a), encode(a)).changed).toBe(0);
    const r = diffPngs(encode(a), encode(b));
    expect(r.changed).toBe(200);
    expect(r.bbox).toEqual({ x: 10, y: 10, w: 20, h: 10 });
  });
});

describe("diffPdfs", () => {
  it("two identical PDFs diff to zero and the PNG is the page at the requested dpi", async () => {
    const a = await squarePdf(50);
    const r = diffPdfs(a, a, 72);
    expect(r.changed).toBe(0);
    expect(r.bbox).toBeNull();
    const png = decode(r.png);
    expect([png.width, png.height]).toEqual([200, 100]);
    expect(r.total).toBe(200 * 100);
  });

  it("a moved square changes pixels inside a bbox spanning old and new positions", async () => {
    const r = diffPdfs(await squarePdf(50), await squarePdf(80), 72);
    // Old square x 50..90, new x 80..120: the 80..90 overlap is black in both,
    // leaving two 30x40 silhouettes. Allow a pixel of rasterizer rounding.
    expect(r.changed).toBeGreaterThan(0);
    expect(Math.abs(r.changed - 2 * 30 * 40)).toBeLessThanOrEqual(2 * 2 * 40);
    const b = r.bbox!;
    expect(b).not.toBeNull();
    expect(Math.abs(b.x - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.w - 70)).toBeLessThanOrEqual(2);
    expect(Math.abs(b.h - 40)).toBeLessThanOrEqual(2);
    const png = decode(r.png);
    expect(px(png, 60, 50)).toEqual(RED); // where it was
    expect(px(png, 110, 50)).toEqual(RED); // where it is
    expect(px(png, 85, 50)).toEqual(FADED_BLACK); // the overlap, unchanged ink
    expect(px(png, 10, 10)).toEqual(WHITE);
  });

  it("scales the raster with dpi", async () => {
    const a = await squarePdf(50);
    const r = diffPdfs(a, a, 144);
    expect([r.width, r.height]).toEqual([400, 200]);
  });

  it("renders at the default 600 dpi", async () => {
    const a = await squarePdf(50);
    const r = diffPdfs(a, a);
    expect(r.changed).toBe(0);
    // 200x100pt at 600 dpi.
    expect([r.width, r.height]).toEqual([1667, 834]);
  });
});

describe("summaryLine and parseArgs", () => {
  it("formats the one-line stdout contract", () => {
    const a = paint(solid(40, 30, WHITE), 10, 10, 10, 10, BLACK);
    const b = paint(solid(40, 30, WHITE), 20, 10, 10, 10, BLACK);
    expect(summaryLine(diffRasters(a, b))).toBe("changed: 200 px (16.6667%), bbox: 10,10,20,10");
    expect(summaryLine(diffRasters(a, a))).toBe("changed: 0 px (0.0000%), bbox: none");
  });

  it("accepts --flag value and --flag=value, defaults dpi 600 / threshold 0", () => {
    expect(parseArgs(["o.pdf", "n.pdf", "d.png"])).toEqual({
      oldPath: "o.pdf", newPath: "n.pdf", outPath: "d.png", dpi: 600, threshold: 0,
    });
    expect(parseArgs(["o.pdf", "n.pdf", "d.png", "--dpi", "300", "--threshold=5"]))
      .toMatchObject({ dpi: 300, threshold: 5 });
  });

  it("rejects malformed invocations", () => {
    expect(() => parseArgs(["o.pdf", "n.pdf"])).toThrow(/usage/);
    expect(() => parseArgs(["o.pdf", "n.pdf", "d.png", "--dpi", "lots"])).toThrow(/--dpi/);
    // #111: pdftoppm treats -r 0 as "use the default" and renders at 150 dpi
    // while the log claims 0, so a zero (or negative) DPI must be refused.
    expect(() => parseArgs(["o.pdf", "n.pdf", "d.png", "--dpi", "0"])).toThrow(/--dpi must be a positive number/);
    expect(() => parseArgs(["o.pdf", "n.pdf", "d.png", "--dpi=-72"])).toThrow(/--dpi must be a positive number/);
    expect(parseArgs(["o.pdf", "n.pdf", "d.png", "--threshold", "0"]).threshold).toBe(0);
    expect(() => parseArgs(["o.pdf", "n.pdf", "d.png", "--rasterizer", "pdfjs"])).toThrow(/unknown flag/);
    expect(() => parseArgs(["o.pdf", "n.pdf", "d.png", "--bogus", "1"])).toThrow(/unknown flag/);
  });
});

describe("CLI", () => {
  const script = join(__dirname, "..", "scripts", "golden-diff.mts");
  const tsx = join(__dirname, "..", "node_modules", ".bin", "tsx");
  const run = (...args: string[]) => {
    const p = spawnSync(tsx, [script, ...args], { encoding: "utf8" });
    return { status: p.status, stdout: p.stdout, stderr: p.stderr };
  };

  it("prints the summary, writes the PNG, and exits 1 past the threshold", async () => {
    const dir = mkdtempSync(join(tmpdir(), "golden-diff-test-"));
    try {
      const oldPdf = join(dir, "old.pdf"), newPdf = join(dir, "new.pdf"), out = join(dir, "diff.png");
      writeFileSync(oldPdf, await squarePdf(50));
      writeFileSync(newPdf, await squarePdf(80));

      const moved = run(oldPdf, newPdf, out, "--dpi", "72");
      expect(moved.status).toBe(1);
      expect(moved.stdout).toMatch(/^changed: \d+ px \(\d+\.\d{4}%\), bbox: \d+,\d+,\d+,\d+\n$/);
      expect(moved.stderr).toMatch(/rasterizing with pdftoppm at 72 dpi/);
      const png = decode(readFileSync(out));
      expect([png.width, png.height]).toEqual([200, 100]);

      const tolerated = run(oldPdf, newPdf, out, "--dpi", "72", "--threshold", "100000");
      expect(tolerated.status).toBe(0);

      const same = run(oldPdf, oldPdf, out, "--dpi=72");
      expect(same.status).toBe(0);
      expect(same.stdout).toBe("changed: 0 px (0.0000%), bbox: none\n");

      // PNG inputs take the direct path: the two diff PNGs just written differ.
      const pngA = join(dir, "a.png"), pngB = join(dir, "b.png");
      writeFileSync(pngA, encode(paint(solid(40, 30, WHITE), 10, 10, 10, 10, BLACK)));
      writeFileSync(pngB, encode(paint(solid(40, 30, WHITE), 20, 10, 10, 10, BLACK)));
      const pngs = run(pngA, pngB, out);
      expect(pngs.status).toBe(1);
      expect(pngs.stdout).toBe("changed: 200 px (16.6667%), bbox: 10,10,20,10\n");

      const usage = run(oldPdf);
      expect(usage.status).toBe(2);
      expect(usage.stderr).toMatch(/usage:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, SLOW);

  // #110: run through a symlinked path the entry guard used to miss, so the
  // CLI silently did nothing and exited 0 — a gate that never compared.
  it("runs when invoked through a symlinked path", () => {
    const dir = mkdtempSync(join(tmpdir(), "golden-diff-link-"));
    try {
      symlinkSync(join(__dirname, "..", "scripts"), join(dir, "scripts"));
      const p = spawnSync(tsx, [join(dir, "scripts", "golden-diff.mts"), "only-one-arg"], { encoding: "utf8" });
      expect(p.status).toBe(2);
      expect(p.stderr).toMatch(/usage:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, SLOW);
});
