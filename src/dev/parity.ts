// parity.ts — DEV-ONLY: renders each fixture config through the canvas
// backend and through the real PDF pipeline (build + pdf.js raster), then
// reports the per-plate pixel difference. Font rasterization differs between
// the two engines, so the threshold is loose by design — the plan-level
// vitest suites carry the strictness; this page exists for compositing and
// geometry drift, which shows up as whole-percent jumps, not fractions.
import { buildArtPdf, buildMaskPdf, type Assets } from "../pdf/build";
import { loadFonts } from "../pdf/fonts";
import { renderPdfPage } from "../pdf/render";
import { planLayers } from "../planLayers";
import { convertConfigV1 } from "../model/convert";
import { resolveLayers } from "../model/resolveLayers";
import { lolevMaster } from "../model/lolevLayers";
import { drawPlate, type CanvasAssets } from "../canvas/draw";
import { labelFontCss, loadLabelFont, loadLabelFaces } from "../fonts";
import { defaultConfig } from "../defaults";
import { PAGE } from "../layout";
import type { LabelConfig } from "../types";
import logoSvg from "../assets/logo2025.svg?raw";

const SCALE = 2; // raster px per pt — plenty to see geometry drift
/** Channel delta below which a pixel counts as equal (antialias noise). */
const CHANNEL_TOLERANCE = 24;
/** Max fraction of differing pixels per plate. Tuned to ~2x the worst
 *  observed PASS value from a real run (markers/art: 2.483%; see
 *  task-5-report.md for all four numbers). */
const MAX_DIFF_PCT = 5;

/** A deterministic synthetic texture, so the cover-fit and draw-over-art
 *  paths are exercised without a bundled photo. */
function syntheticTexture(): Promise<{ bytes: Uint8Array; bitmap: ImageBitmap }> {
  const c = new OffscreenCanvas(800, 500);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 800, 500);
  g.addColorStop(0, "#3a3a44");
  g.addColorStop(1, "#14141a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 800, 500);
  return c.convertToBlob({ type: "image/png" }).then(async (blob) => ({
    bytes: new Uint8Array(await blob.arrayBuffer()),
    bitmap: await createImageBitmap(blob),
  }));
}

/** Marker-heavy fixture: header + inline bold + multiple description lines,
 *  plus a stroked volume line and tracked name — exercises description.ts's
 *  markdown subset (`# header`, `**bold**`) alongside Style's stroke/
 *  strokeWidth/letterSpacing fields. */
function markerConfig(): LabelConfig {
  const cfg = defaultConfig();
  return {
    ...cfg,
    beerName: "Parity Test",
    description: "# HEADER\nA **bold** run and a plain one\nSecond **bold** line here",
    volume: { ...cfg.volume, stroke: "#112233", strokeWidth: 20 },
    nameStyle: { ...cfg.nameStyle, letterSpacing: 1.2 },
  };
}

function diffPct(a: ImageData, b: ImageData): { pct: number; heat: ImageData } {
  const heat = new ImageData(a.width, a.height);
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
    );
    if (d > CHANNEL_TOLERANCE) {
      differing++;
      heat.data[i] = 255;
      heat.data[i + 3] = 255;
    }
  }
  return { pct: (differing / (a.data.length / 4)) * 100, heat };
}

async function run() {
  const report = document.getElementById("report")!;
  const [fonts, mf, texture] = await Promise.all([
    loadFonts(), loadLabelFaces(), syntheticTexture(),
  ]);
  await loadLabelFont();
  const w = Math.round(PAGE.w * SCALE);
  const h = Math.round(PAGE.h * SCALE);

  for (const [name, cfg] of [["default", defaultConfig()], ["markers", markerConfig()]] as const) {
    const pdfAssets: Assets = { fonts, images: { texture: { bytes: texture.bytes, kind: "png" } } };
    const canvasAssets: CanvasAssets = { images: { texture: texture.bitmap } };
    const { label } = convertConfigV1(cfg, false);
    const { layers } = resolveLayers(lolevMaster(), label.enabledVariants, label.values, {
      ...label.overrides, background: { asset: "texture" },
    });
    const plan = planLayers(layers, mf, { logoSvg, custom: { texture: { aspect: 800 / 500 } } });
    for (const mode of ["art", "mask"] as const) {
      const pdfBytes = mode === "art"
        ? await buildArtPdf(plan, pdfAssets) : await buildMaskPdf(plan, pdfAssets);
      const pdfCanvas = document.createElement("canvas");
      await renderPdfPage(pdfBytes, { canvas: pdfCanvas, size: { width: w, height: h } });
      const ours = document.createElement("canvas");
      ours.width = w;
      ours.height = h;
      // Dev harness compares poppins configs only, spelled explicitly now
      // that drawPlate no longer defaults the family.
      drawPlate(ours.getContext("2d")!, plan, canvasAssets, mode, labelFontCss("poppins"));

      const A = ours.getContext("2d")!.getImageData(0, 0, w, h);
      const B = pdfCanvas.getContext("2d")!.getImageData(0, 0, w, h);
      const { pct, heat } = diffPct(A, B);
      const heatCanvas = document.createElement("canvas");
      heatCanvas.width = w;
      heatCanvas.height = h;
      heatCanvas.getContext("2d")!.putImageData(heat, 0, 0);

      const row = document.createElement("div");
      const ok = pct <= MAX_DIFF_PCT;
      row.innerHTML = `<h2 style="font-size:13px;color:${ok ? "#7c7" : "#f66"}">
        ${name} / ${mode}: ${pct.toFixed(3)}% differing — ${ok ? "PASS" : "FAIL"} (max ${MAX_DIFF_PCT}%)</h2>`;
      for (const [label, c] of [["canvas", ours], ["pdf", pdfCanvas], ["diff", heatCanvas]] as const) {
        c.style.width = "420px";
        c.title = label;
        c.style.marginRight = "8px";
        c.style.background = "#fff";
        row.appendChild(c);
      }
      report.appendChild(row);
    }
  }
}

run().catch((e) => {
  document.getElementById("report")!.textContent = String(e);
});
