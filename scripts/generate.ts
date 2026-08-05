// generate.ts — Node harness for headless generation and visual iteration:
//   npm run generate -- <texture.png|jpg> <mask.png> <outDir> [config.json]
// Uses the same builders as the web app; pngjs stands in for the canvas.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { buildArtPdf, buildMaskPdf, type Assets, type CollabImage } from "../src/pdf/build";
import { buildPsd, type PsdAssets } from "../src/psd/build";
import { defaultConfig, parseConfigFile } from "../src/defaults";
import { validateMask, recolorMaskForPdf } from "../src/maskimage";
import { validateUpc } from "../src/upc";

const here = dirname(fileURLToPath(import.meta.url));
const asset = (p: string) => join(here, "..", "src", "assets", p);

const argv = process.argv.slice(2);
const flag = (name: string) =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [texturePath, maskPath, outDir, configPath] = argv.filter((a) => !a.startsWith("--"));

/** Load a collab logo by extension: .svg as source text (recolorable per its
 *  slot's style), anything else as raster bytes. */
const collabImage = (p: string | undefined): CollabImage | null =>
  !p
    ? null
    : /\.svg$/i.test(p)
      ? { kind: "svg", svg: readFileSync(p, "utf8") }
      : { kind: /\.jpe?g$/i.test(p) ? "jpg" : "png", bytes: readFileSync(p) };
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

// "none" skips the mask: the white-ink PDF then carries only the
// per-element layer assignments.
let maskPng: Uint8Array | undefined;
if (maskPath !== "none") {
  const mask = PNG.sync.read(readFileSync(maskPath));
  const rgba = new Uint8Array(mask.data.buffer, mask.data.byteOffset, mask.data.length);
  const check = validateMask(rgba);
  if (!check.ok) console.warn(`warning: ${check.error}`);
  recolorMaskForPdf(rgba);
  const buf = PNG.sync.write(mask);
  maskPng = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
}

// Read once — both the PDF assets and the PSD's pixel decode use these bytes.
const textureBytes = texturePath === "none" ? undefined : readFileSync(texturePath);

const assets: Assets = {
  fonts: {
    regular: readFileSync(asset("fonts/Poppins-Regular.ttf")),
    semibold: readFileSync(asset("fonts/Poppins-SemiBold.ttf")),
    bold: readFileSync(asset("fonts/Poppins-Bold.ttf")),
  },
  logoSvg: readFileSync(asset("logo2025.svg"), "utf8"),
  collabLeft: collabImage(flag("collab-left")),
  collabCenter: collabImage(flag("collab-center")),
  // "none" skips the texture: the art PDF is then just the elements on
  // bare stock (matches the app's pre-drop preview).
  texture: textureBytes && {
    bytes: textureBytes,
    kind: /\.jpe?g$/i.test(texturePath) ? "jpg" : "png",
  },
  maskPng,
};

// The PSD's texture layer takes decoded pixels; buildPsd centres them. PNG
// only — a JPG texture still reaches both PDFs, the PSD just ships without
// the background layer (Node has no JPEG decoder here; the browser gets one
// free from canvas).
let texturePixels: PsdAssets["texture"];
if (assets.texture?.kind === "png") {
  const t = PNG.sync.read(textureBytes!);
  texturePixels = {
    data: new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.length),
    width: t.width,
    height: t.height,
  };
} else if (assets.texture) {
  console.warn("warning: JPG texture — PSD will omit the background layer");
}

mkdirSync(resolve(outDir), { recursive: true });
const art = await buildArtPdf(cfg, assets);
const maskPdf = await buildMaskPdf(cfg, assets);
const psd = await buildPsd(cfg, {
  fonts: assets.fonts,
  logoSvg: assets.logoSvg,
  texture: texturePixels,
});
const artOut = join(outDir, `${cfg.beerName}.pdf`);
const maskOut = join(outDir, `${cfg.beerName}-mask.pdf`);
const psdOut = join(outDir, `${cfg.beerName}.psd`);
writeFileSync(artOut, art);
writeFileSync(maskOut, maskPdf);
writeFileSync(psdOut, psd);
console.log(`wrote ${artOut} (${(art.length / 1e6).toFixed(1)}MB)`);
console.log(`wrote ${maskOut} (${(maskPdf.length / 1e6).toFixed(1)}MB)`);
console.log(`wrote ${psdOut} (${(psd.length / 1e6).toFixed(1)}MB)`);
