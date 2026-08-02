// generate.ts — Node harness for headless generation and visual iteration:
//   npm run generate -- <texture.png|jpg> <mask.png> <outDir> [config.json]
// Uses the same builders as the web app; pngjs stands in for the canvas.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { buildArtPdf, buildMaskPdf, type Assets } from "../src/pdf/build";
import { defaultConfig, parseConfigFile } from "../src/defaults";
import { validateMask, recolorMaskForPdf } from "../src/maskimage";
import { validateUpc } from "../src/upc";

const here = dirname(fileURLToPath(import.meta.url));
const asset = (p: string) => join(here, "..", "src", "assets", p);

const [texturePath, maskPath, outDir, configPath] = process.argv.slice(2);
if (!texturePath || !maskPath || !outDir) {
  console.error("usage: npm run generate -- <texture> <mask.png> <outDir> [config.json]");
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

const mask = PNG.sync.read(readFileSync(maskPath));
const rgba = new Uint8Array(mask.data.buffer, mask.data.byteOffset, mask.data.length);
const check = validateMask(rgba);
if (!check.ok) console.warn(`warning: ${check.error}`);
recolorMaskForPdf(rgba);
const maskPng = PNG.sync.write(mask);

const assets: Assets = {
  fonts: {
    regular: readFileSync(asset("fonts/Poppins-Regular.ttf")),
    semibold: readFileSync(asset("fonts/Poppins-SemiBold.ttf")),
    bold: readFileSync(asset("fonts/Poppins-Bold.ttf")),
  },
  logoSvg: readFileSync(asset("logo2025.svg"), "utf8"),
  texture: {
    bytes: readFileSync(texturePath),
    kind: /\.jpe?g$/i.test(texturePath) ? "jpg" : "png",
  },
  maskPng: new Uint8Array(maskPng.buffer, maskPng.byteOffset, maskPng.length),
};

mkdirSync(resolve(outDir), { recursive: true });
const art = await buildArtPdf(cfg, assets);
const maskPdf = await buildMaskPdf(cfg, assets);
const artOut = join(outDir, `${cfg.beerName}.pdf`);
const maskOut = join(outDir, `${cfg.beerName}-mask.pdf`);
writeFileSync(artOut, art);
writeFileSync(maskOut, maskPdf);
console.log(`wrote ${artOut} (${(art.length / 1e6).toFixed(1)}MB)`);
console.log(`wrote ${maskOut} (${(maskPdf.length / 1e6).toFixed(1)}MB)`);
