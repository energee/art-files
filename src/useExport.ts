// useExport.ts — the editor's full-resolution exports, split out of App.tsx
// (#416): the print PDF and PSD (White Ink inside) or, with two-file export,
// the art + mask pairs, built on demand from the same layers the preview draws,
// the export-in-flight state, the toast that reports each export's result
// (saved, left half-saved, failed, or saved beside a stale mask — a cancel
// reports nothing), where this tab's desktop exports were last written (so a
// repeat export needs no dialog), and the batch of download URLs every save
// (exports, Save Label, Save Master) hands its plain-download fallback through.
import { useEffect, useId, useRef, useState } from "react";
import { nativeExists, saveThrough, type FileTarget } from "@/files";
import { baseName, errMsg } from "@/lib/utils";
import { notify } from "@/notify";
import { revealAction } from "@/reveal";
import { t } from "@/i18n";
import type { Fill } from "@/types";
import { PAGE_ART_ID, type Layer } from "@/model/layers";
import { planLayers, type PlacedLayer } from "@/planLayers";
import type { PlanAssets } from "@/plan";
import type { RenderSettings } from "@/settings";
import { FONT_URLS, labelFontCss, loadLabelFaces } from "@/fonts";
import { drawPlate } from "@/canvas/draw";
import { PSD_DOC } from "@/layout";
import type { FontFamilyId } from "@/fontCatalog";
import { loadFonts } from "@/pdf/fonts";
// The builders are imported dynamically at export time (buildFull, exportPsd,
// which runs buildPsd in a worker) so they stay out of the initial bundle;
// only their types are needed up front.
import type { Assets, CollabImage } from "@/pdf/build";
import type { PsdAssets, PsdOpts } from "@/psd/build";
import { blobUrl, download, rasterPixelsNatural, tintedPng, type CustomFile } from "@/assets/io";

/** `path` with its extension (if any) replaced by `suffix`: the one rule for
 *  every export name derived from a .label or an art file. */
const withSuffix = (path: string, suffix: string) => path.replace(/(\.[^./\\]+)?$/, suffix);
/** Where an export pair's mask sits beside its art file: `<stem>-mask.<ext>`. */
const maskBeside = (path: string, extension: string) => withSuffix(path, `-mask.${extension}`);
/** The toast id of export run number `run` in the editor whose id prefix is `base`. */
const runToastId = (base: string, run: number) => `${base}:${run}`;
/** The desktop path a save wrote to; browser saves have a handle or none. */
const pathOf = (target: FileTarget | undefined) => target && "path" in target ? target.path : undefined;

/** The texture/mask bytes for a build (App.tsx pageArt): absent when the
 *  slot is empty or its page-art layer is switched off. */
type PageArt = {
  texture?: { bytes: Uint8Array; kind: "png" | "jpg" };
  maskPng?: Uint8Array;
};

/** The page's texture and mask as export images, under their page ids, so
 *  the plan's background and mask items draw them (PDFs and PSD plates). */
function pageImages(art: PageArt): Record<string, CollabImage> {
  return {
    ...(art.texture ? { [PAGE_ART_ID.background]: art.texture } : {}),
    ...(art.maskPng ? { [PAGE_ART_ID.mask]: { kind: "png" as const, bytes: art.maskPng } } : {}),
  };
}

type FlatPlate = NonNullable<PsdOpts["composite"]>;

/** Both plates flattened by the preview's canvas renderer at `doc`, the
 *  export's PSD_DOC size: each PSD's composite (PsdOpts.composite), the image
 *  Finder and Preview show, and the mask the print PSD turns into White Ink.
 *  The full-resolution export images decode once for both plates, which draw
 *  one after the other on one canvas. SVG art plans as paths, so it needs no
 *  bitmap. Undefined without a 2D canvas.
 *  ponytail: draws on the main thread; an OffscreenCanvas in the PSD worker
 *  would free the UI if high-DPI exports stall it. */
