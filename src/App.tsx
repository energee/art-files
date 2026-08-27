// App.tsx — one document's editor: LabelConfig, texture/mask assets
// (full-res + preview-res pairs), validation, and on-demand full-resolution
// exports, plus whole-project save/open (.label — see labelfile.ts). The 2D
// preview draws per keystroke from the canvas backend (see canvas/draw.ts);
// the 3D views texture from the same plates (see three/labelTextures.ts).
// PDFs/PSDs build only on export.
// TabsShell mounts one DocumentEditor per workspace tab and hides the
// inactive ones, so anything here that registers window/document-level
// listeners or renders a singleton surface (the native menu) MUST honor the
// `active` prop — and per-document renders are dropped while inactive (see
// the deactivation effect). The editor reports { title, dirty, edited,
// filePath } upward through onMeta; the shell owns tabs, file-open routing,
// render settings, and the updater.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { basename } from "@tauri-apps/api/path";
import type {
  CollabSlot, CustomBarcodeLayer, CustomImageLayer, CustomLayer, CustomQrLayer, CustomTextLayer,
  Fill, LabelConfig,
} from "@/types";
import { dragTarget, dragTarget2, editableText, type ElementId } from "@/elements";
import type { Measure } from "@/hittest";
import { defaultConfig, exportBaseName, parseConfigFile } from "@/defaults";
import { strToU8 } from "fflate";
import { LABEL_EXT, packLabelV2, unpackLabel } from "@/labelfile";
import { LABEL_FILTER, LABEL_TYPES, isAbort, savePicker, writeHandle } from "@/filePickers";
import { readNativeFile, saveNativeFile } from "@/files";
import { useHistory } from "@/history";
import {
  addVariant, applyDesignEdit, applyLayerEdit, bridgeCollabOverride, composeConfig,
  configDiff, expandCustomFormats, toggleVariant, valuesFromConfig, visibleFieldsOf,
  type EditTarget,
} from "@/model/document";
import { parseLabelFile } from "@/model/labelfile";
import { lolevMaster } from "@/model/lolev";
import { masterIndex, resolveMasterById } from "@/masters";
import type { FieldDecl, FieldValue, LabelFileV2, Master, MasterLayer } from "@/model/types";
import { setPath } from "@/model/resolve";
import { makeHiddenPropsEqual } from "@/tabs";
import { validateUpc } from "@/upc";
import { EMBEDDABLE_RASTER, mimeFor, rasterKind, tintRgba } from "@/collab";
import { parseLogo } from "@/logo";
// The builders are imported dynamically at export time (see downloadPdfs /
// exportPsd) so they stay out of the initial bundle; only their types are
// needed up front.
import type { Assets, CollabImage } from "@/pdf/build";
import type { PsdAssets } from "@/psd/build";
// setBleed is aliased: `bleed` is already taken here by the show-bleed-lines
// toggle, and the two are unrelated — one is a view option, the other the
// document's actual geometry.
import {
  ART, PAGE, PREVIEW_OVERSAMPLE, PSD_DOC, setBleed as setLayoutBleed, setOutputDpi,
} from "@/layout";
import {
  Inspector, type CollabFiles, type DocSettings, type InspectorFiles,
} from "@/components/StyleProperties";
import { LayersPanel } from "@/components/LayersPanel";
import { EditingTarget } from "@/components/EditingTarget";
import { FieldList } from "@/components/FieldList";
import { AssetDropOverlay } from "@/components/AssetDropOverlay";
import {
  commitBleedIn, loadPresets, mutatePresets, normalizePresets, usePresets,
  type Presets,
} from "@/presets";
import { isElementId, type HideableLayerId, type LayerId } from "@/components/layers";
import { panelRows } from "@/model/panel";
import {
  EMPTY_SELECTION, resolveSelect, type SelectMods, type Selection,
} from "@/selection";
import { CommandMenu, type Command } from "@/components/CommandMenu";
import { AppMenu } from "@/components/AppMenu";
import { PresetsDialog } from "@/components/PresetsDialog";
import { PreviewCompare, type PreviewCompareHandle } from "@/components/PreviewCompare";
import { Rulers } from "@/components/Rulers";
import { CanView, type CanViewHandle } from "@/components/CanView";
import {
  DEFAULT_MARGIN_PT, nextRulerUnit, sizeLabel,
  type GuideAxis, type ManualGuide, type RulerUnit,
} from "@/rulers";
import {
  Sidebar, SidebarContent, SidebarInset, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { loadLabelFont, loadLabelFaces, labelFontCss } from "@/fonts";
import { fontFamilyOf } from "@/fontCatalog";
import { loadFonts } from "@/pdf/fonts";
import type { MeasureFace, PlanAssets } from "@/plan";
import type { CanvasAssets, CanvasRenderSource } from "@/canvas/draw";
import logoSvg from "@/assets/logo2025.svg?raw";

/** bytes = full print resolution (exports); previewBytes = downscaled PNG the
 *  assembly effect decodes into a bitmap, so keystroke-driven rebuilds never
 *  churn the print-size image (a burst of those OOMs the tab). Neither is necessarily
 *  the original file bytes: the mask's `bytes` is recolored (see onMask), so
 *  it carries an extra `srcBytes` — the untouched upload — for Save Project
 *  to round-trip without double-processing on reload. */
type Loaded = { bytes: Uint8Array; previewBytes: Uint8Array; name: string; previewUrl: string };

/** A loaded collab logo: what the renderer needs, plus what the drop zone
 *  shows. previewUrl is the raw file, so an SVG thumbnails as itself. */
type CollabFile = { image: CollabImage; name: string; previewUrl: string };

/** A loaded master-variant custom-image-layer asset: mirrors CollabFile,
 *  plus the intrinsic aspect (w/h) stored back onto the layer (types.ts's
 *  CustomImageLayer.aspect) so hit/drag boxes are exact before/without a
 *  decoded bitmap. Keyed by the id minted at drop (mintCustomAssetId). */
type CustomFile = { image: CollabImage; name: string; previewUrl: string; aspect: number };

/** Mint a new custom-layer asset id. One spelling of the format, so every
 *  call site — this file's open/restore path and the (later) drop-to-add UI
 *  — mints ids a saved project's `CustomImageLayer.asset` can always resolve
 *  against a customImages entry here, regardless of which added it. */
export function mintCustomAssetId(): string {
  return `custom-asset-${crypto.randomUUID().slice(0, 8)}`;
}

/** Chrome-level error, sized for the menu bar: the shadcn Alert (the app's
 *  one notification surface — see ui/alert.tsx) compacted to fit inline
 *  beside the menus rather than as a full-width block. */
function HeaderAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="destructive" className="w-auto border-destructive/50 px-2 py-0.5">
      <AlertDescription className="text-xs">{children}</AlertDescription>
    </Alert>
  );
}

/** Where the view toggles (rulers/guides/bleed lines) persist — localStorage,
 *  deliberately NOT presets.json: per-operator UI state in the git-tracked
 *  library dirtied the repo on every View-menu click. Defaults match the
 *  historical boot state (rulers/guides on, bleed lines off). */
const VIEW_KEY = "lolev-view";
function loadViewToggles(): { showRulers: boolean; showGuides: boolean; showBleed: boolean } {
  const defaults = { showRulers: true, showGuides: true, showBleed: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") };
  } catch {
    return defaults; // a hand-mangled entry falls back rather than crashing boot
  }
}


/** One spelling for the "which error do I show?" expression the open paths
 *  share. */
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What every open path hands to openProject. Each entry point converts
 *  to this shape itself (fileSource for picked Files), so the shared
 *  pipeline never branches on where the bytes came from — the Finder path
 *  hands over bytes the desktop shell already read, skipping a second
 *  ~40MB File/arrayBuffer copy. */
type LabelSource = { name: string; bytes: Uint8Array };
const fileSource = async (f: File): Promise<LabelSource> =>
  ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });

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
  const image: CollabImage = mimeFor(f.name) === "image/svg+xml"
    ? { kind: "svg", svg: await f.text() }
    : { kind: rasterKind(f.name), bytes: new Uint8Array(await f.arrayBuffer()) };
  return { image, name: f.name, previewUrl: URL.createObjectURL(f) };
}

/** Read a custom-layer image asset: same shape as readCollab, plus the
 *  intrinsic aspect (w/h) — an SVG's ink box (parseLogo, fit into 1x1 so the
 *  returned w/h ratio IS the ink aspect), a raster's decoded bitmap size. */
async function readCustomImage(f: File): Promise<CustomFile> {
  const previewUrl = URL.createObjectURL(f);
  if (mimeFor(f.name) === "image/svg+xml") {
    const svg = await f.text();
    const { w, h } = parseLogo(svg, 1, 1);
    return { image: { kind: "svg", svg }, name: f.name, previewUrl, aspect: w / h };
  }
  const bytes = new Uint8Array(await f.arrayBuffer());
  const bmp = await createImageBitmap(new Blob([bytes as unknown as BlobPart]));
  const aspect = bmp.width / bmp.height;
  bmp.close();
  return { image: { kind: rasterKind(f.name), bytes }, name: f.name, previewUrl, aspect };
}

/** Longest preview-texture edge in px. Sized to the 3D label texture
 *  (~2340px: the 585pt preview page at labelTextures' 4x oversample) so
 *  the mask plate is never upscaled into it — at 1600 the binary mask's steps
 *  were rebuilt on a coarser grid and blown up 1.46x, which read as visible
 *  pixelation on the can. Also covers PreviewCompare's 2.5x oversample. */
const PREVIEW_PX = 2400;

