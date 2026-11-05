import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PNG } from "pngjs";
import { buildArtPdf, buildMaskPdf, buildPrintPdf, type Assets } from "../src/pdf/build";
import { assets, lolevPlan, onePxPng } from "./fixtures";
import { PAGE, setBleed, SHIPPED_BLEED_IN } from "../src/layout";
import type { PlacedLayer } from "../src/planLayers";

function run(bin: string, args: string[]) {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  expect(result.status, result.stderr + result.stdout).toBe(0);
}

interface GrayPlate { width: number; height: number; data: Buffer }

// Ghostscript's uncompressed, one-channel 8-bit TIFF output. Read its IFD
// rather than adding an image-codec dependency solely for these separations.
function grayTiff(path: string): GrayPlate {
  const bytes = readFileSync(path);
  const le = bytes.toString("ascii", 0, 2) === "II";
  const u16 = (at: number) => le ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);
  const u32 = (at: number) => le ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
  expect(u16(2)).toBe(42);
  const ifd = u32(4), tags = new Map<number, number[]>();
  for (let i = 0; i < u16(ifd); i++) {
    const at = ifd + 2 + 12 * i, type = u16(at + 2), count = u32(at + 4);
    if (![256, 257, 258, 259, 262, 273, 277, 279].includes(u16(at))) continue;
    expect([3, 4]).toContain(type);
    const size = type === 3 ? 2 : 4, start = count * size <= 4 ? at + 8 : u32(at + 8);
    tags.set(u16(at), Array.from({ length: count }, (_, n) => type === 3 ? u16(start + n * size) : u32(start + n * size)));
  }
  expect(tags.get(258)).toEqual([8]); // bits/sample
  expect(tags.get(259)).toEqual([1]); // no compression
  expect(tags.get(277) ?? [1]).toEqual([1]); // samples/pixel
  const width = tags.get(256)![0], height = tags.get(257)![0];
  const offsets = tags.get(273)!, counts = tags.get(279)!;
  const data = Buffer.concat(offsets.map((offset, i) => bytes.subarray(offset, offset + counts[i])));
  expect(data.length).toBe(width * height);
  // WhiteIsZero and BlackIsZero both occur across GS device versions.
  if (tags.get(262)![0] === 0) for (let i = 0; i < data.length; i++) data[i] = 255 - data[i];
  return { width, height, data };
}

function separate(dir: string, name: string, pdf: Uint8Array) {
  const input = join(dir, `${name}.pdf`);
  writeFileSync(input, pdf);
  run("gs", ["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=tiffsep", "-r150", "-sCompression=none", `-sOutputFile=${join(dir, `${name}-%d.tif`)}`, input]);
  const plates = new Map<string, GrayPlate>();
  for (const file of readdirSync(dir)) {
    const match = file.match(new RegExp(`^${name}-1\\((.+)\\)\\.tif$`));
    if (match) plates.set(match[1], grayTiff(join(dir, file)));
  }
  return plates;
}

async function compare(items: PlacedLayer[], input: Assets, bleed = SHIPPED_BLEED_IN) {
  const dir = mkdtempSync(join(tmpdir(), "print-separations-"));
  setBleed(bleed);
  try {
    const print = separate(dir, "print", await buildPrintPdf(items, input));
    const art = separate(dir, "art", await buildArtPdf(items, input));
    expect([...print.keys()].sort()).toEqual(["Black", "Cyan", "Magenta", "White Ink", "Yellow"]);
    for (const color of ["Cyan", "Magenta", "Yellow", "Black"]) {
      const actual = print.get(color)!, expected = art.get(color)!;
      expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
      const samples: string[] = [];
      let count = 0, outsideEdges = 0;
      for (let i = 0; i < actual.data.length; i++) {
        if (actual.data[i] === expected.data[i]) continue;
        count++;
        const x = i % actual.width, y = Math.floor(i / actual.width);
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= actual.width || ny >= actual.height) continue;
          if (expected.data[ny * actual.width + nx] !== expected.data[i]) edge = true;
        }
        if (!edge) {
          outsideEdges++;
          if (samples.length < 8) samples.push(`${x},${y}:${actual.data[i]}/${expected.data[i]}`);
        }
      }
      // With alpha PNGs, GS's transparency/spot rendering changes 27 edge
      // samples at 150 DPI; an opaque-PNG control changes zero. The exact
      // rasterizer cause is unproven. Process interiors must remain exact.
      expect(outsideEdges, `${color}: ${count} changed samples; ${samples.join("; ")}`).toBe(0);
    }
    writeFileSync(join(dir, "mask.pdf"), await buildMaskPdf(items, input));
    run("pdftoppm", ["-png", "-singlefile", "-r", "150", join(dir, "mask.pdf"), join(dir, "mask")]);
    const mask = PNG.sync.read(readFileSync(join(dir, "mask.png")));
    const white = print.get("White Ink")!;
    expect(white.width).toBe(mask.width);
    expect(white.height).toBe(mask.height);
    let differences = 0, outsideEdges = 0;
    const interiorSamples: string[] = [];
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      const i = y * mask.width + x;
      if (Math.abs(white.data[i] - mask.data[i * 4]) <= 1) continue;
      differences++;
      // Fractional page sizes round differently in GS and Poppler: their
      // outermost row/column is also an edge, not a changed solid interior.
      let edge = x === 0 || y === 0 || x === mask.width - 1 || y === mask.height - 1;
      const here = mask.data[i * 4];
      for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
        const value = mask.data[(ny * mask.width + nx) * 4];
        if (value !== here) edge = true;
      }
      if (!edge) {
        outsideEdges++;
        if (interiorSamples.length < 8) interiorSamples.push(`${x},${y}: ${white.data[i]} vs ${mask.data[i * 4]}`);
      }
    }
    // Poppler's text hinting and GS's outlined paths may differ only around
    // AA edges; no changed solid interior or shifted footprint is accepted.
    expect(outsideEdges, `${differences} changed samples; ${interiorSamples.join("; ")}`).toBe(0);
  } finally {
    setBleed(SHIPPED_BLEED_IN);
    rmSync(dir, { recursive: true, force: true });
  }
}

