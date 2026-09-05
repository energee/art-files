// strokecap.ts — DEV-ONLY: renders the art plate through the canvas backend
// at high magnification and hands back both that raster and the real PDF
// bytes, so stroke geometry on tiny glyph features (periods, i-dots,
// counters) can be compared pixel for pixel against the PDF that prints.
// pdf.js is deliberately NOT used here (headless Chromium lacks
// Math.sumPrecise, which its current build needs) — rasterize the returned
// PDF with pdftoppm at 72 * SCALE dpi and the two rasters line up. Run:
// npm run strokecap. Results land on window.__cap for a driver to read.
import { buildArtPdf } from "../pdf/build";
import { loadFonts } from "../pdf/fonts";
import { planLayers } from "../planLayers";
import { convertConfigV1 } from "../model/convert";
import { resolveLayers } from "../model/resolveLayers";
import { lolevMaster } from "../model/lolevLayers";
import { drawPlate } from "../canvas/draw";
import { labelFontCss, loadLabelFont, loadLabelFaces } from "../fonts";
import { defaultConfig } from "../defaults";
import { hitBoxesFromLayout } from "../hittestLayers";
import { layerBoxes } from "../planLayers";
import { PAGE, previewRasterScale } from "../layout";
import logoSvg from "../assets/logo2025.svg?raw";

const SCALE = 8; // raster px per pt
/** What the shipped 2D preview actually paints at, unzoomed on a retina
 *  display — taken from the policy itself rather than restated, so this page
 *  can't drift away from the density it exists to measure. */
const PREVIEW_SCALE = previewRasterScale(1, 2);
/** Breathing room around a hit box, in points, so a halo isn't clipped. */
const PAD = 3;

/** One element's crop box, in PAGE points with BLEED_SHIFT already applied. */
interface Crop { x: number; y: number; w: number; h: number }

declare global {
  interface Window {
    __cap?: {
      scale: number;
      previewScale: number;
      crops: Record<string, Crop>;
      canvasPng: string; // base64, no data: prefix
      previewPng: string;
      pdf: string; // base64 art PDF
    };
  }
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  // Chunked: one fromCharCode call per 32k slice, not one append per byte.
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

async function run() {
  const report = document.getElementById("report")!;
  // Register browser faces before drawing; placement uses face-aware metrics.
  const [fonts, mf] = await Promise.all([loadFonts(), loadLabelFaces(), loadLabelFont()]);
  const cfg = defaultConfig();
  cfg.abv = "8.5";
  const { label } = convertConfigV1(cfg, false);
  const { layers } = resolveLayers(lolevMaster(), label.enabledVariants, label.values, label.overrides);
  const plan = planLayers(layers, mf, { logoSvg });

  // One spelling of "the art plate at density s", so the magnified capture
  // and the preview-density one can only differ by their density.
  const plate = (s: number) => {
    const el = document.createElement("canvas");
    el.width = Math.round(PAGE.w * s);
    el.height = Math.round(PAGE.h * s);
    drawPlate(el.getContext("2d")!, plan, {}, "art", labelFontCss("poppins"));
    return el.toDataURL("image/png").split(",")[1];
  };

  // One crop per element, from the hit-test boxes — already the union of an
  // element's drawn lines (description, warning and the Info line each place
  // many runs under one id) and already padded by the font's real ascent and
  // descent, so this page has no box maths of its own to drift. Vector items
  // like the laurel come along for free: their strokes go through the same
  // stroker, so the same cavity question applies to their leaf tips.
  const ids = new Set(plan.map((r) => r.id));
  const crops: Record<string, Crop> = {};
  for (const b of hitBoxesFromLayout(layers, layerBoxes(layers, mf, { logoSvg }))) {
    if (!ids.has(b.id)) continue;
    crops[b.id] = {
      x: b.x - PAD, y: b.y - PAD,
      w: b.w + 2 * PAD, h: b.h + 2 * PAD,
    };
  }

  const pdfBytes = await buildArtPdf(plan, { fonts });
  window.__cap = {
    scale: SCALE,
    previewScale: PREVIEW_SCALE,
    crops,
    // Magnified, for comparing geometry against a pdftoppm raster of `pdf`;
    // and at preview density, where the bridge's device-pixel sampling bound
    // actually binds (at SCALE it does not).
    canvasPng: plate(SCALE),
    previewPng: plate(PREVIEW_SCALE),
    pdf: b64(pdfBytes),
  };
  report.textContent = `ready: ${Object.keys(crops).join(", ")}`;
}

run().catch((e) => { document.getElementById("report")!.textContent = String(e); });
