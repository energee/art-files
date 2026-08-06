// App.tsx — owns all state: LabelConfig, texture/mask assets (full-res +
// preview-res pairs), validation, debounced preview-resolution PDF builds,
// overlay-compare preview, and on-demand full-resolution exports. Mirrors
// the old main.ts wiring, componentized.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CollabSlot, Fill, LabelConfig } from "@/types";
import type { ElementId } from "@/elements";
import type { Measure } from "@/hittest";
import { defaultConfig, exportBaseName } from "@/defaults";
import { useHistory } from "@/history";
import { validateUpc } from "@/upc";
import { prepareMaskForPdf } from "@/maskimage";
import { rasterKind, tintRgba } from "@/collab";
// The builders are imported dynamically at export time (see downloadPdfs /
// exportPsd) so they stay out of the initial bundle; only their types are
// needed up front.
import type { Assets, CollabImage } from "@/pdf/build";
import { buildPreviewPdfs, disposePreviewWorker } from "@/pdf/client";
import type { PsdAssets } from "@/psd/build";
import { PSD_DOC } from "@/layout";
import {
  Inspector, type CollabFiles, type DocSettings, type InspectorFiles,
} from "@/components/StyleProperties";
import { LayersPanel } from "@/components/LayersPanel";
import { AssetDropOverlay } from "@/components/AssetDropOverlay";
import {
  DEFAULT_RENDER, loadPresets, mutatePresets, normalizePresets, usePresets,
  type Presets,
} from "@/presets";
import { PANEL_ORDER, isElementId, type LayerId } from "@/components/layers";
import {
  EMPTY_SELECTION, resolveSelect, type SelectMods, type Selection,
} from "@/selection";
import { CommandMenu, type Command } from "@/components/CommandMenu";
import { PreviewCompare, type PreviewCompareHandle } from "@/components/PreviewCompare";
import { CanView } from "@/components/CanView";
import {
  Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator,
  MenubarShortcut, MenubarTrigger,
} from "@/components/ui/menubar";
import {
  Sidebar, SidebarContent, SidebarInset, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import poppinsRegular from "@/assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "@/assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "@/assets/fonts/Poppins-Bold.ttf?url";
import { loadFonts } from "@/pdf/fonts";
import logoSvg from "@/assets/logo2025.svg?raw";

/** bytes = full print resolution (exports); previewBytes = downscaled PNG the
 *  debounced preview builds use, so keystroke-driven rebuilds never churn the
 *  print-size image (a burst of those OOMs the tab). */
type Loaded = { bytes: Uint8Array; previewBytes: Uint8Array; name: string; previewUrl: string };

/** A loaded collab logo: what the renderer needs, plus what the drop zone
 *  shows. previewUrl is the raw file, so an SVG thumbnails as itself. */
type CollabFile = { image: CollabImage; name: string; previewUrl: string };

/** Encode a canvas's pixels as PNG bytes — the shared tail of every
 *  decode/recolor/re-encode pipeline in this file. */
async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Decode an image into a fresh 2D canvas — the front half of every pixel
 *  pipeline here (recolor a collab logo, prepare a mask, rasterize a texture).
 *  `size` forces the canvas dimensions and cover-fits the image into them,
 *  centred; without it the canvas takes the image's natural size. The bitmap
 *  is always closed: it holds a decoded copy until it is. */
async function decodeToCanvas(
  src: Blob, size?: { width: number; height: number },
): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(src);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size?.width ?? bmp.width;
    canvas.height = size?.height ?? bmp.height;
    const ctx = canvas.getContext("2d")!;
    if (size) {
      const s = Math.max(canvas.width / bmp.width, canvas.height / bmp.height);
      const w = bmp.width * s;
      const h = bmp.height * s;
      ctx.drawImage(bmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    } else {
      ctx.drawImage(bmp, 0, 0);
    }
    return canvas;
  } finally {
    bmp.close();
  }
}

/** The bytes as a Blob, for decodeToCanvas. */
const blobOf = (bytes: Uint8Array) => new Blob([bytes as unknown as BlobPart]);

/** Repaint a raster collab logo in `fill`, keeping alpha, and re-encode it as
 *  PNG for embedding — the color-overlay path for PNG/JPG art, which pdf-lib
 *  can only draw as-is. Same decode/recolor/re-encode shape as onMask. */
async function tintedPng(bytes: Uint8Array, fill: Fill): Promise<Uint8Array> {
  const canvas = await decodeToCanvas(blobOf(bytes));
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  tintRgba(img.data, fill);
  ctx.putImageData(img, 0, 0);
  return canvasToPng(canvas);
}

