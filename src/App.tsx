// App.tsx — owns all state: LabelConfig, texture/mask assets (full-res +
// preview-res pairs), validation, debounced preview-resolution PDF builds,
// overlay-compare preview, and on-demand full-resolution exports. Mirrors
// the old main.ts wiring, componentized.
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { CollabSlot, Fill, LabelConfig } from "@/types";
import type { ElementId } from "@/elements";
import type { Measure } from "@/hittest";
import { defaultConfig, fileBase, parseConfigFile, toConfigFile } from "@/defaults";
import { useHistory } from "@/history";
import { validateUpc } from "@/upc";
import { validateMask, recolorMaskForPdf } from "@/maskimage";
import { rasterKind, tintRgba } from "@/collab";
import { buildArtPdf, buildMaskPdf, type Assets, type CollabImage } from "@/pdf/build";
import { buildPsd, PSD_DOC, type PsdAssets } from "@/psd/build";
import {
  Inspector, type CollabFiles, type DocSettings, type InspectorFiles,
} from "@/components/StyleProperties";
import { LayersPanel } from "@/components/LayersPanel";
import { isElementId, type LayerId } from "@/components/layers";
import { DEFAULT_LABEL_VIEW_SETTINGS } from "@/three/labelSettings";
import type { ViewMode } from "@/three/viewMode";
import { CommandMenu } from "@/components/CommandMenu";
import { PreviewCompare, type PreviewCompareHandle } from "@/components/PreviewCompare";
// Lazy: three.js, its loaders and the GLTF/HDR decoding are a large chunk
// that a user who never opens a 3D view should not download or parse.
const CanView = lazy(() => import("@/components/CanView").then((m) => ({ default: m.CanView })));
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

/** Repaint a raster collab logo in `fill`, keeping alpha, and re-encode it as
 *  PNG for embedding — the color-overlay path for PNG/JPG art, which pdf-lib
 *  can only draw as-is. Same decode/recolor/re-encode shape as onMask. */
async function tintedPng(bytes: Uint8Array, fill: Fill): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([bytes as unknown as BlobPart]));
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
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

