// ai-format-proof.ts — the #597 format gate: writes proof/ai-format-proof.ai,
// a PDF-compatible Illustrator file built by the real print-PDF builder from
// a display list whose text is pre-converted to glyph outlines. It answers
// one question in Illustrator: does buildPrintPdf's PDF, with no live type,
// open as selectable vector paths, an embedded transparent raster and a
// White Ink spot that overprints? It is not the exporter (docs/plans/ai-export.md).
//
// Run: npx tsx scripts/ai-format-proof.ts
//
// Strokes: the QR keyline arrives already expanded (planLayers grows the
// modules into a filled path). Expanding a text or logo stroke needs a path
// boolean engine the repo does not have yet (plan Task 2), so this proof
// draws text and the logo unstroked and fails fast on any live stroke.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import type { Font } from "@pdf-lib/fontkit";
import { buildPrintPdf, pdfMeasureFace, type Assets } from "../src/pdf/build";
import { outlineText } from "../src/pdf/outline";
import { openFont } from "../src/fontkit";
import { FONT_FAMILIES, type FontFamilyId } from "../src/fontCatalog";
import { digitStartX } from "../src/plan";
import { planLayers, type PlacedLayer } from "../src/planLayers";
import { svgAspect } from "../src/logo";
import { CENTER_X, GOLD, PAGE } from "../src/layout";
import type { Layer } from "../src/model/layers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fontDir = join(root, "src", "assets", "fonts");
const pack = (id: FontFamilyId): Assets["fonts"] => {
  const f = FONT_FAMILIES[id].files;
  const read = (n: string) => new Uint8Array(readFileSync(join(fontDir, n)));
  return { regular: read(f.regular), semibold: read(f.semibold), bold: read(f.bold) };
};

/** 256x256 RGBA: an 8px red/blue checkerboard (detects resampling) inside a
 *  disc whose alpha ramps to zero over its outer 32px (detects matte fringes
 *  and alpha loss). Everything outside the disc is fully transparent. */
function transparentPng(): Uint8Array {
  const size = 256;
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
    const red = ((x >> 3) + (y >> 3)) % 2 === 0;
    png.data[i] = red ? 220 : 20;
    png.data[i + 1] = 40;
    png.data[i + 2] = red ? 40 : 200;
    png.data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, (128 - r) / 32)));
  }
  return new Uint8Array(PNG.sync.write(png));
}

/** The uploaded White Ink mask, at the page's aspect: five bands of red
 *  0/64/128/191/255 (100/75/50/25/0% ink; only red is read, see
 *  embedWhiteInkMask), opaque on top and 50% alpha below. */
function maskPng(): PNG {
  const w = 160, h = Math.round(w * PAGE.h / PAGE.w);
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const red = [0, 64, 128, 191, 255][Math.floor((x * 5) / w)];
    png.data.set([red, red, 255, y < h / 2 ? 255 : 128], i);
  }
  return png;
}

const MASK = "proof-mask";
const LOGO = "proof-logo";
const RASTER = "proof-raster";
const METAL = { fill: GOLD, layer: "metallic" } as const;
const BLACK_KEYLINE = { stroke: "#000000", strokeLayer: "white", strokeWidth: 15 } as const;

/** The proof label: Barlow ligature/counter text (upright, rotated, and a
 *  White Ink run overlapping a process run), the curved laurel logo, a QR
 *  with an expanded keyline, a UPC-A with outlined digits, and one
 *  transparent raster overlapping White Ink text, all over an uploaded
 *  White Ink mask with partial tints and partial alpha. */
function proofLayers(): Layer[] {
  const text = (l: Partial<Layer> & Pick<Layer, "id" | "x" | "y">, line: string, size: number, extra = {}): Layer => ({
    kind: "text", name: l.id, enabled: true, anchor: "left", align: "left",
    fontFamily: "barlow-condensed", size, style: { ...METAL }, faces: { base: "bold", bold: "bold" },
    lines: [{ text: line, ...METAL }], ...extra, ...l,
  } as Layer);
  return [
    { kind: "image", id: "mask", name: "Mask", enabled: true, role: "mask", asset: MASK, fit: "cover",
      x: 0, anchor: "left", y: 0, w: PAGE.w, h: PAGE.h, style: { ...METAL } },
    { kind: "image", id: "logo", name: "Logo", enabled: true, asset: LOGO, x: CENTER_X, anchor: "center",
      y: 30, w: 120, style: { ...METAL } },
    text({ id: "ligatures", x: 40, y: 150 }, "office B8 AVATAR", 44),
    text({ id: "white-ink", x: 60, y: 182 }, "WHITE INK 0O8", 30,
      { style: { fill: "#FFFFFF", layer: "white" }, lines: [{ text: "WHITE INK 0O8", fill: "#FFFFFF", layer: "white" }] }),
    text({ id: "rotated", x: 540, y: 150, rotation: 90 }, "WAVE TOWER office", 14, { faces: { base: "regular", bold: "bold" } }),
    { kind: "qr", id: "qr", name: "QR", enabled: true, value: "https://example.com/proof", x: 40, anchor: "left",
      y: 250, size: 80, qrStyle: "square", style: { ...METAL, ...BLACK_KEYLINE } },
    { kind: "barcode", id: "upc", name: "UPC", enabled: true, symbology: "upc-a", value: "012345678905",
      x: 200, anchor: "left", y: 255, h: 30, moduleW: 1.5, style: { fill: "#000000", layer: "metallic", stroke: "none" } },
    { kind: "image", id: "raster", name: "Raster", enabled: true, asset: RASTER, x: 330, anchor: "left",
      y: 140, w: 100, style: { ...METAL } },
  ];
}

