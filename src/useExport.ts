// useExport.ts — the editor's full-resolution exports, split out of App.tsx
// (#416): the PDF and PSD pairs built on demand from the same layers the
// preview draws, the export-in-flight and "Saved …" note state the header
// shows, where this tab's desktop exports were last written (so a repeat
// export needs no dialog), and the batch of download URLs every save
// (exports, Save Label, Save Master) hands its plain-download fallback through.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { saveThrough, type FileTarget } from "@/files";
import { errMsg } from "@/lib/utils";
import { useOwnedError } from "@/useOwnedError";
import type { Fill } from "@/types";
import { PAGE_ART_ID, type Layer } from "@/model/layers";
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
type PageArt = {
  texture?: { bytes: Uint8Array; kind: "png" | "jpg" };
  maskPng?: Uint8Array;
};

type ExportInputs = {
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
  /** The header's build-error channel: export failures and cancel notes.
   *  Shared with asset, master and menu errors, so it takes App's raw setter:
   *  a successful export clears the slot only while it still holds the
   *  export's own message (#473). */
  setBuildError: Dispatch<SetStateAction<string>>;
};

/** Where an export writes. `labelPath` is the tab's bound .label (desktop
 *  only): a first export's dialog opens beside it, under its name. `ask`
 *  (Export … As…) opens the dialog even when a file is remembered. */
