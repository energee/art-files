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
import { PREVIEW_OVERSAMPLE, PSD_DOC } from "@/layout";
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
import { CommandMenu, shortcutOf, type Command } from "@/components/CommandMenu";
import { PreviewCompare, type PreviewCompareHandle } from "@/components/PreviewCompare";
import { Rulers } from "@/components/Rulers";
import { CanView, type CanViewHandle } from "@/components/CanView";
import {
  DEFAULT_MARGIN_PT, type GuideAxis, type ManualGuide, type RulerUnit,
} from "@/rulers";
import {
  Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator,
  MenubarShortcut, MenubarTrigger,
} from "@/components/ui/menubar";
import {
  Sidebar, SidebarContent, SidebarInset, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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

/** Largest wheel delta any single event is allowed to contribute, before the
 *  exponential below turns it into a scale factor. A trackpad pinch reports
 *  deltas of a few px many times a second, but one mouse notch reports 100 at
 *  once — unclamped that is e^(2/3) ≈ 2x from a single click of the wheel,
 *  which overshoots the whole zoom range in two notches. Clamped, a notch is
 *  at most 1.4x and a pinch still resolves smoothly. */
const ZOOM_STEP_CAP = 50;

/** Keep the scaled content covering the pane `r`, so neither a pan nor a
 *  zoom-out can strand the label against a band of empty background. At z === 1
 *  the two bounds collapse to 0 and the content is pinned. Shared by the two
 *  things that move the view — the wheel and the right-drag — so they cannot
 *  disagree about where the edges are. */
const clampView = (r: DOMRect, z: number, x: number, y: number) => ({
  z,
  x: Math.min(0, Math.max(r.width * (1 - z), x)),
  y: Math.min(0, Math.max(r.height * (1 - z), y)),
});

/** The pane's zoom range: 1 (fitted) up to the preview's own oversample, which
 *  is where the bitmap runs out of real pixels. The 3D views clamp their dolly
 *  to the same ceiling, so a zoom carried across is never silently clipped. */
const clampZoom = (z: number) => Math.min(PREVIEW_OVERSAMPLE, Math.max(1, z));

/** Zoom to `z` about the pane point (ax, ay), keeping whatever is under that
 *  point where it is. Shared by the wheel (anchored on the pointer) and the
 *  typed field (anchored on the pane centre, having no pointer to work from):
 *  the anchoring is the half of the view maths clampView doesn't cover, and
 *  the two callers must not disagree about it either. */
const zoomAbout = (
  r: DOMRect, v: { z: number; x: number; y: number }, z: number, ax: number, ay: number,
) => {
  const k = z / v.z;
  return clampView(r, z, ax - k * (ax - v.x), ay - k * (ay - v.y));
};

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
  // maskBytes is null until a build that included the white-ink plate lands
  // (see needMask): the art plate alone is enough for the default view.
  const [pdfs, setPdfs] =
    useState<{ artBytes: Uint8Array; maskBytes: Uint8Array | null } | null>(null);
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
  // Preview pane zoom: scale `z` about the pane's top-left, then offset by
  // (x, y) screen px. z === 1 is the fitted view, and the clamp in the wheel
  // handler pins the offset to 0 there, so unzoomed is exactly as before.
  const previewPane = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ z: 1, x: 0, y: 0 });
  // The 3D dolly, reported by CanView as a multiple of the mode's framing
  // distance so it shares the 2D pane's units. Held here, not in CanView,
  // because the one toolbar below reads whichever view is up.
  const canView = useRef<CanViewHandle>(null);
  // Stored as the whole percent the field shows, not the raw float: the camera
  // emits a 'change' per damped frame of every gesture, and a float would
  // re-render this whole component — command table, menubar, hidden compare —
  // for every one of them. Rounding lets React's bail-out absorb the frames
  // the readout wouldn't have moved on, which is most of a settle and all of
  // an orbit. The precise value still reaches `carried` below, which is a ref.
  const [camZoomPct, setCamZoomPct] = useState(100);
  const shownZoomPct = viewMode === "2d" ? Math.round(zoom.z * 100) : camZoomPct;
  // Zoom level follows you across views: both sides express it as a multiple
  // of how the view frames itself, so handing the number over is enough. Pan
  // travels with it as a fraction of the visible frame — the 2D pane's px
  // offset and the 3D target displacement are different quantities, but "a
  // third of a frame left of centre" means the same thing in both.
  //
  // A ref, not state: only a view change hands it over, and re-rendering on
  // every camera frame to store a number nothing displays is pure waste. Held
  // in CanView's own {zoom, pan} shape so the handover is a prop rather than a
  // pack/unpack at each of the three boundaries it crosses.
  const carried = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  // The view this ref's contents belong to, so a freshly mounted scene's reset
  // emissions can't be mistaken for the operator's position (see onZoom).
  const carriedMode = useRef(viewMode);
  // Captured on the single render that leaves 2D — `zoom` still holds the 2D
  // value there and the pane still has its rect, so this is the same number
  // the last 2D render would have produced, measured once per switch instead
  // of on every keystroke, divider drag and pan frame. It has to happen in
  // render rather than an effect: CanView reads it as a prop while mounting,
  // and child effects run before this component's own. The 3D side has no
  // state to read back here (a right-drag pan changes none), so it records
  // straight from the camera in CanView's onZoom, its single writer.
  if (viewMode !== "2d" && carriedMode.current === "2d") {
    const r = previewPane.current?.getBoundingClientRect();
    if (r?.width) carried.current = {
      zoom: zoom.z,
      // How far the transformed sheet's centre sits from the pane's centre,
      // as a fraction of the VISIBLE frame. Do not divide this by zoom: the
      // 3D camera's pan uses its current projected frame too, so doing that
      // made a 2D pan arrive 1/z as far away in Rendered.
      pan: {
        x: (r.width * (1 - zoom.z) / 2 - zoom.x) / r.width,
        y: (r.height * (1 - zoom.z) / 2 - zoom.y) / r.height,
      },
    };
  }
  useEffect(() => {
    carriedMode.current = viewMode;
    if (viewMode !== "2d") return; // CanView takes it as a prop — see initialView
    const { zoom: z, pan } = carried.current;
    const r = previewPane.current?.getBoundingClientRect();
    if (!r?.width) return setZoom({ z, x: 0, y: 0 });
    setZoom(clampView(r, z,
      r.width * (1 - z) / 2 - pan.x * r.width,
      r.height * (1 - z) / 2 - pan.y * r.height));
  }, [viewMode]);
  // What the toolbar field holds while it is being edited; null means it just
  // mirrors shownZoomPct, so a gesture keeps updating the number until you type.
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  // Commits the typed percentage (on Enter or blur). Garbage input is simply
  // dropped back to the live value — the field is a readout first.
  const applyTypedZoom = () => {
    const pct = parseFloat(zoomDraft ?? "");
    setZoomDraft(null);
    if (!isFinite(pct)) return;
    const z = clampZoom(pct / 100);
    if (viewMode === "2d") {
      const r = previewPane.current?.getBoundingClientRect();
      // Anchor on the pane centre: with no pointer to zoom about, growing from
      // the top-left would walk the label off the corner.
      setZoom((v) => r?.width
        ? zoomAbout(r, v, z, r.width / 2, r.height / 2)
        : { z, x: 0, y: 0 });
    } else canView.current?.setZoom(z);
  };
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

  // Wheel-to-zoom, scoped to the preview pane, matching what OrbitControls
  // gives the 3D views so one set of habits works in all four: wheel (or a
  // two-finger scroll) dollies, right-drag pans, and the context menu is out of
  // the way. Every wheel event zooms, ctrlKey or not — a trackpad pinch reports
  // ctrlKey and a scroll doesn't, but OrbitControls dollies on both, so
  // splitting them here is exactly the inconsistency to avoid.
  //
  // preventDefault on the ctrlKey ones doubles as the fix for the original
  // complaint: without it a pinch is browser page zoom, rescaling the whole UI
  // — menubar, layers, inspector — just to look closely at the label. Scoped to
  // this element, so pinching anywhere else still zooms the app.
  //
  // 2D only: the 3D views run this gesture through OrbitControls against a real
  // camera, and CSS-scaling their canvas would only magnify a fixed-resolution
  // render.
  //
  // The listener is attached by hand rather than through onWheel because
  // React's synthetic wheel handler is registered passive at the root, where
  // preventDefault does nothing.
  //
  // setZoom's functional form is load-bearing, not style: a pinch delivers
  // wheel events faster than React re-renders, so a handler closing over `zoom`
  // would apply several events on top of the same stale value and drop all but
  // the last. Measured: twelve zoom-out events in one tick left the pane at
  // 1.37x instead of 1. Composing on the previous state makes every event
  // count, and lets the listener stay attached across zoom changes.
  //
  // ponytail: no touchscreen pinch (touch events) and no Safari `gesture*`
  // fallback — add either if this ever runs somewhere that matters.
  useEffect(() => {
    const el = previewPane.current;
    if (!el || viewMode !== "2d") return;
    function onWheel(e: WheelEvent) {
      const r = el!.getBoundingClientRect();
      if (!r.width || !r.height) return; // not laid out yet
      e.preventDefault();
      setZoom((v) => {
        // Zoom about the pointer, which is where this deliberately departs from
        // OrbitControls: it dollies toward the camera target, but a flat
        // document has no target worth keeping centred, and anchoring on the
        // cursor is what lets you drive straight at a detail. Exponential in
        // deltaY so an increment feels the same at 1x as at 2x, instead of
        // crawling once zoomed in.
        const step = Math.max(-ZOOM_STEP_CAP, Math.min(ZOOM_STEP_CAP, e.deltaY));
        const z = clampZoom(v.z * Math.exp(-step / 150));
        return zoomAbout(r, v, z, e.clientX - r.left, e.clientY - r.top);
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewMode]);

  // Drag-to-pan on the right button, which on a trackpad is the two-finger
  // click — the same button OrbitControls pans with in the 3D views. That
  // gesture otherwise opens the browser context menu over the preview, a menu
  // of things ("Reload", "Inspect") with nothing to do with the label, so
  // onContextMenu below suppresses it exactly as OrbitControls does on its own
  // canvas. With the wheel given over to zoom, this is the only way to pan.
  // The drag origin, plus the pane's rect measured once at pointerdown: the
  // pane cannot be resized by a pan, and re-measuring per move was a forced
  // layout flush up to 120 times a second.
  const panFrom = useRef<{ x: number; y: number; r: DOMRect } | null>(null);
  const [panning, setPanning] = useState(false);
  function onPanStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 2 || viewMode !== "2d") return;
    // Capture, so a drag that leaves the pane (or the window) keeps panning
    // and still gets its pointerup instead of sticking in a dragging state.
    e.currentTarget.setPointerCapture(e.pointerId);
    panFrom.current = {
      x: e.clientX, y: e.clientY, r: e.currentTarget.getBoundingClientRect(),
    };
    setPanning(true);
  }
  function onPanMove(e: React.PointerEvent<HTMLDivElement>) {
    const from = panFrom.current;
    if (!from) return;
    // Deltas against the previous move, not the drag origin, so the clamp
    // biting at an edge can't build up an offset the label has to "catch up"
    // through when the drag turns back the other way.
    const dx = e.clientX - from.x, dy = e.clientY - from.y;
    from.x = e.clientX;
    from.y = e.clientY;
    setZoom((v) => clampView(from.r, v.z, v.x + dx, v.y + dy));
  }
  function onPanEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!panFrom.current) return;
    panFrom.current = null;
    setPanning(false);
    // No explicit release: this runs on pointerup and pointercancel, which are
    // exactly the two events that release capture implicitly.
  }
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
  // Rulers and guides are view state, like hidden layer eyes: they assist the
  // operator but are not label content, so none enters config history/exports.
  const [showRulers, setShowRulers] = useState(true);
  const [rulerUnit, setRulerUnit] = useState<RulerUnit>("in");
  const [showGuides, setShowGuides] = useState(true);
  const [showMargins, setShowMargins] = useState(true);
  const [showCenter, setShowCenter] = useState(true);
  const [showManualGuides, setShowManualGuides] = useState(true);
  const [marginPt, setMarginPt] = useState(DEFAULT_MARGIN_PT);
  const [manualGuides, setManualGuides] = useState<ManualGuide[]>([]);
  const nextGuideId = useRef(1);
  const addManualGuide = (axis: GuideAxis, point: number) =>
    setManualGuides((guides) => [...guides, { id: nextGuideId.current++, axis, point }]);
  const moveManualGuide = (id: number, point: number) =>
    setManualGuides((guides) => guides.map((guide) => guide.id === id ? { ...guide, point } : guide));
  const removeManualGuide = (id: number) =>
    setManualGuides((guides) => guides.filter((guide) => guide.id !== id));

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

  // Figma-style bare keys plus the ⌘-modified exports (see `commands` for
  // which), with the same inert-while-typing guard as undo: a digit in a text
  // field is text. Registered once — the handler reads the table through a ref.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey) return;
      // The pressed combo, in the same notation the table declares: undefined
      // for a bare key, so a command can't fire under the wrong modifiers.
      const mods = e.metaKey || e.ctrlKey ? (e.shiftKey ? "⇧⌘" : "⌘") : undefined;
      if (!mods && e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;
      const cmd = commandsRef.current.find((c) => c.key === e.key.toLowerCase() && c.mods === mods);
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
    labelWidth: render.labelWidth,
    onLabelWidth: (v) => setRender((r) => ({ ...r, labelWidth: v })),
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

  // Is the white-ink plate visible anywhere right now? In the 2D compare it is
  // clipped away entirely at split 0 (PreviewCompare's clipPath), which is
  // where a typing session lives; the 3D views always texture with it. False
  // skips ~40% of every rebuild — the mask build in the worker plus its pdf.js
  // raster here. A boolean, not `split` itself, so dragging the divider
  // doesn't re-run the effect once per pointer frame; flipping it to true is
  // itself a dependency, so the plate is rebuilt the moment it's needed (it
  // lags one build behind at that instant, the same lag the whole preview
  // already has).
  const needMask = viewMode !== "2d" || split > 0;

  // Debounced preview regeneration on any input change, at preview resolution
  // (Loaded.previewBytes). Short: the two guards below, not the wait, are what
  // keep keystroke bursts from OOMing the tab — builds are serialized through
  // buildChain (the debounce alone can't stop overlap once a build outlasts
  // the typing gap), and superseded builds bail before allocating anything. So
  // the delay only has to outlast a fast typist's inter-key gap.
  const buildChain = useRef<Promise<void>>(Promise.resolve());
  // Everything a plate is built from. Spread into the effect's deps below, so
  // this is the ONE list — a future input added here can't be forgotten in the
  // dep array (which would stop rebuilds) or in the identity check (which
  // would silently freeze the preview for that input).
  const inputs = [cfg, texture, mask, collabLeft, collabCenter, hiddenLayers] as const;
  // What the last COMPLETED build was made from, so a re-run of this effect
  // that changes none of it doesn't rebuild. needMask is a dependency (the
  // plate has to appear when it's first needed), which without this made every
  // trip between the standard and mask views rebuild both plates from
  // unchanged inputs. Identity comparison is enough: `update` structuredClones
  // cfg, and each asset/hidden-set edit replaces its object.
  const built = useRef<{ inputs: typeof inputs; withMask: boolean } | null>(null);
  useEffect(() => {
    if (blocked) return;
    const done = built.current;
    const sameInputs = !!done && done.inputs.every((v, i) => v === inputs[i]);
    // Already on screen and still current: the mask half only forces a rebuild
    // when it's newly needed and the last build skipped it.
    if (sameInputs && (!needMask || done.withMask)) return;
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
          // Only the plates that aren't already current. sameInputs means the
          // art on screen was built from exactly these inputs, so the mask
          // top-up that a first trip to the mask view triggers rebuilds the
          // mask alone — and leaving artBytes' identity untouched is what
          // keeps that trip from re-rasterizing the art through pdf.js too.
          const { art, mask: maskPdf } =
            await buildPreviewPdfs(cfg, assets, { art: !sameInputs, mask: needMask });
          if (stale) return;
          // A skipped plate keeps the last one it built rather than blanking
          // the canvas: nothing is showing it, and if something starts to,
          // stale-by-one-build beats an empty frame while the rebuild runs.
          // (art is only ever skipped when a previous build already landed one,
          // so the `?? old` can't leave us without an art plate.)
          setPdfs((old) => {
            const artBytes = art ?? old?.artBytes;
            return artBytes ? { artBytes, maskBytes: maskPdf ?? old?.maskBytes ?? null } : old;
          });
          built.current = { inputs, withMask: needMask };
          setBuildError("");
        } catch (err) {
          if (!stale) setBuildError(String(err));
        } finally {
          if (!stale) setBuilding(false);
        }
      });
    }, 150);
    return () => { stale = true; clearTimeout(timer); };
  }, [...inputs, blocked, needMask]);

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
   *  Built full-resolution on demand, like the PDF exports. `which` picks a
   *  single plate — `{name}.psd` (art) or `{name}-mask.psd` (white ink) — and
   *  defaults to writing both, mirroring the two PDF deliverables. */
  async function exportPsd(which: "both" | "art" | "mask" = "both") {
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
      if (which !== "mask") {
        saveBytes(await buildPsd(cfg, assets), `${exportBaseName(cfg)}.psd`, "image/vnd.adobe.photoshop");
      }
      if (which !== "art") {
        saveBytes(
          await buildPsd(cfg, assets, "mask"),
          `${exportBaseName(cfg)}-mask.psd`, "image/vnd.adobe.photoshop",
        );
      }
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
   *  their `run`/`disabled`/`label` from it, and every surface renders its
   *  glyphs through shortcutOf — so a shortcut can't drift from the key that
   *  actually fires it, a label can't drift from the command it names, and a
   *  command can't be enabled in one surface while disabled in another. The menubar keeps its own JSX: it groups,
   *  separates and check-marks, which is layout, not command identity. */
  const commands: Command[] = [
    // ⌘E exports the PDFs, ⇧⌘E the PSDs — the whole-deliverable runs. The
    // single-plate variants stay menu-only: naming six distinct combos costs
    // more than it saves.
    { id: "export-both", label: "Export PDFs", key: "e", mods: "⌘",
      disabled: pdfExportBlocked, run: exportPdfs },
    { id: "export-art", label: "Export Artwork PDF", disabled: pdfExportBlocked, run: downloadArt },
    { id: "export-mask", label: "Export Mask PDF", disabled: pdfExportBlocked, run: downloadMask },
    { id: "export-psd", label: "Export PSDs", key: "e", mods: "⇧⌘",
      disabled: exportBlocked, run: () => void exportPsd() },
    { id: "export-psd-art", label: "Export Artwork PSD", disabled: exportBlocked, run: () => void exportPsd("art") },
    { id: "export-psd-mask", label: "Export Mask PSD", disabled: exportBlocked, run: () => void exportPsd("mask") },
    { id: "undo", label: "Undo", shortcut: "⌘Z", disabled: !canUndo, run: undo },
    { id: "redo", label: "Redo", shortcut: "⇧⌘Z", disabled: !canRedo, run: redo },
    { id: "presets-export", label: "Export presets", run: () => void exportPresets() },
    { id: "presets-import", label: "Import presets", run: () => presetsInput.current?.click() },
    { id: "view-standard", label: "Preview: Standard", key: "1", run: () => show2d("art") },
    { id: "view-mask", label: "Preview: Mask", key: "2", run: () => show2d("mask") },
    { id: "view-rendered", label: "Preview: Rendered", key: "3", run: () => setViewMode("flat") },
    { id: "view-can", label: "Preview: Single Can", key: "4", run: () => setViewMode("can") },
    { id: "view-pack", label: "Preview: Four-Pack", key: "5", run: () => setViewMode("pack") },
    // Bare B, not ⌘B — that one belongs to the sidebar toggle. Disabled
    // outside the 2D view, where there is no trim guide to draw.
    { id: "bleed", label: bleed ? "Hide bleed lines" : "Show bleed lines", key: "b",
      disabled: viewMode !== "2d", run: () => setBleed((b) => !b) },
    { id: "rulers", label: showRulers ? "Hide rulers" : "Show rulers", key: "r",
      disabled: viewMode !== "2d", run: () => setShowRulers((shown) => !shown) },
    { id: "guides", label: showGuides ? "Hide guides" : "Show guides",
      disabled: viewMode !== "2d", run: () => setShowGuides((shown) => !shown) },
    { id: "margin-guides", label: showMargins ? "Hide margin guides" : "Show margin guides",
      disabled: viewMode !== "2d" || !showGuides, run: () => setShowMargins((shown) => !shown) },
    { id: "center-guides", label: showCenter ? "Hide center guides" : "Show center guides",
      disabled: viewMode !== "2d" || !showGuides, run: () => setShowCenter((shown) => !shown) },
    { id: "manual-guides", label: showManualGuides ? "Hide manual guides" : "Show manual guides",
      disabled: viewMode !== "2d" || !showGuides, run: () => setShowManualGuides((shown) => !shown) },
    { id: "clear-guides", label: "Clear manual guides",
      disabled: viewMode !== "2d" || !showGuides || manualGuides.length === 0,
      run: () => setManualGuides([]) },
  ];
  // Indexed once per render rather than a linear find per menu item: the
  // menubar reads ~15 commands and App re-renders on every keystroke.
  const index = Object.fromEntries(commands.map((c) => [c.id, c])) as Record<string, Command>;
  // Throws at the lookup rather than at the .run/.disabled access downstream:
  // every caller is a literal id in the menubar's JSX, so a miss means a typo
  // or a deleted command, and the id is the only useful thing to report.
  const byId = (id: string): Command => {
    const c = index[id];
    if (!c) throw new Error(`Unknown command: ${id}`);
    return c;
  };
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
                {/* Deliverables first, both-at-once first within each format:
                    that is the common run. !pdfs is the mid-build state, so
                    only the PDF items wait on it — the PSD path rebuilds from
                    the config alone. */}
                <MenubarItem disabled={byId("export-both").disabled} onClick={byId("export-both").run}>
                  {byId("export-both").label} <MenubarShortcut>{shortcutOf(byId("export-both"))}</MenubarShortcut>
                </MenubarItem>
                <MenubarItem disabled={byId("export-art").disabled} onClick={byId("export-art").run}>
                  {byId("export-art").label}
                </MenubarItem>
                <MenubarItem disabled={byId("export-mask").disabled} onClick={byId("export-mask").run}>
                  {byId("export-mask").label}
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem disabled={byId("export-psd").disabled} onClick={byId("export-psd").run}>
                  {byId("export-psd").label} <MenubarShortcut>{shortcutOf(byId("export-psd"))}</MenubarShortcut>
                </MenubarItem>
                <MenubarItem disabled={byId("export-psd-art").disabled} onClick={byId("export-psd-art").run}>
                  {byId("export-psd-art").label}
                </MenubarItem>
                <MenubarItem disabled={byId("export-psd-mask").disabled} onClick={byId("export-psd-mask").run}>
                  {byId("export-psd-mask").label}
                </MenubarItem>
                <MenubarSeparator />
                {/* The preset library: beer styles and barcodes reused across
                    labels. Ellipsis — import opens a file picker. */}
                <MenubarItem onClick={byId("presets-import").run}>
                  Import Presets…
                </MenubarItem>
                <MenubarItem onClick={byId("presets-export").run}>
                  Export Presets
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className={MENU_TRIGGER}>Edit</MenubarTrigger>
              <MenubarContent align="start" className={MENU_ITEMS}>
                <MenubarItem disabled={byId("undo").disabled} onClick={byId("undo").run}>
                  Undo <MenubarShortcut>{shortcutOf(byId("undo"))}</MenubarShortcut>
                </MenubarItem>
                <MenubarItem disabled={byId("redo").disabled} onClick={byId("redo").run}>
                  Redo <MenubarShortcut>{shortcutOf(byId("redo"))}</MenubarShortcut>
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
            <MenubarMenu>
              <MenubarTrigger className={MENU_TRIGGER}>View</MenubarTrigger>
              <MenubarContent align="start" className={MENU_ITEMS}>
                {/* Checked only at the extremes: anywhere in between is a
                    manual compare position, which is neither view. */}
                <MenubarCheckboxItem checked={viewMode === "2d" && split === 0}
                  onClick={byId("view-standard").run}>
                  Standard <MenubarShortcut>{shortcutOf(byId("view-standard"))}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={viewMode === "2d" && split === 100}
                  onClick={byId("view-mask").run}>
                  Mask <MenubarShortcut>{shortcutOf(byId("view-mask"))}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarSeparator />
                <MenubarCheckboxItem checked={viewMode === "flat"}
                  onClick={byId("view-rendered").run}>
                  Rendered <MenubarShortcut>{shortcutOf(byId("view-rendered"))}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={viewMode === "can"}
                  onClick={byId("view-can").run}>
                  Single Can <MenubarShortcut>{shortcutOf(byId("view-can"))}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={viewMode === "pack"}
                  onClick={byId("view-pack").run}>
                  Four-Pack <MenubarShortcut>{shortcutOf(byId("view-pack"))}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarSeparator />
                {/* 2D only: the trim guide is drawn in page space, which the
                    3D views don't present. */}
                <MenubarCheckboxItem checked={bleed}
                  disabled={byId("bleed").disabled} onClick={byId("bleed").run}>
                  Bleed Lines <MenubarShortcut>{shortcutOf(byId("bleed"))}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={showRulers}
                  disabled={byId("rulers").disabled} onClick={byId("rulers").run}>
                  Rulers <MenubarShortcut>{shortcutOf(byId("rulers"))}</MenubarShortcut>
                </MenubarCheckboxItem>
                <MenubarSeparator />
                <MenubarCheckboxItem checked={showGuides}
                  disabled={byId("guides").disabled} onClick={byId("guides").run}>
                  Guides
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={showMargins}
                  disabled={byId("margin-guides").disabled} onClick={byId("margin-guides").run}>
                  Margin Guides
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={showCenter}
                  disabled={byId("center-guides").disabled} onClick={byId("center-guides").run}>
                  Center Guides
                </MenubarCheckboxItem>
                <MenubarCheckboxItem checked={showManualGuides}
                  disabled={byId("manual-guides").disabled} onClick={byId("manual-guides").run}>
                  Manual Guides
                </MenubarCheckboxItem>
                <MenubarItem disabled={byId("clear-guides").disabled}
                  onClick={byId("clear-guides").run}>
                  Clear Manual Guides
                </MenubarItem>
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
          {/* Build failures sit here too rather than in their own strip above
              the preview — one place for chrome-level errors, and the strip
              was 20px reserved for a row that is empty almost always. */}
          {buildError && <span className="text-xs text-destructive">{buildError}</span>}
          <input ref={presetsInput} type="file" accept="application/json" hidden
            onChange={(e) => e.target.files?.[0] && void importPresets(e.target.files[0])} />
        </header>
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          {/* overflow-hidden is what makes the pane the window the zoomed
              preview is seen through; without it the scaled label would spill
              over the layers panel and the inspector. */}
          <div
            ref={previewPane}
            className={cn("relative flex min-h-0 flex-1 overflow-hidden",
              panning && "cursor-grabbing")}
            // Suppressed unconditionally in 2D, not just while zoomed: a
            // gesture that opens a menu at 100% and pans at 150% would be a
            // coin toss. The 3D views keep the normal menu.
            onContextMenu={(e) => viewMode === "2d" && e.preventDefault()}
            onPointerDown={onPanStart}
            onPointerMove={onPanMove}
            onPointerUp={onPanEnd}
            onPointerCancel={onPanEnd}>
            {/* Blurs the stale render while a rebuild is in flight, so what's
                on screen reads as "being replaced" rather than current. Only
                the two views are inside it — the overlays below stay sharp,
                which is what keeps them readable as chrome. */}
            <div
              className={cn("flex min-h-0 min-w-0 flex-1 transition-[filter,opacity] duration-200",
                building && "blur-sm opacity-70")}>
            {/* PreviewCompare stays mounted but hidden in 3D modes (see
                viewMode). Selection box + click-to-select apply to 2D only.
                The pinch-zoom transform belongs to THIS div, not the wrapper
                above: the 3D views zoom their own camera, so scaling a shared
                ancestor multiplied the two and showed a 200% dolly at 400%.
                transform is deliberately absent from the transition list — it
                has to track the pinch frame for frame, not ease toward it. */}
            <div
              className={viewMode === "2d" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}
              style={{
                transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.z})`,
                transformOrigin: "0 0",
              }}>
            <PreviewCompare ref={previewRef}
              // Nulled while a 3D view is up: this component stays mounted but
              // display:none, and a hidden canvas rasterizes just as expensively
              // as a visible one — that was two wasted pdf.js passes per rebuild
              // on top of CanView's own. useRenderPdf no-ops on null, so the
              // canvases keep their last painting and coming back to 2D flips
              // the identity and repaints once.
              artBytes={viewMode === "2d" ? pdfs?.artBytes ?? null : null}
              maskBytes={viewMode === "2d" ? pdfs?.maskBytes ?? null : null}
              cfg={cfg} measure={measure} collab={collabSlots}
              // The preview knows only renderer elements; a selected document
              // layer (background/mask) shows no selection box there.
              selected={elementSelection}
              onPick={pick}
              onSplit={setSplit}
              bleed={bleed}
              // Same Settings knob the 3D die uses, so both previews cut alike.
              cornerRadiusPct={render.cornerRadius} />
            </div>
            {viewMode !== "2d" && (
              <CanView ref={canView}
                initialView={carried.current}
                onZoom={(z, pan) => {
                  // Record straight from the camera rather than waiting for a
                  // render: a right-drag pan changes no state, so the render
                  // that would have captured it never happens and leaving the
                  // view handed the 2D pane a stale position. Same guard as
                  // the render-time capture — ignore the resets a freshly
                  // mounted scene emits before the handover has been applied.
                  if (carriedMode.current !== "2d") carried.current = { zoom: z, pan };
                  setCamZoomPct(Math.round(z * 100));
                }}
                artBytes={pdfs?.artBytes ?? null} maskBytes={pdfs?.maskBytes ?? null}
                mode={viewMode} cornerRadiusPct={render.cornerRadius}
                labelHeightPct={render.labelSize}
                labelWidthPct={render.labelWidth}
                edgeSoftnessPct={render.edgeSoftness} />
            )}
            </div>
            {viewMode === "2d" && (
              <Rulers paneRef={previewPane} previewRef={previewRef} transform={zoom}
                showRulers={showRulers} unit={rulerUnit} onUnitChange={setRulerUnit}
                guidesEnabled={showGuides} showMargins={showMargins} showCenter={showCenter}
                showManual={showManualGuides} marginPt={marginPt}
                onMarginChange={setMarginPt} manual={manualGuides}
                onAddManual={addManualGuide} onMoveManual={moveManualGuide}
                onRemoveManual={removeManualGuide} />
            )}
            {/* Rebuild indicator, in the frame's bottom-left rather than a
                strip above it: it belongs to the thing that is changing. Same
                corner CanView uses for its texture build, which runs right
                after this one, so the two read as one continuous indicator.
                Outside the blur wrapper, so it stays sharp; gated on pdfs so
                it can't double up with the first-load spinner below. */}
            {building && pdfs && (
              <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
                rendering preview…
              </span>
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
                visible, blur it, and show the corner spinner instead. */}
            {!pdfs && !buildError && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  <span className="text-xs">rendering label…</span>
                </div>
              </div>
            )}
          </div>
          {/* Preview toolbar, in every view: 2D reads its CSS transform and the
              3D views read their camera dolly, both expressed against how the
              view frames itself, so one number means the same thing in all
              four. Left-aligned, under the preview frame's left edge. */}
          <div className="flex h-8 shrink-0 items-center overflow-x-auto border-t border-border bg-sidebar px-2">
            {/* Readout and control in one: it tracks the gesture while idle,
                and typing a percentage over it jumps there — 100 is the way
                back, so no separate reset button. In 3D that moves the dolly
                and leaves the orbit alone; the angle is the operator's work.
                Commits on Enter or blur, Esc abandons the edit. tabular-nums
                so the width doesn't jitter digit by digit as the number runs. */}
            <input
              value={zoomDraft ?? String(shownZoomPct)}
              onChange={(e) => setZoomDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => applyTypedZoom()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") { setZoomDraft(null); e.currentTarget.blur(); }
              }}
              title="Zoom — type a percentage, 100 fits the view"
              aria-label="Zoom percentage"
              className="w-10 rounded bg-transparent py-0.5 text-right text-xs tabular-nums text-muted-foreground outline-none hover:text-foreground focus:text-foreground" />
            <span className="text-xs text-muted-foreground">%</span>
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
            // Hand focus back to whatever opened the sheet only when the
            // close came from the keyboard. Otherwise base-ui returns it to
            // the last-clicked layer row AND marks it keyboard-focused, so
            // dismissing the inspector with the mouse lit a focus ring on a
            // row the user never navigated to — an outline that looked like
            // it was highlighting something at random.
            finalFocus={(closeType) => closeType === "keyboard"}
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