/** tintedPng, memoized per source bytes: the debounced preview rebuilds on
 *  every keystroke, and without this each rebuild re-decoded, re-tinted and
 *  re-encoded both collab logos even when neither the file nor its fill had
 *  changed. Keyed by the bytes' identity (a new upload is a new Uint8Array)
 *  and fill; WeakMap lets a replaced upload's cache be collected. */
const tintCache = new WeakMap<Uint8Array, Map<Fill, Promise<Uint8Array>>>();
function tintedPngCached(bytes: Uint8Array, fill: Fill): Promise<Uint8Array> {
  let byFill = tintCache.get(bytes);
  if (!byFill) tintCache.set(bytes, (byFill = new Map()));
  let p = byFill.get(fill);
  if (!p) byFill.set(fill, (p = tintedPng(bytes, fill)));
  return p;
}

/** Read a dropped collab logo: SVG as source text (so it can be recolored
 *  per its slot's style), anything else as raster bytes. */
async function readCollab(f: File): Promise<CollabFile> {
  const image: CollabImage = /\.svg$/i.test(f.name)
    ? { kind: "svg", svg: await f.text() }
    : { kind: rasterKind(f.name), bytes: new Uint8Array(await f.arrayBuffer()) };
  return { image, name: f.name, previewUrl: URL.createObjectURL(f) };
}

/** Longest preview-texture edge in px — covers PreviewCompare's canvas at its
 *  2.5x oversample while keeping each preview rebuild a few MB. */
const PREVIEW_PX = 1600;

async function previewPng(src: ImageBitmap | HTMLCanvasElement): Promise<Uint8Array> {
  const scale = Math.min(1, PREVIEW_PX / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return canvasToPng(c);
}

let measurePromise: Promise<Measure> | null = null;
function loadMeasure(): Promise<Measure> {
  if (measurePromise) return measurePromise;
  measurePromise = Promise.all([
    new FontFace("PoppinsMeasure", `url(${poppinsRegular})`, { weight: "400" }).load(),
    new FontFace("PoppinsMeasure", `url(${poppinsSemiBold})`, { weight: "600" }).load(),
  ]).then((faces) => {
    faces.forEach((face) => document.fonts.add(face));
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("Could not create the font measurement canvas.");
    return (text: string, size: number, bold: boolean) => {
      ctx.font = `${bold ? 600 : 400} ${size}px PoppinsMeasure`;
      return ctx.measureText(text).width;
    };
  }).catch((error) => {
    measurePromise = null;
    throw error;
  });
  return measurePromise;
}

// Blob snapshots the bytes at construction (no transfer), so no copy needed —
// unlike pdf.js, which neuters the buffer it's handed (see PreviewCompare).
const blobUrl = (bytes: Uint8Array, type: string) =>
  URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));

// Menu chrome, shared by all three menus so they can't drift apart: small
// regular-weight triggers, and items sized to match.
const MENU_TRIGGER = "px-2 py-1 text-xs font-normal";
const MENU_ITEMS = "[&_[data-slot=menubar-item]]:text-xs";

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

