// useExport.ts — the editor's full-resolution exports, split out of App.tsx
// (#416): the PDF and PSD pairs built on demand from the same layers the
// preview draws, the export-in-flight and "Saved …" note state the header
// shows, and the batch of download URLs every save (exports, Save Project,
// Save Master) hands its plain-download fallback through.
import { useEffect, useRef, useState } from "react";
import { saveThrough } from "@/files";
import { errMsg } from "@/lib/utils";
import type { Fill } from "@/types";
import type { Layer } from "@/model/layers";
import { PAGE_ART_ID } from "@/model/layers";
import { planLayers, type PlacedLayer } from "@/planLayers";
import type { PlanAssets } from "@/plan";
import type { RenderSettings } from "@/settings";
import { FONT_URLS } from "@/fonts";
import type { FontFamilyId } from "@/fontCatalog";
import { loadFonts } from "@/pdf/fonts";
// The builders are imported dynamically at export time (buildFull, exportPsd,
// which runs buildPsd in a worker) so they stay out of the initial bundle;
// only their types are needed up front.
import type { Assets, CollabImage } from "@/pdf/build";
import type { PsdAssets } from "@/psd/build";
import { blobUrl, download, rasterPixelsNatural, tintedPng, type CustomFile } from "@/assets/io";

/** The texture/mask bytes for a build (App.tsx pageArt): absent when the
 *  slot is empty or its page-art layer is switched off. */
export type PageArt = {
  texture?: { bytes: Uint8Array; kind: "png" | "jpg" };
  maskPng?: Uint8Array;
};

export type ExportInputs = {
  /** The layers that draw — what the preview plans from, and so the exports. */
  drawLayers: Layer[];
  /** The master's font family (fontCatalog fontFamilyOf). */
  family: FontFamilyId;
  /** The image assets the document still names (App.tsx liveImages). */
  liveImages: Record<string, CustomFile>;
  /** The planner's asset descriptors (App.tsx planAssetsOf). */
  planAssets: () => PlanAssets;
  pageArt: (preview: boolean) => PageArt;
  /** The document title the PDFs carry, and the base of every file name. */
  title: string;
  exportBase: string;
  /** Bleed and DPI, handed to the PSD workers with each job. */
  render: RenderSettings;
  /** The header's build-error channel: export failures and cancel notes. */
  setBuildError: (error: string) => void;
};