const rectPath = (b: { x: number; yTop: number; w: number; h: number }) =>
  `M ${b.x} ${b.yTop} h ${b.w} v ${b.h} h ${-b.w} Z`;

/** Replace every live-type or live-stroke item with filled `paths` items in
 *  label space (x 0, y 0, as outlineText's paths expect). Rasters pass
 *  through. A stroke has no outline engine here yet, so it throws rather
 *  than ship a live stroke. */
export function outlineItems(items: readonly PlacedLayer[], font: (face: "regular" | "semibold" | "bold", family?: FontFamilyId) => Font): PlacedLayer[] {
  const noStroke = (id: string) => { throw new Error(`${id}: stroke expansion is not part of the format proof`); };
  return items.flatMap((r): PlacedLayer[] => {
    if (r.kind === "text") {
      if (r.stroke) noStroke(r.id);
      return [{ kind: "paths", id: r.id, paths: outlineText(font(r.face, r.fontFamily), r), x: 0, y: 0, fill: r.fill, layer: r.layer, stroke: null }];
    }
    if (r.kind === "paths" && r.stroke) noStroke(r.id);
    if (r.kind !== "barcode") return [r];
    if (r.S > 0 && r.stroke !== "none") noStroke(r.id);
    const digits = r.digits.flatMap((d) => outlineText(font("regular"), {
      kind: "text", id: r.id, text: d.text, face: "regular", size: r.textSize,
      x: digitStartX(d, r.rotated), y: d.y, rotated: r.rotated,
      fill: r.fill, layer: r.fillLayer, w: d.w, tracking: 0, stroke: null,
    }));
    return [{ kind: "paths", id: r.id, paths: [r.geo.bars.map(rectPath).join(" "), ...digits], x: 0, y: 0, fill: r.fill, layer: r.fillLayer, stroke: null }];
  });
}

/** The proof file's bytes: plan with the export measure, outline, then the
 *  unchanged print-PDF builder. */
export async function buildAiFormatProof(): Promise<Uint8Array> {
  const poppins = pack("poppins");
  const barlow = pack("barlow-condensed");
  const fontFamilies = { poppins, "barlow-condensed": barlow };
  const logo = readFileSync(join(root, "src", "assets", "logo2025.svg"), "utf8");
  const raster = transparentPng();
  const mask = maskPng();
  const measure = await pdfMeasureFace(fontFamilies, "poppins");
  const items = planLayers(proofLayers(), measure, {
    custom: { [LOGO]: { aspect: svgAspect(logo), art: { kind: "svg", svg: logo } }, [RASTER]: { aspect: 1 },
      [MASK]: { aspect: mask.width / mask.height } },
  });
  const opened = new Map<Uint8Array, Font>();
  const font = (face: "regular" | "semibold" | "bold", family: FontFamilyId = "poppins") => {
    const bytes = fontFamilies[family][face];
    if (!opened.has(bytes)) opened.set(bytes, openFont(bytes));
    return opened.get(bytes)!;
  };
  return buildPrintPdf(outlineItems(items, font), {
    fonts: poppins, fontFamilies, title: "AI format proof",
    images: {
      [LOGO]: { kind: "svg", svg: logo },
      [RASTER]: { kind: "png", bytes: raster },
      [MASK]: { kind: "png", bytes: new Uint8Array(PNG.sync.write(mask)) },
    },
    maskPixels: { data: new Uint8ClampedArray(mask.data), width: mask.width, height: mask.height },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(root, "proof", "ai-format-proof.ai");
  mkdirSync(dirname(out), { recursive: true });
  const bytes = await buildAiFormatProof();
  writeFileSync(out, bytes);
  console.log(`${out} (${bytes.length} bytes)`);
}