const fontsPromise = (async () => {
  const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const [regular, semibold, bold] = await Promise.all([
    get(poppinsRegular), get(poppinsSemiBold), get(poppinsBold),
  ]);
  return { regular, semibold, bold };
})();

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
  // Which layer the inspector shows — Figma's model, one at a time, driven
  // by the layers panel or PreviewCompare's click-to-select. LayerId, not
  // ElementId: the Background/Mask document layers are selectable in the UI
  // but unknown to the renderer.
  const [selected, setSelected] = useState<LayerId | null>(null);
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
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  // Document Settings layer's knobs — see LabelViewSettings: 3D presentation
  // only, never saved to the config or applied to the print PDFs.
  const [viewSettings, setViewSettings] = useState(DEFAULT_LABEL_VIEW_SETTINGS);
  // Once a 3D view has been opened the scene stays mounted (hidden in 2D) so
  // the GLTF, HDRI and label textures survive a round trip; `active` below
  // keeps a hidden scene from doing any work.
  const [used3d, setUsed3d] = useState(false);
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
  const show3d = (mode: Exclude<ViewMode, "2d">) => { setUsed3d(true); setViewMode(mode); };
  /** The five previews, in menu order: label, digit shortcut, how to enter,
   *  and when the item reads as current. One table drives the View menu, the
   *  1-5 keys and the command palette, so they cannot drift apart. */
  const VIEWS: { label: string; key: string; go: () => void; checked: boolean }[] = [
    { label: "Standard", key: "1", go: () => show2d("art"), checked: viewMode === "2d" && split === 0 },
    { label: "Mask", key: "2", go: () => show2d("mask"), checked: viewMode === "2d" && split === 100 },
    { label: "Rendered", key: "3", go: () => show3d("flat"), checked: viewMode === "flat" },
    { label: "Single Can", key: "4", go: () => show3d("can"), checked: viewMode === "can" },
    { label: "Four-Pack", key: "5", go: () => show3d("pack"), checked: viewMode === "pack" },
  ];
  const configInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<PreviewCompareHandle>(null);

  const update = (fn: (c: LabelConfig) => void) =>
    setCfg((c) => { const n = structuredClone(c); fn(n); return n; });

  // Builds the real Measure hitTest needs, once: embed the faces into a
  // throwaway pdf-lib doc purely to read widthOfTextAtSize (never saved/
  // rendered). hitTest's `bold` flag can't tell one call site from another —
  // it's a single boolean, not a per-element hint — so it has to pick one
  // face to mean "true" for every caller. Reading src/pdf/build.ts's
  // drawElements: the wordmark and beer name always draw in the real Bold
  // face (font: fonts.bold, overriding line.bold entirely), but every other
  // bold-flagged element resolves to SemiBold — drawLine picks
  // fonts.semibold when line.bold (volume, a bold description line, the
  // style line), and drawRotated's handleAddress/storeCold calls hardcode
  // fonts.semibold outright, regardless of any style field. In the shipped
  // default config that's 4 semibold calls (volume, the "# HOPS" header,
  // handleAddress, storeCold) against 2 Bold calls (wordmark, name), and
  // Poppins SemiBold vs Bold widths differ by under 2.5% at every size this
  // label uses (measured with widthOfTextAtSize directly) — so `bold` here
  // backs SemiBold. That undermeasures the wordmark/name by a percent or
  // two, split evenly on both edges since both are centered; backing it
  // with Bold instead would OVERmeasure every left- or baseline-anchored
  // bold line (volume, handleAddress, storeCold, a bold description line)
  // on one side only, which is the worse failure mode for a click target.
  useEffect(() => {
    void (async () => {
      const fonts = await fontsPromise;
      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      const regular = await doc.embedFont(fonts.regular);
      const semibold = await doc.embedFont(fonts.semibold);
      setMeasure(() => (text: string, size: number, bold: boolean) =>
        (bold ? semibold : regular).widthOfTextAtSize(text, size));
    })();
  }, []);

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

  // 1–5 switch views (Figma-style bare digits), with the same
  // inert-while-typing guard as undo: a digit in a text field is text.
  // Registered once; the ref keeps the one listener reading this render's
  // handlers rather than the ones captured at mount.
  const viewsRef = useRef(VIEWS);
  viewsRef.current = VIEWS;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;
      const view = viewsRef.current.find((v) => v.key === e.key);
      if (!view) return;
      view.go();
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
    const bmp = await createImageBitmap(f);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const check = validateMask(data.data);
    recolorMaskForPdf(data.data);
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
    values: viewSettings,
    onChange: (patch) => setViewSettings((s) => ({ ...s, ...patch })),
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
          const fonts = await fontsPromise;
          const assets: Assets = {
            fonts, logoSvg, ...(await collabAssets()),
            texture: texture ? { bytes: texture.previewBytes, kind: "png" } : undefined,
            maskPng: mask?.previewBytes,
            hidden: hiddenLayers,
          };
          // Sequential, not Promise.all — halves the transient memory peak.
          const art = await buildArtPdf(cfg, assets);
          if (stale) return;
          const maskPdf = await buildMaskPdf(cfg, assets);
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
    setBuilding(true);
    startSaveBatch();
    try {
      const fonts = await fontsPromise;
      // Exports honor the eye too: a hidden layer is "not on this label",
      // preview and deliverable alike. (PSDs still carry every layer — a
      // layered handoff is the place to keep them all.)
      const assets: Assets = {
        fonts, logoSvg, ...(await collabAssets()),
        texture: texture ? { bytes: texture.bytes, kind: texture.kind } : undefined,
        maskPng: mask?.bytes,
        hidden: hiddenLayers,
      };
      if (which !== "mask") saveBytes(await buildArtPdf(cfg, assets), `${fileBase(cfg)}.pdf`);
      if (which !== "art") saveBytes(await buildMaskPdf(cfg, assets), `${fileBase(cfg)}-mask.pdf`);
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
    const bmp = await createImageBitmap(new Blob([bytes as unknown as BlobPart]));
    const canvas = document.createElement("canvas");
    canvas.width = PSD_DOC.w;
    canvas.height = PSD_DOC.h;
    const ctx = canvas.getContext("2d")!;
    const s = Math.max(canvas.width / bmp.width, canvas.height / bmp.height);
    const w = bmp.width * s;
    const h = bmp.height * s;
    ctx.drawImage(bmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    bmp.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: new Uint8Array(img.data.buffer), width: img.width, height: img.height };
  }

  /** Layered Photoshop files: editable type layers, vector logo/QR/barcode.
   *  Built full-resolution on demand, like the PDF exports. Writes the pair —
   *  `{name}.psd` (art) and `{name}-mask.psd` (white-ink plate), mirroring
   *  the two PDF deliverables. */
  async function exportPsd() {
    setBuilding(true);
    startSaveBatch();
    try {
      const fonts = await fontsPromise;
      const assets: PsdAssets = {
        fonts, logoSvg,
        texture: await rasterPixels(texture?.bytes),
        mask: await rasterPixels(mask?.bytes),
      };
      saveBytes(await buildPsd(cfg, assets), `${fileBase(cfg)}.psd`, "image/vnd.adobe.photoshop");
      saveBytes(
        await buildPsd(cfg, assets, "mask"),
        `${fileBase(cfg)}-mask.psd`, "image/vnd.adobe.photoshop",
      );
      setBuildError("");
    } catch (err) {
      setBuildError(String(err));
    } finally {
      setBuilding(false);
    }
  }

  function saveConfig() {
    const url = blobUrl(
      new TextEncoder().encode(JSON.stringify(toConfigFile(cfg), null, 2)),
      "application/json",
    );
    download(url, `${cfg.beerName || "label"}-config.json`);
    URL.revokeObjectURL(url);
  }

  async function loadConfig(f: File) {
    try {
      setCfg(parseConfigFile(await f.text()));
      setLoadError("");
    } catch (err) {
      setLoadError(String(err));
    }
  }

  return (
    <TooltipProvider>
      {/* Figma-style three-region shell: collapsible left Sidebar (Layers),
          preview center, fixed inspector column right. */}
      <SidebarProvider>
        <Sidebar collapsible="offcanvas">
          <SidebarContent>
            <LayersPanel cfg={cfg} update={update} hidden={hiddenLayers}
              onToggleHidden={toggleHidden} selected={selected} onSelect={setSelected} />
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="flex h-svh flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-border px-3 py-1">
          {/* Toggles the Layers sidebar; the component also binds ⌘B. */}
          <SidebarTrigger className="size-6" />
          {/* Stripped to a real menu bar: no pill border or rounding of its
              own (the header's bottom border is the chrome), and small
              regular-weight labels rather than the default's badge-like
              medium ones. */}
          <Menubar className="h-auto gap-0 rounded-none border-0 p-0">
            <MenubarMenu>
              <MenubarTrigger className={MENU_TRIGGER}>File</MenubarTrigger>
              <MenubarContent align="start" className={MENU_ITEMS}>
                <MenubarItem onClick={saveConfig}>Save config</MenubarItem>
                <MenubarItem onClick={() => configInput.current?.click()}>
                  Load config
                </MenubarItem>
                <MenubarSeparator />
                {/* !pdfs is the mid-build state: the PSD path rebuilds from
                    the config alone, so only the PDF items wait on it.
                    Exporting both PDFs at once lives in the ⌘K palette only —
                    here the two layers are separate items. */}
                <MenubarItem disabled={blocked || !pdfs} onClick={downloadArt}>
                  Export PDF
                </MenubarItem>
                <MenubarItem disabled={blocked || !pdfs} onClick={downloadMask}>
                  Export Mask PDF
                </MenubarItem>
                <MenubarItem disabled={blocked} onClick={() => void exportPsd()}>
                  Export PSDs
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className={MENU_TRIGGER}>Edit</MenubarTrigger>
              <MenubarContent align="start" className={MENU_ITEMS}>
                <MenubarItem disabled={!canUndo} onClick={undo}>
                  Undo <MenubarShortcut>⌘Z</MenubarShortcut>
                </MenubarItem>
                <MenubarItem disabled={!canRedo} onClick={redo}>
                  Redo <MenubarShortcut>⇧⌘Z</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className={MENU_TRIGGER}>View</MenubarTrigger>
              <MenubarContent align="start" className={MENU_ITEMS}>
                {/* The 2D items are checked only at the divider's extremes:
                    anywhere in between is a manual compare position, which
                    is neither view. Separator after them splits flat from 3D. */}
                {VIEWS.map((v, i) => (
                  <Fragment key={v.label}>
                    {i === 2 && <MenubarSeparator />}
                    <MenubarCheckboxItem checked={v.checked} onClick={v.go}>
                      {v.label} <MenubarShortcut>{v.key}</MenubarShortcut>
                    </MenubarCheckboxItem>
                  </Fragment>
                ))}
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
          {/* Replaces the tooltip the old disabled Export button carried: a
              menu item can't explain its own disabled state, so the reason
              sits in the bar itself. */}
          {blocked && <span className="text-xs text-destructive">{blockedWhy}</span>}
          {/* Config-load failures used to sit atop the old sidebar; the bar
              is the one chrome that always shows regardless of selection. */}
          {loadError && <span className="text-xs text-destructive">{loadError}</span>}
          <input ref={configInput} type="file" accept="application/json" hidden
            onChange={(e) => e.target.files?.[0] && void loadConfig(e.target.files[0])} />
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
            {!texture && !building && (
              <span className="text-xs text-muted-foreground">
                drop a texture to fill the background
              </span>
            )}
          </div>
          <div className="relative flex min-h-0 flex-1">
            {/* PreviewCompare stays mounted but hidden in 3D modes (see
                viewMode). Selection box + click-to-select apply to 2D only. */}
            <div className={viewMode === "2d" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
            <PreviewCompare ref={previewRef}
              artBytes={pdfs?.artBytes ?? null} maskBytes={pdfs?.maskBytes ?? null}
              cfg={cfg} measure={measure}
              // The preview knows only renderer elements; a selected document
              // layer (background/mask) shows no selection box there.
              selected={selected && isElementId(selected) ? selected : null}
              onPick={setSelected}
              onSplit={setSplit} />
            </div>
            {/* Mounted from the first 3D view onward and hidden in 2D, for
                the same reason PreviewCompare is: re-entering a 3D view
                would otherwise re-fetch the GLTF and HDRI and re-rasterize
                both PDFs. `active` keeps the hidden scene from working. */}
            {used3d && (
              <div className={viewMode === "2d" ? "hidden" : "flex min-h-0 min-w-0 flex-1"}>
                <Suspense fallback={null}>
                  <CanView artBytes={pdfs?.artBytes ?? null} maskBytes={pdfs?.maskBytes ?? null}
                    mode={viewMode === "2d" ? "can" : viewMode}
                    settings={viewSettings} active={viewMode !== "2d"} />
                </Suspense>
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
        <Sheet open={selected !== null} modal={false}
          onOpenChange={(open) => { if (!open) setSelected(null); }}>
          <SheetContent side="right" showOverlay={false} showCloseButton={false}
            className="w-[300px] gap-0 overflow-y-auto p-3 sm:max-w-[300px]">
            {selected && (
              <Inspector id={selected} cfg={cfg} errors={errors} update={update} files={files}
                settings={docSettings}
                onClose={() => setSelected(null)} />
            )}
          </SheetContent>
        </Sheet>
        <CommandMenu
          actions={[
            { label: "Export PDF + Mask PDF", disabled: blocked || !pdfs, run: exportPdfs },
            { label: "Export PDF", disabled: blocked || !pdfs, run: downloadArt },
            { label: "Export Mask PDF", disabled: blocked || !pdfs, run: downloadMask },
            { label: "Export PSDs", disabled: blocked, run: () => void exportPsd() },
            { label: "Undo", disabled: !canUndo, run: undo },
            { label: "Redo", disabled: !canRedo, run: redo },
            { label: "Save config", run: saveConfig },
            { label: "Load config", run: () => configInput.current?.click() },
            ...VIEWS.map((v) => ({ label: `Preview: ${v.label}`, run: v.go })),
          ]}
        />
      </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