export function useExport({
  drawLayers, family, liveImages, planAssets, pageArt, title, exportBase, render, setBuildError,
}: ExportInputs) {
  // The export in flight, if any: it blurs the preview under a note naming
  // the files being built (#401), and blocks a second export.
  const [exporting, setExporting] = useState<"pdf" | "psd" | null>(null);
  // The files the last export wrote (#400): shown until the next edit or
  // export, since an edit makes those files stale. exportFresh goes false on
  // any edit, so an export that an edit overlapped confirms nothing: its
  // files hold the label as it was when the export began.
  const [exportNote, setExportNote] = useState("");
  const exportFresh = useRef(false);
  const exportStale = () => { exportFresh.current = false; setExportNote(""); };

  // Revoking immediately can abort a large download, so each URL lives until
  // the NEXT save batch — or until the tab closes, which releases them so
  // they don't pin their bytes for the rest of the session (#85).
  const lastSaved = useRef<string[]>([]);
  useEffect(() => () => lastSaved.current.forEach((u) => URL.revokeObjectURL(u)), []);
  function startSaveBatch() {
    lastSaved.current.forEach((u) => URL.revokeObjectURL(u));
    lastSaved.current = [];
  }
  function saveBytes(bytes: Uint8Array, name: string, type = "application/pdf") {
    const url = blobUrl(bytes, type);
    lastSaved.current.push(url);
    download(url, name);
  }
  /** Save one exported file through the platform's save dialog. Tauri uses
   *  the OS dialog; supported browsers use File System Access; Safari/Firefox
   *  keep the plain-download fallback. */
  async function saveVia(bytes: Uint8Array, name: string, type: string) {
    const extension = name.slice(name.lastIndexOf(".") + 1);
    const description = `${extension.toUpperCase()} file`;
    return await saveThrough(bytes, {
      name, type, filter: { name: description, extensions: [extension] },
      types: [{ description, accept: { [type]: [`.${extension}`] } }],
    }, saveBytes);
  }

  /** Every image asset's embed bytes, tinted where a layer asks
   *  (`tintRaster`): what the exports embed. Async because a tinted raster
   *  has to be decoded and re-encoded; SVG and untinted rasters pass through.
   *  The preview decodes liveImages as-is and tints at draw time instead
   *  (the plan's image items carry `tint`), so it never calls this (#414). */
  async function imageAssets(): Promise<Record<string, CollabImage>> {
    const tints = new Map<string, Fill>(drawLayers.flatMap((l) =>
      l.kind === "image" && l.tintRaster && l.asset ? [[l.asset, l.style.fill] as const] : []));
    const out: Record<string, CollabImage> = {};
    for (const [id, c] of Object.entries(liveImages)) {
      const fill = tints.get(id);
      out[id] = c.image.kind !== "svg" && fill
        ? { kind: "png", bytes: await tintedPng(c.image.bytes, fill) }
        : c.image;
    }
    return out;
  }

  /** The full-resolution display list for an export: the same layers the
   *  preview draws, planned with the pdf-lib widths the PDF draws with
   *  (pdfMeasureFace — unkerned, #86) and the full-size asset descriptors.
   *  Every bundled family is loaded so a layer's own font measures true. */
  async function exportPlan(): Promise<{ plan: PlacedLayer[]; images: Record<string, CollabImage>; fontFamilies: Assets["fontFamilies"] }> {
    const [{ pdfMeasureFace }, loaded] = await Promise.all([
      import("@/pdf/build"),
      Promise.all((Object.keys(FONT_URLS) as FontFamilyId[]).map(async (id) => [id, await loadFonts(id)] as const)),
    ]);
    const packs = Object.fromEntries(loaded) as Record<FontFamilyId, Assets["fonts"]>;
    const plan = planLayers(drawLayers, await pdfMeasureFace(packs, family), planAssets());
    const families = new Set(plan.flatMap((run) => run.kind === "text" && run.fontFamily ? [run.fontFamily] : []));
    const fontFamilies = Object.fromEntries([...families].map((id) => [id, packs[id]]));
    return { plan, images: await imageAssets(), fontFamilies };
  }

  const exportRunning = useRef(false);
  async function exportPair(
    extension: "pdf" | "psd", type: string,
    build: () => Promise<(Uint8Array | null)[]>,
  ) {
    if (exportRunning.current) return;
    exportRunning.current = true;
    setExporting(extension);
    setExportNote("");
    exportFresh.current = true;
    startSaveBatch();
    const saved: string[] = [];
    let pending = "";
    try {
      const pair = await build();
      for (const [index, bytes] of pair.entries()) {
        if (!bytes) continue;
        pending = `${exportBase}${index ? "-mask" : ""}.${extension}`;
        const result = await saveVia(bytes, pending, type);
        if (!result) {
          setBuildError(`Note: ${saved.length ? `Saved ${saved.join(", ")}. ` : ""}Export cancelled before saving ${pending}.`);
          return;
        }
        saved.push(result.name);
      }
      setBuildError("");
      if (exportFresh.current) setExportNote(`Saved ${saved.join(", ")}.`);
    } catch (error) {
      setBuildError(`${saved.length ? `Saved ${saved.join(", ")}. ` : ""}${pending ? `Could not save ${pending}: ` : ""}${errMsg(error)}`);
    } finally {
      exportRunning.current = false;
      setExporting(null);
    }
  }

  /** Build full-resolution plates before opening either save dialog. */
  async function buildFull(which: "art" | "mask" | "both") {
    await exportPair("pdf", "application/pdf", async () => {
      const [{ buildArtPdf, buildMaskPdf }, fonts, { plan, images, fontFamilies }] = await Promise.all([
        import("@/pdf/build"), loadFonts(family), exportPlan(),
      ]);
      const art = pageArt(false);
      const assets: Assets = {
        fonts, fontFamilies, title,
        images: {
          ...images,
          ...(art.texture ? { [PAGE_ART_ID.background]: art.texture } : {}),
          ...(art.maskPng ? { [PAGE_ART_ID.mask]: { kind: "png" as const, bytes: art.maskPng } } : {}),
        },
      };
      // Both files build BEFORE the first dialog opens.
      return await Promise.all([
        which !== "mask" ? buildArtPdf(plan, assets) : null,
        which !== "art" ? buildMaskPdf(plan, assets) : null,
      ]);
    });
  }

  /** Layered Photoshop files, built full-resolution on demand like the PDFs,
   *  off the main thread (psd/offThread.ts). Image decoding (psdImages) still
   *  runs here: it needs a canvas. `which` picks a single plate or (default)
   *  both. */
  async function exportPsd(which: "both" | "art" | "mask" = "both") {
    await exportPair("psd", "image/vnd.adobe.photoshop", async () => {
      const [{ psdImages }, { buildPsdOffThread }, fonts, { plan, images }] = await Promise.all([
        import("@/psd/build"), import("@/psd/offThread"), loadFonts(family), exportPlan(),
      ]);
      const art = pageArt(false);
      const assets: PsdAssets = {
        fonts, fontFamily: family,
        images: await psdImages(images, { texture: art.texture?.bytes, mask: art.maskPng }, rasterPixelsNatural),
      };
      // Each plate builds in its own worker (#415); the worker's layout.ts
      // gets this editor's bleed and DPI with the job.
      const geometry = { bleedIn: render.bleedIn, dpi: render.dpi };
      const plate = (mode: "art" | "mask") =>
        buildPsdOffThread({ items: plan, assets, mode, opts: { layers: drawLayers }, geometry });
      return await Promise.all([
        which !== "mask" ? plate("art") : null,
        which !== "art" ? plate("mask") : null,
      ]);
    });
  }

  return { exporting, exportNote, exportStale, startSaveBatch, saveBytes, buildFull, exportPsd };
}