async function previewPng(src: ImageBitmap | HTMLCanvasElement): Promise<Uint8Array> {
  const scale = Math.min(1, PREVIEW_PX / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return canvasToPng(c);
}

// Blob snapshots the bytes at construction (no transfer), so no copy needed.
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

/** The pane's zoom range: 1 (fitted) through the same ceiling used by the 3D
 *  dolly, so a zoom carried across is never silently clipped. PreviewCompare
 *  re-rasterizes/repaints the canvas plates as this increases; the ceiling is
 *  no longer a point where CSS runs past a fixed bitmap. */
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

/** The five preview views in keys-1–5 order: status-bar label, the command
 *  id that shows it, and the state that means "this one is current". One
 *  list, so the readout, the click-to-cycle, and the commands can't disagree
 *  about what the views are or where each sits in the cycle. Standard's
 *  predicate absorbs a mid-split compare (split < 100), so cycling from a
 *  compare lands on Mask. */
type ViewMode = "2d" | "can" | "pack" | "flat";
const VIEW_CYCLE: { label: string; id: string; at: (m: ViewMode, split: number) => boolean }[] = [
  { label: "Standard", id: "view-standard", at: (m, s) => m === "2d" && s < 100 },
  { label: "Mask", id: "view-mask", at: (m, s) => m === "2d" && s === 100 },
  { label: "Rendered", id: "view-rendered", at: (m) => m === "flat" },
  { label: "Single Can", id: "view-can", at: (m) => m === "can" },
  { label: "Four-Pack", id: "view-pack", at: (m) => m === "pack" },
];

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

/** The undoable half of one document: the live config, which of its master's
 *  variants are enabled, and the master itself. All three travel together
 *  through history (see useHistory<Doc> above) so undoing a variant toggle
 *  restores the FieldList checkboxes in the same step as the config it
 *  produced — and, since Design mode authors the master rather than the label
 *  (see `designEdit`), so a design edit's new master and the config it
 *  recomposed undo as ONE step instead of drifting apart. */
type Doc = { cfg: LabelConfig; enabledVariants: string[]; master: Master };

/** A file the shell wants this editor to open. seq is monotonic — a new
 *  value triggers the open, so a re-render can never re-open. Exactly one
 *  of path (Tauri), handle (FS-Access picker), or file (hidden-input
 *  fallback, no save identity) is set. */
export type FileToOpen = {
  seq: number;
  path?: string;
  handle?: FileSystemFileHandle;
  file?: File;
};

/** What the tab strip shows for this document — reported through onMeta
 *  whenever any field changes. */
export type DocumentMeta = {
  title: string;
  dirty: boolean;
  edited: boolean;
  filePath: string | null;
};

/** The Document Settings knobs (DPI/bleed/corner/edge) — shell-owned:
 *  they describe the press's die and stock, not one label, and per-editor
 *  copies would let a hidden tab stomp the shared layout globals with
 *  stale values during its renders. */
export type RenderSettings = Presets["render"];

type DocumentEditorProps = {
  active: boolean;
  fileToOpen: FileToOpen | null;
  /** Reports fileToOpen's attempt finished (success or failure), so the
   *  shell can drop the queued entry — a stale entry blocks re-opening the
   *  path and keeps claiming it after Save As (see TabsShell's pending). */
  onOpenSettled: (seq: number) => void;
  onMeta: (meta: DocumentMeta) => void;
  /** Shell-owned slot this editor assigns its save fn into on every render;
   *  resolves false when the user cancels the save dialog (the shell's
   *  close-tab flow keeps the tab open on false). */
  saveSlot: { current: (() => Promise<boolean>) | null };
  render: RenderSettings;
  onRenderChange: (render: RenderSettings) => void;
  onOpenProject: () => void;
  onNewTab: () => void;
  onCloseTab: () => void;
  onCheckForUpdates: () => void;
  /** Ref callback for the tab-strip host: the ACTIVE editor mounts an empty
   *  slot just under its menubar row and the shell portals the strip into it
   *  (inside the editor because the sidebar is fixed-position and would
   *  overlap any strip above the whole shell). A stable callback, not a
   *  ReactNode: passing the strip element itself would hand the editor a new
   *  prop identity on every tab-list change — every keystroke retitles a tab
   *  — defeating the memo below and double-rendering the editor. */
  tabStripHost: (el: HTMLDivElement | null) => void;
};

// memo is load-bearing, not an optimization garnish: every keystroke in any
// tab updates the shell's tab list (onMeta → title/dirty), and without the
// bail every HIDDEN editor's 1700-line body would re-run per keystroke. It
// only holds if the shell passes identity-stable props to inactive editors
// (per-tab callbacks and slots created once — see TabsShell's extrasFor).
export const DocumentEditor = memo(function DocumentEditor({
  active, fileToOpen, onOpenSettled, onMeta, saveSlot, render, onRenderChange,
  onOpenProject, onNewTab, onCloseTab, onCheckForUpdates, tabStripHost,
}: DocumentEditorProps) {
  // Config lives in a history stack, not plain useState — every edit that
  // goes through setDoc (i.e. all of them, see `update` below) is undoable.
  // enabledVariants rides along in the same history entry as cfg (not a
  // separate useState): undoing a variant toggle has to restore BOTH the
  // composed config AND the FieldList checkboxes that produced it, in one
  // step, or the two fall out of sync (see toggleVariant in model/document).
  const { value: doc, set: setDoc, reset: resetDoc, undo, redo, canUndo, canRedo } =
    useHistory<Doc>(() => ({ cfg: defaultConfig(), enabledVariants: [], master: lolevMaster() }));
  const cfg = doc.cfg;
  const enabledVariants = doc.enabledVariants;
  // Which layers the inspector shows — Figma's model: an ordered selection
  // plus an anchor a shift-range extends from, driven by the layers panel or
  // PreviewCompare's click-to-select. LayerId, not ElementId: the
  // Background/Mask/Settings document layers are selectable in the UI but
  // unknown to the renderer. The resolution rules (replace / toggle / range,
  // and document layers being single-select) live in selection.ts.
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const selected = selection.ids;
  // Which master this document composes against. It rides IN history now
  // (see Doc above): Design mode edits the master itself, so a design edit
  // has to undo as one step with the config it recomposed. Swapped wholesale
  // on Open/New through resetDocument, so a document can't leak the previous
  // one's master.
  const master = doc.master;
  // Where a Design-mode edit is recorded: the master's own defaults, or a
  // named variant's overrides (model/document.ts's EditTarget). Design-only
  // UI state — deliberately outside history and never persisted: which target
  // is selected isn't a document edit, and an undone edit shouldn't drag the
  // selector back with it. Defaults to the master.
  const [editingTarget, setEditingTarget] = useState<EditTarget>("master");
  // The master as of the last open/reset — the baseline the "unsaved master
  // edits" dot compares against. A ref, not state: nothing renders it
  // directly. Identity is the whole test, and it is exact in both directions:
  // applyDesignEdit returns the SAME master when a mutation changed nothing,
  // and undo restores the previous object itself, so undoing back to the
  // opened master clears the dot.
  const pristineMaster = useRef(doc.master);
  const masterDirty = doc.master !== pristineMaster.current;
  // The master's resolved layers and which of them are off right now
  // (master-disabled, or their owning variant is off) — values don't affect
  // either, only master + enabledVariants, so an empty values object is fine
  // here (unlike the real composeConfig calls that produce `cfg` itself).
  const { layers: masterLayers, disabledLayers } = useMemo(
    () => composeConfig(master, enabledVariants, {}, undefined),
    [master, enabledVariants],
  );
  // The layers panel's rows — the master's layers flat, in draw order, then
  // any custom layers (model/panel.ts's panelRows). Also the shift-range
  // order `pick` resolves against below, so the panel's visible rows and the
  // selection rules can never disagree about what "next row" means.
  const panelLayerRows = useMemo(
    () => panelRows(master, masterLayers, disabledLayers, cfg),
    [master, masterLayers, disabledLayers, cfg],
  );
  /** A row or canvas click, resolved against the anchor and the panel's row
   *  order. A background click (null) clears everything, anchor included. */
  const clearSelection = () => setSelection(EMPTY_SELECTION);
  const pick = (id: LayerId | null, mods: SelectMods) => {
    if (id === null) { clearSelection(); return; }
    // Auto-target on selection (spec: edits record into the selected variant
    // automatically): picking a variant-owned layer in Design mode moves the
    // editing target onto that variant, so styling e.g. a Collab layer can't
    // silently land on the master. One-way — a master-owned layer never
    // switches away from a target the user chose explicitly, because
    // "master" is also the default and pulling back to it on every ordinary
    // click would make the selector impossible to hold on a variant.
    const owner = master.layers.find((l) => l.id === id)?.variant;
    if (mode === "design" && owner) setEditingTarget({ variant: owner });
    setSelection((s) => resolveSelect(
      s, id, mods, panelLayerRows.map((r) => r.id) as LayerId[]));
  };
  // The renderer elements of the selection, for the preview's outlines.
  // Memoized like collabSlots below and for the same reason: it is a
  // dependency of PreviewCompare's outline memo, and a fresh array every
  // render would defeat it — dragging the compare divider re-renders App per
  // pointer-move frame, which would re-measure every selected element's box
  // on every one of those frames.
  const elementSelection = useMemo(() => selected.filter(isElementId), [selected]);
  // Layers the panel's eye has hidden — session state, deliberately outside
  // the config/history: a saved label never records a hidden layer, and
  // toggling an eye is not an undoable document edit. Exports fold it into
  // Assets.hidden directly; the preview folds it into the skip set instead
  // (see `skip` below), so both draw the same omissions from one source.
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlySet<HideableLayerId>>(new Set());
  // Design edits the canvas directly (layers, style, position); Fill edits
  // through the field list only. Per-document UI state, deliberately outside
  // both the config and its history like `master` above — which mode you're
  // in isn't a document edit, and switching tabs shouldn't carry it along.
  const [mode, setMode] = useState<"design" | "fill">("fill");
  /** Layers panel's variant checkboxes: recompose the whole config AND the
   *  enabled set in one undoable step (see toggleVariant in model/document)
   *  — so undo restores the checkbox along with the config it produced. */
  const setVariant = (id: string, on: boolean) => {
    const r = toggleVariant(master, cfg, enabledVariants, id, on);
    markDirty();
    setDoc((d) => ({ ...d, cfg: r.config, enabledVariants: r.enabled }));
  };
  // Insertable refs for a custom barcode/qr layer's FormatBuilder (the
  // Inspector's fields prop) — the master's own fields plus whichever
  // variants are enabled, same set FieldList's sidebar shows.
  const visibleFields = useMemo(
    () => visibleFieldsOf(master, enabledVariants), [master, enabledVariants]);
  // The label's current field values, stringified — FormatBuilder's live
  // preview and expandCustomFormats below both read plain strings, unlike
  // valuesFromConfig's FieldValue (string | number | boolean).
  const stringValues = useMemo(() => {
    const values = valuesFromConfig(master, enabledVariants, cfg);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) out[k] = String(v);
    return out;
  }, [master, enabledVariants, cfg]);
  // The display seam (Task 5): every custom barcode/qr layer's raw `value`
  // expanded over stringValues, for whatever draws or exports the label.
  // The sidebar, history, and save all keep `cfg` itself — only this derived
  // copy sees the expansion. Identity (===) with `cfg` when there is nothing
  // to expand (expandCustomFormats), so this memo doesn't force a re-render
  // of its own consumers for the common case of a plain payload.
  const displayCfg = useMemo(
    () => expandCustomFormats(cfg, stringValues), [cfg, stringValues]);
  // The element being edited in place on the preview, if any (reported by
  // PreviewCompare). While set, planLabel skips it via the render flag (see
  // `skip` below) so the editor's live DOM text IS the element — no doubled
  // glyphs — and the ordinary render takes back over when the session ends.
  const [editSession, setEditSession] = useState<ElementId | null>(null);
  const toggleHidden = (id: HideableLayerId) =>
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
  // srcBytes: the original upload, before prepareMaskForPdf recolors it — the
  // bytes Save Project writes, so Open Project doesn't recolor an
  // already-recolored mask.
  const [mask, setMask] = useState<(Loaded & { error?: string; srcBytes: Uint8Array }) | null>(null);
  // Collab logos. Unlike the texture and mask these need no preview-resolution
  // twin: they are at most a 70pt mark, so the same bytes serve the preview
  // build and the print export.
  const [collabLeft, setCollabLeft] = useState<CollabFile | null>(null);
  const [collabCenter, setCollabCenter] = useState<CollabFile | null>(null);
  // Master-variant custom image layers' assets, keyed by CustomImageLayer's
  // `asset` (the id minted at drop — see mintCustomAssetId). Like the collab
  // logos, no preview/print split: these are small marks, not backgrounds.
  const [customImages, setCustomImages] = useState<Record<string, CustomFile>>({});
  // Which collab slots hold art, for the preview's hit boxes. Memoized: it is
  // a dependency of the selection-outline memo, and a fresh object every
  // render would defeat it.
  const collabSlots = useMemo(
    () => ({ left: !!collabLeft, center: !!collabCenter }),
    [collabLeft, collabCenter],
  );
  const [building, setBuilding] = useState(false);
  // Two error channels, split by who can clear them. renderError belongs to
  // the renderers (2D paint / 3D texture rebuild): every successful frame
  // clears it, which is safe because only a frame can fix a frame. buildError
  // belongs to asset assembly, exports, and native menu failures: it survives
  // successful frames (a repaint from STALE assets used to wipe a decode
  // error the user never saw resolved) and clears when assembly or an export
  // succeeds. The strip shows whichever is set.
  const [buildError, setBuildError] = useState("");
  const [renderError, setRenderError] = useState("");
  const [loadError, setLoadError] = useState("");
  // Divider position reported by PreviewCompare (% of width showing
  // white-ink), so the View menu can check off whichever end it sits at.
  const [split, setSplit] = useState(0);
  // "2d" = the canvas-backend compare view; the rest are CanView's three.js
  // modes. The 2D preview stays mounted (hidden) so its rendered canvases and
  // divider position survive a round-trip through the 3D views.
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
  // Where the current view sits in VIEW_CYCLE, and what the status bar calls
  // it — the one place the "a mid-split compare counts as Standard for
  // cycling but reads as Compare" rule lives.
  const viewIndex = VIEW_CYCLE.findIndex((v) => v.at(viewMode, split));
  const viewLabel = viewMode === "2d" && split > 0 && split < 100
    ? "Compare" : VIEW_CYCLE[viewIndex].label;
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
  // Owned by TabsShell (see RenderSettings) and debounced into the shared
  // library there; this editor only reads the prop and calls onRenderChange.
  const { presets, error: presetsError } = usePresets();
  // Published to layout.ts during render rather than from an effect: the
  // toolbar's px readout and the rulers read OUTPUT_DPI while rendering, so an
  // effect would leave them a frame behind the knob. Idempotent — it writes
  // three numbers and reads nothing.
  // Published during render, not from an effect: the rulers and the toolbar's
  // size readout read PAGE and OUTPUT_DPI while rendering, so an effect would
  // leave them a frame behind the knob. Both are idempotent scalar writes.
  //
  // `render` is a prop: TabsShell owns adoption from and persistence to the
  // presets library. ACTIVE editor only: a hidden editor's memo bail freezes
  // its `render` prop (makeHiddenPropsEqual skips it while hidden), so a
  // hidden render — e.g. from a presets-store update — would stomp the
  // shared globals with stale DPI/bleed. It rewrites them on activation.
  if (active) {
    setLayoutBleed(render.bleedIn);
    setOutputDpi(render.dpi);
  }
  useEffect(() => {
    if (presetsError) setLoadError(`presets save failed: ${presetsError}`);
  }, [presetsError]);

  // The app-wide context-menu blocker lives in TabsShell now — one window
  // listener, not one per tab.

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
  function onPanEnd() {
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
  // The read-only "View presets" dialog (File menu / ⌘K).
  const [presetsOpen, setPresetsOpen] = useState(false);
  const previewRef = useRef<PreviewCompareHandle>(null);
  // Trim guide over the 2D preview at the art box, wherever the bleed knob
  // currently puts it (ART.x/ART.y follow it). View-only — this toggle draws
  // the line, it does not decide where the trim is; the exported PDFs are
  // unaffected either way.
  const [bleed, setBleed] = useState(() => loadViewToggles().showBleed);
  // Rulers and guides are view state, like hidden layer eyes: they assist the
  // operator but are not label content, so none enters config history/exports.
  // Rulers, guides, and bleed lines DO persist across sessions — in
  // localStorage (per-operator UI state), NOT presets.json: writing them to
  // the git-tracked library dirtied the repo on every View-menu click.
  const [showRulers, setShowRulers] = useState(() => loadViewToggles().showRulers);
  const [rulerUnit, setRulerUnit] = useState<RulerUnit>("in");
  const [showGuides, setShowGuides] = useState(() => loadViewToggles().showGuides);
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
  // Persist the toggles on change. Synchronous and unguarded — localStorage
  // is cheap, there is no shared file to interleave with, and the states
  // initialize FROM storage so the first run writes back what it read.
  useEffect(() => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ showRulers, showGuides, showBleed: bleed }));
  }, [showRulers, showGuides, bleed]);

  /** A per-LABEL edit: mutate this document's own config, exactly as every
   *  edit did before Design mode learned to author masters. Still the whole
   *  story in Fill mode, and the path the two label-fact exceptions below
   *  (onFieldValue, onNudge*) take in BOTH modes. */
  const labelEdit = (fn: (c: LabelConfig) => void, coalesce?: boolean) => {
    markDirty(); // every config edit passes through here — see `dirty`
    setDoc((d) => {
      const n = structuredClone(d.cfg);
      fn(n);
      return { ...d, cfg: n };
    }, coalesce);
  };

  /** A DESIGN edit: run the same LabelConfig mutation, but record its diff on
   *  the master (or the editing variant) instead of this label — see
   *  applyDesignEdit in model/document.ts. The label's own deviations are
   *  diffed off the OLD master first and re-applied on top of the new one, so
   *  authoring the master never silently discards them; cfg is recomposed in
   *  the SAME history entry as the new master, so the preview updates now and
   *  undo restores both together. An edit that changed nothing returns the
   *  master by identity — no history entry, and no phantom dirty dot. */
  const designEdit = (fn: (c: LabelConfig) => void, coalesce?: boolean) => {
    markDirty();
    setDoc((d) => {
      const values = valuesFromConfig(d.master, d.enabledVariants, d.cfg);
      const nextMaster = applyDesignEdit(d.master, editingTarget, d.enabledVariants, values, fn);
      if (nextMaster === d.master) return d;
      const overrides = configDiff(
        composeConfig(d.master, d.enabledVariants, values, undefined).config, d.cfg);
      const config = composeConfig(
        nextMaster, d.enabledVariants, values,
        Object.keys(overrides).length ? overrides : undefined).config;
      return { cfg: config, enabledVariants: d.enabledVariants, master: nextMaster };
    }, coalesce);
  };

  /** THE routing rule, in one branch so no call site has to know about it:
   *  Design mode authors the master, Fill mode fills the label (spec: the
   *  two modes' whole difference). Everything that edits the document —
   *  the inspector, the layers panel, Add layer, the style controls — keeps
   *  calling `update` and keeps mutating a plain LabelConfig; only where the
   *  resulting diff is recorded changes. */
  const update = (fn: (c: LabelConfig) => void, coalesce?: boolean) =>
    mode === "design" ? designEdit(fn, coalesce) : labelEdit(fn, coalesce);

  /** A layer POLICY edit (rename / enable / lock) at the current editing
   *  target. Layer policy isn't part of LabelConfig, so it can't ride
   *  `update`'s diff and gets its own entry point (applyLayerEdit). The
   *  layers panel's eye is NOT this: hiding is session-only, never recorded. */
  const layerEdit = (layerId: string, patch: Partial<MasterLayer>) => {
    markDirty();
    setDoc((d) => ({ ...d, master: applyLayerEdit(d.master, editingTarget, layerId, patch) }));
  };

  /** The Editing selector's "New variant…": mint the variant, enable it (a
   *  fresh variant you can't see is useless), and select it as the target so
   *  the next edit lands in it — all one undoable step. */
  const addAndSelectVariant = (name: string) => {
    const { master: withVariant, id } = addVariant(master, name);
    const r = toggleVariant(withVariant, cfg, enabledVariants, id, true);
    markDirty();
    setDoc(() => ({ cfg: r.config, enabledVariants: r.enabled, master: withVariant }));
    setEditingTarget({ variant: id });
  };
  /** Wrap a config mutation that bypasses `update` (undo/redo) so it still
   *  marks the document dirty. */
  const mutating = (fn: () => void) => () => { markDirty(); fn(); };

  /** One spelling of a new custom layer's default anchored position — center
   *  x, just under the top edge — shared by every "Add layer" type so a
   *  freshly placed layer always lands somewhere visible on the label. */
  const NEW_LAYER_POSITION = { anchor: "center", vAnchor: "top", offsetX: 0, offsetY: 24 } as const;

  /** Design-mode "Add layer": mints the id, appends the layer through
   *  `update` (one undo step) and selects it — the spec's "placed
   *  immediately, configure after". Text/barcode/QR default styles borrow the
   *  matching template element's CURRENT style/ink, so a fresh layer starts
   *  in the label's own palette rather than a hardcoded black. Image is
   *  file-pick FIRST (see the hidden input below and addCustomImageLayer):
   *  there is nothing to place until an asset exists. */
  function addCustomLayer(type: "text" | "image" | "barcode" | "qr") {
    if (type === "image") { customImageInput.current?.click(); return; }
    const id = `custom-${crypto.randomUUID().slice(0, 8)}` as const;
    const layer: CustomTextLayer | CustomBarcodeLayer | CustomQrLayer =
      type === "text"
        ? {
            id, name: "Text", type: "text", size: 12, position: NEW_LAYER_POSITION,
            line: { text: "Text", fill: cfg.nameStyle.fill, layer: cfg.nameStyle.layer },
          }
        : type === "barcode"
        ? {
            id, name: "Barcode", type: "barcode", symbology: "code-128", value: "",
            h: 40, moduleW: 1, position: NEW_LAYER_POSITION,
            style: {
              fill: cfg.barcodeFill, layer: cfg.barcodeLayer, stroke: cfg.barcodeStroke,
              strokeLayer: cfg.barcodeStrokeLayer, strokeWidth: cfg.barcodeStrokeWidth,
            },
          }
        : {
            id, name: "QR", type: "qr", value: "", size: 40, qrStyle: "square",
            position: NEW_LAYER_POSITION,
            style: {
              fill: cfg.qrFill, layer: cfg.qrLayer, stroke: cfg.qrStroke,
              strokeLayer: cfg.qrStrokeLayer, strokeWidth: cfg.qrStrokeWidth,
            },
          };
    update((c) => { c.customLayers = [...(c.customLayers ?? []), layer]; });
    setSelection({ ids: [id], anchor: id });
  }

  /** The image half of addCustomLayer: picks the file first (customImageInput's
   *  onChange below), reads it through the same pipeline the .label restore
   *  path uses (readCustomImage + mintCustomAssetId), then appends the layer —
   *  there is no sensible empty image layer to place before an asset exists. */
  async function addCustomImageLayer(f: File) {
    const assetId = mintCustomAssetId();
    const file = await readCustomImage(f);
    setCustomImages((old) => ({ ...old, [assetId]: file }));
    const id = `custom-${crypto.randomUUID().slice(0, 8)}` as const;
    const layer: CustomImageLayer = {
      id, name: "Image", type: "image", asset: assetId, w: 60, aspect: file.aspect,
      position: NEW_LAYER_POSITION, style: { fill: "none", layer: "white" },
    };
    update((c) => { c.customLayers = [...(c.customLayers ?? []), layer]; });
    setSelection({ ids: [id], anchor: id });
  }
  const customImageInput = useRef<HTMLInputElement>(null);

  /** Move a custom layer one place earlier (back) or later (front) in
   *  cfg.customLayers — which IS its z-order: planLabel appends custom layers
   *  in stored order, so later means drawn on top. One undoable step; a
   *  no-op at either end of the custom range. */
  function moveCustomLayer(id: string, delta: -1 | 1) {
    update((c) => {
      const layers = c.customLayers ?? [];
      const i = layers.findIndex((l) => l.id === id);
      const j = i + delta;
      if (i === -1 || j < 0 || j >= layers.length) return;
      const [layer] = layers.splice(i, 1);
      layers.splice(j, 0, layer);
    });
  }

  // FieldList's onValue: writes one field straight into the config via its
  // path. Coalescing mirrors onEditText's contract (see PreviewCompare's
  // onEditText below) — the first change to a field opens an undo step, the
  // rest fold into it, and moving to a different field starts a new one.
  // Tracked in a ref rather than state so switching fields doesn't itself
  // trigger a render.
  const lastFieldRef = useRef<string | null>(null);
  const onFieldValue = (field: FieldDecl, value: FieldValue) => {
    const first = lastFieldRef.current !== field.id;
    lastFieldRef.current = field.id;
    // labelEdit, not update: a field's VALUE is a label fact — this beer's
    // name — never a master default, so it stays per-label in both modes.
    labelEdit((c) => setPath(c as unknown as Record<string, unknown>, field.path,
      field.kind === "toggle" ? value === true : String(value)), !first);
  };

  // Canvas uses the same bundled Regular/SemiBold font files as the PDF, but
  // avoids loading pdf-lib + fontkit on the UI thread just to measure hit
  // boxes. `bold` intentionally means SemiBold here: most bold hit targets
  // use that face, while the two true-Bold elements are centred and tolerate
  // the small symmetric under-measurement (see hittest.ts). Keyed on the
  // config's family (fontFamilyOf) so switching families re-embeds — the
  // fonts.ts gate memoizes per family, so re-selecting one already loaded
  // resolves immediately.
  const family = fontFamilyOf(cfg);
  useEffect(() => {
    let cancelled = false;
    void loadLabelFont(family)
      .then((next) => { if (!cancelled) setMeasure(() => next); })
      .catch((error) => { if (!cancelled) setBuildError(String(error)); });
    return () => { cancelled = true; };
  }, [family]);

  // Which instance the window/document-level key listeners below belong to.
  // A ref, not the prop: the listeners are registered once on mount.
  const activeRef = useRef(active);
  activeRef.current = active;

  // ⌘Z / ⇧⌘Z (and ⌘Y) for the config history. Deliberately inert while a
  // text field has focus: there the browser's own per-field undo is the one
  // the user means, and stealing it would blow away a whole typed line.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return; // a hidden tab owns no shortcuts
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
      if (!activeRef.current) return; // a hidden tab owns no shortcuts
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

  /** Replaces (or, with null, removes) a loaded asset, revoking the old
   *  thumbnail URL — the one shape every drop and every FileDrop X share. */
  const swapLoaded = <T extends { previewUrl: string }>(
    set: (fn: (old: T | null) => T | null) => void, next: T | null,
  ) => {
    markDirty(); // every asset change passes through here — see `dirty`
    set((old) => { if (old) URL.revokeObjectURL(old.previewUrl); return next; });
  };

  async function onTexture(f: File) {
    // PNG and JPEG pass through byte-for-byte; anything else the browser can
    // decode (WebP) is re-encoded to PNG ONCE, here, and renamed to match.
    // pdf-lib embeds PNG and JPEG only, so transcoding at the door is what
    // keeps every later consumer — the PDF embed, the .label round-trip,
    // rasterKind/mimeFor — reading bytes whose format its name claims. The
    // rename is the honest half: the project now holds a PNG.
    const passthrough = EMBEDDABLE_RASTER.test(f.name);
    const decoded = passthrough ? await createImageBitmap(f) : await decodeToCanvas(f);
    const bytes = passthrough
      ? new Uint8Array(await f.arrayBuffer())
      : await canvasToPng(decoded as HTMLCanvasElement);
    const previewBytes = await previewPng(decoded);
    if (decoded instanceof ImageBitmap) decoded.close();
    const name = passthrough ? f.name : `${f.name.replace(/\.[^.]*$/, "")}.png`;
    const previewUrl = URL.createObjectURL(f);
    swapLoaded(setTexture, {
      bytes, previewBytes, name,
      kind: rasterKind(name),
      previewUrl,
    });
  }

  async function onMask(f: File) {
    // The mask passes through untouched — the printer accepts these plates
    // as-authored, and binarizing here was what pixelated the 3D preview
    // (the metalness map classifies pixels itself, see labelTextures.ts).
    const [srcBytes, canvas] = await Promise.all([
      f.arrayBuffer().then((b) => new Uint8Array(b)), decodeToCanvas(f),
    ]);
    const previewBytes = await previewPng(canvas);
    const previewUrl = URL.createObjectURL(f);
    swapLoaded(setMask, {
      bytes: srcBytes,
      previewBytes,
      name: f.name,
      previewUrl,
      srcBytes,
    });
  }

  /** Load a collab logo into `slot`, revoking the previous thumbnail URL. */
  function onCollab(slot: "left" | "center", f: File) {
    return readCollab(f).then((next) =>
      swapLoaded(slot === "left" ? setCollabLeft : setCollabCenter, next));
  }
  const collabFiles: CollabFiles = {
    leftName: collabLeft?.name, leftUrl: collabLeft?.previewUrl,
    centerName: collabCenter?.name, centerUrl: collabCenter?.previewUrl,
    onLeft: (f) => onCollab("left", f),
    onCenter: (f) => onCollab("center", f),
    onClearLeft: () => swapLoaded(setCollabLeft, null),
    onClearCenter: () => swapLoaded(setCollabCenter, null),
  };
  /** Everything file-shaped the inspector edits: the Document layers' drops
   *  plus the collab logos. */
  const docSettings: DocSettings = {
    cornerRadius: render.cornerRadius,
    onCornerRadius: (v) => onRenderChange({ ...render, cornerRadius: v }),
    edgeSoftness: render.edgeSoftness,
    onEdgeSoftness: (v) => onRenderChange({ ...render, edgeSoftness: v }),
    dpi: render.dpi,
    onDpi: (v) => onRenderChange({ ...render, dpi: Math.round(v) }),
    bleedIn: render.bleedIn,
    // commitBleedIn, not a plain write: the field can only show 0.063 for the
    // shipped 0.063333..., so a commit that just echoes the display must leave
    // the stored value alone. Skipping onRenderChange on an echo is
    // load-bearing — no re-render, no preview rebuild, no presets.json write.
    onBleedIn: (v) => {
      const bleedIn = commitBleedIn(render.bleedIn, v);
      if (bleedIn !== render.bleedIn) onRenderChange({ ...render, bleedIn });
    },
  };
  const files: InspectorFiles = {
    texture: {
      fileName: texture?.name, previewUrl: texture?.previewUrl,
      onFile: (f) => void onTexture(f),
      onClear: () => swapLoaded(setTexture, null),
    },
    mask: {
      fileName: mask?.name, previewUrl: mask?.previewUrl, error: mask?.error,
      onFile: (f) => void onMask(f),
      onClear: () => swapLoaded(setMask, null),
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

  /** The texture/mask half of Assets, with the eyes applied by omission: a
   *  hidden asset simply isn't handed to the build, same as never dropped.
   *  The ONE place both the eye rule and the byte choice live — the assembly
   *  effect below spreads eyedAssets(true) (downscaled preview bytes), the
   *  export build eyedAssets(false) (full-resolution). */
  const eyedAssets = (preview: boolean) => ({
    texture: !texture || hiddenLayers.has("background") ? undefined
      : preview
        ? { bytes: texture.previewBytes, kind: "png" as const }
        : { bytes: texture.bytes, kind: texture.kind },
    maskPng: hiddenLayers.has("mask") ? undefined
      : preview ? mask?.previewBytes : mask?.bytes,
  });

  // The render source for BOTH views: fonts + decoded bitmaps for drawPlate,
  // assembled off the asset inputs alone (debounced — uploads and eye/tint
  // toggles are rare and each re-assembly decodes up to 4 ImageBitmaps).
  // Config changes deliberately DON'T re-run this: cfg flows into the views
  // as a prop and repaints with these same bitmaps. The two collab tint
  // knobs are the only cfg fields the bitmaps depend on, so they are
  // dependencies here by value.
  const [canvasAssets, setCanvasAssets] = useState<{
    m: MeasureFace; planAssets: PlanAssets; drawAssets: CanvasAssets; fontCss: string;
  } | null>(null);
  useEffect(() => {
    if (blocked || !active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const m = await loadLabelFaces(family);
        // Every decode this run makes is tracked here, so a throw partway
        // through (a later await failing after an earlier one already
        // decoded a bitmap) can still close everything decoded so far —
        // only the fully-published drawAssets is otherwise reachable to
        // close, and a throw never reaches that assignment.
        const decoded: ImageBitmap[] = [];
        const bitmap = async (bytes: Uint8Array | undefined) => {
          if (!bytes) return null;
          const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
          decoded.push(bmp);
          return bmp;
        };
        const { collabLeft: cl, collabCenter: cc } = await collabAssets();
        const slot = async (img: CollabImage | null | undefined) => {
          if (!img) return { art: null, image: null };
          if (img.kind === "svg") return { art: img, image: null };
          const bmp = await createImageBitmap(new Blob([img.bytes as BlobPart]));
          decoded.push(bmp);
          return { art: { kind: "raster" as const, w: bmp.width, h: bmp.height }, image: bmp };
        };
        // Custom-layer images decode alongside collab art: raster bytes
        // become a bitmap for the canvas to draw; an SVG source stays
        // undecoded (no bitmap-drawing path for it yet) and is simply a
        // no-op on the canvas plate, same as a not-yet-loaded asset.
        const customEntries = Object.entries(customImages);
        const customBitmap = async (c: CustomFile) => {
          if (c.image.kind === "svg") return null;
          const bmp = await createImageBitmap(new Blob([c.image.bytes as BlobPart]));
          decoded.push(bmp);
          return bmp;
        };
        let drawAssets: CanvasAssets;
        let left: Awaited<ReturnType<typeof slot>>, center: Awaited<ReturnType<typeof slot>>;
        let customBitmaps: Record<string, ImageBitmap | null>;
        try {
          [left, center] = await Promise.all([slot(cl), slot(cc)]);
          customBitmaps = Object.fromEntries(
            await Promise.all(customEntries.map(async ([id, c]) => [id, await customBitmap(c)] as const)));
          const eyed = eyedAssets(true);
          drawAssets = {
            texture: await bitmap(eyed.texture?.bytes),
            maskImage: await bitmap(eyed.maskPng),
            collabLeft: left.image, collabCenter: center.image,
            customImages: customBitmaps,
          };
        } catch (err) {
          // A later decode failed after an earlier one landed: close
          // everything this run decoded before rethrowing to the outer
          // .catch, which surfaces the error exactly as before.
          for (const bmp of decoded) bmp.close();
          throw err;
        }
        if (cancelled) {
          // Superseded before publish: nothing will ever reference these.
          closeCanvasBitmaps(drawAssets);
          return;
        }
        setCanvasAssets({
          m,
          planAssets: {
            logoSvg, collabLeft: left.art, collabCenter: center.art,
            // Real intrinsic aspects, not the layers' stored ones: this is
            // the loaded-bytes path plan.ts prefers over CustomImageLayer.aspect.
            // `art` carries the loaded shape too — an SVG source switches
            // planLabel to its ink-tight `paths` fit (see plan.ts); a raster
            // source needs none here, its bitmap already drives the canvas
            // backend's own `customImages` lookup.
            custom: Object.fromEntries(customEntries.map(([id, c]) => [
              id,
              {
                aspect: c.aspect,
                ...(c.image.kind === "svg" ? { art: { kind: "svg" as const, svg: c.image.svg } } : {}),
              },
            ])),
          },
          drawAssets,
          fontCss: labelFontCss(family),
        });
        // A full assembly succeeded: whatever font/decode (or lingering
        // export) failure the strip was showing is resolved or stale.
        setBuildError("");
      })().catch((err) => {
        // The font gate or a decode failed: the preview cannot render.
        // Surface it — the spec's "never a silently wrong face".
        if (!cancelled) setBuildError(String(err));
      });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
    // Asset inputs only — cfg deliberately excluded except the tint knobs
    // and the font family (see the comment above). eslint can't see that
    // collabAssets() reads exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    texture, mask, collabLeft, collabCenter, customImages, hiddenLayers, family,
    cfg.collabLeft.fill, cfg.collabLeft.tintRaster,
    cfg.collabCenter.fill, cfg.collabCenter.tintRaster,
    blocked, active,
  ]);
  // The bitmaps backing the CURRENTLY LIVE `canvasAssets` generation. Tracked
  // outside React state so the next generation can .close() them once it has
  // fully replaced them — createImageBitmap results aren't GC'd on their own.
  const canvasBitmaps = useRef<CanvasAssets | null>(null);
  const closeCanvasBitmaps = (a: CanvasAssets | null | undefined) => {
    if (!a) return;
    for (const b of [a.texture, a.maskImage, a.collabLeft, a.collabCenter]) {
      if (b instanceof ImageBitmap) b.close();
    }
    for (const b of Object.values(a.customImages ?? {})) {
      if (b instanceof ImageBitmap) b.close();
    }
  };
  // Close the superseded generation's ImageBitmaps AFTER the commit that
  // replaces them: any rAF or rebuild timer still holding the old assets was
  // cancelled by the views' effect cleanups during this same commit (child
  // cleanups run first), so nothing can draw a closed bitmap. Unmount closes
  // the last generation.
  useEffect(() => {
    const prev = canvasBitmaps.current;
    if (prev && prev !== canvasAssets?.drawAssets) closeCanvasBitmaps(prev);
    canvasBitmaps.current = canvasAssets?.drawAssets ?? null;
  }, [canvasAssets]);
  useEffect(() => () => closeCanvasBitmaps(canvasBitmaps.current), []);

  // What planLabel omits: the layers-panel eyes, the in-place edit session's
  // element — the v0.1.16 hide-and-rebuild plumbing reduced to a render flag
  // — and anything the master/variant resolution has switched off (a
  // disabled layer, or one owned by a variant that's off). The byte-identity
  // locks stay green: the shipped master never disables a layer the old
  // hardcoded draw already omitted (collabEnabled === false already
  // suppresses the same three ids planLabel's own gate does). Same-frame: a
  // new editSession changes this memo, the source memo below, and
  // PreviewCompare repaints on the next rAF.
  const skip = useMemo<{ has(id: ElementId): boolean }>(
    () => ({
      has: (id: ElementId) => id === editSession
        || hiddenLayers.has(id as HideableLayerId)
        || disabledLayers.has(id),
    }),
    [editSession, hiddenLayers, disabledLayers],
  );
  // Null until the first assembly lands — both views render from this.
  const canvasSource = useMemo<CanvasRenderSource | null>(
    () => (canvasAssets ? { ...canvasAssets, skip } : null),
    [canvasAssets, skip],
  );
  // "The preview has something to render from": both views draw from the
  // assembled canvas source; CanView shows its own corner spinner while a
  // texture rebuild is in flight.
  const previewReady = !!canvasAssets;
  // The guard means "the render pipeline has come up" — not "preview bytes
  // exist", since there are no more preview PDF bytes to have.
  const pdfExportBlocked = exportBlocked || !previewReady;

  // Background tabs keep their state and asset bytes but not their decoded
  // render source: the ImageBitmaps are the heavy, cheaply-rebuildable part.
  // The assembly effect above bails while inactive, and `active` in its deps
  // reruns it on reactivation; the close effect below reclaims the bitmaps.
  useEffect(() => {
    if (!active) setCanvasAssets(null);
  }, [active]);

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
  /** Save one exported file through the platform's save dialog (name/place
   *  it, like Save Project). Tauri uses the OS dialog; supported browsers use
   *  File System Access; Safari/Firefox keep the plain-download fallback. A
   *  cancelled dialog means "don't save this file" — no fallback download.
   *  Multi-file exports prompt once per file because neither platform offers
   *  a multi-save dialog. */
  async function saveVia(bytes: Uint8Array, name: string, type: string) {
    const extension = name.slice(name.lastIndexOf(".") + 1);
    if (isTauri()) {
      await saveNativeFile(bytes, {
        defaultPath: name,
        filter: { name: `${extension.toUpperCase()} file`, extensions: [extension] },
      });
      return;
    }
    const pick = savePicker();
    if (pick) {
      const ext = `.${extension}`;
      try {
        const handle = await pick({
          suggestedName: name,
          types: [{ description: `${ext.slice(1).toUpperCase()} file`, accept: { [type]: [ext] } }],
        });
        await writeHandle(handle, bytes);
        return;
      } catch (err) {
        if (isAbort(err)) return;
        // Any other failure falls through to the download path below.
      }
    }
    saveBytes(bytes, name, type);
  }

  /** Downloads rebuild from the full-resolution assets on demand — the
   *  on-screen preview is deliberately preview-resolution (see Loaded). */
  async function buildFull(which: "art" | "mask" | "both") {
    if (building) return;
    setBuilding(true);
    startSaveBatch();
    try {
      const [{ buildArtPdf, buildMaskPdf }, fonts] = await Promise.all([
        import("@/pdf/build"),
        loadFonts(fontFamilyOf(displayCfg)),
      ]);
      // Exports honor the eye too: a hidden layer is "not on this label",
      // preview and deliverable alike. (PSDs still carry every layer — a
      // layered handoff is the place to keep them all.)
      const customEntries = Object.entries(customImages);
      const assets: Assets = {
        fonts, logoSvg, ...(await collabAssets()),
        ...eyedAssets(false),
        hidden: hiddenLayers,
        // Same `art` addition as the preview assembly effect above: an SVG
        // custom image has no raster bytes for `customImages` below to embed
        // (drawElements' embed loop skips SVG sources), so without `art` it
        // would still plan as an empty rect in the export PDFs even though
        // the on-screen preview now draws it. See plan.ts's PlanAssets.custom.
        custom: Object.fromEntries(customEntries.map(([id, c]) => [
          id,
          {
            aspect: c.aspect,
            ...(c.image.kind === "svg" ? { art: { kind: "svg" as const, svg: c.image.svg } } : {}),
          },
        ])),
        customImages: Object.fromEntries(customEntries.map(([id, c]) => [id, c.image])),
      };
      // Both files build BEFORE the first dialog opens: the user shouldn't
      // sit in dialog #2 waiting on a build that could have run during
      // dialog #1 — and back-to-back dialogs stay inside the user-activation
      // window a long build could outlive.
      const [artPdf, maskPdf] = await Promise.all([
        which !== "mask" ? buildArtPdf(displayCfg, assets) : null,
        which !== "art" ? buildMaskPdf(displayCfg, assets) : null,
      ]);
      if (artPdf) await saveVia(artPdf, `${exportBaseName(cfg)}.pdf`, "application/pdf");
      if (maskPdf) await saveVia(maskPdf, `${exportBaseName(cfg)}-mask.pdf`, "application/pdf");
      setBuildError(""); // same clear-on-success the PSD export already does
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

  /** The file Save rewrites in place: set by Save As and picker-based Open.
   *  Null until then, so plain Save falls through to the Save As dialog —
   *  the classic editor contract. A ref, not state: nothing renders it. */
  const projectHandle = useRef<FileSystemFileHandle | null>(null);
  /** Tauri's equivalent of projectHandle. A native dialog returns a path,
   *  which Save reuses until New/Open or a failed in-place write clears it. */
  const projectPath = useRef<string | null>(null);
  function forgetProjectFile() {
    projectHandle.current = null;
    projectPath.current = null;
    setFilePath(null);
  }
  /** Whether the document differs from the last saved/opened project —
   *  File → Save disables while clean. Marked at three sites: `update` (all
   *  config edits), `swapLoaded` (all assets — a new asset can't dodge the
   *  flag), and the undo/redo commands, which mutate the config around
   *  `update`. Cleared by a completed save or open. Undoing back to the
   *  exact saved state still counts as dirty: the flag tracks mutations,
   *  not content equality. */
  const [dirty, setDirty] = useState(true);
  /** Whether the user has actually touched this document — unlike `dirty`,
   *  which starts true so Save is enabled on a fresh default document. The
   *  shell prompts about closing a tab only when edited AND dirty, so an
   *  untouched Untitled tab closes silently. Set wherever dirty is set
   *  (markDirty), cleared by open. */
  const [edited, setEdited] = useState(false);
  const markDirty = () => { setDirty(true); setEdited(true); };
  /** State mirror of projectPath (a ref, which can't drive onMeta): the
   *  Tauri path identity the shell dedupes OS opens against. */
  const [filePath, setFilePath] = useState<string | null>(null);
  // What the tab strip and window title show: the beer name as typed (not
  // exportBaseName's filename slug); "Untitled" while blank, saved or not.
  const title = cfg.beerName.trim() || "Untitled";
  useEffect(() => {
    onMeta({ title, dirty, edited, filePath });
    // onMeta is this tab's shell callback; identity is irrelevant to when
    // the report should fire, so only the reported facts are deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, dirty, edited, filePath]);

  /** Full-document replacement for Open: swap the whole Doc in (resetting
   *  history) and clear every asset slot. A slot added later must be
   *  cleared here so an open can't leak the previous project's asset.
   *  `enabledVariants` and `master` default to [] / the shipped Lolev master
   *  for a bare New Project; the v2 open path passes the label's real set and
   *  its resolved master directly so all three land in the same history step,
   *  rather than a second write right after (which could leak a stale master
   *  into the opened document depending on call order). */
  function resetDocument(
    config: LabelConfig, enabledVariants: string[] = [], master: Master = lolevMaster(),
  ) {
    resetDoc({ cfg: config, enabledVariants, master });
    // The freshly opened master is the baseline the dirty dot compares
    // against — see pristineMaster.
    pristineMaster.current = master;
    swapLoaded(setTexture, null);
    swapLoaded(setMask, null);
    swapLoaded(setCollabLeft, null);
    swapLoaded(setCollabCenter, null);
    // A slot added later must be cleared here too, same rule as above — a
    // Record rather than one T|null, so it goes through its own revoke loop
    // instead of swapLoaded (the four calls above already mark the document
    // dirty for this reset).
    setCustomImages((old) => {
      for (const c of Object.values(old)) URL.revokeObjectURL(c.previewUrl);
      return {};
    });
  }

  // (New Project is gone: ⌘N opens a new tab via the shell, and the old
  // discard-confirm dialog's job moved to the shell's close-tab flow.)

  /** File → Save / Save As…: everything needed to reopen this label — config
   *  plus original image bytes — zipped as <beer-name-slug>.label
   *  (exportBaseName; see labelfile.ts).
   *  Tauri and supported Chromium browsers show a real save dialog and Save
   *  then rewrites that same file; Safari/Firefox use a plain download. */
  async function saveProject(as = false): Promise<boolean> {
    const collabAsset = (c: CollabFile | null) =>
      c ? { name: c.name, bytes: c.image.kind === "svg" ? strToU8(c.image.svg) : c.image.bytes } : undefined;
    // Always writes v2 (see labelfile.ts): values are the fields the master
    // and its enabled variants declare; overrides are whatever the user's
    // config still deviates from a fresh compose of those exact values — the
    // same shape openProject's v2 branch expects back.
    const values = valuesFromConfig(master, enabledVariants, cfg);
    const overrides = configDiff(
      composeConfig(master, enabledVariants, values, undefined).config, cfg);
    const label: LabelFileV2 = {
      formatVersion: 2, masterId: master.id,
      masterHint: masterIndex()[master.id]?.path,
      enabledVariants, values,
      ...(Object.keys(overrides).length ? { overrides } : {}),
    };
    const customImageEntries = Object.entries(customImages);
    const zip = packLabelV2(label, {
      texture: texture ? { name: texture.name, bytes: texture.bytes } : undefined,
      mask: mask ? { name: mask.name, bytes: mask.srcBytes } : undefined,
      collabLeft: collabAsset(collabLeft),
      collabCenter: collabAsset(collabCenter),
      customImages: customImageEntries.length
        ? Object.fromEntries(customImageEntries.map(([id, c]) => [
            id, { name: c.name, bytes: c.image.kind === "svg" ? strToU8(c.image.svg) : c.image.bytes },
          ]))
        : undefined,
    });
    if (isTauri()) {
      const existingPath = as ? null : projectPath.current;
      try {
        const path = await saveNativeFile(zip, {
          defaultPath: exportBaseName(cfg) + LABEL_EXT,
          filter: LABEL_FILTER,
          path: existingPath ?? undefined,
        });
        if (path === null) return false;
        projectPath.current = path;
        setFilePath(path);
        setDirty(false);
        setLoadError("");
        return true;
      } catch (err) {
        // A failed in-place write should prompt on the next Save. A failed or
        // cancelled Save As must keep the prior file association intact.
        if (existingPath) {
          projectPath.current = null;
          setFilePath(null);
        }
        setLoadError(`Could not save project: ${errMsg(err)}`);
        return false;
      }
    }
    const pick = savePicker();
    if (pick) {
      try {
        if (as || !projectHandle.current) {
          projectHandle.current = await pick({
            suggestedName: exportBaseName(cfg) + LABEL_EXT,
            types: LABEL_TYPES,
          });
        }
        await writeHandle(projectHandle.current, zip);
        setDirty(false);
        return true;
      } catch (err) {
        // Cancelled dialog = no save wanted; anything else falls back to
        // the download path rather than losing the file. A handle that
        // failed to write is not trusted again.
        projectHandle.current = null;
        if (isAbort(err)) return false;
      }
    }
    startSaveBatch();
    saveBytes(zip, exportBaseName(cfg) + LABEL_EXT, "application/zip");
    setDirty(false);
    return true;
  }
  // The shell's close-tab flow saves through this slot; reassigned every
  // render so it always closes over current state.
  saveSlot.current = () => saveProject();
  /** The one spelling of "open failed" for every open entry point — picker,
   *  retry loop, Finder — so wording and the abort-stays-silent rule can't
   *  drift between them. */
  const reportOpenError = (err: unknown) => {
    if (!isAbort(err)) setLoadError(`Could not open project: ${errMsg(err)}`);
  };

  // (File → Open's picker lives in TabsShell now — an open has to be able
  // to target a new tab. The picked handle/file arrives via fileToOpen.)

  /** Open a .label with quiet retries — shared by ALL entry points (the
   *  FS-Access picker, the hidden-input fallback, and the desktop
   *  Finder-open effect), so none can drift.
   *  The first read of a freshly saved, cloud-synced, or large
   *  just-downloaded file can fail while the OS materializes or scans the
   *  bytes — users saw "cancel and reopen fixes it", which is this race
   *  resolving itself. Backoff to ~1.5s total because a 38MB file scans
   *  measurably slower than a small one; only the last attempt reports.
   *  getFile sits INSIDE the try: the flaky read is the file read itself
   *  (fileSource's arrayBuffer / readNativeFile), so its failures must be
   *  retried exactly like a failed unpack. */
  async function openWithRetry(getFile: () => Promise<LabelSource>): Promise<boolean> {
    const delays = [0, 300, 1200];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      const quiet = i < delays.length - 1;
      try {
        if (await openProject(await getFile(), { quiet })) return true;
      } catch (err) {
        if (!quiet) reportOpenError(err);
      }
    }
    return false;
  }

  /** File → Open Project…: unzip a .label (v2 label.json or legacy
   *  config.json), resolve it to a config against the right master, then feed
   *  each embedded image through the exact handler a manual drop uses so
   *  previews, mask polarity, and object-URL lifecycle behave identically.
   *  Slots absent from the file are cleared: opening a project is a full
   *  restore, not a merge. */
  async function openProject(f: LabelSource, opts?: { quiet?: boolean }): Promise<boolean> {
    try {
      const unpacked = unpackLabel(f.bytes);
      let warnings: string[] = [];
      if (unpacked.label) {
        const parsed = parseLabelFile(JSON.parse(unpacked.label));
        if ("legacy" in parsed) throw new Error("label.json is not a v2 label");
        const m = await resolveMasterById(parsed.masterId, parsed.masterHint);
        if (!m) {
          setLoadError(
            `Could not find master "${parsed.masterId}"` +
            `${parsed.masterHint ? ` (last seen at ${parsed.masterHint})` : ""}` +
            ` — open its .master file once to register it.`);
          return false;
        }
        let c = composeConfig(m, parsed.enabledVariants, parsed.values, parsed.overrides);
        // Pre-Plan-5a bridge (I1): a label saved before layer visibility
        // moved onto enabledVariants may carry overrides.collabEnabled with
        // "collab" absent from enabledVariants — recompose with "collab"
        // enabled so its layers don't land in disabledLayers on reopen.
        let openedVariants = parsed.enabledVariants;
        const bridged = bridgeCollabOverride(
          m, parsed.enabledVariants, parsed.overrides, c.config.collabEnabled);
        if (bridged.changed) {
          openedVariants = bridged.enabledVariants;
          c = composeConfig(m, bridged.enabledVariants, parsed.values, bridged.overrides);
        }
        // Config, variants and master all land in ONE history step (see
        // resetDocument), so no call order can leak a stale master here.
        resetDocument(c.config, openedVariants, m);
        warnings = c.warnings; // advisory only — a lossy compose still opens
      } else {
        const parsedCfg = parseConfigFile(unpacked.config!);
        // Bridge: an old collab label has no master/variant concept, but a
        // checked Collab box in its config is exactly the "collab" variant.
        resetDocument(parsedCfg, parsedCfg.collabEnabled ? ["collab"] : []);
      }
      // The type matters: FileDrop thumbnails are createObjectURL(file), and
      // an <img> won't render a typeless blob as SVG — logos restored from a
      // project showed as broken images while fresh drops (whose File the
      // browser types) worked.
      const toFile = (a: { name: string; bytes: Uint8Array }) =>
        new File([a.bytes as unknown as BlobPart], a.name, { type: mimeFor(a.name) });
      const { texture: t, mask: m, collabLeft: l, collabCenter: c, customImages: ci } = unpacked.assets;
      // Awaited so the freshly opened document can be marked clean AFTER the
      // asset handlers' state writes — each of those marks it dirty again,
      // and the last write has to be this clean one.
      await Promise.all([
        t && onTexture(toFile(t)), m && onMask(toFile(m)),
        l && onCollab("left", toFile(l)), c && onCollab("center", toFile(c)),
        // resetDocument (above) already cleared customImages to {}, so this
        // is a full restore, not a merge — same contract as the other slots.
        (async () => {
          const entries = await Promise.all(
            Object.entries(ci ?? {}).map(async ([id, a]) =>
              [id, await readCustomImage(toFile(a))] as const));
          if (entries.length) setCustomImages(Object.fromEntries(entries));
        })(),
      ]);
      setDirty(false);
      setEdited(false); // a freshly opened document is untouched by definition
      // "Note: " prefix keeps these advisory resolve warnings from reading
      // as a hard open failure — the same setLoadError slot shows both.
      setLoadError(warnings.length ? "Note: " + warnings.join(" · ") : "");
      return true;
    } catch (err) {
      // quiet: the picker path retries once before reporting — a first-read
      // failure that the retry recovers from should never flash an error.
      if (!opts?.quiet) setLoadError(`Could not open ${f.name}: ${errMsg(err)}`);
      return false;
    }
  }

  /** Opens handed down by the shell — OS file-opens (Finder/Explorer, routed
   *  through TabsShell's take_opened_file listener) and File → Open both
   *  land here. seq-gated so a re-render can never re-open; each source
   *  adopts its save identity exactly as the per-editor entry points used
   *  to: a path lets Save rewrite the double-clicked file, a handle lets
   *  Save rewrite the picked one, a bare File yields none (Save prompts).
   *  The same quiet-retry open as before (see openWithRetry). */
  const openedSeq = useRef(0);
  // Serialized through a sequence number, and superseded opens are skipped:
  // two opens routed to this editor in quick succession must never interleave
  // their resetDocument/asset writes (a half-A half-B document marked clean), and
  // once B is queued there is no point applying A at all.
  const openChain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!fileToOpen || fileToOpen.seq === openedSeq.current) return;
    openedSeq.current = fileToOpen.seq;
    const mySeq = fileToOpen.seq;
    const { path, handle, file } = fileToOpen;
    openChain.current = openChain.current.then(async () => {
      if (openedSeq.current !== mySeq) return; // a newer open superseded us
      try {
        if (path) {
          const name = await basename(path);
          if (await openWithRetry(async () => ({ name, bytes: await readNativeFile(path) }))) {
            projectPath.current = path;
            setFilePath(path);
          }
        } else if (handle) {
          if (await openWithRetry(async () => fileSource(await handle.getFile())))
            projectHandle.current = handle;
        } else if (file) {
          // Hidden-input fallback: bytes but no writable identity — forget
          // any earlier association so Save prompts for this file.
          if (await openWithRetry(() => fileSource(file))) forgetProjectFile();
        }
      } catch (err) {
        reportOpenError(err);
      } finally {
        // Either way the attempt is over — let the shell drop the queued
        // entry (seq-guarded there against a newer open on this tab).
        onOpenSettled(mySeq);
      }
    });
    // openWithRetry's closure chain ends in stable setters (and
    // onOpenSettled is an identity-stable TabExtras callback), so the
    // current render's copy is never stale — same reasoning as onKey above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileToOpen]);

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

  /** A custom image layer's raster bytes, decoded at NATURAL pixel size —
   *  unlike `rasterPixels` above, this does no cover-fit: a custom layer's
   *  placed box can differ from its asset's own resolution, so buildPsd
   *  itself resamples to the placed rect (see psd/build.ts's resizeRGBA). */
  async function rasterPixelsNatural(
    bytes: Uint8Array,
  ): Promise<NonNullable<PsdAssets["customImages"]>[string]> {
    const canvas = await decodeToCanvas(blobOf(bytes));
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
        loadFonts(fontFamilyOf(displayCfg)),
      ]);
      // Same `custom` shape as the PDF export's Assets.custom (see
      // buildFull above): an SVG-sourced custom image plans as ink-tight
      // vector paths, a raster-sourced one as a rect sized by `aspect`.
      const customEntries = Object.entries(customImages);
      const custom = Object.fromEntries(customEntries.map(([id, c]) => [
        id,
        {
          aspect: c.aspect,
          ...(c.image.kind === "svg" ? { art: { kind: "svg" as const, svg: c.image.svg } } : {}),
        },
      ]));
      // Raster custom images decode at NATURAL size — buildPsd resamples to
      // each layer's own placed box (see psd/build.ts's resizeRGBA); an SVG
      // source needs no pixels, it plans as paths via `custom` above.
      const customImageEntries = (await Promise.all(
        customEntries.map(async ([id, c]) => {
          if (c.image.kind === "svg") return null;
          return [id, await rasterPixelsNatural(c.image.bytes)] as const;
        }),
      )).filter((e): e is readonly [string, NonNullable<PsdAssets["customImages"]>[string]] => e !== null);
      const assets: PsdAssets = {
        fonts, logoSvg,
        texture: await rasterPixels(texture?.bytes),
        mask: await rasterPixels(mask?.bytes),
        custom,
        customImages: Object.fromEntries(customImageEntries),
      };
      // Built before any dialog, same reasoning as the PDF exports above.
      const [artPsd, maskPsd] = await Promise.all([
        which !== "mask" ? buildPsd(displayCfg, assets) : null,
        which !== "art" ? buildPsd(displayCfg, assets, "mask") : null,
      ]);
      if (artPsd)
        await saveVia(artPsd, `${exportBaseName(cfg)}.psd`, "image/vnd.adobe.photoshop");
      if (maskPsd)
        await saveVia(maskPsd, `${exportBaseName(cfg)}-mask.psd`, "image/vnd.adobe.photoshop");
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
      const url = blobUrl(strToU8(body), "application/json");
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

  /** Every command the app exposes, once. The palette and AppMenu read this
   *  list, while the key listener dispatches off `key`, so an action cannot
   *  be enabled in one surface while disabled in another. AppMenu owns one
   *  layout shared by its browser and native Tauri renderers. */
  // The two conditions the view commands share, stated once: rulers and guides
  // are 2D-only chrome, and the per-kind guide toggles are meaningless while
  // the umbrella is off. Restated per entry, an eighth 2D command silently
  // works in the 3D views the day someone forgets the clause.
  const twoD = viewMode === "2d";
  const guideEdit = twoD && showGuides;
  const commands: Command[] = [
    // Tab commands run in the shell: a new document is a new tab, and
    // closing goes through the shell's dirty-confirm flow. (⌘N/⌘W are
    // browser-reserved in the web build — the menu items still work there.)
    { id: "tab-new", label: "New Tab", key: "n", mods: "⌘", run: onNewTab },
    { id: "tab-close", label: "Close Tab", key: "w", mods: "⌘", run: onCloseTab },
    { id: "project-open", label: "Open Project…", key: "o", mods: "⌘",
      run: onOpenProject },
    // Disabled while clean: with nothing changed since the last save/open
    // there is nothing to write. Save As stays live — a copy under a new
    // name is always meaningful.
    { id: "project-save", label: "Save Project", key: "s", mods: "⌘",
      disabled: !dirty, run: () => void saveProject() },
    { id: "project-save-as", label: "Save Project As…", key: "s", mods: "⇧⌘",
      run: () => void saveProject(true) },
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
    // Undo/redo are config mutations that bypass `update`, so they run
    // through `mutating` to mark the document dirty (see `dirty`) — as must
    // any future command that changes the config outside `update`.
    { id: "undo", label: "Undo", shortcut: "⌘Z", disabled: !canUndo, run: mutating(undo) },
    { id: "redo", label: "Redo", shortcut: "⇧⌘Z", disabled: !canRedo, run: mutating(redo) },
    { id: "presets-view", label: "View presets", run: () => setPresetsOpen(true) },
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
      disabled: !twoD, run: () => setBleed((b) => !b) },
    { id: "rulers", label: showRulers ? "Hide rulers" : "Show rulers", key: "r",
      disabled: !twoD, run: () => setShowRulers((shown) => !shown) },
    { id: "guides", label: showGuides ? "Hide guides" : "Show guides",
      disabled: !twoD, run: () => setShowGuides((shown) => !shown) },
    { id: "margin-guides", label: showMargins ? "Hide margin guides" : "Show margin guides",
      disabled: !guideEdit, run: () => setShowMargins((shown) => !shown) },
    { id: "center-guides", label: showCenter ? "Hide center guides" : "Show center guides",
      disabled: !guideEdit, run: () => setShowCenter((shown) => !shown) },
    { id: "manual-guides", label: showManualGuides ? "Hide manual guides" : "Show manual guides",
      disabled: !guideEdit, run: () => setShowManualGuides((shown) => !shown) },
    { id: "clear-guides", label: "Clear manual guides",
      disabled: !guideEdit || manualGuides.length === 0, run: () => setManualGuides([]) },
    { id: "mode-design", label: "Design mode", run: () => setMode("design") },
    { id: "mode-fill", label: "Fill mode", run: () => setMode("fill") },
  ];
  // Indexed once per render for status-bar command dispatch.
  const index = Object.fromEntries(commands.map((c) => [c.id, c])) as Record<string, Command>;
  // Throws at the lookup rather than at the .run access downstream, keeping a
  // missing VIEW_CYCLE command explicit.
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
      {/* h-full, not the provider's min-h-svh default: the shell's tab strip
          sits above this editor, so the viewport is no longer all ours.
          hotkey: only the visible tab's provider may own ⌘B. */}
      <SidebarProvider hotkey={active} className="min-h-0 h-full">
        {/* No border of its own: the menubar and status bar share the
            sidebar's paint, so a full-height rule would slice one band of
            chrome in two. The canvas pane below draws the separating edge
            for just the rows where the two differ. */}
        <Sidebar collapsible="offcanvas">
          <SidebarContent>
            {/* Design shows the Editing selector (which the whole sidebar is
                scoped by — see EditingTarget) over the layers panel (style,
                order, visibility); Fill shows the label, the field list, and
                variant checkboxes — no styling, no layers panel (spec: UI). */}
            {mode === "design"
              ? <>
                  <EditingTarget master={master} target={editingTarget}
                    onTarget={setEditingTarget} onNewVariant={addAndSelectVariant}
                    dirty={masterDirty} />
                  <LayersPanel cfg={cfg} update={update} hidden={hiddenLayers} mode={mode}
                    onToggleHidden={toggleHidden} selected={selected} onSelect={pick}
                    onAddLayer={addCustomLayer} onMoveCustomLayer={moveCustomLayer}
                    onLayerEdit={layerEdit} rows={panelLayerRows} />
                </>
              : <FieldList master={master} enabledVariants={enabledVariants} cfg={cfg}
                  onValue={onFieldValue} onVariant={setVariant} />}
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="flex h-full flex-col overflow-hidden">
        {/* No bottom rule of its own: the tab strip below is painted the
            same, and its border draws the one chrome/canvas separation. */}
        <header className="flex items-center gap-3 bg-sidebar text-sidebar-foreground px-3 py-2">
          {/* Toggles the Layers sidebar; the component also binds ⌘B. */}
          <SidebarTrigger className="size-6" />
          {/* Only the active tab renders the menu: under Tauri AppMenu
              installs the one native application menu, a singleton. */}
          {active && <AppMenu actions={commands} onNativeError={setBuildError}
            onCheckForUpdates={onCheckForUpdates} checked={{
            "view-standard": viewMode === "2d" && split === 0,
            "view-mask": viewMode === "2d" && split === 100,
            "view-rendered": viewMode === "flat",
            "view-can": viewMode === "can",
            "view-pack": viewMode === "pack",
            bleed,
            rulers: showRulers,
            guides: showGuides,
            "margin-guides": showMargins,
            "center-guides": showCenter,
            "manual-guides": showManualGuides,
          }} />}
          {/* Replaces the tooltip the old disabled Export button carried: a
              menu item can't explain its own disabled state, so the reason
              sits in the bar itself. */}
          {blocked && <HeaderAlert>{blockedWhy}</HeaderAlert>}
          {/* Preset import/export failures: the bar is the one chrome that
              always shows regardless of selection. */}
          {loadError && <HeaderAlert>{loadError}</HeaderAlert>}
          {/* Build failures sit here too rather than in their own strip above
              the preview — one place for chrome-level errors, and the strip
              was 20px reserved for a row that is empty almost always. */}
          {(buildError || renderError) && <HeaderAlert>{buildError || renderError}</HeaderAlert>}
          <input ref={presetsInput} type="file" accept="application/json" hidden
            onChange={(e) => e.target.files?.[0] && void importPresets(e.target.files[0])} />
          {/* "Add layer -> Image"'s file-pick-first step (see addCustomLayer):
              a plain hidden input, same pattern as presetsInput above — no
              drop zone needed since there is no layer yet to drop onto.
              Cleared on every change so re-picking the same filename still
              fires (native <input> dedupes identical values otherwise). */}
          <input ref={customImageInput} type="file" accept="image/svg+xml,image/png,image/jpeg" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void addCustomImageLayer(f);
            }} />
        </header>
      {/* The workspace tab strip's slot, under the menubar (in the desktop
          build the menubar is native, so this is the window's top content
          row). The shell portals the strip in; display:contents keeps the
          strip a direct flex child of this column. */}
      {active && <div className="contents" ref={tabStripHost} />}
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          {/* overflow-hidden is what makes the pane the window the zoomed
              preview is seen through; without it the scaled label would spill
              over the layers panel and the inspector. */}
          <div
            ref={previewPane}
            className={cn("relative flex min-h-0 flex-1 overflow-hidden border-l border-sidebar-border",
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
              // display:none, and a hidden canvas paints just as expensively as
              // a visible one — that was a wasted repaint per rebuild on top of
              // CanView's own. The paint effect no-ops on null, so the canvases
              // keep their last frame and coming back to 2D repaints once.
              canvasRender={viewMode === "2d" ? canvasSource : null}
              bleedIn={render.bleedIn}
              // displayCfg, not cfg: hit-testing, drag boxes, and the plan
              // this draws must see the SAME geometry — a barcode/qr's
              // expanded payload can change its drawn width. onNudge*
              // callbacks below still write through raw cfg by id, which is
              // safe since ids never change between the two.
              cfg={displayCfg} measure={measure} collab={collabSlots}
              // The preview knows only renderer elements; a selected document
              // layer (background/mask) shows no selection box there.
              selected={elementSelection}
              onPick={pick}
              // Live per-keystroke updates so the canvas render IS the edit
              // feedback, folded into one undo step per session: the first
              // keystroke opens the step, the rest coalesce (see useHistory).
              onEditText={(id, text, first) => {
                const spec = editableText[id];
                if (spec) update((c) => spec.set(c, text), !first);
              }}
              // Escape: the whole session is that one step, so undoing it
              // restores the text as it was when the editor opened.
              onEditCancel={mutating(undo)}
              // Drag-to-move: first move opens the step, the rest coalesce —
              // one undo per drag, mirroring the text-edit session above.
              onNudge={(id, offsetY, first) => {
                // labelEdit, not update: where this label's art actually sits
                // is a label fact — a nudge answers "on THIS can", not "on
                // every can" — so a drag stays per-label in both modes.
                labelEdit((c) => { dragTarget(c, collabSlots, id)?.set(c, offsetY); }, !first);
              }}
              // Two-axis drag for an unlocked custom layer (dragTarget2's
              // "position" form) — same fold-into-one-undo-step contract as
              // onNudge above, sharing its onNudgeCancel.
              onNudgePosition={(id, position, first) => {
                // labelEdit for the same reason as onNudge above: a dragged
                // position is a label fact, in both modes.
                labelEdit((c) => {
                  const t = dragTarget2(c, collabSlots, id);
                  if (t?.kind === "position") t.set(c, position);
                }, !first);
              }}
              onNudgeCancel={mutating(undo)}
              // In-place sessions skip their element from the render (see
              // editSession) so the editor's DOM text is the element.
              onEditSession={setEditSession}
              onSplit={setSplit}
              bleed={bleed}
              // Same Settings knob the 3D die uses, so both previews cut alike.
              cornerRadiusPct={render.cornerRadius}
              zoom={zoom.z}
              // setRenderError itself, not a wrapper: useState setters are
              // identity-stable, and an inline arrow here would be a new
              // function every render, defeating the paint effect's deps.
              // The RENDER channel, not buildError: a successful frame
              // clears it, and frames must never wipe asset/export errors.
              onRenderError={setRenderError} />
            </div>
            {/* active gate: a hidden tab must not hold a live three.js
                context and texture set — reactivation rebuilds them. */}
            {active && viewMode !== "2d" && (
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
                cfg={displayCfg} source={canvasSource} bleedIn={render.bleedIn}
                mode={viewMode} cornerRadiusPct={render.cornerRadius}
                edgeSoftnessPct={render.edgeSoftness}
                onRenderError={setRenderError} />
            )}
            </div>
            {viewMode === "2d" && (
              <Rulers paneRef={previewPane} previewRef={previewRef} transform={zoom}
                showRulers={showRulers} unit={rulerUnit} onUnitChange={setRulerUnit}
                // ANDed here, not inside Rulers: the umbrella toggle is one
                // rule over every guide kind, and it already decides the
                // menu's disabled states through guideEdit above.
                guidesEnabled={showGuides} showMargins={showGuides && showMargins}
                showCenter={showGuides && showCenter}
                showManual={showGuides && showManualGuides} marginPt={marginPt}
                onMarginChange={setMarginPt} manual={manualGuides}
                onAddManual={addManualGuide} onMoveManual={moveManualGuide}
                onRemoveManual={removeManualGuide} />
            )}
            {/* Rebuild indicator, in the frame's bottom-left rather than a
                strip above it: it belongs to the thing that is changing. Same
                corner CanView uses for its texture build, which runs right
                after this one, so the two read as one continuous indicator.
                Outside the blur wrapper, so it stays sharp; gated on
                previewReady so it can't double up with the first-load
                spinner below (now shows only during export builds, which is
                when `building` is true). */}
            {building && previewReady && (
              <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
                rendering preview…
              </span>
            )}
            {/* No-texture hint. It used to sit in the status strip above the
                frame, where it read as chrome; low on the label it is the
                one thing in an empty preview. Waits for the first assembly so it
                can't share the frame with the loading spinner. */}
            {!texture && !building && previewReady && (
              <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
                <span className="rounded-full border border-dashed border-border bg-background/85 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
                  drop a texture anywhere to fill the background
                </span>
              </div>
            )}
            {/* First-load state: until the first debounced assembly lands
                there is nothing on the canvases, so fill the empty frame with
                a spinner instead of a bare box. Later rebuilds keep the
                previous render visible, blur it, and show the corner spinner
                instead. */}
            {!previewReady && !buildError && !renderError && (
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
            {/* What the press receives, next to how magnified you are looking
                at it. Both are facts about the deliverable rather than the
                view, so they read the same in all four modes — unlike the
                zoom to their left. */}
            <span className="mx-2 h-3.5 w-px shrink-0 bg-border" />
            {/* The TRIM, not the page: this is the die-cut size the label is
                ordered at (8x5in) — what "artboard size" means to the
                operator. The full page with bleed — what the press file
                measures — is a keystroke away in the tooltip.
                Clicking cycles the SAME unit the rulers and the margin field
                use, so the app has one measurement setting rather than a
                toolbar that disagrees with the ruler beside it. */}
            <button
              onClick={() => setRulerUnit(nextRulerUnit(rulerUnit))}
              title={`Trim size — with bleed the page is ${sizeLabel(PAGE.w, PAGE.h, rulerUnit)}. Click for ${nextRulerUnit(rulerUnit)}`}
              aria-label={`Artboard size ${sizeLabel(ART.w, ART.h, rulerUnit)}; click to change units`}
              className="shrink-0 rounded px-1 py-0.5 text-xs tabular-nums whitespace-nowrap text-muted-foreground outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {sizeLabel(ART.w, ART.h, rulerUnit)}
            </button>
            <span className="mx-2 h-3.5 w-px shrink-0 bg-border" />
            <span className="shrink-0 px-1 text-xs tabular-nums whitespace-nowrap text-muted-foreground"
              title="Resolution the PDFs and PSDs are built at">
              {render.dpi} DPI
            </span>
            <span className="mx-2 h-3.5 w-px shrink-0 bg-border" />
            {/* Which preview is on screen — the menubar's View names. In 2D
                the split decides: all-mask, all-art, or a live compare.
                Clicking advances to the next view through the SAME commands
                keys 1–5 run, so this can't drift from the menu (a mid-split
                Compare counts as Standard, so it advances to Mask). */}
            <button
              onClick={() => byId(VIEW_CYCLE[(viewIndex + 1) % VIEW_CYCLE.length].id).run()}
              title="Current preview view — click for the next (View menu, keys 1–5)"
              className="shrink-0 rounded px-1 py-0.5 text-xs whitespace-nowrap text-muted-foreground outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              View Mode: {viewLabel}
            </button>
            {/* Design/Fill segmented control, pinned to the toolbar's right
                end — the mode is a property of how you're working, like the
                view readouts beside it, not a command (so not in the menus).
                aria-pressed per button rather than a radiogroup so each is
                its own reachable control. */}
            <div className="ml-auto flex shrink-0 overflow-hidden rounded border border-border">
              {(["design", "fill"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-2 py-0.5 text-xs capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    mode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        </section>
        {/* Right inspector: a shadcn Sheet driven by the selection — open
            while a layer is selected, closed (Esc or the header X) by
            clearing it. Non-modal and overlay-free so the preview and the
            layers panel stay clickable while inspecting; dismissible={false}
            keeps an outside click (e.g. preview click-to-select) from
            closing it mid-selection (no backdrop = no outside-press target). */}
        {/* active gate: the sheet portals to document.body, escaping the
            shell's display:none wrapper — without it a hidden tab's open
            inspector floats over the active tab. The selection itself is
            kept, so the sheet reopens on switching back. mode gate: Fill
            exposes no styling (spec: UI) — canvas clicks still select and
            in-place edit there, but the style inspector stays closed. */}
        <Sheet open={active && mode === "design" && selected.length > 0} modal={false}
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
                fields={visibleFields} preview={stringValues}
                onClose={clearSelection} />
            )}
          </SheetContent>
        </Sheet>
        {/* Drop a texture or mask anywhere in the window — no layer selection
            or inspector trip required. Armed only during a PNG/JPEG drag. */}
        {/* Both register window/document-level listeners, so only the
            active tab may mount them: a hidden overlay would swallow the
            visible tab's drop, and ⌘K would open every tab's palette. */}
        {active && <AssetDropOverlay
          onTexture={(f) => void onTexture(f)}
          onMask={(f) => void onMask(f)} />}
        {active && <CommandMenu actions={commands} />}
        {/* Same portal reasoning as the Sheet above. */}
        <PresetsDialog open={active && presetsOpen} onOpenChange={setPresetsOpen} presets={presets} />
      </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}, makeHiddenPropsEqual<DocumentEditorProps>("render"));