export default function App() {
  // Config lives in a history stack, not plain useState — every edit that
  // goes through setCfg (i.e. all of them, see `update` below) is undoable.
  const { value: cfg, set: setCfg, undo, redo, canUndo, canRedo } =
    useHistory<LabelConfig>(defaultConfig);
  // Which layers the inspector shows — Figma's model: an ordered selection
  // plus an anchor a shift-range extends from, driven by the layers panel or
  // PreviewCompare's click-to-select. LayerId, not ElementId: the
  // Background/Mask/Settings document layers are selectable in the UI but
  // unknown to the renderer. The resolution rules (replace / toggle / range,
  // and document layers being single-select) live in selection.ts.
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const selected = selection.ids;
  /** A row or canvas click, resolved against the anchor and the panel's row
   *  order. A background click (null) clears everything, anchor included. */
  const clearSelection = () => setSelection(EMPTY_SELECTION);
  const pick = (id: LayerId | null, mods: SelectMods) =>
    id === null
      ? clearSelection()
      : setSelection((s) => resolveSelect(s, id, mods, PANEL_ORDER));
  // The renderer elements of the selection, for the preview's outlines.
  // Memoized like collabSlots below and for the same reason: it is a
  // dependency of PreviewCompare's outline memo, and a fresh array every
  // render would defeat it — dragging the compare divider re-renders App per
  // pointer-move frame, which would re-measure every selected element's box
  // on every one of those frames.
  const elementSelection = useMemo(() => selected.filter(isElementId), [selected]);
  // Layers the panel's eye has hidden — session state, deliberately outside
  // the config/history: a saved label never records a hidden layer, and
  // toggling an eye is not an undoable document edit. Flows into
  // Assets.hidden, where the renderer skips the element in both plates.
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlySet<ElementId>>(new Set());
  const toggleHidden = (id: ElementId) =>
    setHiddenLayers((old) => {
      const next = new Set(old);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // Real glyph widths for PreviewCompare's click-to-select hit-testing (see
  // hittest.ts's Measure type) — null until the one-time font embed below
  // resolves; PreviewCompare skips hit-testing rather than guess with it.
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [texture, setTexture] = useState<(Loaded & { kind: "png" | "jpg" }) | null>(null);
  const [mask, setMask] = useState<(Loaded & { error?: string }) | null>(null);
  // Collab logos. Unlike the texture and mask these need no preview-resolution
  // twin: they are at most a 70pt mark, so the same bytes serve the preview
  // build and the print export.
  const [collabLeft, setCollabLeft] = useState<CollabFile | null>(null);
  const [collabCenter, setCollabCenter] = useState<CollabFile | null>(null);
  // Which collab slots hold art, for the preview's hit boxes. Memoized: it is
  // a dependency of the selection-outline memo, and a fresh object every
  // render would defeat it.
  const collabSlots = useMemo(
    () => ({ left: !!collabLeft, center: !!collabCenter }),
    [collabLeft, collabCenter],
  );
  // Preview-resolution PDFs for the on-screen compare only; downloads always
  // rebuild at full resolution (see buildFull).
  const [pdfs, setPdfs] = useState<{ artBytes: Uint8Array; maskBytes: Uint8Array } | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [loadError, setLoadError] = useState("");
  // Divider position reported by PreviewCompare (% of width showing
  // white-ink), so the View menu can check off whichever end it sits at.
  const [split, setSplit] = useState(0);
  // "2d" = the PDF compare view; the rest are CanView's three.js modes. The
  // 2D preview stays mounted (hidden) so its rendered canvases and divider
  // position survive a round-trip through the 3D views.
  const [viewMode, setViewMode] = useState<"2d" | "can" | "pack" | "flat">("2d");
  // Document Settings layer's knobs: 3D-view presentation only (die-cut
  // corner radius, label height on the can, foil-edge blur). The print PDFs
  // and saved configs never see them; they persist in presets.json, since
  // they describe the press's die and stock rather than one label.
  // Local while dragging (a scrub field emits a change per pixel), then
  // debounced into the shared library.
  const { presets, loaded: presetsLoaded, error: presetsError } = usePresets();
  const [render, setRender] = useState(DEFAULT_RENDER);
  // Adopt the saved settings once, when the library first arrives. Writing
  // before that would stamp the defaults over the file.
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !presetsLoaded) return;
    adopted.current = true;
    setRender(presets.render);
  }, [presetsLoaded, presets.render]);
  useEffect(() => {
    if (!adopted.current) return;
    const t = setTimeout(() => void mutatePresets((p) => ({ ...p, render })), 500);
    return () => clearTimeout(t);
  }, [render]);
  useEffect(() => {
    if (presetsError) setLoadError(`presets save failed: ${presetsError}`);
  }, [presetsError]);
  /** Return to the 2D compare at one end. The divider resize is deferred a
   *  frame: while a 3D mode is up the compare sits in a display:none wrapper
   *  with zero width, and react-resizable-panels misapplies a percentage
   *  resize against that hidden layout. */
  const show2d = (which: "art" | "mask") => {
    setViewMode("2d");
    requestAnimationFrame(() => {
      if (which === "art") previewRef.current?.showArt();
      else previewRef.current?.showMask();
    });
  };
  const presetsInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<PreviewCompareHandle>(null);
  // Trim guide over the 2D preview at the art box (38px of bleed per side at
  // 600dpi). View-only — the exported PDFs are unaffected.
  const [bleed, setBleed] = useState(false);

  const update = (fn: (c: LabelConfig) => void) =>
    setCfg((c) => { const n = structuredClone(c); fn(n); return n; });

  // Canvas uses the same bundled Regular/SemiBold font files as the PDF, but
  // avoids loading pdf-lib + fontkit on the UI thread just to measure hit
  // boxes. `bold` intentionally means SemiBold here: most bold hit targets
  // use that face, while the two true-Bold elements are centred and tolerate
  // the small symmetric under-measurement (see hittest.ts).
  useEffect(() => {
    let cancelled = false;
    void loadMeasure()
      .then((next) => { if (!cancelled) setMeasure(() => next); })
      .catch((error) => { if (!cancelled) setBuildError(String(error)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => disposePreviewWorker(), []);

  // ⌘Z / ⇧⌘Z (and ⌘Y) for the config history. Deliberately inert while a
  // text field has focus: there the browser's own per-field undo is the one
  // the user means, and stealing it would blow away a whole typed line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (!e.metaKey && !e.ctrlKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Figma-style bare keys (see COMMANDS for which), with the same
  // inert-while-typing guard as undo: a digit in a text field is text.
  // Registered once — the handler reads the current table through a ref.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;
      const cmd = commandsRef.current.find((c) => c.key === e.key.toLowerCase());
      if (!cmd || cmd.disabled) return;
      e.preventDefault();
      cmd.run();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // The ref always holds this render's table, so the listener never needs
    // re-registering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upc = useMemo(() => validateUpc(cfg.upc), [cfg.upc]);
  const errors: Record<string, string> = {};
  if (!upc.ok) errors.upc = upc.error!;
  // A blank name no longer blocks: the renderer draws the "Name" placeholder
  // (see displayName in defaults.ts), which is a previewable, printable label.
  // Texture and mask are both optional — the label renders on bare stock
  // until they are dropped, so the text is previewable straight away. Only
  // a loaded-but-invalid mask or bad label data blocks.
  const blocked = !!mask?.error || !upc.ok;
  const blockedWhy = [mask?.error, errors.upc].filter(Boolean).join(" · ");
  // main's export guards kept: a build in flight has no bytes worth writing.
  const exportBlocked = blocked || building;
  const pdfExportBlocked = exportBlocked || !pdfs;

  async function onTexture(f: File) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const bmp = await createImageBitmap(f);
    const previewBytes = await previewPng(bmp);
    bmp.close();
    const previewUrl = URL.createObjectURL(f);
    setTexture((old) => {
      if (old) URL.revokeObjectURL(old.previewUrl);
      return {
        bytes, previewBytes, name: f.name,
        kind: rasterKind(f.name),
        previewUrl,
      };
    });
  }

  async function onMask(f: File) {
    const canvas = await decodeToCanvas(f);
    const ctx = canvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const check = prepareMaskForPdf(data.data);
    ctx.putImageData(data, 0, 0);
    const bytes = await canvasToPng(canvas);
    const previewBytes = await previewPng(canvas); // recolored canvas, downscaled
    const previewUrl = URL.createObjectURL(f);
    setMask((old) => {
      if (old) URL.revokeObjectURL(old.previewUrl);
      return {
        bytes,
        previewBytes,
        name: f.name,
        previewUrl,
        error: check.ok ? undefined : check.error,
      };
    });
  }

  /** Load a collab logo into `slot`, revoking the previous thumbnail URL. */
  function onCollab(slot: "left" | "center", f: File) {
    void readCollab(f).then((next) => {
      const set = slot === "left" ? setCollabLeft : setCollabCenter;
      set((old) => {
        if (old) URL.revokeObjectURL(old.previewUrl);
        return next;
      });
    });
  }
  const collabFiles: CollabFiles = {
    leftName: collabLeft?.name, leftUrl: collabLeft?.previewUrl,
    centerName: collabCenter?.name, centerUrl: collabCenter?.previewUrl,
    onLeft: (f) => onCollab("left", f),
    onCenter: (f) => onCollab("center", f),
  };
  /** Everything file-shaped the inspector edits: the Document layers' drops
   *  plus the collab logos. */
  const docSettings: DocSettings = {
    cornerRadius: render.cornerRadius,
    onCornerRadius: (v) => setRender((r) => ({ ...r, cornerRadius: v })),
    labelSize: render.labelSize,
    onLabelSize: (v) => setRender((r) => ({ ...r, labelSize: v })),
    edgeSoftness: render.edgeSoftness,
    onEdgeSoftness: (v) => setRender((r) => ({ ...r, edgeSoftness: v })),
  };
  const files: InspectorFiles = {
    texture: {
      fileName: texture?.name, previewUrl: texture?.previewUrl,
      onFile: (f) => void onTexture(f),
    },
    mask: {
      fileName: mask?.name, previewUrl: mask?.previewUrl, error: mask?.error,
      onFile: (f) => void onMask(f),
    },
    collab: collabFiles,
  };
  /** The collab half of Assets, shared by the preview and export builds.
   *  Async because a tinted raster has to be decoded and re-encoded; vector
   *  art and untinted rasters pass straight through. */
  async function collabAssets() {
    const resolve = async (f: CollabFile | null, slot: CollabSlot) => {
      if (!f) return null;
      if (f.image.kind === "svg" || !slot.tintRaster) return f.image;
      return { kind: "png" as const, bytes: await tintedPngCached(f.image.bytes, slot.fill) };
    };
    return {
      collabLeft: await resolve(collabLeft, cfg.collabLeft),
      collabCenter: await resolve(collabCenter, cfg.collabCenter),
    };
  }

  // Debounced preview regeneration on any input change, at preview resolution
  // (Loaded.previewBytes). Two guards keep keystroke bursts from OOMing the
  // tab: builds are serialized through buildChain (the debounce alone can't
  // stop overlap once a build outlasts the typing gap), and superseded builds
  // bail before allocating anything.
  const buildChain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (blocked) return;
    let stale = false;
    const timer = setTimeout(() => {
      buildChain.current = buildChain.current.then(async () => {
        if (stale) return; // a newer edit is queued behind us — skip entirely
        setBuilding(true);
        try {
          const assets = {
            ...(await collabAssets()),
            texture: texture ? { bytes: texture.previewBytes, kind: "png" as const } : undefined,
            maskPng: mask?.previewBytes,
            hidden: hiddenLayers,
          };
          const { art, mask: maskPdf } = await buildPreviewPdfs(cfg, assets);
          if (stale) return;
          setPdfs({ artBytes: art, maskBytes: maskPdf });
          setBuildError("");
        } catch (err) {
          if (!stale) setBuildError(String(err));
        } finally {
          if (!stale) setBuilding(false);
        }
      });
    }, 600);
    return () => { stale = true; clearTimeout(timer); };
  }, [cfg, texture, mask, collabLeft, collabCenter, blocked, hiddenLayers]);

  // Revoking immediately can abort a large download, so each URL lives until
  // the NEXT export batch — a timer would instead pin a full Blob copy of
  // every export (tens of MB for the PSD) for its whole duration. Revocation
  // happens per batch, not per save: "Export PDFs (art + mask)" saves twice
  // back-to-back, and revoking inside saveBytes would kill the art PDF's URL
  // the moment the mask save followed it.
  const lastSaved = useRef<string[]>([]);
  function startSaveBatch() {
    lastSaved.current.forEach((u) => URL.revokeObjectURL(u));
    lastSaved.current = [];
  }
  function saveBytes(bytes: Uint8Array, name: string, type = "application/pdf") {
    const url = blobUrl(bytes, type);
    lastSaved.current.push(url);
    download(url, name);
  }

  /** Downloads rebuild from the full-resolution assets on demand — the
   *  preview PDFs on screen are deliberately low-res (see Loaded). */
  async function buildFull(which: "art" | "mask" | "both") {
    if (building) return;
    setBuilding(true);
    startSaveBatch();
    try {
      const [{ buildArtPdf, buildMaskPdf }, fonts] = await Promise.all([
        import("@/pdf/build"),
        loadFonts(),
      ]);
      // Exports honor the eye too: a hidden layer is "not on this label",
      // preview and deliverable alike. (PSDs still carry every layer — a
      // layered handoff is the place to keep them all.)
      const assets: Assets = {
        fonts, logoSvg, ...(await collabAssets()),
        texture: texture ? { bytes: texture.bytes, kind: texture.kind } : undefined,
        maskPng: mask?.bytes,
        hidden: hiddenLayers,
      };
      if (which !== "mask") saveBytes(await buildArtPdf(cfg, assets), `${exportBaseName(cfg)}.pdf`);
      if (which !== "art") saveBytes(await buildMaskPdf(cfg, assets), `${exportBaseName(cfg)}-mask.pdf`);
    } catch (err) {
      setBuildError(String(err));
    } finally {
      setBuilding(false);
    }
  }
  const downloadArt = () => void buildFull("art");
  const downloadMask = () => void buildFull("mask");
  // Shared by the sidebar "Export PDFs" button and the ⌘K palette action.
  const exportPdfs = () => void buildFull("both");

  /** The PSD's texture layer needs raw RGBA at document size — PSD layers
   *  hold pixels 1:1, so the cover-fit happens here rather than in the
   *  builder. Only run on an explicit export, never in the preview loop:
   *  the full-size ImageData is ~60MB. */
  async function rasterPixels(bytes: Uint8Array | undefined): Promise<PsdAssets["texture"]> {
    if (!bytes) return undefined;
    // Cover-fit to the full 600dpi page, exactly like the PDF's coverPage.
    const canvas = await decodeToCanvas(blobOf(bytes), { width: PSD_DOC.w, height: PSD_DOC.h });
    const img = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return { data: new Uint8Array(img.data.buffer), width: img.width, height: img.height };
  }

  /** Layered Photoshop files: editable type layers, vector logo/QR/barcode.
   *  Built full-resolution on demand, like the PDF exports. Writes the pair —
   *  `{name}.psd` (art) and `{name}-mask.psd` (white-ink plate), mirroring
   *  the two PDF deliverables. */
  async function exportPsd() {
    if (building) return;
    setBuilding(true);
    startSaveBatch();
    try {
      const [{ buildPsd }, fonts] = await Promise.all([
        import("@/psd/build"),
        loadFonts(),
      ]);
      const assets: PsdAssets = {
        fonts, logoSvg,
        texture: await rasterPixels(texture?.bytes),
        mask: await rasterPixels(mask?.bytes),
      };
      saveBytes(await buildPsd(cfg, assets), `${exportBaseName(cfg)}.psd`, "image/vnd.adobe.photoshop");
      saveBytes(
        await buildPsd(cfg, assets, "mask"),
        `${exportBaseName(cfg)}-mask.psd`, "image/vnd.adobe.photoshop",
      );
      setBuildError("");
    } catch (err) {
      setBuildError(String(err));
    } finally {
      setBuilding(false);
    }
  }

  /** Hand the whole preset library to someone who doesn't have the repo. The
   *  file itself is the record (see presets.ts); this is a copy of it. */
  async function exportPresets() {
    try {
      const body = JSON.stringify(await loadPresets(), null, 2);
      const url = blobUrl(new TextEncoder().encode(body), "application/json");
      download(url, "presets.json");
      URL.revokeObjectURL(url);
      setLoadError("");
    } catch (err) {
      setLoadError(String(err));
    }
  }

  /** Replace the library wholesale from a file. Parsed before it is sent so a
   *  wrong file can't overwrite good presets with junk. */
  async function importPresets(f: File) {
    try {
      const raw = JSON.parse(await f.text()) as Partial<Presets>;
      // Through the store, not savePresets: an import replaces the library,
      // and every panel showing it has to follow.
      await mutatePresets(() => normalizePresets(raw));
      setLoadError("");
    } catch (err) {
      setLoadError(`presets import failed: ${String(err)}`);
    }
  }

  /** Every command the app exposes, once. The palette renders this list, the
   *  bare-key listener dispatches off `key`, and the menubar's items pull
   *  their `run`/`disabled` from it — so a shortcut can't drift from the key
   *  that actually fires it, and a command can't be enabled in one surface
   *  while disabled in another. The menubar keeps its own JSX: it groups,
   *  separates and check-marks, which is layout, not command identity. */
  const commands: Command[] = [
    { id: "export-both", label: "Export PDF + Mask PDF", disabled: pdfExportBlocked, run: exportPdfs },
    { id: "export-art", label: "Export PDF", disabled: pdfExportBlocked, run: downloadArt },
    { id: "export-mask", label: "Export Mask PDF", disabled: pdfExportBlocked, run: downloadMask },
    { id: "export-psd", label: "Export PSDs", disabled: exportBlocked, run: () => void exportPsd() },
    { id: "undo", label: "Undo", shortcut: "⌘Z", disabled: !canUndo, run: undo },
    { id: "redo", label: "Redo", shortcut: "⇧⌘Z", disabled: !canRedo, run: redo },
    { id: "presets-export", label: "Export presets", run: () => void exportPresets() },
    { id: "presets-import", label: "Import presets", run: () => presetsInput.current?.click() },
    { id: "view-standard", label: "Preview: Standard", key: "1", shortcut: "1", run: () => show2d("art") },
    { id: "view-mask", label: "Preview: Mask", key: "2", shortcut: "2", run: () => show2d("mask") },
    { id: "view-rendered", label: "Preview: Rendered", key: "3", shortcut: "3", run: () => setViewMode("flat") },
    { id: "view-can", label: "Preview: Single Can", key: "4", shortcut: "4", run: () => setViewMode("can") },
    { id: "view-pack", label: "Preview: Four-Pack", key: "5", shortcut: "5", run: () => setViewMode("pack") },
    // Bare B, not ⌘B — that one belongs to the sidebar toggle. Disabled
    // outside the 2D view, where there is no trim guide to draw.
    { id: "bleed", label: bleed ? "Hide bleed lines" : "Show bleed lines", key: "b", shortcut: "B",
      disabled: viewMode !== "2d", run: () => setBleed((b) => !b) },
  ];
  const byId = (id: string) => commands.find((c) => c.id === id)!;
  // The keydown listener is registered once and reads the live table here.
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  return (
    <TooltipProvider>
      {/* Figma-style three-region shell: collapsible left Sidebar (Layers),
          preview center, fixed inspector column right. */}
      <SidebarProvider>
        <Sidebar collapsible="offcanvas">
          <SidebarContent>
            <LayersPanel cfg={cfg} update={update} hidden={hiddenLayers}
              onToggleHidden={toggleHidden} selected={selected} onSelect={pick} />
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="flex h-svh flex-col overflow-hidden">
        {/* py-2 rather than the trigger's own py-1: with no bottom border the
            bar needs its own breathing room against the canvas. */}
        <header className="flex items-center gap-3 px-3 py-2">
          {/* Toggles the Layers sidebar; the component also binds ⌘B. */}
          <SidebarTrigger className="size-6" />
          {/* Stripped to a real menu bar: no pill border or rounding of its
              own — the header is borderless too, so the menu floats on the
              canvas — and small regular-weight labels rather than the
              default's badge-like medium ones. */}
          <Menubar className="h-auto gap-0 rounded-none border-0 p-0">
            <MenubarMenu>
              <MenubarTrigger className={MENU_TRIGGER}>File</MenubarTrigger>
              <MenubarContent align="start" className={MENU_ITEMS}>
                {/* The preset library: beer styles and barcodes reused across
                    labels. */}
                <MenubarItem onClick={byId("presets-export").run}>
                  Export presets
                </MenubarItem>
                <MenubarItem onClick={byId("presets-import").run}>
                  Import presets
                </MenubarItem>
                <MenubarSeparator />
                {/* !pdfs is the mid-build state: the PSD path rebuilds from
                    the config alone, so only the PDF items wait on it.
                    Exporting both PDFs at once lives in the ⌘K palette only —
                    here the two layers are separate items. */}
                <MenubarItem disabled={byId("export-art").disabled} onClick={byId("export-art").run}>
                  Export PDF
                </MenubarItem>
                <MenubarItem disabled={byId("export-mask").disabled} onClick={byId("export-mask").run}>
                  Export Mask PDF
                </MenubarItem>
                <MenubarItem disabled={byId("export-psd").disabled} onClick={byId("export-psd").run}>
                  Export PSDs
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className={MENU_TRIGGER}>Edit</MenubarTrigger>
              <MenubarContent align="start" className={MENU_ITEMS}>
                <MenubarItem disabled={byId("undo").disabled} onClick={byId("undo").run}>
                  Undo <MenubarShortcut>{byId("undo").shortcut}</MenubarShortcut>
                </MenubarItem>
                <MenubarItem disabled={byId("redo").disabled} onClick={byId("redo").run}>
                  Redo <MenubarShortcut>{byId("redo").shortcut}</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className={MENU_TRIGGER}>View</MenubarTrigger>
              <MenubarContent align="start" className={MENU_ITEMS}>
                {/* Checked only at the extremes: anywhere in between is a
                    manual compare position, which is neither view. */}
                <MenubarCheckboxItem checked={viewMode === "2d" && split === 0}
                  disabled={byId("view-standard").disabled} onClick={byId("view-standard").run}>
                  Standard <MenubarShortcut>{byId("view-standard").shortcut}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={viewMode === "2d" && split === 100}
                  disabled={byId("view-mask").disabled} onClick={byId("view-mask").run}>
                  Mask <MenubarShortcut>{byId("view-mask").shortcut}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarSeparator />
                <MenubarCheckboxItem checked={viewMode === "flat"}
                  disabled={byId("view-rendered").disabled} onClick={byId("view-rendered").run}>
                  Rendered <MenubarShortcut>{byId("view-rendered").shortcut}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={viewMode === "can"}
                  disabled={byId("view-can").disabled} onClick={byId("view-can").run}>
                  Single Can <MenubarShortcut>{byId("view-can").shortcut}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={viewMode === "pack"}
                  disabled={byId("view-pack").disabled} onClick={byId("view-pack").run}>
                  Four-Pack <MenubarShortcut>{byId("view-pack").shortcut}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarSeparator />
                {/* 2D only: the trim guide is drawn in page space, which the
                    3D views don't present. */}
                <MenubarCheckboxItem checked={bleed}
                  disabled={byId("bleed").disabled} onClick={byId("bleed").run}>
                  Bleed Lines <MenubarShortcut>{byId("bleed").shortcut}</MenubarShortcut>
                </MenubarCheckboxItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
          {/* Replaces the tooltip the old disabled Export button carried: a
              menu item can't explain its own disabled state, so the reason
              sits in the bar itself. */}
          {blocked && <span className="text-xs text-destructive">{blockedWhy}</span>}
          {/* Preset import/export failures: the bar is the one chrome that
              always shows regardless of selection. */}
          {loadError && <span className="text-xs text-destructive">{loadError}</span>}
          <input ref={presetsInput} type="file" accept="application/json" hidden
            onChange={(e) => e.target.files?.[0] && void importPresets(e.target.files[0])} />
        </header>
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col p-3">
          <div className="mb-2 flex h-5 items-center gap-2">
            {building && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
                rendering preview…
              </span>
            )}
            {buildError && <span className="text-xs text-destructive">{buildError}</span>}
          </div>
          <div className="relative flex min-h-0 flex-1">
            {/* PreviewCompare stays mounted but hidden in 3D modes (see
                viewMode). Selection box + click-to-select apply to 2D only. */}
            <div className={viewMode === "2d" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
            <PreviewCompare ref={previewRef}
              artBytes={pdfs?.artBytes ?? null} maskBytes={pdfs?.maskBytes ?? null}
              cfg={cfg} measure={measure} collab={collabSlots}
              // The preview knows only renderer elements; a selected document
              // layer (background/mask) shows no selection box there.
              selected={elementSelection}
              onPick={pick}
              onSplit={setSplit}
              bleed={bleed} />
            </div>
            {viewMode !== "2d" && (
              <CanView artBytes={pdfs?.artBytes ?? null} maskBytes={pdfs?.maskBytes ?? null}
                mode={viewMode} cornerRadiusPct={render.cornerRadius}
                labelHeightPct={render.labelSize}
                edgeSoftnessPct={render.edgeSoftness} />
            )}
            {/* No-texture hint. It used to sit in the status strip above the
                frame, where it read as chrome; low on the label it is the
                one thing in an empty preview. Waits for the first build so it
                can't share the frame with the loading spinner. */}
            {!texture && !building && pdfs && (
              <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
                <span className="rounded-full border border-dashed border-border bg-background/85 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
                  drop a texture anywhere to fill the background
                </span>
              </div>
            )}
            {/* First-load state: until the first debounced build lands there is
                nothing on the canvases, so fill the empty frame with a spinner
                instead of a bare box. Later rebuilds keep the previous render
                visible and only show the small strip spinner above. */}
            {!pdfs && !buildError && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  <span className="text-xs">rendering label…</span>
                </div>
              </div>
            )}
          </div>
        </section>
        {/* Right inspector: a shadcn Sheet driven by the selection — open
            while a layer is selected, closed (Esc or the header X) by
            clearing it. Non-modal and overlay-free so the preview and the
            layers panel stay clickable while inspecting; dismissible={false}
            keeps an outside click (e.g. preview click-to-select) from
            closing it mid-selection (no backdrop = no outside-press target). */}
        <Sheet open={selected.length > 0} modal={false}
          // The selection is the source of truth for this sheet, so only a
          // deliberate close clears it — a WHITELIST, not a blocklist. The
          // sheet has no backdrop, so base-ui reports every click in the
          // layers panel or on the canvas as "outside-press", and it fires
          // that on the POINTERDOWN *preceding* the click that is about to
          // extend the selection; "focus-out" arrives the same way when a
          // row button takes focus, which is why the sidebar felt flakier
          // than the canvas (a canvas click moves no focus). Honouring
          // either wiped the selection and its anchor between clicks and
          // made ⇧/⌘ behave like plain clicks.
          // Untyped `reason` strings would let a base-ui rename slip through
          // silently, so the union from the Sheet's own props is kept.
          onOpenChange={(open, details) => {
            if (!open && (details.reason === "escape-key" || details.reason === "close-press"))
              clearSelection();
          }}>
          <SheetContent side="right" showOverlay={false} showCloseButton={false}
            // Same card shade as the left sidebar and, like it, no border —
            // the two rails read as one surface flanking the canvas.
            className="w-[300px] gap-0 overflow-y-auto border-l-0! bg-sidebar p-3 sm:max-w-[300px]">
            {selected.length > 0 && (
              <Inspector ids={selected} cfg={cfg} errors={errors} update={update} files={files}
                settings={docSettings}
                onClose={clearSelection} />
            )}
          </SheetContent>
        </Sheet>
        {/* Drop a texture or mask anywhere in the window — no layer selection
            or inspector trip required. Armed only during a PNG/JPEG drag. */}
        <AssetDropOverlay
          onTexture={(f) => void onTexture(f)}
          onMask={(f) => void onMask(f)} />
        <CommandMenu actions={commands} />
      </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