type ExportRequest = { labelPath?: string | null; ask?: boolean };

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
  // Desktop export destinations, scoped to the label they were chosen from.
  // The one-file print PDF remembers its destination separately from the
  // two-file pair, but both default to `<label>.pdf`: a print export into a
  // folder holding an older pair replaces its art file and leaves its
  // `-mask.pdf` behind.
  const exportPaths = useRef<{
    label?: string | null;
    pdf?: string;
    printPdf?: string;
    psd?: string;
  }>({});
  const forgetExportPaths = () => { exportPaths.current = {}; };

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
   *  keep the plain-download fallback. A `target` writes there with no
   *  dialog. */
  async function saveVia(bytes: Uint8Array, name: string, type: string, target?: FileTarget) {
    const extension = name.slice(name.lastIndexOf(".") + 1);
    const description = `${extension.toUpperCase()} file`;
    return await saveThrough(bytes, {
      name, type, target, filter: { name: description, extensions: [extension] },
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
  // A later successful export clears only the error an export set (#473).
  const exportError = useOwnedError(setBuildError);
  async function exportPair(
    extension: "pdf" | "psd", type: string, { labelPath, ask }: ExportRequest,
    build: () => Promise<[art: Uint8Array, mask: Uint8Array]>,
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
      // The art file: the remembered one, written with no dialog unless
      // `ask`; otherwise the dialog opens on it, or beside the tab's .label
      // under its name, or (neither) on the bare export name. Memory belongs
      // to the .label path it was chosen under: once that changes (Save
      // Label As, a first save) it is dropped, so ⌘E can never rewrite the
      // previous beer's PDFs.
      if (exportPaths.current.label !== (labelPath ?? null)) exportPaths.current = { label: labelPath ?? null };
      const remembered = exportPaths.current[extension];
      const artTarget = ask ? undefined : remembered;
      const artName = remembered ?? labelPath?.replace(/(\.[^./\\]+)?$/, `.${extension}`)
        ?? `${exportBase}.${extension}`;
      // On desktop the mask is written beside the art file, as
      // `<stem>-mask.<extension>` (the export's own extension, so the
      // capability globs cover it), replacing any file there: confirming the
      // art file confirms the pair. Notes and errors name the derived path.
      let maskPath: string | undefined;
      for (const [index, bytes] of pair.entries()) {
        pending = index ? maskPath ?? `${exportBase}-mask.${extension}` : artName;
        const target = index ? maskPath : artTarget;
        const result = await saveVia(bytes, pending, type, target ? { path: target } : undefined);
        if (!result) {
          exportError.set(`Note: ${saved.length ? `Saved ${saved.join(", ")}. ` : ""}Export cancelled before saving ${pending}.`);
          return;
        }
        saved.push(result.name);
        if (!index && result.target && "path" in result.target) {
          exportPaths.current[extension] = result.target.path;
          maskPath = result.target.path.replace(/(\.[^./\\]+)?$/, `-mask.${extension}`);
        }
      }
      exportError.clear();
      if (exportFresh.current) setExportNote(`Saved ${saved.join(", ")}.`);
    } catch (error) {
      exportError.set(`${saved.length ? `Saved ${saved.join(", ")}. ` : ""}${pending ? `Could not save ${pending}: ` : ""}${errMsg(error)}`);
    } finally {
      exportRunning.current = false;
      setExporting(null);
    }
  }

  async function pdfInputs() {
    const art = pageArt(false);
    const [{ plan, images, fontFamilies }, fonts] = await Promise.all([exportPlan(), loadFonts(family)]);
    const assets: Assets = {
      fonts, fontFamilies, title,
      images: {
        ...images,
        ...(art.texture ? { [PAGE_ART_ID.background]: art.texture } : {}),
        ...(art.maskPng ? { [PAGE_ART_ID.mask]: { kind: "png" as const, bytes: art.maskPng } } : {}),
      },
    };
    return { art, plan, assets };
  }

  /** One-file PDF exports share the build/save lifecycle. Only the combined
   *  print file remembers a destination; individual legacy plates always ask. */
  async function exportSinglePdf(mode: "print" | "art" | "mask", request: ExportRequest) {
    if (exportRunning.current) return;
    exportRunning.current = true;
    setExporting("pdf");
    setExportNote("");
    exportFresh.current = true;
    startSaveBatch();
    const labelPath = request.labelPath ?? null;
    let remembered: string | undefined;
    if (mode === "print") {
      if (exportPaths.current.label !== labelPath) exportPaths.current = { label: labelPath };
      remembered = exportPaths.current.printPdf;
    }
    const suffix = mode === "mask" ? "-mask.pdf" : ".pdf";
    const name = remembered ?? labelPath?.replace(/(\.[^./\\]+)?$/, suffix) ?? `${exportBase}${suffix}`;
    try {
      const [builders, { art, plan, assets }] = await Promise.all([
        import("@/pdf/build"), pdfInputs(),
      ]);
      let bytes: Uint8Array;
      switch (mode) {
        case "print": {
          if (art.maskPng) {
            const pixels = await rasterPixelsNatural(art.maskPng);
            assets.maskPixels = {
              data: new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
              width: pixels.width,
              height: pixels.height,
            };
          }
          bytes = await builders.buildPrintPdf(plan, assets);
          break;
        }
        case "art":
          bytes = await builders.buildArtPdf(plan, assets);
          break;
        case "mask":
          bytes = await builders.buildMaskPdf(plan, assets);
          break;
      }
      const target = !request.ask && remembered ? { path: remembered } : undefined;
      const result = await saveVia(bytes, name, "application/pdf", target);
      if (!result) {
        exportError.set(`Note: Export cancelled before saving ${name}.`);
        return;
      }
      if (mode === "print" && result.target && "path" in result.target)
        exportPaths.current.printPdf = result.target.path;
      exportError.clear();
      if (exportFresh.current) setExportNote(`Saved ${result.name}.`);
    } catch (error) {
      exportError.set(`Could not save ${name}: ${errMsg(error)}`);
    } finally {
      exportRunning.current = false;
      setExporting(null);
    }
  }

  /** Build one combined print PDF by default; the retained pair is explicit. */
  async function buildFull(request: ExportRequest = {}, kind: "print" | "pair" = "print") {
    if (kind === "print") return exportSinglePdf("print", request);
    await exportPair("pdf", "application/pdf", request, async () => {
      const [{ buildArtPdf, buildMaskPdf }, { plan, assets }] = await Promise.all([
        import("@/pdf/build"), pdfInputs(),
      ]);
      return await Promise.all([buildArtPdf(plan, assets), buildMaskPdf(plan, assets)]);
    });
  }

  function exportPdfPlate(mode: "art" | "mask", request: ExportRequest = {}) {
    return exportSinglePdf(mode, request);
  }

  /** Layered Photoshop files, built full-resolution on demand like the PDFs,
   *  off the main thread (psd/offThread.ts). Image decoding (psdImages) still
   *  runs here: it needs a canvas. Saved like the PDFs (see buildFull). */
  async function exportPsd(request: ExportRequest = {}) {
    await exportPair("psd", "image/vnd.adobe.photoshop", request, async () => {
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
      return await Promise.all([plate("art"), plate("mask")]);
    });
  }

  return {
    exporting, exportNote, exportStale, forgetExportPaths, startSaveBatch, saveBytes,
    buildFull, exportPdfPlate, exportPsd,
  };
}