it.each([{ variants: [] }, { variants: ["collab"] }])("preserves process plates and the White Ink mask for $variants", async ({ variants }) => {
  const png = { kind: "png" as const, bytes: onePxPng };
  const items = await lolevPlan({ variants, overrides: { collabLeft: { asset: "left" }, collabCenter: { asset: "center" } }, custom: { left: { aspect: 1 }, center: { aspect: 1 } } });
  await compare(items, { ...assets, images: { left: png, center: png } });
}, 30_000);

it("preserves uploaded mask tints, knockout order and page coverage with changed bleed", async () => {
  const mask = new PNG({ width: 2, height: 1 });
  mask.data.set([0, 0, 255, 255, 255, 255, 255, 255]);
  const items: PlacedLayer[] = [
    { kind: "page", id: "mask", role: "mask", asset: "mask", x: 0, y: 0, w: PAGE.w, h: PAGE.h },
    { kind: "paths", id: "knockout", x: 100, y: 100, paths: ["M0 0H40V40H0Z"], fill: "#FFFFFF", layer: "metallic", stroke: null },
    { kind: "paths", id: "white", x: 110, y: 110, paths: ["M0 0H10V10H0Z"], fill: "#FFFFFF", layer: "white", stroke: null },
  ];
  await compare(items, { ...assets, images: { mask: { kind: "png", bytes: PNG.sync.write(mask) } }, maskPixels: { data: new Uint8ClampedArray(mask.data), width: 2, height: 1 } }, 0.125);
}, 30_000);

it("preserves transparent mask pixels and partial alpha over earlier white ink", async () => {
  const mask = new PNG({ width: 4, height: 1 });
  mask.data.set([
    0, 0, 255, 0,
    255, 255, 255, 64,
    0, 0, 255, 128,
    0, 0, 255, 0,
  ]);
  const items: PlacedLayer[] = [
    { kind: "paths", id: "underlay", x: 0, y: 0,
      paths: [`M0 0H${PAGE.w / 2}V${PAGE.h}H0Z`], fill: "#FFFFFF", layer: "white", stroke: null },
    { kind: "page", id: "mask", role: "mask", asset: "mask", x: 0, y: 0, w: PAGE.w, h: PAGE.h },
  ];
  await compare(items, {
    ...assets,
    images: { mask: { kind: "png", bytes: PNG.sync.write(mask) } },
    maskPixels: { data: new Uint8ClampedArray(mask.data), width: mask.width, height: mask.height },
  });
}, 30_000);

it("lays White Ink under a transparent image's opaque pixels only (#668)", async () => {
  // 4x4 art: an opaque 2x2 centre inside a fully transparent ring.
  const art = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < 16; i++) {
    const x = i % 4, y = Math.floor(i / 4), opaque = x > 0 && x < 3 && y > 0 && y < 3;
    art.data.set([200, 30, 30, opaque ? 255 : 0], i * 4);
  }
  // An all-knockout uploaded mask, so the only ink is the image's own.
  const knockout = new PNG({ width: 1, height: 1 });
  knockout.data.set([255, 255, 255, 255]);
  const items: PlacedLayer[] = [
    { kind: "page", id: "mask", role: "mask", asset: "mask", x: 0, y: 0, w: PAGE.w, h: PAGE.h },
    { kind: "image", id: "art", asset: "art", x: 144, y: 144, w: 144, h: 144 },
  ];
  const input: Assets = {
    ...assets,
    images: { art: { kind: "png", bytes: PNG.sync.write(art) }, mask: { kind: "png", bytes: PNG.sync.write(knockout) } },
    maskPixels: { data: new Uint8ClampedArray(knockout.data), width: 1, height: 1 },
  };
  const dir = mkdtempSync(join(tmpdir(), "white-ink-alpha-"));
  try {
    const white = separate(dir, "print", await buildPrintPdf(items, input)).get("White Ink")!;
    writeFileSync(join(dir, "mask.pdf"), await buildMaskPdf(items, input));
    run("pdftoppm", ["-png", "-singlefile", "-r", "150", join(dir, "mask.pdf"), join(dir, "mask")]);
    const mask = PNG.sync.read(readFileSync(join(dir, "mask.png")));
    // Page points to 150 DPI pixels; the image spans 144-288pt, one art
    // pixel per 36pt: its transparent ring is 144-180pt, its centre 180-252pt.
    const at = (pt: number) => Math.round((pt * 150) / 72);
    const ink = (x: number, y: number) => white.data[at(y) * white.width + at(x)];
    const blue = (x: number, y: number) => mask.data[(at(y) * mask.width + at(x)) * 4];
    // Centre: full ink (0) on the White Ink plate, mask blue (R=0) on the mask PDF.
    expect(ink(216, 216)).toBe(0);
    expect(blue(216, 216)).toBe(0);
    // Transparent ring: no ink, white on the mask PDF.
    for (const [x, y] of [[160, 160], [216, 160], [270, 216], [160, 270]]) {
      expect(ink(x, y), `White Ink at ${x},${y}`).toBe(255);
      expect(blue(x, y), `mask PDF at ${x},${y}`).toBe(255);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