async function flattenPlates(
  plan: readonly PlacedLayer[], images: Record<string, CollabImage>, fontCss: string, doc: { w: number; h: number },
): Promise<Record<"art" | "mask", FlatPlate> | undefined> {
  const bitmaps: Record<string, ImageBitmap> = {};
  try {
    for (const [id, image] of Object.entries(images))
      if (image.kind !== "svg") bitmaps[id] = await createImageBitmap(new Blob([image.bytes as BlobPart]));
    // The plan and the worker's page are this size; drawPlate reads the live
    // page, which a Bleed or PSD resolution change mid-export would move.
    if (PSD_DOC.w !== doc.w || PSD_DOC.h !== doc.h)
      throw new Error(t("Bleed or PSD resolution changed during the export. Export again."));
    const canvas = document.createElement("canvas");
    canvas.width = doc.w;
    canvas.height = doc.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const flat = (mode: "art" | "mask"): FlatPlate => {
      ctx.resetTransform();
      ctx.clearRect(0, 0, doc.w, doc.h);
      drawPlate(ctx, plan, { images: bitmaps }, mode, fontCss);
      const { data, width, height } = ctx.getImageData(0, 0, doc.w, doc.h);
      return { data, width, height };
    };
    return { art: flat("art"), mask: flat("mask") };
  } finally {
    for (const bitmap of Object.values(bitmaps)) bitmap.close();
  }
}

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
  /** What a warning's Export again does: App runs its own "Export … As…" pair
   *  command for `format`, so the export gate and the label's current state
   *  are the menu's, not this hook's. */
  exportAgain: (format: "pdf" | "psd") => void;
};

/** Where an export writes. `labelPath` is the tab's bound .label (desktop
 *  only): a first export's dialog opens beside it, under its name. `ask`
 *  (Export … As…) opens the dialog even when a file is remembered. */
type ExportRequest = { labelPath?: string | null; ask?: boolean };

