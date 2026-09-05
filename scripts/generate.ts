// generate.ts — Node harness for headless generation and visual iteration:
//   npm run generate -- <texture.png|jpg> <mask.png> <outDir> [config.json]
// Uses the same builders as the web app; pngjs stands in for the canvas.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { convertConfigV1 } from "../src/model/convert";
import { lolevMaster } from "../src/model/lolevLayers";
import { resolveLayers } from "../src/model/resolveLayers";
import { planLayers } from "../src/planLayers";
import type { PlanAssets } from "../src/plan";
import { buildArtPdf, buildMaskPdf, type Assets, type CollabImage } from "../src/pdf/build";
import type { CollabSlot } from "../src/types";
import { buildPsd, type PsdAssets } from "../src/psd/build";
import { defaultConfig, parseConfigFile } from "../src/defaults";
import { rasterKind, tintRgba } from "../src/collab";
import { validateUpc } from "../src/upc";
import { FONT_FAMILIES, fontFamilyOf } from "../src/fontCatalog";

const here = dirname(fileURLToPath(import.meta.url));
const asset = (p: string) => join(here, "..", "src", "assets", p);

const argv = process.argv.slice(2);
const flag = (name: string) =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [texturePath, maskPath, outDir, configPath] = argv.filter((a) => !a.startsWith("--"));

/** Load a collab logo by extension: .svg as source text (recolorable per its
 *  slot's style), anything else as raster bytes. */
const collabImage = (p: string | undefined, slot: CollabSlot): CollabImage | null => {
  if (!p) return null;
  if (/\.svg$/i.test(p)) return { kind: "svg", svg: readFileSync(p, "utf8") };
  // Color overlay: repaint the pixels before embedding. PNG only — pngjs is
  // the harness's only decoder, so a JPEG passes through untinted.
  if (slot.tintRaster && /\.png$/i.test(p)) {
    const png = PNG.sync.read(readFileSync(p));
    tintRgba(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length), slot.fill);
    return { kind: "png", bytes: PNG.sync.write(png) };
  }
  // Unlike the browser app, which tints any raster via canvas.
  if (slot.tintRaster) console.warn(`warning: ${p} — tint is PNG-only here, embedding untinted`);
  return { kind: rasterKind(p), bytes: readFileSync(p) };
};
if (!texturePath || !maskPath || !outDir) {
  console.error(
    "usage: npm run generate -- <texture|none> <mask.png|none> <outDir> [config.json] " +
      "[--collab-left=<file>] [--collab-center=<file>]",
  );
  process.exit(1);
}

const cfg = configPath
  ? parseConfigFile(readFileSync(configPath, "utf8"))
  : defaultConfig();

const upc = validateUpc(cfg.upc);
if (!upc.ok) {
  console.error(upc.error);
  process.exit(1);
}

const fontFiles = FONT_FAMILIES[fontFamilyOf(cfg)].files;
const assets: Assets = {
  fonts: {
    regular: readFileSync(asset(`fonts/${fontFiles.regular}`)),
    semibold: readFileSync(asset(`fonts/${fontFiles.semibold}`)),
    bold: readFileSync(asset(`fonts/${fontFiles.bold}`)),
  },
  images: {},
};
const psdAssets: PsdAssets = { fonts: assets.fonts, fontFamily: fontFamilyOf(cfg), images: {} };
const planAssets: PlanAssets = { logoSvg: readFileSync(asset("logo2025.svg"), "utf8"), custom: {} };
const metrics = await PDFDocument.create();
metrics.registerFontkit(fontkit);
const fonts = {
  regular: await metrics.embedFont(assets.fonts.regular),
  semibold: await metrics.embedFont(assets.fonts.semibold),
  bold: await metrics.embedFont(assets.fonts.bold),
};
const left = flag("collab-left");
const center = flag("collab-center");
if (left) cfg.collabLeft.image = "collab-left";
if (center) cfg.collabCenter.image = "collab-center";
const converted = convertConfigV1(cfg, !!(left || center));
const { label } = converted;
const resolved = resolveLayers(lolevMaster(), label.enabledVariants, label.values, {
  ...label.overrides,
  background: { asset: texturePath === "none" ? "" : "texture" },
  mask: { asset: maskPath === "none" ? "" : "mask" },
});
for (const warning of [...converted.warnings, ...resolved.warnings]) console.warn(warning);
if (Object.keys(resolved.errors).length) throw new Error(Object.values(resolved.errors).join("\n"));
for (const [id, img] of [
  ["texture", texturePath === "none" ? null : { kind: rasterKind(texturePath), bytes: readFileSync(texturePath) }],
  ["mask", maskPath === "none" ? null : { kind: "png", bytes: readFileSync(maskPath) }],
  ["collab-left", collabImage(left, cfg.collabLeft)],
  ["collab-center", collabImage(center, cfg.collabCenter)],
] as [string, CollabImage | null][]) {
  if (!img) continue;
  assets.images![id] = img;
  if (img.kind === "svg") {
    planAssets.custom![id] = { aspect: 1, art: img };
    continue;
  }
  const embedded = img.kind === "png" ? await metrics.embedPng(img.bytes) : await metrics.embedJpg(img.bytes);
  planAssets.custom![id] = { aspect: embedded.width / embedded.height };
  if (img.kind === "png") {
    const png = PNG.sync.read(Buffer.from(img.bytes));
    psdAssets.images![id] = { data: new Uint8Array(png.data), width: png.width, height: png.height };
  } else {
    console.warn(`warning: ${id} is JPEG — PSD will omit this raster layer`);
  }
}
const layers = resolved.layers;
const plan = planLayers(layers, (text, size, face) => fonts[face].widthOfTextAtSize(text, size), planAssets);

mkdirSync(resolve(outDir), { recursive: true });
const art = await buildArtPdf(plan, assets);
const maskPdf = await buildMaskPdf(plan, assets);
const psd = await buildPsd(plan, psdAssets, "art", { layers });
const maskPsd = await buildPsd(plan, psdAssets, "mask", { layers });
const artOut = join(outDir, `${cfg.beerName}.pdf`);
const maskOut = join(outDir, `${cfg.beerName}-mask.pdf`);
const psdOut = join(outDir, `${cfg.beerName}.psd`);
const maskPsdOut = join(outDir, `${cfg.beerName}-mask.psd`);
writeFileSync(artOut, art);
writeFileSync(maskOut, maskPdf);
writeFileSync(psdOut, psd);
writeFileSync(maskPsdOut, maskPsd);
console.log(`wrote ${artOut} (${(art.length / 1e6).toFixed(1)}MB)`);
console.log(`wrote ${maskOut} (${(maskPdf.length / 1e6).toFixed(1)}MB)`);
console.log(`wrote ${psdOut} (${(psd.length / 1e6).toFixed(1)}MB)`);
console.log(`wrote ${maskPsdOut} (${(maskPsd.length / 1e6).toFixed(1)}MB)`);