export function useExport({
  drawLayers, family, liveImages, planAssets, pageArt, title, exportBase, render, exportAgain,
}: ExportInputs) {
  // The export in flight, if any: it blurs the preview under a note naming
  // the files being built (#401), and blocks a second export.
  /** What is building, for the overlay: one file ("pdf") or a pair ("pdfs"). */
  const [exporting, setExporting] = useState<"pdf" | "psd" | "pdfs" | "psds" | null>(null);
  // Each export run reports under its own toast id (runToastId), and a new run
  // dismisses only the previous run's. Sonner keeps a dismissed id for ~250 ms
  // and folds a toast shown under it into the dying one (useOwnedToast.ts makes
  // the same split), so a repeat export that failed quickly would lose its
  // error if runs shared an id. All of a run's toasts (saved, then the stale
  // mask warning that replaces it) share its id, so they replace each other
  // instead of stacking. Nothing else dismisses a run's toast (an edit leaves
  // it up) but closing the tab. Results are events, shown whichever tab is in
  // front.
  const toastBase = `${useId()}:export`;
  // exportFresh goes false on any edit (#400), so an export that an edit
  // overlapped confirms nothing: its files hold the label as it was when the
  // export began.
  const exportFresh = useRef(false);
  // Bumped by every export start, so a slow check from an older export can't
  // replace a newer export's toast.
  const exportRun = useRef(0);
  const exportStale = () => { exportFresh.current = false; };
  /** Begin an export run: retire the previous run's toast, mark the run fresh,
   *  and return the id this run's toasts use. */
  function startRun() {
    notify.dismiss(runToastId(toastBase, exportRun.current));
    exportFresh.current = true;
    exportRun.current++;
    return runToastId(toastBase, exportRun.current);
  }
  // A closed tab's export toasts go with it, and none offers Export again for a
  // label that no longer exists (see closed.current in exportPair).
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- the run in flight when the tab closes is the one to dismiss, so the ref is read at cleanup time on purpose
      notify.dismiss(runToastId(toastBase, exportRun.current));
    };
  }, [toastBase]);
  // Desktop export destinations, scoped to the label they were chosen from.
  // The one-file print PDF and PSD remember their destinations separately
  // from the two-file pairs, but both default to `<label>.pdf`/`.psd`: a
  // print export into a folder holding an older pair replaces its art file
  // and leaves its `-mask` file behind. The print PDF save warns when it
  // finds a `-mask.pdf` (warnIfStaleMask).
  const exportPaths = useRef<{
    label?: string | null;
    pdf?: string;
    printPdf?: string;
    psd?: string;
    printPsd?: string;
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
    const description = t("{{format}} file", { format: extension.toUpperCase() });
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
  async function exportPair(
    extension: "pdf" | "psd", type: string, { labelPath, ask }: ExportRequest,
    build: () => Promise<[art: Uint8Array, mask: Uint8Array]>,
  ) {
    if (exportRunning.current) return;
    exportRunning.current = true;
    setExporting(`${extension}s`);
    const toastId = startRun();
    startSaveBatch();
    // What the dialog suggests when no destination is remembered. It is also
    // the file an error is blamed on until the first save starts (a failed build).
    const defaultName = labelPath != null ? withSuffix(labelPath, `.${extension}`) : `${exportBase}.${extension}`;
    const saved: string[] = [];
    let pending = defaultName;
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
      const artName = remembered ?? defaultName;
      // On desktop the mask is written beside the art file, as
      // `<stem>-mask.<extension>` (the export's own extension, so the
      // capability globs cover it), replacing any file there: confirming the
      // art file confirms the pair. Toasts name the derived file.
      let artPath: string | undefined;
      let maskPath: string | undefined;
      for (const [index, bytes] of pair.entries()) {
        pending = index ? maskPath ?? `${exportBase}-mask.${extension}` : artName;
        const target = index ? maskPath : artTarget;
        const result = await saveVia(bytes, pending, type, target ? { path: target } : undefined);
        if (!result) {
          // A cancel is the user's own choice, so it says nothing, unless it
          // leaves a pair half saved: that warns and offers to redo the pair.
          if (saved.length) notify.warning(t("{{file}} wasn't saved", { file: baseName(pending) }), {
            id: toastId,
            description: t("Export again to save both files."),
            // Not for a tab that closed while this export was in flight.
            action: closed.current ? undefined : { label: t("Export again"), onClick: () => exportAgain(extension) },
          });
          return;
        }
        saved.push(baseName(result.name));
        const path = pathOf(result.target);
        if (!index && path) {
          artPath = path;
          exportPaths.current[extension] = path;
          maskPath = maskBeside(path, extension);
        }
      }
      if (exportFresh.current) notify.success(t("Saved {{files}}", { files: saved.join(", ") }), {
        id: toastId, action: revealAction(artPath),
      });
    } catch (error) {
      notify.error(t("Couldn't save {{file}}", { file: baseName(pending) }), {
        id: toastId,
        description: saved.length ? `${t("Saved {{files}}.", { files: saved.join(", ") })} ${errMsg(error)}` : errMsg(error),
      });
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
      images: { ...images, ...pageImages(art) },
    };
    return { art, plan, assets };
  }

  /** One file through one dialog: the print PDF or PSD (art with White Ink
   *  inside), or a single legacy PDF plate; `mode` names the file and `build`
   *  makes it. Only the print files remember a destination; individual
   *  plates always ask. */
  async function exportSingle(
    format: "pdf" | "psd", mode: "print" | "art" | "mask", request: ExportRequest, build: () => Promise<Uint8Array>,
  ) {
    if (exportRunning.current) return;
    exportRunning.current = true;
    setExporting(format);
    const toastId = startRun();
    startSaveBatch();
    const labelPath = request.labelPath ?? null;
    let remembered: string | undefined;
    const key = format === "pdf" ? "printPdf" : "printPsd";
    if (mode === "print") {
      if (exportPaths.current.label !== labelPath) exportPaths.current = { label: labelPath };
      remembered = exportPaths.current[key];
    }
    const suffix = `${mode === "mask" ? "-mask" : ""}.${format}`;
    const type = format === "pdf" ? "application/pdf" : "image/vnd.adobe.photoshop";
    const name = remembered ?? (labelPath != null ? withSuffix(labelPath, suffix) : `${exportBase}${suffix}`);
    try {
      const target = !request.ask && remembered ? { path: remembered } : undefined;
      const result = await saveVia(await build(), name, type, target);
      if (!result) return; // a cancel is the user's own choice: nothing to report
      const path = pathOf(result.target);
      if (exportFresh.current) notify.success(t("Saved {{files}}", { files: baseName(result.name) }), {
        id: toastId, action: revealAction(path),
      });
      if (mode === "print" && path) {
        exportPaths.current[key] = path;
        if (format === "pdf") void warnIfStaleMask(path, result.name);
      }
    } catch (error) {
      notify.error(t("Couldn't save {{file}}", { file: baseName(name) }), { id: toastId, description: errMsg(error) });
    } finally {
      exportRunning.current = false;
      setExporting(null);
    }
  }

  /** The print PDF carries the white ink, so an older pair's `-mask.pdf`
   *  beside it would reach the printer as a second plate: turn the saved toast
   *  into a warning that offers to reveal the old mask. Never deletes it. Runs
   *  after the export has finished, so a slow volume can't hold the export
   *  open; a failed check (a scope refusal, say) still reaches UncaughtErrors.
   *  Not held back by an edit (#400): the old mask is stale whatever was edited,
   *  so the warning comes even when the Saved confirmation was withheld. */
  async function warnIfStaleMask(pdfPath: string, file: string) {
    const run = exportRun.current;
    const mask = maskBeside(pdfPath, "pdf");
    const stale = await nativeExists(mask).catch((error: unknown) => { void Promise.reject(error); return false; });
    if (!stale || run !== exportRun.current) return;
    notify.warning(t("Saved {{file}}", { file: baseName(file) }), {
      id: runToastId(toastBase, run),
      description: t("Don't send the old {{mask}} with it — this PDF already has the white ink.", { mask: baseName(mask) }),
      action: revealAction(mask),
    });
  }

  /** Build one combined print PDF by default; the retained pair is explicit. */
  async function buildFull(request: ExportRequest = {}, kind: "print" | "pair" = "print") {
    if (kind === "print") return exportSingle("pdf", "print", request, async () => {
      const [{ buildPrintPdf }, { art, plan, assets }] = await Promise.all([import("@/pdf/build"), pdfInputs()]);
      if (art.maskPng) {
        const pixels = await rasterPixelsNatural(art.maskPng);
        assets.maskPixels = {
          data: new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength),
          width: pixels.width,
          height: pixels.height,
        };
      }
      return buildPrintPdf(plan, assets);
    });
    await exportPair("pdf", "application/pdf", request, async () => {
      const [{ buildArtPdf, buildMaskPdf }, { plan, assets }] = await Promise.all([
        import("@/pdf/build"), pdfInputs(),
      ]);
      return await Promise.all([buildArtPdf(plan, assets), buildMaskPdf(plan, assets)]);
    });
  }

  function exportPdfPlate(mode: "art" | "mask", request: ExportRequest = {}) {
    return exportSingle("pdf", mode, request, async () => {
      const [{ buildArtPdf, buildMaskPdf }, { plan, assets }] = await Promise.all([import("@/pdf/build"), pdfInputs()]);
      return (mode === "art" ? buildArtPdf : buildMaskPdf)(plan, assets);
    });
  }

  /** Everything a PSD build needs, gathered on the main thread: the plan,
   *  ag-psd's decoded pixels, and both plates flattened (flattenPlates). Each
   *  build then runs in its own worker (#415), which gets this editor's
   *  bleed and DPI with the job — captured here, with the page size, before
   *  anything awaits. */
  async function psdInputs() {
    const geometry = { bleedIn: render.bleedIn, dpi: render.dpi };
    const doc = { w: PSD_DOC.w, h: PSD_DOC.h };
    const [{ psdImages }, { buildPsdOffThread }, fonts, { plan, images, fontFamilies }] = await Promise.all([
      import("@/psd/build"), import("@/psd/offThread"), loadFonts(family), exportPlan(),
    ]);
    const art = pageArt(false);
    const assets: PsdAssets = {
      fonts, fontFamily: family,
      images: await psdImages(images, { texture: art.texture?.bytes, mask: art.maskPng }, rasterPixelsNatural),
    };
    // The flattened plates draw with the preview's registered faces.
    await loadLabelFaces(family, Object.keys(fontFamilies ?? {}) as FontFamilyId[]);
    const flatten = () => flattenPlates(plan, { ...images, ...pageImages(art) }, labelFontCss(family), doc);
    const build = (mode: "art" | "mask", opts: PsdOpts) =>
      buildPsdOffThread({ items: plan, assets, mode, geometry, opts: { layers: drawLayers, ...opts } });
    return { flatten, build };
  }

  /** The one-file print PSD: the art layers with the White Ink plate as a
   *  spot channel. The mask plate's red channel is the ink, as the print
   *  PDF reads it (embedWhiteInkMask): blue R=0 is full ink, white R=255 a
   *  knockout — already Photoshop's spot storage (0 = 100% ink). Without a
   *  canvas there is no White Ink to add, so it fails rather than save a
   *  print file without it. */
  async function printPsd(): Promise<Uint8Array> {
    const { flatten, build } = await psdInputs();
    const plates = await flatten();
    if (!plates) throw new Error(t("No canvas to draw the White Ink plate."));
    return build("art", { composite: plates.art, whiteInk: plates.mask });
  }

  /** Layered Photoshop files, built full-resolution on demand like the PDFs:
   *  one print PSD by default, or the art + mask pair. Saved like the PDFs
   *  (see buildFull). */
  async function exportPsd(request: ExportRequest = {}, kind: "print" | "pair" = "print") {
    if (kind === "print") return exportSingle("psd", "print", request, printPsd);
    await exportPair("psd", "image/vnd.adobe.photoshop", request, async () => {
      const { flatten, build } = await psdInputs();
      const plates = await flatten(); // no canvas: ag-psd's black previews
      return await Promise.all([build("art", { composite: plates?.art }), build("mask", { composite: plates?.mask })]);
    });
  }

  return {
    exporting, exportStale, forgetExportPaths, startSaveBatch, saveBytes,
    buildFull, exportPdfPlate, exportPsd,
  };
}
