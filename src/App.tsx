// App.tsx — one document's editor: the v3 document `{ master, label }`
// (model/layers.ts — a Master is its layers in draw order plus variants, a
// LabelFile the master reference, enabled variants and filled values) in an
// undo history, the texture/mask assets (full-res + preview-res pairs), the
// per-id image store, validation, and on-demand full-resolution exports,
// plus whole-project save/open (.label / .master — see model/files.ts).
//
// Rendering is one pipeline for every surface: resolveLayers → the drawing
// layers (page art bound to the loaded texture/mask slots, see withPageArt)
// → planLayers' display list → drawPlate on the 2D preview and the 3D can,
// buildArtPdf / buildMaskPdf / buildPsd on export. There is ONE mode (spec
// 2026-09-04: Removed): the Layers list (LayerList) with its Changed filter
// replaces Fill mode, and the inspector (LayerInspector) edits the selected
// layer. Every edit lands in the LABEL — a property edit as an override, a
// text/image/code edit as a fill value (model/edit.ts's patchLayers /
// setContentIn). The master is the template and changes only through the
// reviewed Save Master, so it never drifts under an operator filling a
// label. Master and label edits share one undo stack.
//
// TabsShell mounts one DocumentEditor per workspace tab and hides the
// inactive ones, so anything here that registers window/document-level
// listeners or renders a singleton surface (the native menu) MUST honor the
// `active` prop — and per-document renders are dropped while inactive (see
// the deactivation effect). The editor reports { title, dirty, edited,
// filePath } upward through onMeta; the shell owns tabs, file-open routing,
// render settings, and the updater.
import { RenderSettings as RenderSettingsFields } from "@/components/RenderSettings";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MasterSaveReview } from "@/components/MasterSaveReview";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { basename } from "@tauri-apps/api/path";
import type { Fill } from "@/types";
import { legacyCollabEnabled, parseConfigFile } from "@/defaults";
import { machineName } from "@/qr";
import { strToU8 } from "fflate";
import { LABEL_EXT, type LabelAssets } from "@/labelfile";
import {
  LABEL_FILTER, LABEL_TYPES, MASTER_FILTER, MASTER_TYPES, isAbort, openPicker, savePicker,
  writeHandle,
} from "@/filePickers";
import { openNativeFile, readNativeFile, saveNativeFile } from "@/files";
import { useHistory } from "@/history";
import type {
  ImageLayer, LabelFile, Layer, LayerKind, LayerValue, Master,
} from "@/model/layers";
import { PAGE_ART_ID, uppercaseOf } from "@/model/layers";
import { exportBase as exportBaseOf, titleOf } from "@/model/resolveLayers";
import type { DeepPartial } from "@/model/merge";
import {
  addLayer, addVariant, adoptMaster, assetReferenced, bindingPatch, unbindPatch, clearLabelOverride, clearOverride,
  applyPromotions, masterChanges, masterDiff, type MasterChange, moveBy, removeVariant, renameVariant, showVersion, nearestLine, snapDelta, type SnapTarget, moveLayers, resizeBy, type ResizeHandle, overrideBadges, overriddenPaths, patchLayers, removeLayer, setContentIn, setValue, structureOnlyMaster,
} from "@/model/edit";
import { layerRows } from "@/model/rows";
import { convertConfigV1, convertLabelV2, guideLines } from "@/model/convert";
import { formatLink, parseLink } from "@/model/format";
import { rebindLabel } from "@/model/rebindLayers";
import {
  MASTER_EXT, masterNameFromFile, packLabel, packMaster, unpackLabel, unpackMaster,
  type MasterAssets,
} from "@/model/files";
import { lolevMaster } from "@/model/lolevLayers";
import { SHIPPED_MASTER_ID, masterIndex, rememberMaster, resolveDefaultMaster, resolveMasterById, saveTargetFor, type MasterSaveTarget } from "@/masters";
import { layerBoxes, type PlacedLayer } from "@/planLayers";
import type { Box } from "@/model/place";
import { planLayers } from "@/planLayers";
import { makeHiddenPropsEqual } from "@/tabs";
import { EMBEDDABLE_RASTER, mimeFor, rasterKind, tintRgba } from "@/collab";
import { parseLogo } from "@/logo";
// The builders are imported dynamically at export time (see buildFull /
// exportPsd) so they stay out of the initial bundle; only their types are
// needed up front.
import type { Assets, CollabImage } from "@/pdf/build";
import type { PsdAssets } from "@/psd/build";
// setBleed is aliased so the call site reads as what it writes: the
// document's actual geometry (layout.ts), not a view option.
import {
  ART, BLEED_SHIFT, PAGE, PREVIEW_OVERSAMPLE, PSD_DOC, setBleed as setLayoutBleed, setOutputDpi,
} from "@/layout";
import { LayerList } from "@/components/LayerList";
import { LayerInspector } from "@/components/LayerInspector";
import { ChoiceBox, TextEditor } from "@/components/TextEditor";
import { FileDrop } from "@/components/FileDrop";
import { MasterPicker } from "@/components/MasterPicker";
import { AssetDropOverlay } from "@/components/AssetDropOverlay";
import type { RenderSettings } from "@/settings";
import {
  EMPTY_SELECTION, gestureIds, resolveSelect, type Selection,
} from "@/selection";
import { CommandMenu, type Command } from "@/components/CommandMenu";
import { AppMenu } from "@/components/AppMenu";
import { PreviewCompare, SNAP_PT, type PreviewCompareHandle, type SnapLines, type SnapMark } from "@/components/PreviewCompare";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { loadLabelFaces, labelFontCss } from "@/fonts";
import { fontFamilyOf, type FontFamilyId } from "@/fontCatalog";
import { loadFonts } from "@/pdf/fonts";
import type { MeasureFace, PlanAssets } from "@/plan";
import type { CanvasAssets, CanvasRenderSource } from "@/canvas/draw";
import logoSvg from "@/assets/logo2025.svg?raw";

/** bytes = full print resolution (exports); previewBytes = downscaled PNG the
 *  assembly effect decodes into a bitmap, so keystroke-driven rebuilds never
 *  churn the print-size image (a burst of those OOMs the tab). `aspect` is
 *  the intrinsic w/h the planner cover-fits the page art by. */
type Loaded = {
  bytes: Uint8Array; previewBytes: Uint8Array; name: string; previewUrl: string; aspect: number;
};

/** One loaded per-id image asset: an image layer's art (a collab logo is
 *  one, filling an image layer). `image` is what the renderer needs;
 *  previewUrl is the raw file, so an SVG thumbnails as itself; `aspect` is
 *  the intrinsic w/h the planner sizes the box by before/without a decoded
 *  bitmap. Keyed by the id minted at drop (mintCustomAssetId). */
type CustomFile = { image: CollabImage; name: string; previewUrl: string; aspect: number };

/** The document: the master being authored and the label filling it. One
 *  history entry holds both, so a master edit and a value edit undo alike. */
type Doc = { master: Master; label: LabelFile };

/** The asset ids the two page-art layers resolve to while the texture / mask
 *  slots hold art. The slots are fixed roles in both containers
 *  (labelfile.ts's texture/<name>, mask/<name>), so the layers carry no id
 *  of their own; App binds them here and registers the same ids in the
 *  render assets (see withPageArt and the assembly effect). */
/** Shift + an arrow key moves the selection this many points instead of one —
 *  the coarse step, as in every design tool. */
const NUDGE_SHIFT_PT = 10;

/** An overlay that has taken focus: a modal, a menu, a Select's list. EVERY
 *  bare key belongs to it while it is up — base-ui moves focus into the popup,
 *  so "g" there is the list's typeahead, not the app's Show-guides command, and
 *  firing the command would both act on the canvas behind the popup and
 *  preventDefault the key the popup needed. */
const POPUP_OWNS_KEYS = [
  '[role="dialog"]', '[role="alertdialog"]', '[role="listbox"]', '[role="menu"]',
  '[role="combobox"]',
].join(",");

/** Everything a popup owns, plus the roving-focus widgets where only the ARROWS
 *  belong to the widget (the inspector's mm/pt toggle, tabs, a radio group).
 *  The nudge stands aside for these rather than moving the layer behind them.
 *  Deliberately narrow: the layer list and the preview carry none of these
 *  roles, so selecting there still nudges. */
const WIDGET_OWNS_ARROWS = [
  POPUP_OWNS_KEYS,
  '[role="radiogroup"]', '[role="tablist"]', '[role="slider"]',
  '[data-slot="toggle-group"]',
].join(",");

/** A fresh label on `master`: nothing filled, no variant on. */
const newLabel = (master: Master): LabelFile =>
  ({ formatVersion: 3, masterId: master.id, enabledVariants: [], values: {} });

/** Mint a new image asset id. One spelling of the format, so every drop
 *  site mints ids a saved project's `ImageLayer.asset` can always resolve
 *  against a customImages entry here, regardless of which added it. */
export function mintCustomAssetId(): string {
  return `custom-asset-${crypto.randomUUID().slice(0, 8)}`;
}

/** The page-art layers bound to the loaded slots: a background/mask layer
 *  draws the slot's art (under PAGE_ART_ID) while the slot holds any, and
 *  nothing otherwise — a layer the master switched off is not in `layers`
 *  at all, so switching Background off is what the old eye did. */
export function withPageArt(layers: Layer[], hasTexture: boolean, hasMask: boolean): Layer[] {
  return layers.map((l) => {
    if (l.kind !== "image" || (l.role !== "background" && l.role !== "mask")) return l;
    const has = l.role === "background" ? hasTexture : hasMask;
    return { ...l, asset: has ? PAGE_ART_ID[l.role] : "" };
  });
}

/** Chrome-level error (or, with `tone="warning"`, a resolveLayers validation
 *  warning), sized for the menu bar: the shadcn Alert (the app's one
 *  notification surface — see ui/alert.tsx) compacted to fit inline beside
 *  the menus rather than as a full-width block. A warning uses `variant`
 *  "default" plus its own colour classes rather than the destructive variant,
 *  which paints its descendant text through a selector on Alert itself that
 *  a className override can't reach. */
function HeaderAlert({ children, tone = "destructive" }: { children: React.ReactNode; tone?: "destructive" | "warning" }) {
  return (
    <Alert
      variant={tone === "warning" ? "default" : "destructive"}
      className={cn(
        "w-auto px-2 py-0.5",
        tone === "warning" ? "border-warning/50 bg-warning-soft" : "border-destructive/50",
      )}
    >
      <AlertDescription className={cn("text-xs", tone === "warning" && "text-warning-text")}>
        {children}
      </AlertDescription>
    </Alert>
  );
}

/** Where the two view toggles (rulers/guides) persist — localStorage, like
 *  every other per-operator setting (settings.ts, masters.ts). Only the two
 *  known keys are read, so an entry written by an earlier build sheds its
 *  extras on the next write instead of leaking them in. */
const VIEW_KEY = "lolev-view";
type ViewToggles = { showRulers: boolean; showGuides: boolean };
function loadViewToggles(): ViewToggles {
  const toggles: ViewToggles = { showRulers: true, showGuides: true };
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Record<string, unknown>;
    for (const k of Object.keys(toggles) as (keyof ViewToggles)[]) {
      if (typeof stored[k] === "boolean") toggles[k] = stored[k];
    }
  } catch {
    // a hand-mangled entry falls back to the defaults rather than crashing boot
  }
  return toggles;
}

/** One spelling for the "which error do I show?" expression the open paths
 *  share. */
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What every open path hands to openProject. Each entry point converts
 *  to this shape itself (fileSource for picked Files), so the shared
 *  pipeline never branches on where the bytes came from. */
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
 *  pipeline here. `size` forces the canvas dimensions and cover-fits the
 *  image into them, centred; without it the canvas takes the image's
 *  natural size. The bitmap is always closed. */
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

/** Repaint a raster image in `fill`, keeping alpha, and re-encode it as PNG
 *  for embedding — the color-overlay path for PNG/JPG art an image layer's
 *  `tintRaster` asks for. */
async function tintedPng(bytes: Uint8Array, fill: Fill): Promise<Uint8Array> {
  const canvas = await decodeToCanvas(blobOf(bytes));
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  tintRgba(img.data, fill);
  ctx.putImageData(img, 0, 0);
  return canvasToPng(canvas);
}

/** tintedPng, memoized per source bytes and fill: the debounced preview
 *  rebuilds re-tint otherwise; WeakMap lets a replaced upload's cache go. */
const tintCache = new WeakMap<Uint8Array, Map<Fill, Promise<Uint8Array>>>();
function tintedPngCached(bytes: Uint8Array, fill: Fill): Promise<Uint8Array> {
  let byFill = tintCache.get(bytes);
  if (!byFill) tintCache.set(bytes, (byFill = new Map()));
  let p = byFill.get(fill);
  if (!p) byFill.set(fill, (p = tintedPng(bytes, fill)));
  return p;
}

/** A packed container asset as a typed File — the type matters: FileDrop
 *  thumbnails are createObjectURL(file), and an <img> won't render a
 *  typeless blob as SVG. One spelling for the label-open and master-adopt
 *  paths. */
function assetToFile(a: { name: string; bytes: Uint8Array }): File {
  return new File([a.bytes as unknown as BlobPart], a.name, { type: mimeFor(a.name) });
}

/** Read a dropped image asset. SVG is kept as source text (so it can be
 *  recolored per its layer's style), anything else as raster bytes, plus
 *  the intrinsic aspect (w/h): an SVG's ink box, a raster's bitmap size. */
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
 *  (~2340px) so the mask plate is never upscaled into it. */
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

/** Largest wheel delta any single event is allowed to contribute: a mouse
 *  notch reports 100 at once, which unclamped overshoots the zoom range. */
const ZOOM_STEP_CAP = 50;

/** Keep the scaled content covering the pane `r`, so neither a pan nor a
 *  zoom-out can strand the label against a band of empty background. */
const clampView = (r: DOMRect, z: number, x: number, y: number) => ({
  z,
  x: Math.min(0, Math.max(r.width * (1 - z), x)),
  y: Math.min(0, Math.max(r.height * (1 - z), y)),
});

/** The pane's zoom range: 1 (fitted) through the 3D dolly's ceiling. */
const clampZoom = (z: number) => Math.min(PREVIEW_OVERSAMPLE, Math.max(1, z));

/** Zoom to `z` about the pane point (ax, ay), keeping whatever is under that
 *  point where it is. Shared by the wheel and the typed field. */
const zoomAbout = (
  r: DOMRect, v: { z: number; x: number; y: number }, z: number, ax: number, ay: number,
) => {
  const k = z / v.z;
  return clampView(r, z, ax - k * (ax - v.x), ay - k * (ay - v.y));
};

/** The three preview views in keys-1–3 order. One list, so the readout,
 *  the click-to-cycle, and the commands can't disagree. */
type ViewMode = "2d" | "can";
const VIEW_CYCLE: { label: string; id: string; at: (m: ViewMode, split: number) => boolean }[] = [
  { label: "Label", id: "view-label", at: (m, s) => m === "2d" && s < 100 },
  { label: "Mask", id: "view-mask", at: (m, s) => m === "2d" && s === 100 },
  { label: "Can", id: "view-can", at: (m) => m === "can" },
];

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

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

type DocumentEditorProps = {
  active: boolean;
  fileToOpen: FileToOpen | null;
  /** Reports fileToOpen's attempt finished (success or failure), so the
   *  shell can drop the queued entry. */
  onOpenSettled: (seq: number) => void;
  onMeta: (meta: DocumentMeta) => void;
  /** Shell-owned slot this editor assigns its save fn into on every render;
   *  resolves false when the user cancels the save dialog. */
  saveSlot: { current: (() => Promise<boolean>) | null };
  /** The Document Settings knobs (DPI/bleed/corner/edge) — shell-owned. */
  render: RenderSettings;
  onRenderChange: (render: RenderSettings) => void;
  onOpenProject: () => void;
  onNewTab: () => void;
  onCloseTab: () => void;
  onCheckForUpdates: () => void;
  /** An update is installed and awaits a relaunch (relabels the app menu). */
  updateInstalled?: boolean;
  /** Ref callback for the tab-strip host: the ACTIVE editor mounts an empty
   *  slot just under its menubar row and the shell portals the strip into it. */
  updateStatusHost?: (el: HTMLDivElement | null) => void;
  tabStripHost: (el: HTMLDivElement | null) => void;
};

// memo is load-bearing: every keystroke in any tab updates the shell's tab
// list (onMeta → title/dirty), and without the bail every HIDDEN editor's
// body would re-run per keystroke. It only holds if the shell passes
// identity-stable props to inactive editors (see TabsShell's extrasFor).
export const DocumentEditor = memo(function DocumentEditor({
  active, fileToOpen, onOpenSettled, onMeta, saveSlot, render, onRenderChange,
  onOpenProject, onNewTab, onCloseTab, onCheckForUpdates, updateInstalled, tabStripHost, updateStatusHost,
}: DocumentEditorProps) {
  // The document lives in a history stack, not plain useState — every edit
  // that goes through `edit` (all of them) is undoable, master and label
  // alike. Swapped wholesale on Open through resetDocument.
  const { value: doc, set: setDoc, reset: resetDoc, undo, redo, canUndo, canRedo } =
    useHistory<Doc>(() => { const m = lolevMaster(); return { master: m, label: newLabel(m) }; });
  const { master, label } = doc;
  const docRef = useRef(doc);
  docRef.current = doc;
  const fileToOpenRef = useRef(fileToOpen);
  fileToOpenRef.current = fileToOpen;
  /** Shared by boot-restore and File/OS open so they cannot interleave
   *  resetDocument / asset writes. openedSeq !== 0 means an open has claimed
   *  this editor — restore must not run (or continue) after that. */
  const openedSeq = useRef(0);
  const openChain = useRef<Promise<void>>(Promise.resolve());
  // The master as of the last open/save — the baseline the "unsaved master
  // edits" dot (Save Master) compares against, itemised by masterChanges.
  const pristineMaster = useRef(doc.master);
  // Bumped by every save/open so the memo below re-reads the ref.
  const [savedTick, repaintMasterDirty] = useState(0);
  // THE WORKING VERSION: the variant the canvas is drawing, which is also the
  // one a promotion lands in (docs/plans/label-first-editing.md, Task 12).
  // It is READ OFF THE LABEL rather than held beside it: the master Select
  // names one version and switching moves `enabledVariants` (showVersion), so
  // the label already records the answer — and undo restores the version along
  // with the variant that created it. Last enabled wins, the same rule
  // resolveLayers and the row badges use.
  const version = label.enabledVariants.at(-1) ?? null;
  /** Which save the review dialog is standing in front of, or null. */
  const [pendingSave, setPendingSave] = useState<{ as: boolean } | null>(null);
  // What a Save Master would write: the structural and fill-contract edits
  // already in the master, plus this label's overrides offered for promotion.
  // Itemised ONLY while the dialog is up — every property edit is a label
  // override now, so this memo's inputs change on every pointermove of a drag,
  // and walking the whole master and its variants at pointer rate to answer
  // "is anything dirty" was most of a drag's work.
  const masterChangeList = useMemo(
    () => (pendingSave
      ? masterChanges(pristineMaster.current, master, label, version ?? undefined) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedTick re-reads the ref
    [pendingSave, master, label, version, savedTick]);
  // The dirty flag is the cheap superset of the same question: the template
  // moved, or the label holds an override that a save could offer to promote.
  // It can light Save Master for an override that happens to equal what the
  // master already says — the review then opens with nothing in it, which is
  // the honest answer to "what would this save write?".
  // Only the master compare is worth memoizing, and it depends on `master`
  // alone — keeping `label.overrides` out of the deps stops a drag's
  // per-pointermove override writes from re-walking the whole master.
  const templateMoved = useMemo(
    () => masterDiff(pristineMaster.current, master),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- savedTick re-reads the ref
    [master, savedTick]);
  const masterDirty = templateMoved || Object.keys(label.overrides ?? {}).length > 0;

  // Which layers the inspector shows — Figma's model: an ordered selection
  // plus an anchor a shift-range extends from, driven by the Layers list or
  // PreviewCompare's click-to-select (selection.ts).
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const selected = selection.ids;
  // The Layers list's rows: every resolved layer (values applied, disabled
  // kept) in draw order, plus the layers an off variant would add. One
  // resolve per master/label change; the inspector reads the same rows.
  const { rows, errors, warnings: resolveWarnings } = useMemo(() => layerRows(master, label), [master, label]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.layer.id, r])), [rows]);
  const [changedOnly, setChangedOnly] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const guides = useMemo(
    () => guideLines({ physical: master.physical, guides: master.guides }),
    [master.physical, master.guides]);
  const [texture, setTexture] = useState<(Loaded & { kind: "png" | "jpg" }) | null>(null);
  // srcBytes: the original upload — the bytes Save writes.
  const [mask, setMask] = useState<(Loaded & { error?: string; srcBytes: Uint8Array }) | null>(null);
  // Every per-id image asset this document carries: image layers' art,
  // collab logos included (an image layer's value is a key here).
  const [customImages, setCustomImages] = useState<Record<string, CustomFile>>({});
  // The layers that DRAW: enabled, values applied, page art bound to the
  // loaded slots. What the preview, the hit boxes, the drag targets and the
  // exports all plan from.
  const drawLayers = useMemo(() => withPageArt(
    rows.filter((r) => r.layer.enabled && (!r.variant || r.variant.enabled)).map((r) => r.layer),
    !!texture, !!mask,
  ), [rows, texture, mask]);
  const pageOn = (role: "background" | "mask") =>
    drawLayers.some((l) => l.kind === "image" && l.role === role);
  /** A row or canvas click, resolved against the anchor and the list's row
   *  order (front to back). A background click (null) clears everything. */
  const clearSelection = () => setSelection(EMPTY_SELECTION);
  const pick = (id: string | null, mods: { shift?: boolean; toggle?: boolean }) => {
    if (id === null) { clearSelection(); return; }
    const order = rows.map((r) => r.layer.id).reverse();
    setSelection((s) => resolveSelect(s, id, mods, order));
  };
  // The layer the inspector edits: the most recently picked one.
  const inspected = selected.length ? rowById.get(selected[selected.length - 1]) : undefined;
  // The layer being edited in place on the preview, if any (reported by
  // PreviewCompare). While set, planLayers skips it via the render source's
  // skip set so the editor's live DOM text IS the layer — no doubled glyphs.
  const [editSession, setEditSession] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  // Two error channels, split by who can clear them: renderError belongs to
  // the renderers (every good frame clears it); buildError to asset
  // assembly, exports and native menu failures.
  const [buildError, setBuildError] = useState("");
  const [renderError, setRenderError] = useState("");
  const [loadError, setLoadError] = useState("");
  // Divider position reported by PreviewCompare (% of width showing
  // white-ink), so the View menu can check off whichever end it sits at.
  const [split, setSplit] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  // How many cans the 3D view shows — one, or the 2x2 four-pack.
  const [cans, setCans] = useState<1 | 4>(1);
  // Preview pane zoom: scale `z` about the pane's top-left, then offset by
  // (x, y) screen px. z === 1 is the fitted view.
  const previewPane = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState({ z: 1, x: 0, y: 0 });
  const canView = useRef<CanViewHandle>(null);
  // Whole percent, so the camera's per-frame emissions bail out of React.
  const [camZoomPct, setCamZoomPct] = useState(100);
  const shownZoomPct = viewMode === "2d" ? Math.round(zoom.z * 100) : camZoomPct;
  const viewIndex = VIEW_CYCLE.findIndex((v) => v.at(viewMode, split));
  const viewLabel = viewMode === "2d" && split > 0 && split < 100
    ? "Compare" : VIEW_CYCLE[viewIndex].label;
  // Zoom level follows you across views (see CanView's initialView). A ref:
  // only a view change hands it over.
  const carried = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const carriedMode = useRef(viewMode);
  // Captured on the single render that leaves 2D — `zoom` still holds the
  // 2D value there and the pane still has its rect. Render-time, not an
  // effect: CanView reads it as a prop while mounting.
  if (viewMode !== "2d" && carriedMode.current === "2d") {
    const r = previewPane.current?.getBoundingClientRect();
    if (r?.width) carried.current = {
      zoom: zoom.z,
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
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  const applyTypedZoom = () => {
    const pct = parseFloat(zoomDraft ?? "");
    setZoomDraft(null);
    if (!isFinite(pct)) return;
    const z = clampZoom(pct / 100);
    if (viewMode === "2d") {
      const r = previewPane.current?.getBoundingClientRect();
      setZoom((v) => r?.width
        ? zoomAbout(r, v, z, r.width / 2, r.height / 2)
        : { z, x: 0, y: 0 });
    } else canView.current?.setZoom(z);
  };
  // Published to layout.ts during render, not from an effect: the rulers
  // and the toolbar's size readout read PAGE and OUTPUT_DPI while rendering.
  // ACTIVE editor only: a hidden editor's memo bail freezes its `render`.
  if (active) {
    setLayoutBleed(render.bleedIn);
    setOutputDpi(render.dpi);
  }

  // Wheel-to-zoom, scoped to the preview pane (2D only; the 3D views run
  // this through OrbitControls). Attached by hand: React's synthetic wheel
  // handler is passive at the root. setZoom's functional form is
  // load-bearing: a pinch delivers events faster than React re-renders.
  useEffect(() => {
    const el = previewPane.current;
    if (!el || viewMode !== "2d") return;
    function onWheel(e: WheelEvent) {
      const r = el!.getBoundingClientRect();
      if (!r.width || !r.height) return; // not laid out yet
      e.preventDefault();
      setZoom((v) => {
        const step = Math.max(-ZOOM_STEP_CAP, Math.min(ZOOM_STEP_CAP, e.deltaY));
        const z = clampZoom(v.z * Math.exp(-step / 150));
        return zoomAbout(r, v, z, e.clientX - r.left, e.clientY - r.top);
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewMode]);

  // Drag-to-pan on the right button — the same button OrbitControls pans
  // with in the 3D views.
  const panFrom = useRef<{ x: number; y: number; r: DOMRect } | null>(null);
  const [panning, setPanning] = useState(false);
  function onPanStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 2 || viewMode !== "2d") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panFrom.current = {
      x: e.clientX, y: e.clientY, r: e.currentTarget.getBoundingClientRect(),
    };
    setPanning(true);
  }
  function onPanMove(e: React.PointerEvent<HTMLDivElement>) {
    const from = panFrom.current;
    if (!from) return;
    const dx = e.clientX - from.x, dy = e.clientY - from.y;
    from.x = e.clientX;
    from.y = e.clientY;
    setZoom((v) => clampView(from.r, v.z, v.x + dx, v.y + dy));
  }
  function onPanEnd() {
    if (!panFrom.current) return;
    panFrom.current = null;
    setPanning(false);
  }
  /** Return to the 2D compare at one end. The divider resize is deferred a
   *  frame: while a 3D mode is up the compare sits in a display:none wrapper
   *  with zero width. */
  const show2d = (which: "art" | "mask") => {
    setViewMode("2d");
    requestAnimationFrame(() => {
      if (which === "art") previewRef.current?.showArt();
      else previewRef.current?.showMask();
    });
  };
  const previewRef = useRef<PreviewCompareHandle>(null);
  // Rulers and guides are view state: they assist the operator but are not
  // label content, so none enters history/exports. Both persist per operator.
  const [showRulers, setShowRulers] = useState(() => loadViewToggles().showRulers);
  const [dimensionUnit, setDimensionUnit] = useState<"mm" | "pt">("mm");
  const [rulerUnit, setRulerUnit] = useState<RulerUnit>("in");
  const [showGuides, setShowGuides] = useState(() => loadViewToggles().showGuides);
  const marginPt = master.guides.top ?? DEFAULT_MARGIN_PT;
  const [manualGuides, setManualGuides] = useState<ManualGuide[]>([]);
  const nextGuideId = useRef(1);
  const addManualGuide = (axis: GuideAxis, point: number) =>
    setManualGuides((guides) => [...guides, { id: nextGuideId.current++, axis, point }]);
  const moveManualGuide = (id: number, point: number) =>
    setManualGuides((guides) => guides.map((guide) => guide.id === id ? { ...guide, point } : guide));
  const removeManualGuide = (id: number) =>
    setManualGuides((guides) => guides.filter((guide) => guide.id !== id));
  useEffect(() => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ showRulers, showGuides }));
  }, [showRulers, showGuides]);

  /** Whether the document differs from the last saved/opened project —
   *  File → Save disables while clean. */
  const [dirty, setDirty] = useState(true);
  /** Whether the user has actually touched this document — the shell
   *  prompts about closing a tab only when edited AND dirty. */
  const [edited, setEdited] = useState(false);
  const editedRef = useRef(edited);
  editedRef.current = edited;
  /** Boot-restore's resetDocument goes through swapLoaded, which markDirty.
   *  While this is set they must not flip `edited` — an untitled tab has to
   *  stay pristine so an OS-open can reuse it, and a keystroke during the
   *  await must not be cleared afterwards. */
  const restoringRef = useRef(false);
  const markDirty = () => { setDirty(true); if (!restoringRef.current) setEdited(true); };

  /** THE write path. Every document edit is a pure Doc → Doc transition
   *  (model/edit.ts), recorded as one history entry; `coalesce` folds a
   *  gesture's many updates (a drag, an in-place text session) into one undo
   *  step — see useHistory's `pushed`. Computed against the doc THIS render
   *  sees so a no-op can return before marking the tab dirty. */
  const edit = (fn: (d: Doc) => Doc, coalesce?: boolean) => {
    let next: Doc;
    try {
      next = fn(doc);
    } catch (err) {
      setBuildError(errMsg(err)); // bindBelow/unbind re-validate through parseMaster
      return;
    }
    if (next === doc || (next.master === doc.master && next.label === doc.label)) return;
    // Always mark edited: boot-restore's restoringRef only suppresses
    // swapLoaded/onTexture, not a keystroke while assets are still loading.
    setDirty(true);
    setEdited(true);
    setDoc((d) => (d === doc ? next : fn(d)), coalesce);
  };
  const editMaster = (fn: (m: Master) => Master, coalesce?: boolean) =>
    edit((d) => ({ ...d, master: fn(d.master) }), coalesce);
  const editLabel = (fn: (l: LabelFile) => LabelFile, coalesce?: boolean) =>
    edit((d) => ({ ...d, label: fn(d.label) }), coalesce);
  /** A DESIGN edit on one layer — position, style, policy, geometry: lands in
   *  the LABEL as an override, never in the master. The master is the template
   *  and changes only through the reviewed Save Master (see edit.ts's
   *  patchLayers for the rule). */
  const patch = (id: string, p: DeepPartial<Layer>, coalesce?: boolean) =>
    patchMany([[id, p]], coalesce);
  /** patch for several layers in ONE doc edit (one clone, one undo entry) —
   *  a group drag patches every selected layer per pointermove. */
  const patchMany = (entries: [string, DeepPartial<Layer>][], coalesce?: boolean) =>
    edit((d) => patchLayers(d, entries), coalesce);
  /** A layer's CONTENT: always a fill value into the label, for any layer. */
  const setContent = (layer: Layer, value: LayerValue, coalesce?: boolean) =>
    edit((d) => setContentIn(d, layer.id, value), coalesce);
  /** Wrap a mutation that bypasses `edit` (undo/redo) so it still marks
   *  the document dirty. */
  const mutating = (fn: () => void) => () => { markDirty(); fn(); };

  /** Add layer: a default layer of `kind` at the end of the master's draw
   *  order, selected. An image layer starts empty; its inspector well loads
   *  the art. */
  /** Add layer, into the version the master Select names: a variant while one
   *  is switched to, the base master otherwise. */
  function onAddLayer(kind: LayerKind) {
    const variant = version ?? undefined;
    const { master: next, id } = addLayer(master, kind, { variant });
    edit((d) => ({ ...d, master: d.master === master ? next : addLayer(d.master, kind, { variant }).master }));
    setSelection({ ids: [id], anchor: id });
  }
  function onRemoveLayer(id: string) {
    editMaster((m) => removeLayer(m, id, rowBoxes()));
    setSelection((s) => s.ids.includes(id)
      ? { ids: s.ids.filter((x) => x !== id), anchor: s.anchor === id ? null : s.anchor } : s);
  }
  /** Switch the working version: what the canvas draws, and what a promotion
   *  in the Save Master review would be written into. The Select names one
   *  version and that is the one you see — switching to a variant shows it,
   *  and going back to the base hides it again (edit.ts's showVersion). */
  function switchVersion(id: string | null) {
    editLabel((l) => showVersion(l, version, id));
  }

  /** The master Select's "New Variant" (and the command of the same name): a
   *  fresh empty variant, switched on for this label
   *  and offers its own Add layer submenu. Named
   *  "Variant N"; rename is a master-file edit for now. */
  /** Returns the minted id so the picker can open its rename box on the new
   *  row — MasterPicker.onNewVariant is typed `() => string` for that. */
  function onNewVariant(): string {
    const name = `Variant ${master.variants.length + 1}`;
    // Minted outside the edit so the id is in hand for the version switch —
    // `edit`'s callback stays a pure Doc → Doc.
    const { master: m, id } = addVariant(master, name);
    // Switched to, like any other version: the new one is what you see.
    edit((d) => ({ master: m, label: showVersion(d.label, version, id) }));
    return id;
  }

  /** Inline rename of a variant, from the picker. A master-file edit. */
  function onRenameVersion(id: string, name: string) {
    editMaster((m) => renameVariant(m, id, name));
  }

  /** Delete a variant and stop showing it. One undoable edit, so it needs no
   *  confirm of its own. */
  function onRemoveVersion(id: string) {
    edit((d) => ({
      master: removeVariant(d.master, id),
      label: showVersion(d.label, version === id ? id : version, null),
    }));
  }

  /** The dot-paths deviating from the master on the inspected layer, kept
   *  APART by source — see overrideBadges, which holds the rule. */
  const overridden = useMemo(() => (
    inspected
      ? overrideBadges(master, label, inspected.layer.id)
      : { variant: new Set<string>(), label: new Set<string>() }
  ), [inspected, master, label]);
  /** Per-property reset, targeted by SOURCE rather than by precedence: the
   *  badge says which one it clears and passes it here, so clearing a label
   *  edit can never silently rewrite a variant in the master file. */
  const resetOverride = (path: string, source: "variant" | "label") => {
    if (!inspected) return;
    const id = inspected.layer.id;
    if (source === "label") { editLabel((l) => clearLabelOverride(l, id, path)); return; }
    edit((d) => {
      let m = d.master;
      for (const v of m.variants) {
        if (d.label.enabledVariants.includes(v.id) && overriddenPaths(m, v.id, id).has(path))
          m = clearOverride(m, v.id, id, path);
      }
      return { ...d, master: m };
    });
  };

  // Face-aware canvas measure for the planner (PreviewCompare's hit boxes,
  // the inspector's Unbind), via the fonts.ts gate — null until the family
  // loads. Keyed on the master's family (the single font gate).
  const family = fontFamilyOf(master);
  const [measure, setMeasure] = useState<MeasureFace | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadLabelFaces(family)
      .then((next) => { if (!cancelled) setMeasure(() => next); })
      .catch((error) => { if (!cancelled) setBuildError(String(error)); });
    return () => { cancelled = true; };
  }, [family]);

  // Which instance the window/document-level key listeners below belong to.
  const activeRef = useRef(active);
  activeRef.current = active;

  // ⌘Z / ⇧⌘Z (and ⌘Y) for the history. Inert while a text field has focus:
  // there the browser's own per-field undo is the one the user means.
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

  // Figma-style bare keys plus the ⌘-modified exports, with the same
  // inert-while-typing guard as undo. Registered once — reads the table
  // through a ref.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (e.altKey) return;
      const mods = e.metaKey || e.ctrlKey ? (e.shiftKey ? "⇧⌘" : "⌘") : undefined;
      if (!mods && e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;
      // Same stand-aside as the nudge, for the BARE keys (1/2/3/r/g): an open
      // menu, dialog or Select holds focus and those keys are its own
      // typeahead. The ⌘ shortcuts stay live — no popup claims those.
      if (!mods && el?.closest?.(POPUP_OWNS_KEYS)) return;
      const cmd = commandsRef.current.find((c) => c.key === e.key.toLowerCase() && c.mods === mods);
      if (!cmd || cmd.disabled) return;
      e.preventDefault();
      cmd.run();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrow-key nudge for the selection: 1pt a press, 10pt with shift. Same
  // inert-while-typing guard as the other two; registered once and reading
  // the live move through a ref, like the command table above.
  const nudgeRef = useRef<(dx: number, dy: number) => void>(() => {});
  useEffect(() => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘← is "go back", not a nudge
      const step = steps[e.key];
      if (!step) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;
      // A popup, dialog or roving-focus widget owns the arrow keys while it
      // holds focus: nudging the canvas behind an open Select (and eating the
      // key the list needs) is never what the arrow meant there.
      if (el?.closest?.(WIDGET_OWNS_ARROWS)) return;
      e.preventDefault();
      const by = e.shiftKey ? NUDGE_SHIFT_PT : 1;
      nudgeRef.current(step[0] * by, step[1] * by);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A loaded-but-invalid mask or an invalid filled value (a bad UPC) blocks
  // exports; texture and mask are both optional.
  const errorList = Object.entries(errors).map(([id, e]) => `${rowById.get(id)?.layer.name ?? id}: ${e}`);
  const blocked = !!mask?.error || errorList.length > 0;
  const blockedWhy = [mask?.error, ...errorList].filter(Boolean).join(" · ");
  const exportBlocked = blocked || building;

  /** Replaces (or, with null, removes) a loaded asset, revoking the old
   *  thumbnail URL — the one shape every drop and every X share. */
  const swapLoaded = <T extends { previewUrl: string }>(
    set: (fn: (old: T | null) => T | null) => void, next: T | null,
  ) => {
    markDirty();
    set((old) => { if (old) URL.revokeObjectURL(old.previewUrl); return next; });
  };

  async function onTexture(f: File) {
    // PNG and JPEG pass through byte-for-byte; anything else the browser can
    // decode (WebP) is re-encoded to PNG ONCE, here, and renamed to match —
    // pdf-lib embeds PNG and JPEG only.
    const passthrough = EMBEDDABLE_RASTER.test(f.name);
    const decoded = passthrough ? await createImageBitmap(f) : await decodeToCanvas(f);
    const bytes = passthrough
      ? new Uint8Array(await f.arrayBuffer())
      : await canvasToPng(decoded as HTMLCanvasElement);
    const previewBytes = await previewPng(decoded);
    const aspect = decoded.width / decoded.height;
    if (decoded instanceof ImageBitmap) decoded.close();
    const name = passthrough ? f.name : `${f.name.replace(/\.[^.]*$/, "")}.png`;
    const previewUrl = URL.createObjectURL(f);
    swapLoaded(setTexture, { bytes, previewBytes, name, kind: rasterKind(name), previewUrl, aspect });
  }

  async function onMask(f: File) {
    // The mask passes through untouched — the printer accepts these plates
    // as-authored (the metalness map classifies pixels itself).
    const [srcBytes, canvas] = await Promise.all([
      f.arrayBuffer().then((b) => new Uint8Array(b)), decodeToCanvas(f),
    ]);
    const previewBytes = await previewPng(canvas);
    const previewUrl = URL.createObjectURL(f);
    swapLoaded(setMask, {
      bytes: srcBytes, previewBytes, name: f.name, previewUrl, srcBytes,
      aspect: canvas.width / canvas.height,
    });
  }

  /** Releases an image asset's bytes once nothing in the document names it
   *  any more — the same art can be shared by two layers, so only an
   *  unreferenced id is dropped. Checked against the doc AFTER the write. */
  function releaseAsset(assetId: string, after: Doc) {
    if (!assetId || assetReferenced(after.master, after.label, assetId)) return;
    setCustomImages((old) => {
      const entry = old[assetId];
      if (!entry) return old;
      URL.revokeObjectURL(entry.previewUrl);
      const next = { ...old };
      delete next[assetId];
      return next;
    });
  }

  /** An image layer's well: read the dropped file into the per-id store
   *  and point the layer (its fill value, or the master's own asset) at the
   *  minted id; the previous asset is released if nothing else uses it. */
  async function onLayerImage(layer: ImageLayer, f: File | null) {
    const previous = layer.asset;
    let assetId = "";
    if (f) {
      assetId = mintCustomAssetId();
      const file = await readCustomImage(f);
      setCustomImages((old) => ({ ...old, [assetId]: file }));
    }
    setContent(layer, assetId);
    // The doc as it will be after that edit lands — releaseAsset must see the
    // NEW state to decide whether the old asset is still referenced.
    const after: Doc = setContentIn({ master, label }, layer.id, assetId);
    if (previous && previous !== assetId) releaseAsset(previous, after);
  }

  /** The image layers whose raster art draws repainted in their fill
   *  (`tintRaster`), keyed by asset — the one per-layer knob the render
   *  assets depend on, spelled as a string so the assembly effect can key
   *  on it by value. */
  const tintKey = useMemo(() => JSON.stringify(drawLayers.flatMap((l) =>
    l.kind === "image" && l.tintRaster && l.asset ? [[l.asset, l.style.fill]] : [])), [drawLayers]);
  /** Every image asset's embed bytes, tinted where a layer asks: what the
   *  preview decodes and the exports embed. Async because a tinted raster
   *  has to be decoded and re-encoded; SVG and untinted rasters pass through. */
  async function imageAssets(): Promise<Record<string, CollabImage>> {
    const tints = new Map<string, Fill>(JSON.parse(tintKey) as [string, Fill][]);
    const out: Record<string, CollabImage> = {};
    for (const [id, c] of Object.entries(customImages)) {
      const fill = tints.get(id);
      out[id] = c.image.kind !== "svg" && fill
        ? { kind: "png", bytes: await tintedPngCached(c.image.bytes, fill) }
        : c.image;
    }
    return out;
  }
  /** The planner's asset descriptors: every image's intrinsic aspect (an
   *  SVG source's ink too, so it plans as paths), plus the page art under
   *  PAGE_ART_ID while the slots hold it. */
  const planAssetsOf = (): PlanAssets => ({
    logoSvg, guides,
    custom: {
      ...Object.fromEntries(Object.entries(customImages).map(([id, c]) => [
        id,
        { aspect: c.aspect, ...(c.image.kind === "svg" ? { art: { kind: "svg" as const, svg: c.image.svg } } : {}) },
      ])),
      ...(texture ? { [PAGE_ART_ID.background]: { aspect: texture.aspect } } : {}),
      ...(mask ? { [PAGE_ART_ID.mask]: { aspect: mask.aspect } } : {}),
    },
  });
  /** The texture/mask bytes for a build, honoring the page-art layers'
   *  enabled switch by omission: a switched-off Background is "no texture"
   *  to every backend, the exports included. */
  const pageArt = (preview: boolean) => ({
    texture: !texture || !pageOn("background") ? undefined
      : preview
        ? { bytes: texture.previewBytes, kind: "png" as const }
        : { bytes: texture.bytes, kind: texture.kind },
    maskPng: !mask || !pageOn("mask") ? undefined : preview ? mask.previewBytes : mask.bytes,
  });

  // The render source for BOTH views: fonts + decoded bitmaps for drawPlate,
  // assembled off the asset inputs alone (debounced — uploads and tint
  // changes are rare and each re-assembly decodes every bitmap). Layer edits
  // deliberately DON'T re-run this: the layers flow into the views as a prop
  // and repaint with these same bitmaps.
  const [decodedAssets, setDecodedAssets] = useState<{
    m: MeasureFace; planAssets: PlanAssets; drawAssets: CanvasAssets; fontCss: string;
  } | null>(null);
  // Guide movement changes placement immediately, without decoding image bytes again.
  const canvasAssets = useMemo(() => decodedAssets ? {
    ...decodedAssets, planAssets: { ...decodedAssets.planAssets, guides },
  } : null, [decodedAssets, guides]);
  const bgOn = pageOn("background"), maskOn = pageOn("mask");
  useEffect(() => {
    if (blocked || !active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const m = await loadLabelFaces(family);
        // Every decode this run makes is tracked here, so a throw partway
        // through can still close everything decoded so far.
        const decoded: ImageBitmap[] = [];
        const bitmap = async (bytes: Uint8Array | undefined) => {
          if (!bytes) return null;
          const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
          decoded.push(bmp);
          return bmp;
        };
        let drawAssets: CanvasAssets;
        try {
          const images = await imageAssets();
          // Raster bytes become a bitmap for the canvas to draw; an SVG
          // source stays undecoded (it plans as paths) and is absent here.
          const customBitmaps: Record<string, ImageBitmap | null> = Object.fromEntries(
            await Promise.all(Object.entries(images).map(async ([id, img]) =>
              [id, img.kind === "svg" ? null : await bitmap(img.bytes)] as const)));
          const art = pageArt(true);
          const textureBmp = await bitmap(art.texture?.bytes);
          const maskBmp = await bitmap(art.maskPng);
          // The page art rides under its PAGE_ART_ID keys too, so a backend
          // that draws the `page` items by asset id finds the same bitmaps.
          if (textureBmp) customBitmaps[PAGE_ART_ID.background] = textureBmp;
          if (maskBmp) customBitmaps[PAGE_ART_ID.mask] = maskBmp;
          drawAssets = { images: customBitmaps };
        } catch (err) {
          for (const bmp of decoded) bmp.close();
          throw err;
        }
        if (cancelled) {
          closeCanvasBitmaps(drawAssets);
          return;
        }
        setDecodedAssets({ m, planAssets: planAssetsOf(), drawAssets, fontCss: labelFontCss(family) });
        setBuildError("");
      })().catch((err) => {
        if (!cancelled) setBuildError(String(err));
      });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
    // Asset inputs only — the layers reach this effect through tintKey and
    // the two page-art switches (see the comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture, mask, customImages, family, tintKey, bgOn, maskOn, blocked, active]);
  // The bitmaps backing the CURRENTLY LIVE `canvasAssets` generation, closed
  // once the next generation has fully replaced them (bitmaps aren't GC'd
  // on their own). A bitmap can sit under two keys; close each once.
  const canvasBitmaps = useRef<CanvasAssets | null>(null);
  const closeCanvasBitmaps = (a: CanvasAssets | null | undefined) => {
    if (!a) return;
    const seen = new Set<ImageBitmap>();
    for (const b of Object.values(a.images ?? {})) {
      if (b instanceof ImageBitmap && !seen.has(b)) { seen.add(b); b.close(); }
    }
  };
  useEffect(() => {
    const prev = canvasBitmaps.current;
    if (prev && prev !== canvasAssets?.drawAssets) closeCanvasBitmaps(prev);
    canvasBitmaps.current = canvasAssets?.drawAssets ?? null;
  }, [canvasAssets]);
  useEffect(() => () => closeCanvasBitmaps(canvasBitmaps.current), []);

  // What the preview omits: the in-place edit session's layer — hidden
  // while its live editor floats over it. Preview-only: meaningless for a
  // print file. Disabled layers are already gone from drawLayers.
  const skip = useMemo<{ has(id: string): boolean }>(
    () => ({ has: (id: string) => id === editSession }), [editSession]);
  const canvasSource = useMemo<CanvasRenderSource | null>(
    () => (canvasAssets ? { ...canvasAssets, skip } : null),
    [canvasAssets, skip],
  );
  const previewReady = !!canvasAssets;
  const pdfExportBlocked = exportBlocked || !previewReady;

  // Background tabs keep their state and asset bytes but not their decoded
  // render source: the ImageBitmaps are the heavy, cheaply-rebuildable part.
  useEffect(() => {
    if (!active) setDecodedAssets(null);
  }, [active]);

  /** Drag-to-move. PreviewCompare reports the cumulative delta from the
   *  drag's start; the patch is moveBy against the layer AS IT WAS at the
   *  start (kept in a ref for the gesture), so every move replaces the last
   *  rather than stacking on it, and the whole drag coalesces into one undo
   *  step. Horizontal snapping to the master's guides is moveBy's. When the
   *  grabbed layer is selected, every selected unlocked layer moves with it. */
  /** Every layer's resolved box for the current draw list — one full place
   *  pass, wanted only at gesture starts and unbinds, never per move. */
  const boxesNow = (layers: Layer[] = drawLayers) =>
    canvasAssets ? layerBoxes(layers, canvasAssets.m, canvasAssets.planAssets) : undefined;
  /** The same over every listed row (disabled layers included) — what the
   *  inspector's bind/unbind actions want. */
  const rowBoxes = () => boxesNow(rows.map((r) => r.layer));
  /** Every line a gesture can snap to on each axis: the master's guides, plus
   *  the edges and middles of the layers NOT taking part (`skip`) — the
   *  Photoshop/Sketch rule that objects line up with each other, not only with
   *  the page. In guide space: layerBoxes measures in page space, which
   *  BLEED_SHIFT offsets from the coordinates layer.x and the guides use. */
  const snapTargets = (skip: ReadonlySet<string>, boxes: Map<string, Box>, skipGuide?: number) => {
    // A guide runs the whole page; a layer's line runs only as far as the
    // layer does — that extent is what the indicator segment is drawn from.
    // The page's own span is written in GUIDE space like everything else here
    // (-BLEED_SHIFT to the far edge), or the drawn segment would sit a bleed
    // low and overrun the sheet when BLEED_SHIFT re-bases it for the DOM.
    const wholePage = { x: { min: -BLEED_SHIFT, max: PAGE.h - BLEED_SHIFT }, y: { min: -BLEED_SHIFT, max: PAGE.w - BLEED_SHIFT } };
    const lines: { x: SnapTarget[]; y: SnapTarget[] } = {
      x: [guides.left, guides.center, guides.right].map((at) => ({ at, ...wholePage.x, guide: true })),
      y: [guides.top, guides.bottom].map((at) => ({ at, ...wholePage.y, guide: true })),
    };
    for (const g of manualGuides) {
      if (g.id === skipGuide) continue;
      lines[g.axis].push({ at: g.point - BLEED_SHIFT, ...wholePage[g.axis], guide: true });
    }
    for (const layer of drawLayers) {
      if (skip.has(layer.id)) continue;
      const box = boxes.get(layer.id);
      // A zero-size box is a layer with no geometry of its own (the background
      // and mask fill the page): its "edges" are all 0, not a line anyone is
      // aligning to.
      if (!box || box.w <= 0 || box.h <= 0) continue;
      const left = box.x - BLEED_SHIFT;
      const top = box.y - BLEED_SHIFT;
      for (const at of [left, left + box.w / 2, left + box.w])
        lines.x.push({ at, min: top, max: top + box.h });
      for (const at of [top, top + box.h / 2, top + box.h])
        lines.y.push({ at, min: left, max: left + box.w });
    }
    return lines;
  };

  /** The indicator segment for a snap: the line it landed on, spanning from
   *  the moving box to the far end of everything that offered that line —
   *  Photoshop's smart guide, which shows WHAT you lined up with, not just
   *  where. Null when the axis did not snap. */
  const snapMark = (
    marks: readonly SnapTarget[], at: number | null, min: number, max: number,
  ): SnapMark | null => {
    if (at === null) return null;
    let from = min;
    let to = max;
    // A page guide and a layer edge can sit on the same coordinate; the
    // indicator reads blue only when NOTHING but a guide offered the line.
    let guide = true;
    for (const m of marks) {
      if (m.at !== at) continue;
      from = Math.min(from, m.min);
      to = Math.max(to, m.max);
      guide &&= !!m.guide;
    }
    return { at, from, to, guide };
  };

  const dragBase = useRef<
    {
      id: string; bases: { layer: Layer; w: number }[];
      bounds: { x: number; w: number; y: number; h: number };
      lines: { x: SnapTarget[]; y: SnapTarget[] };
    } | null
  >(null);
  const onDrag = (id: string, dx: number, dy: number, first: boolean): SnapLines => {
    if (first || dragBase.current?.id !== id) {
      const boxes = boxesNow();
      if (!boxes) return { x: null, y: null, dx, dy };
      const ids = new Set(gestureIds(selected, id));
      const bases = drawLayers.filter((l) => ids.has(l.id) && !l.locked)
        .map((layer) => ({ layer, w: boxes.get(layer.id)?.w ?? 0 }));
      if (!bases.length) return { x: null, y: null, dx, dy };
      // The selection's own box, in the guides' space: layerBoxes measures in
      // page space, which BLEED_SHIFT offsets from the coordinates layer.x and
      // the guides are written in.
      const span = bases.reduce((acc, { layer }) => {
        const box = boxes.get(layer.id);
        const left = (box?.x ?? layer.x) - BLEED_SHIFT;
        const top = (box?.y ?? 0) - BLEED_SHIFT;
        return {
          x: Math.min(acc.x, left), right: Math.max(acc.right, left + (box?.w ?? 0)),
          y: Math.min(acc.y, top), bottom: Math.max(acc.bottom, top + (box?.h ?? 0)),
        };
      }, { x: Infinity, right: -Infinity, y: Infinity, bottom: -Infinity });
        const lines = snapTargets(ids, boxes);
      dragBase.current = {
        id, bases, lines,
        bounds: { x: span.x, w: span.right - span.x, y: span.y, h: span.bottom - span.y },
      };
    }
    // The SELECTION'S BOUNDS decide where the drag lands: one snap per axis,
    // applied as the distance every selected layer travels. Snapping the
    // grabbed layer alone re-spaced the group every time it crossed a guide,
    // and centred that layer rather than the thing on screen.
    // The set is moveBy's "already carried" test: a layer bound to another in
    // the same drag follows it, and must not move its own gap on top of that.
    const { bounds, lines } = dragBase.current;
    const moving = new Set(dragBase.current.bases.map(({ layer }) => layer.id));
    const sx = snapDelta({ min: bounds.x, size: bounds.w }, dx, lines.x, SNAP_PT);
    const sy = snapDelta({ min: bounds.y, size: bounds.h }, dy, lines.y, SNAP_PT);
    const entries = dragBase.current.bases
      .map(({ layer }): [string, DeepPartial<Layer>] => [layer.id, moveBy(layer, sx.delta, sy.delta, moving)])
      .filter(([, p]) => Object.keys(p).length);
    if (entries.length) patchMany(entries, !first);
    // The indicator spans the moved selection AND whatever it lined up with.
    const top = bounds.y + sy.delta;
    const left = bounds.x + sx.delta;
    return {
      x: snapMark(lines.x, sx.line, top, top + bounds.h),
      y: snapMark(lines.y, sy.line, left, left + bounds.w),
      dx: sx.delta, dy: sy.delta,
    };
  };
  /** A manual guide dragged off the ruler snaps to the same lines a layer
   *  does — the master's guides, the other manual guides, and every layer's
   *  edges and middle — so "line this guide up with that logo" is a drag, not
   *  arithmetic. Rulers speaks page space; the lines are in guide space. */
  const snapGuidePoint = (axis: GuideAxis, point: number, id?: number) => {
    const boxes = boxesNow();
    if (!boxes) return point;
    const line = nearestLine(point - BLEED_SHIFT, snapTargets(new Set(), boxes, id)[axis], SNAP_PT);
    return line ? line.at + BLEED_SHIFT : point;
  };

  /** The keyboard half of drag-to-move: every selected unlocked layer steps
   *  by the same delta, through the same moveBy the pointer uses (so a bound
   *  layer moves its gap and a layer carried by another is left alone). No
   *  snapping — a nudge is a deliberate exact step, which is the whole reason
   *  to reach for the arrow keys. One press is one undo step. */
  nudgeRef.current = (dx, dy) => {
    const moving = new Set(
      drawLayers.filter((l) => selected.includes(l.id) && !l.locked).map((l) => l.id));
    if (!moving.size) return;
    const entries = drawLayers.filter((l) => moving.has(l.id))
      .map((layer): [string, DeepPartial<Layer>] => [layer.id, moveBy(layer, dx, dy, moving)])
      .filter(([, p]) => Object.keys(p).length);
    if (entries.length) patchMany(entries);
  };

  /** Handle resize: like onDrag, the patch is resizeBy against the layer
   *  and box captured at the gesture's start, coalesced into one undo step.
   *  Only the grabbed layer resizes, never the group. */
  const resizeBase = useRef<
    { layer: Layer; box: Box; lines: { x: SnapTarget[]; y: SnapTarget[] } } | null
  >(null);
  const onResize = (
    id: string, handle: ResizeHandle, dx: number, dy: number, uniform: boolean, first: boolean,
  ): SnapLines => {
    if (first) {
      const boxes = boxesNow();
      const layer = drawLayers.find((l) => l.id === id);
      const box = boxes?.get(id);
      resizeBase.current = layer && box && boxes
        ? { layer, box, lines: snapTargets(new Set([id]), boxes) } : null;
    }
    const base = resizeBase.current;
    if (!base) return { x: null, y: null, dx, dy };
    // The GRABBED EDGE snaps, the opposite one stays put: a resize is about
    // where the edge you are dragging lands, so the snap range is that edge
    // alone (size 0), not the whole box.
    const edgeX = base.box.x - BLEED_SHIFT + (handle.hx === 1 ? base.box.w : 0);
    const edgeY = base.box.y - BLEED_SHIFT + (handle.hy === 1 ? base.box.h : 0);
    const sx = handle.hx === 0 ? { delta: dx, line: null }
      : snapDelta({ min: edgeX, size: 0 }, dx, base.lines.x, SNAP_PT);
    const sy = handle.hy === 0 ? { delta: dy, line: null }
      : snapDelta({ min: edgeY, size: 0 }, dy, base.lines.y, SNAP_PT);
    const p = resizeBy(base.layer, base.box, handle, sx.delta, sy.delta, uniform);
    if (Object.keys(p).length) patch(id, p, !first);
    // The indicator spans the resized box and whatever the grabbed edge lined
    // up with. `patch` is a state update, so boxesNow() here still measures
    // the PREVIOUS frame's layers — the segment's cross-axis extent trails the
    // pointer by one move, which is invisible at pointer rates and is not
    // worth re-planning the scene for.
    const now = boxesNow()?.get(id) ?? base.box;
    const top = now.y - BLEED_SHIFT;
    const left = now.x - BLEED_SHIFT;
    return {
      x: snapMark(base.lines.x, sx.line, top, top + now.h),
      y: snapMark(base.lines.y, sy.line, left, left + now.w),
      dx: sx.delta, dy: sy.delta,
    };
  };
  /** The inspector's Unbind: the bound layer's current resolved top, written
   *  as its numeric `y` — only the planner knows where the layer above ends. */
  const onUnbind = (id: string) => {
    const box = rowBoxes()?.get(id);
    const layer = rowById.get(id)?.layer;
    if (box && layer) patch(id, unbindPatch(layer, box));
  };

  // Revoking immediately can abort a large download, so each URL lives until
  // the NEXT export batch.
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
  /** Save one exported file through the platform's save dialog. Tauri uses
   *  the OS dialog; supported browsers use File System Access; Safari/Firefox
   *  keep the plain-download fallback. */
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
      }
    }
    saveBytes(bytes, name, type);
  }

  // What the tab strip, window title and export names call this document.
  const title = titleOf(drawLayers) || "Untitled";
  const exportBase = exportBaseOf(drawLayers);
  useEffect(() => {
    onMeta({ title, dirty, edited, filePath });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, dirty, edited]); // filePath is declared below; its own effect follows

  /** The full-resolution display list for an export: the same layers the
   *  preview draws, planned with the canvas measure (fonts.ts — the one
   *  font gate) and the full-size asset descriptors. */
  async function exportPlan(): Promise<{ plan: PlacedLayer[]; images: Record<string, CollabImage>; fontFamilies: Assets["fontFamilies"] }> {
    const m = await loadLabelFaces(family);
    const plan = planLayers(drawLayers, m, planAssetsOf());
    const families = new Set(plan.flatMap((run) => run.kind === "text" && run.fontFamily ? [run.fontFamily] : []));
    const fontFamilies = Object.fromEntries(await Promise.all(
      [...families].map(async (id: FontFamilyId) => [id, await loadFonts(id)]),
    ));
    return { plan, images: await imageAssets(), fontFamilies };
  }

  /** Downloads rebuild from the full-resolution assets on demand — the
   *  on-screen preview is deliberately preview-resolution (see Loaded). */
  async function buildFull(which: "art" | "mask" | "both") {
    if (building) return;
    setBuilding(true);
    startSaveBatch();
    try {
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
      const [artPdf, maskPdf] = await Promise.all([
        which !== "mask" ? buildArtPdf(plan, assets) : null,
        which !== "art" ? buildMaskPdf(plan, assets) : null,
      ]);
      if (artPdf) await saveVia(artPdf, `${exportBase}.pdf`, "application/pdf");
      if (maskPdf) await saveVia(maskPdf, `${exportBase}-mask.pdf`, "application/pdf");
      setBuildError("");
    } catch (err) {
      setBuildError(String(err));
    } finally {
      setBuilding(false);
    }
  }
  const downloadArt = () => void buildFull("art");
  const downloadMask = () => void buildFull("mask");
  const exportPdfs = () => void buildFull("both");

  /** The file Save rewrites in place: set by Save As and picker-based Open.
   *  Null until then, so plain Save falls through to the Save As dialog. */
  const projectHandle = useRef<FileSystemFileHandle | null>(null);
  /** Tauri's equivalent of projectHandle. */
  const projectPath = useRef<string | null>(null);
  /** State mirror of projectPath (a ref, which can't drive onMeta). */
  const [filePath, setFilePath] = useState<string | null>(null);
  useEffect(() => {
    onMeta({ title, dirty, edited, filePath });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);
  function forgetProjectFile() {
    projectHandle.current = null;
    projectPath.current = null;
    setFilePath(null);
  }
  /** The same save-identity pattern for the .master this document's master
   *  was last saved to or opened from — tagged with that master's id, since
   *  undo can swap the document's master without touching these refs. Read
   *  them only through saveTargetFor (#78). */
  const masterFileHandle = useRef<MasterSaveTarget<FileSystemFileHandle> | null>(null);
  const masterFilePath = useRef<MasterSaveTarget<string> | null>(null);
  const masterInput = useRef<HTMLInputElement>(null);

  /** Full-document replacement for Open: swap the whole Doc in (resetting
   *  history) and clear every asset slot — an open is a full restore. */
  function resetDocument(next: Doc) {
    resetDoc(next);
    pristineMaster.current = next.master;
    masterFileHandle.current = null;
    const indexed = isTauri() ? masterIndex()[next.master.id]?.path : undefined;
    masterFilePath.current = indexed ? { id: next.master.id, target: indexed } : null;
    clearSelection();
    swapLoaded(setTexture, null);
    swapLoaded(setMask, null);
    setCustomImages((old) => {
      for (const c of Object.values(old)) URL.revokeObjectURL(c.previewUrl);
      return {};
    });
  }

  /** The texture/mask slots and a custom image's on-disk bytes, spelled ONCE
   *  for both containers. */
  const textureAsset = () => texture ? { name: texture.name, bytes: texture.bytes } : undefined;
  const maskAsset = () => mask ? { name: mask.name, bytes: mask.srcBytes } : undefined;
  const imageAssetBytes = (c: CustomFile) =>
    c.image.kind === "svg" ? strToU8(c.image.svg) : c.image.bytes;
  const imageBundle = (ids: Iterable<string>) => {
    const out: NonNullable<LabelAssets["customImages"]> = {};
    for (const id of ids) {
      const c = customImages[id];
      if (c) out[id] = { name: c.name, bytes: imageAssetBytes(c) };
    }
    return Object.keys(out).length ? out : undefined;
  };

  /** File → Save / Save As…: the v3 label plus its embedded art, zipped as
   *  <name-slug>.label (model/files.ts). */
  async function saveProject(as = false): Promise<boolean> {
    const zip = packLabel({ ...label, masterHint: masterIndex()[master.id]?.path }, {
      texture: textureAsset(), mask: maskAsset(),
      customImages: imageBundle(Object.keys(customImages)),
    });
    if (isTauri()) {
      const existingPath = as ? null : projectPath.current;
      try {
        const path = await saveNativeFile(zip, {
          defaultPath: exportBase + LABEL_EXT, filter: LABEL_FILTER, path: existingPath ?? undefined,
        });
        if (path === null) return false;
        projectPath.current = path;
        setFilePath(path);
        setDirty(false);
        setLoadError("");
        return true;
      } catch (err) {
        if (existingPath) { projectPath.current = null; setFilePath(null); }
        setLoadError(`Could not save project: ${errMsg(err)}`);
        return false;
      }
    }
    const pick = savePicker();
    if (pick) {
      try {
        if (as || !projectHandle.current) {
          projectHandle.current = await pick({ suggestedName: exportBase + LABEL_EXT, types: LABEL_TYPES });
        }
        await writeHandle(projectHandle.current, zip);
        setDirty(false);
        return true;
      } catch (err) {
        projectHandle.current = null;
        if (isAbort(err)) return false;
      }
    }
    startSaveBatch();
    saveBytes(zip, exportBase + LABEL_EXT, "application/zip");
    setDirty(false);
    return true;
  }
  saveSlot.current = () => saveProject();

  /** The template assets a Save Master captures: the loaded texture/mask
   *  (the art being authored IS the template art) plus the bytes of every
   *  image asset a master-owned image layer references — a variant's or
   *  the label's FILL values stay label deltas. */
  function masterAssetBundle(): MasterAssets {
    const ids = master.layers.flatMap((l) => l.kind === "image" && l.asset ? [l.asset] : []);
    for (const v of master.variants)
      for (const e of Object.values(v.layers)) if (e.kind === "image" && e.asset) ids.push(e.asset);
    return { texture: textureAsset(), mask: maskAsset(), customImages: imageBundle(ids) };
  }

  /** File → Save Master / Save Master As…, always downstream of the review
   *  dialog (MasterSaveReview), which is where `promote` comes from: the label
   *  overrides the reviewer ticked to fold into the template.
   *
   *  Save As also FORKS — a fresh master id, the document rebound onto it, and
   *  the file written. That is what "Duplicate as new master…" used to do
   *  except for the writing, so there is one verb for it now, not two.
   *
   *  packMaster goes through the same three-way platform save path as
   *  saveProject, then registers the file in the library index and moves the
   *  master-dirty baseline. */
  async function saveMaster(as = false, promote: readonly MasterChange[] = []): Promise<boolean> {
    const promoted = applyPromotions(master, label, promote, version ?? undefined);
    const forked = as
      ? { ...promoted.master, id: `master-${crypto.randomUUID().slice(0, 8)}` }
      : promoted.master;
    const assets = masterAssetBundle();
    const suggested = machineName(forked.name) || "master";
    /** A fork takes its display name from the file it was saved as — without
     *  this the library would list two masters called "Lolev" and no way to
     *  tell them apart (there is no master-name field anywhere in the UI).
     *
     *  Only a name the user actually TYPED counts: accepting the suggested
     *  filename must not rename "Lolev" to its own slug, and that is also the
     *  common case, which then costs no second write below. */
    const titled = (file: string): Master => {
      const base = masterNameFromFile(file);
      return as && base && base !== suggested && base !== forked.name
        ? { ...forked, name: base } : forked;
    };
    /** Adopt `m` as the saved master: the document's, the library's, and the
     *  baseline the next review diffs against. A plain save with nothing
     *  promoted is a no-op edit and pushes no history entry. */
    const commit = async (m: Master, where: string, bytes?: Uint8Array) => {
      edit(() => ({ master: m, label: adoptMaster(promoted.label, m) }));
      await rememberMaster(m, where, bytes);
      pristineMaster.current = m;
      repaintMasterDirty((n) => n + 1);
    };
    if (isTauri()) {
      const existingPath = as ? null : saveTargetFor(masterFilePath.current, master.id);
      try {
        const packed = packMaster(forked, assets);
        const path = await saveNativeFile(packed, {
          defaultPath: suggested + MASTER_EXT, filter: MASTER_FILTER, path: existingPath ?? undefined,
        });
        if (path === null) return false;
        masterFilePath.current = { id: forked.id, target: path };
        const final = titled(path);
        // ponytail: the name is only knowable after the picker returns, so a
        // renamed fork rewrites the file it just wrote — same path, no second
        // dialog, but a second zip of every asset. Split saveNativeFile into
        // "pick a path" and "write bytes" if that ever bites.
        let written = packed;
        if (final !== forked) {
          written = packMaster(final, assets);
          await saveNativeFile(written, { defaultPath: suggested + MASTER_EXT, filter: MASTER_FILTER, path });
        }
        await commit(final, path, written);
        setLoadError("");
        return true;
      } catch (err) {
        if (existingPath) masterFilePath.current = null;
        setLoadError(`Could not save master: ${errMsg(err)}`);
        return false;
      }
    }
    const pick = savePicker();
    if (pick) {
      try {
        const handle = (as ? null : saveTargetFor(masterFileHandle.current, master.id))
          ?? await pick({ suggestedName: suggested + MASTER_EXT, types: MASTER_TYPES });
        masterFileHandle.current = { id: forked.id, target: handle };
        // The handle's name is known BEFORE the write here (unlike the Tauri
        // branch above), so a renamed fork packs and writes exactly once.
        const final = titled(handle.name);
        const bytes = packMaster(final, assets);
        await writeHandle(handle, bytes);
        // The bytes go to the master cache too: a browser reload has no path
        // to re-read this file from (masterCache.ts).
        await commit(final, handle.name, bytes);
        return true;
      } catch (err) {
        masterFileHandle.current = null;
        if (isAbort(err)) return false;
        setLoadError(`Could not save master: ${errMsg(err)}`);
        return false;
      }
    }
    // The download fallback names the file itself, so `titled` is a no-op
    // here — it stays in the line so all three branches read the same way.
    const name = suggested + MASTER_EXT;
    const bytes = packMaster(forked, assets);
    startSaveBatch();
    saveBytes(bytes, name, "application/zip");
    await commit(titled(name), name, bytes);
    return true;
  }

  /** Parse a candidate .master file (ZIP, legacy JSON, or a v1 file, which
   *  converts), reporting a clear error and leaving the document untouched
   *  on a bad file. */
  function tryParseMaster(bytes: Uint8Array): { master: Master; assets: MasterAssets } | null {
    try {
      const r = unpackMaster(bytes);
      if (r.warnings.length) setLoadError("Note: " + r.warnings.join(" · "));
      return r;
    } catch (err) {
      setLoadError(`Could not open master: ${errMsg(err)}`);
      return null;
    }
  }

  /** Adopt a master's template assets under the label-delta rule: art the
   *  label already loaded wins — only EMPTY slots fall back to the master's,
   *  and image bytes fill in only for ids the store doesn't hold. */
  async function adoptMasterAssets(a: MasterAssets): Promise<void> {
    await Promise.all([
      !texture && a.texture ? onTexture(assetToFile(a.texture)) : null,
      !mask && a.mask ? onMask(assetToFile(a.mask)) : null,
      (async () => {
        const missing = Object.entries(a.customImages ?? {}).filter(([id]) => !customImages[id]);
        if (!missing.length) return;
        const entries = await Promise.all(missing.map(async ([id, x]) =>
          [id, await readCustomImage(assetToFile(x))] as const));
        setCustomImages((prev) => ({ ...Object.fromEntries(entries), ...prev }));
      })(),
    ]);
  }

  /** Re-aim THIS document at `target`: the label routed through rebindLabel
   *  (non-destructive — whatever doesn't match is benched on `dormant`) and
   *  the master swapped, in one history step. `clean` says whether the
   *  freshly bound master reads as saved (Open Master / the library pick)
   *  or not (a never-written duplicate, so Save Master stays live). */
  function commitRebind(target: Master, clean = true) {
    const { master: from, label: current } = docRef.current;
    const { label: next, dropped } = rebindLabel(current, from, target);
    markDirty();
    setDoc({ master: target, label: next });
    if (clean) { pristineMaster.current = target; repaintMasterDirty((n) => n + 1); }
    clearSelection();
    const notes: string[] = [];
    if (dropped.values.length) notes.push(`${dropped.values.length} value(s) benched: ${dropped.values.join(", ")}`);
    if (dropped.variants.length) notes.push(`${dropped.variants.length} variant(s) benched: ${dropped.variants.join(", ")}`);
    setLoadError(notes.length ? "Note: " + notes.join(" · ") : "");
  }

  /** File → Open Master…: register the newly opened master in the library
   *  index, then commitRebind onto it. */
  async function applyOpenedMaster(m: Master, path: string, bytes?: Uint8Array) {
    await rememberMaster(m, path, bytes);
    commitRebind(m);
  }

  /** Parsed bytes from any Open Master source (native path, FS-Access
   *  handle, hidden input): bind the source, register, rebind, adopt assets. */
  async function openMasterBytes(
    bytes: Uint8Array, name: string, src: { handle?: FileSystemFileHandle; path?: string },
  ) {
    const r = tryParseMaster(bytes);
    if (!r) return;
    const id = r.master.id;
    masterFileHandle.current = src.handle ? { id, target: src.handle } : null;
    masterFilePath.current = src.path ? { id, target: src.path } : null;
    await applyOpenedMaster(r.master, name, bytes);
    await adoptMasterAssets(r.assets);
  }

  /** MasterPicker's library pick (the preview's Continue). The bytes are
   *  already in the master cache (the picker resolved them from disk or the
   *  cache), so only the index / last-applied record needs touching. */
  async function pickLibraryMaster(target: Master, assets: MasterAssets) {
    const path = masterIndex()[target.id]?.path ?? "";
    await rememberMaster(target, path);
    masterFileHandle.current = null;
    masterFilePath.current = isTauri() && path ? { id: target.id, target: path } : null;
    commitRebind(target);
    void adoptMasterAssets(assets);
  }

  /** MasterPicker's library listing: the shipped master plus every master
   *  the index remembers, id → name only (resolved lazily on pick). */
  function libraryEntries(): Record<string, { name: string }> {
    const entries: Record<string, { name: string }> = { [SHIPPED_MASTER_ID]: { name: lolevMaster().name } };
    for (const [id, e] of Object.entries(masterIndex())) entries[id] = { name: e.name };
    return entries;
  }

  /** File → Open Master…: native dialog on desktop (a real path, so the
   *  next launch can re-read the file), FS-Access picker in the browser,
   *  hidden-input fallback elsewhere. */
  async function openMasterPicker() {
    try {
      if (isTauri()) {
        const path = await openNativeFile({ filter: MASTER_FILTER });
        if (path === null) return;
        await openMasterBytes(await readNativeFile(path), path, { path });
        return;
      }
      const pick = openPicker();
      if (!pick) { masterInput.current?.click(); return; }
      const [handle] = await pick({ types: MASTER_TYPES });
      const file = await handle.getFile();
      await openMasterBytes(new Uint8Array(await file.arrayBuffer()), file.name, { handle });
    } catch (err) {
      if (!isAbort(err)) setLoadError(`Could not open master: ${errMsg(err)}`);
    }
  }

  /** A new untitled tab starts on the hardcoded fixture (useHistory is sync)
   *  and then swaps in the last master this operator applied — layers and
   *  positions only; fill values and raster assets stay off so the canvas
   *  is not the last beer. Queued on openChain so a File/OS open cannot
   *  interleave resetDocument with this swap; skipped once openedSeq is
   *  claimed or the operator has edited. */
  useEffect(() => {
    if (fileToOpen) return;
    let cancelled = false;
    openChain.current = openChain.current.then(async () => {
      // An open has claimed this editor (or it unmounted): stand down.
      const claimed = () => cancelled || fileToOpenRef.current || openedSeq.current !== 0;
      try {
        if (claimed()) return;
        const r = await resolveDefaultMaster();
        if (claimed() || editedRef.current) return;
        const current = docRef.current;
        const untouched = current.master.id === SHIPPED_MASTER_ID
          && Object.keys(current.label.values).length === 0
          && !current.label.overrides
          && (current.label.enabledVariants?.length ?? 0) === 0;
        if (!untouched) return;
        const nextMaster = structureOnlyMaster(r.master);
        if (!masterDiff(current.master, nextMaster)) return;
        restoringRef.current = true;
        try {
          resetDocument({ master: nextMaster, label: newLabel(nextMaster) });
          // Untitled restore is not an Open/Save of this document — do not
          // bind Save Master to the last file's path or a restart overwrites it.
          masterFilePath.current = null;
        } finally {
          restoringRef.current = false;
        }
        if (claimed() || editedRef.current) return;
        setEdited(false);
        setDirty(true);
      } catch (err) {
        if (!claimed()) setLoadError(`Could not restore master: ${errMsg(err)}`);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot restore once
  }, []);

  const reportOpenError = (err: unknown) => {
    if (!isAbort(err)) setLoadError(`Could not open project: ${errMsg(err)}`);
  };

  /** Open a .label with quiet retries — shared by ALL entry points. The
   *  first read of a freshly saved, cloud-synced, or large just-downloaded
   *  file can fail while the OS materializes the bytes. */
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

  /** File → Open Project…: unzip a .label of any generation (model/files.ts
   *  — v3 label.json direct, v2 through convertLabelV2 against the resolved
   *  master, a v1 config.json through convertConfigV1), then feed each
   *  embedded image through the exact handler a manual drop uses. */
  async function openProject(f: LabelSource, opts?: { quiet?: boolean }): Promise<boolean> {
    try {
      const unpacked = unpackLabel(f.bytes);
      let notes: string[] = [];
      let masterAssets: MasterAssets = {};
      // Legacy fixed collab ZIP roles (collab-left/, collab-center/) stay
      // READABLE: each is minted an id in the per-id store and becomes the
      // matching image layer's fill value.
      const legacyAssets: Record<string, { name: string; bytes: Uint8Array }> = {};
      const adoptLegacyCollab = (l: LabelFile): LabelFile => {
        let out = l;
        for (const slot of ["collabLeft", "collabCenter"] as const) {
          const a = unpacked.assets[slot];
          if (!a) continue;
          const id = mintCustomAssetId();
          legacyAssets[id] = a;
          out = setValue(out, slot, id);
        }
        return out;
      };
      let next: Doc;
      if (unpacked.legacy !== undefined) {
        // A v1 config.json has no master concept: it converts against the
        // shipped Lolev master, its Collab checkbox becoming the variant.
        const cfg = parseConfigFile(unpacked.legacy);
        const r = convertConfigV1(cfg, legacyCollabEnabled(unpacked.legacy));
        notes = r.warnings;
        next = { master: lolevMaster(), label: adoptLegacyCollab(r.label) };
      } else {
        const ref = unpacked.label ?? unpacked.v2!;
        const resolved = await resolveMasterById(ref.masterId, ref.masterHint);
        if (!resolved) {
          setLoadError(
            `Could not find master "${ref.masterId}"` +
            `${ref.masterHint ? ` (last seen at ${ref.masterHint})` : ""}` +
            ` — open its .master file once to register it.`);
          return false;
        }
        masterAssets = resolved.assets;
        let l: LabelFile;
        if (unpacked.label) l = unpacked.label;
        else {
          const r = convertLabelV2(unpacked.v2!, resolved.master);
          l = r.label;
          notes = r.warnings;
        }
        next = { master: resolved.master, label: adoptLegacyCollab(l) };
      }
      resetDocument(next);
      notes.push(...layerRows(next.master, next.label).warnings);
      // Label-delta rule: the label's own embedded role wins; a missing one
      // falls back to the master's template asset. Image bytes merge the
      // same way, per id (spread order: master first, label last).
      const t = unpacked.assets.texture ?? masterAssets.texture;
      const m = unpacked.assets.mask ?? masterAssets.mask;
      const ci = { ...masterAssets.customImages, ...unpacked.assets.customImages, ...legacyAssets };
      // Awaited so the freshly opened document can be marked clean AFTER
      // the asset handlers' state writes.
      await Promise.all([
        t && onTexture(assetToFile(t)), m && onMask(assetToFile(m)),
        (async () => {
          const entries = await Promise.all(Object.entries(ci).map(async ([id, a]) =>
            [id, await readCustomImage(assetToFile(a))] as const));
          if (entries.length) setCustomImages(Object.fromEntries(entries));
        })(),
      ]);
      setDirty(false);
      setEdited(false);
      setLoadError(notes.length ? "Note: " + notes.join(" · ") : "");
      return true;
    } catch (err) {
      if (!opts?.quiet) setLoadError(`Could not open ${f.name}: ${errMsg(err)}`);
      return false;
    }
  }

  /** Opens handed down by the shell — OS file-opens and File → Open both
   *  land here. seq-gated so a re-render can never re-open; serialized so
   *  two opens never interleave their resetDocument/asset writes (including
   *  the boot-restore job queued on the same chain). */
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
          if (await openWithRetry(() => fileSource(file))) forgetProjectFile();
        }
      } catch (err) {
        reportOpenError(err);
      } finally {
        onOpenSettled(mySeq);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileToOpen]);

  /** The PSD's texture layer needs raw RGBA at document size, cover-fit
   *  here (PSD layers hold pixels 1:1). Export only: ~60MB. */
  async function rasterPixels(bytes: Uint8Array | undefined): Promise<import("@/psd/build").Rgba | undefined> {
    if (!bytes) return undefined;
    const canvas = await decodeToCanvas(blobOf(bytes), { width: PSD_DOC.w, height: PSD_DOC.h });
    const img = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return { data: new Uint8Array(img.data.buffer), width: img.width, height: img.height };
  }
  /** An image layer's raster bytes at NATURAL size — buildPsd resamples to
   *  the placed rect itself. */
  async function rasterPixelsNatural(bytes: Uint8Array): Promise<import("@/psd/build").Rgba> {
    const canvas = await decodeToCanvas(blobOf(bytes));
    const img = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return { data: new Uint8Array(img.data.buffer), width: img.width, height: img.height };
  }

  /** Layered Photoshop files, built full-resolution on demand like the PDFs.
   *  `which` picks a single plate or (default) both. */
  async function exportPsd(which: "both" | "art" | "mask" = "both") {
    if (building) return;
    setBuilding(true);
    startSaveBatch();
    try {
      const [{ buildPsd }, fonts, { plan, images }] = await Promise.all([
        import("@/psd/build"), loadFonts(family), exportPlan(),
      ]);
      const art = pageArt(false);
      const rasterEntries = (await Promise.all(Object.entries(images).map(async ([id, img]) =>
        img.kind === "svg" ? null : [id, await rasterPixelsNatural(img.bytes)] as const)))
        .filter((e): e is readonly [string, import("@/psd/build").Rgba] => e !== null);
      const [texturePx, maskPx] = await Promise.all([rasterPixels(art.texture?.bytes), rasterPixels(art.maskPng)]);
      const assets: PsdAssets = {
        fonts, fontFamily: family,
        images: {
          ...Object.fromEntries(rasterEntries),
          ...(texturePx ? { [PAGE_ART_ID.background]: texturePx } : {}),
          ...(maskPx ? { [PAGE_ART_ID.mask]: maskPx } : {}),
        },
      };
      const [artPsd, maskPsd] = await Promise.all([
        which !== "mask" ? buildPsd(plan, assets, "art", { layers: drawLayers }) : null,
        which !== "art" ? buildPsd(plan, assets, "mask", { layers: drawLayers }) : null,
      ]);
      if (artPsd) await saveVia(artPsd, `${exportBase}.psd`, "image/vnd.adobe.photoshop");
      if (maskPsd) await saveVia(maskPsd, `${exportBase}-mask.psd`, "image/vnd.adobe.photoshop");
      setBuildError("");
    } catch (err) {
      setBuildError(String(err));
    } finally {
      setBuilding(false);
    }
  }

  /** Every command the app exposes, once. The palette and AppMenu read this
   *  list, while the key listener dispatches off `key`. */
  const twoD = viewMode === "2d";
  const commands: Command[] = [
    { id: "tab-new", label: "New Tab", key: "n", mods: "⌘", run: onNewTab },
    { id: "tab-close", label: "Close Tab", key: "w", mods: "⌘", run: onCloseTab },
    { id: "project-open", label: "Open Project…", key: "o", mods: "⌘", run: onOpenProject },
    { id: "project-save", label: "Save Project", key: "s", mods: "⌘",
      disabled: !dirty, run: () => void saveProject() },
    { id: "project-save-as", label: "Save Project As…", key: "s", mods: "⇧⌘",
      run: () => void saveProject(true) },
    { id: "master-open", label: "Open Master…", run: () => void openMasterPicker() },
    { id: "master-save", label: "Save Master", disabled: !masterDirty,
      run: () => setPendingSave({ as: false }) },
    { id: "master-save-as", label: "Save Master As…", run: () => setPendingSave({ as: true }) },
    { id: "export-both", label: "Export PDFs", key: "e", mods: "⌘",
      disabled: pdfExportBlocked, run: exportPdfs },
    { id: "export-art", label: "Export Artwork PDF", disabled: pdfExportBlocked, run: downloadArt },
    { id: "export-mask", label: "Export Mask PDF", disabled: pdfExportBlocked, run: downloadMask },
    { id: "export-psd", label: "Export PSDs", key: "e", mods: "⇧⌘",
      disabled: exportBlocked, run: () => void exportPsd() },
    { id: "export-psd-art", label: "Export Artwork PSD", disabled: exportBlocked, run: () => void exportPsd("art") },
    { id: "export-psd-mask", label: "Export Mask PSD", disabled: exportBlocked, run: () => void exportPsd("mask") },
    { id: "undo", label: "Undo", shortcut: "⌘Z", disabled: !canUndo, run: mutating(undo) },
    { id: "redo", label: "Redo", shortcut: "⇧⌘Z", disabled: !canRedo, run: mutating(redo) },
    { id: "variant-new", label: "New Variant", run: onNewVariant },
    { id: "settings", label: "Settings…", run: () => setSettingsOpen(true) },
    { id: "view-label", label: "Preview: Label", key: "1", run: () => show2d("art") },
    { id: "view-mask", label: "Preview: Mask", key: "2", run: () => show2d("mask") },
    { id: "view-can", label: "Preview: Can", key: "3", run: () => setViewMode("can") },
    { id: "rulers", label: showRulers ? "Hide rulers" : "Show rulers", key: "r",
      disabled: !twoD, run: () => setShowRulers((shown) => !shown) },
    { id: "guides", label: showGuides ? "Hide guides" : "Show guides", key: "g",
      disabled: !twoD, run: () => setShowGuides((shown) => !shown) },
  ];
  const index = Object.fromEntries(commands.map((c) => [c.id, c])) as Record<string, Command>;
  const byId = (id: string): Command => {
    const c = index[id];
    if (!c) throw new Error(`Unknown command: ${id}`);
    return c;
  };
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  /** The inspector's content slot for the selected layer: the rich text
   *  field (or number/code box) for text, the image well for images, the
   *  payload box for barcode/QR — each writing through setContent, so every
   *  layer's content belongs to this label. */
  function contentFor(layer: Layer): React.ReactNode {
    const id = `${layer.id}-content`;
    if (layer.kind === "text") {
      return (
        <TextEditor id={id} label="Text" lines={layer.lines} base={layer.style}
          onChange={(lines) => setContent(layer, lines, true)}
          multiline={true} uppercase={uppercaseOf(layer)}
          onUppercase={(uppercase) => patch(layer.id, { style: { uppercase } })}
          input={layer.input} min={layer.min} max={layer.max} symbology={layer.symbology}
          suffix={layer.suffix} choices={layer.choices} title={layer.title} />
      );
    }
    if (layer.kind === "image") {
      if (layer.role === "background") {
        return <FileDrop label="Texture" accept={{ "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"] }}
          fileName={texture?.name} previewUrl={texture?.previewUrl}
          onFile={(f) => void onTexture(f)} onClear={() => swapLoaded(setTexture, null)} />;
      }
      if (layer.role === "mask") {
        return <FileDrop label="Metallic mask" accept={{ "image/png": [".png"] }}
          fileName={mask?.name} previewUrl={mask?.previewUrl} error={mask?.error}
          onFile={(f) => void onMask(f)} onClear={() => swapLoaded(setMask, null)} />;
      }
      if (layer.asset === "builtin:logo") return null;
      const file = customImages[layer.asset];
      return <FileDrop label="Image" accept={{ "image/svg+xml": [".svg"], "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] }}
        fileName={file?.name} previewUrl={file?.previewUrl}
        onFile={(f) => onLayerImage(layer, f).catch((err) => setBuildError(`Could not load image: ${errMsg(err)}`))}
        onClear={() => void onLayerImage(layer, null)} />;
    }
    // A code layer edits its TEMPLATE (`format`, stashed by resolveLayers when
    // the value carried {ref}s), never the expansion — typing into the
    // expansion would bake today's beer name into the master. `value` is the
    // template verbatim whenever there are no refs to expand.
    const template = layer.format ?? layer.value;
    // The error line and the expansion preview are the same in both boxes
    // below — one node, so a change to either reaches the QR field too.
    const foot = (
      <>
        {errors[layer.id] && <p className="text-xs text-destructive-text">{errors[layer.id]}</p>}
        {layer.format !== undefined && (
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={layer.value}>
            → {layer.value}
          </p>
        )}
      </>
    );
    // A QR is a link, not a format string: the literal prefix is the URL and
    // the one trailing ref is ALWAYS slugified, so the only choice left is
    // which text layer feeds it. Anything parseLink rejects (a hand-written
    // multi-ref template) falls through to the raw box below.
    const link = layer.kind === "qr" ? parseLink(template) : undefined;
    if (link) {
      // Every text layer can feed the link: its id is the ref, its name is
      // what the picker shows.
      const tokens = rows.flatMap((r) =>
        r.layer.kind === "text" ? [{ id: r.layer.id, name: r.layer.name }] : []);
      const src = link.id ?? "";
      const write = (prefix: string, id: string) =>
        setContent(layer, formatLink(prefix, id), true);
      return (
        <div className="space-y-1">
          <Label htmlFor={id} className="text-xs text-muted-foreground">Link</Label>
          <Input id={id} className="h-7 font-mono text-xs" value={link.prefix}
            placeholder="https://lolev.beer/beer/"
            aria-invalid={errors[layer.id] ? true : undefined}
            onChange={(e) => write(e.target.value, src)} />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">followed by</span>
            <Select value={src || "none"} onValueChange={(v) => write(link.prefix, v === "none" ? "" : (v ?? ""))}>
              <SelectTrigger id={`${id}-src`} size="sm" aria-label="Link suffix"
                className="h-6 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">nothing</SelectItem>
                {tokens.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {src && (
            <p className="text-[11px] text-muted-foreground">
              Made safe for a link: lowercased, spaces and punctuation become dashes.
            </p>
          )}
          {foot}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {layer.kind === "barcode" ? "Code" : "Value"}
        </Label>
        {/* A vocabulary makes this the same picker the styled fields use —
            the barcode's tiers are filled HERE, not through TextEditor. */}
        {layer.choices?.length ? (
          <ChoiceBox id={id} className="h-7 font-mono text-xs" value={template}
            choices={layer.choices} invalid={!!errors[layer.id]}
            placeholder={layer.kind === "qr" ? "https://lolev.beer/beer/{name|slug}" : "digits"}
            onCommit={(v) => setContent(layer, v, true)} />
        ) : (
          <Input id={id} className="h-7 font-mono text-xs" value={template}
            placeholder={layer.kind === "qr" ? "https://lolev.beer/beer/{name|slug}" : "digits"}
            aria-invalid={errors[layer.id] ? true : undefined}
            onChange={(e) => setContent(layer, e.target.value, true)} />
        )}
        {foot}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Dialog open={active && settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Settings</DialogTitle>
          <RenderSettingsFields value={render} onChange={onRenderChange} />
        </DialogContent>
      </Dialog>
      {pendingSave && (
        <MasterSaveReview open changes={masterChangeList}
          target={master.variants.find((v) => v.id === version)?.name}
          onCancel={() => setPendingSave(null)}
          onConfirm={(promote) => {
            const { as } = pendingSave;
            setPendingSave(null);
            void saveMaster(as, promote);
          }} />
      )}
      {/* Figma-style three-region shell: collapsible left Sidebar (Layers),
          preview center, inspector sheet right. */}
      <SidebarProvider hotkey={active} className="min-h-0 h-full">
        <Sidebar collapsible="offcanvas">
          <SidebarContent>
            {/* The master picker, then the ONE Layers list (spec: UI). */}
            <MasterPicker master={master} label={label}
              library={libraryEntries()} resolve={resolveMasterById}
              onMaster={pickLibraryMaster} onNewVariant={onNewVariant}
              onRenameVersion={onRenameVersion} onRemoveVersion={onRemoveVersion}
              onSaveMaster={() => setPendingSave({ as: false })} masterDirty={masterDirty}
              version={version} onVersion={switchVersion} />
            <LayerList rows={rows} selected={selected}
              onSelect={(id, mods) => pick(id, { shift: mods.shift, toggle: mods.meta })}
              onToggle={(id, prop, value) => patch(id, { [prop]: value })}
              onRename={(id, name) => patch(id, { name })}
              onReorder={(id, delta) => editMaster((m) => moveLayers(m, gestureIds(selected, id), id, delta))}
              onAdd={onAddLayer} onRemove={onRemoveLayer}
              changedOnly={changedOnly} onChangedOnly={setChangedOnly}
              />
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="flex h-full flex-col overflow-hidden">
        <header className="flex items-center gap-3 bg-sidebar text-sidebar-foreground px-3 py-2">
          <SidebarTrigger className="size-6" />
          {/* Only the active tab renders the menu: under Tauri AppMenu
              installs the one native application menu, a singleton. */}
          {active && <AppMenu actions={commands} onNativeError={setBuildError}
            onCheckForUpdates={onCheckForUpdates} updateInstalled={!!updateInstalled} checked={{
            "view-label": viewMode === "2d" && split === 0,
            "view-mask": viewMode === "2d" && split === 100,
            "view-can": viewMode === "can",
            rulers: showRulers,
            guides: showGuides,
          }} />}
          {blocked && <HeaderAlert>{blockedWhy}</HeaderAlert>}
          {loadError && <HeaderAlert>{loadError}</HeaderAlert>}
          {(buildError || renderError) && <HeaderAlert>{buildError || renderError}</HeaderAlert>}
          {resolveWarnings.length > 0 && <HeaderAlert tone="warning">{resolveWarnings.join(" · ")}</HeaderAlert>}
          {/* Open Master's fallback — see masterInput/openMasterPicker. */}
          <input ref={masterInput} type="file" accept={MASTER_EXT} hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              void f.arrayBuffer().then((buf) => openMasterBytes(new Uint8Array(buf), f.name, {}));
            }} />
        </header>
      {/* The workspace tab strip's slot, under the menubar. */}
      {active && <div className="contents" ref={tabStripHost} />}
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div
            ref={previewPane}
            // The inspector sheet is non-modal and portals over the window,
            // so nothing reflows for it on its own: give the pane a margin
            // the width of the sheet while it is open and the label — which
            // is `m-auto` inside — recentres itself in what is left. Keeping
            // it a MARGIN rather than padding also keeps this element's
            // rect equal to the visible area, which is what clampView pans
            // against. Width must match SheetContent's w-[300px] below.
            className={cn("relative flex min-h-0 flex-1 overflow-hidden border-l border-sidebar-border",
              "transition-[margin] duration-200",
              active && inspected && "mr-[300px]",
              panning && "cursor-grabbing")}
            onContextMenu={(e) => viewMode === "2d" && e.preventDefault()}
            // Clicking the pasteboard — the pane around the label sheet —
            // deselects, which is what closes the inspector (its `open` is
            // derived from the selection). The sheet's own misses already
            // deselect via PreviewCompare's hit test; this covers the gap
            // outside it. Panning is right-button only, so a left click here
            // is never the tail of a drag.
            onClick={(e) => {
              if (viewMode !== "2d") return;
              const t = e.target;
              if (t instanceof Element
                && !t.closest('[data-slot="label-sheet"],[data-slot="rulers"]')) clearSelection();
            }}
            onPointerDown={onPanStart}
            onPointerMove={onPanMove}
            onPointerUp={onPanEnd}
            onPointerCancel={onPanEnd}>
            <div
              className={cn("flex min-h-0 min-w-0 flex-1 transition-[filter,opacity] duration-200",
                building && "blur-sm opacity-70")}>
            {/* PreviewCompare stays mounted but hidden in 3D modes. The
                pinch-zoom transform belongs to THIS div: the 3D views zoom
                their own camera. */}
            <div
              className={viewMode === "2d" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}
              style={{
                transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.z})`,
                transformOrigin: "0 0",
              }}>
            <PreviewCompare ref={previewRef}
              canvasRender={viewMode === "2d" ? canvasSource : null}
              bleedIn={render.bleedIn}
              layers={drawLayers}
              selected={selected}
              onPick={pick}
              // Live per-keystroke updates so the canvas render IS the edit
              // feedback, folded into one undo step per session.
              onEditUppercase={(id, uppercase, first) => patch(id, { style: { uppercase } }, !first)}
              onEditText={(id, lines, first) => {
                const layer = drawLayers.find((l) => l.id === id);
                if (layer) setContent(layer, lines, !first);
              }}
              onEditCancel={mutating(undo)}
              onDrag={onDrag}
              onResize={onResize}
              onDragCancel={mutating(undo)}
              onEditSession={setEditSession}
              onSplit={setSplit}
              bleed={showGuides}
              cornerRadiusPct={render.cornerRadius}
              zoom={zoom.z}
              onRenderError={setRenderError} />
            </div>
            {active && viewMode !== "2d" && (
              <CanView ref={canView}
                initialView={carried.current}
                onZoom={(z, pan) => {
                  if (carriedMode.current !== "2d") carried.current = { zoom: z, pan };
                  setCamZoomPct(Math.round(z * 100));
                }}
                layers={drawLayers} source={canvasSource} bleedIn={render.bleedIn}
                mode={cans === 4 ? "pack" : "can"} cornerRadiusPct={render.cornerRadius}
                edgeSoftnessPct={render.edgeSoftness}
                onRenderError={setRenderError} />
            )}
            </div>
            {viewMode === "2d" && (
              <Rulers paneRef={previewPane} previewRef={previewRef} transform={zoom}
                showRulers={showRulers} unit={rulerUnit} onUnitChange={setRulerUnit}
                showGuides={showGuides} marginPt={marginPt}
                onMarginChange={(margin) => editMaster((m) => ({ ...m, guides: { ...m.guides, left: margin, right: margin, top: margin, bottom: margin } }))} manual={manualGuides}
                onAddManual={addManualGuide} onMoveManual={moveManualGuide} onSnapGuide={snapGuidePoint}
                onRemoveManual={removeManualGuide} />
            )}
            {building && previewReady && (
              <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
                rendering preview…
              </span>
            )}
            {!texture && !building && previewReady && (
              <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
                <span className="rounded-full border border-dashed border-border bg-background/85 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
                  drop a texture anywhere to fill the background
                </span>
              </div>
            )}
            {!previewReady && !buildError && !renderError && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  <span className="text-xs">rendering label…</span>
                </div>
              </div>
            )}
          </div>
          {/* Preview toolbar, in every view. */}
          <div className="flex h-8 shrink-0 items-center overflow-x-auto border-t border-border bg-sidebar px-2">
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
            <span className="mx-2 h-3.5 w-px shrink-0 bg-border" />
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
            <button
              onClick={() => byId(VIEW_CYCLE[(viewIndex + 1) % VIEW_CYCLE.length].id).run()}
              title="Current preview view — click for the next (View menu, keys 1–3)"
              className="shrink-0 rounded px-1 py-0.5 text-xs whitespace-nowrap text-muted-foreground outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              View Mode: {viewLabel}
            </button>
            {viewMode === "can" && (
              <div role="group" aria-label="Cans shown"
                className="ml-2 flex shrink-0 overflow-hidden rounded border border-border">
                {([1, 4] as const).map((n) => (
                  <button key={n} type="button" aria-pressed={cans === n}
                    title={n === 1 ? "One can" : "Four-pack"}
                    onClick={() => setCans(n)}
                    className={`px-2 py-0.5 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      cans === n
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            )}
            {active && <div ref={updateStatusHost} className="ml-auto shrink-0 pl-3" />}
          </div>
        </section>
        {/* Right inspector: a shadcn Sheet driven by the selection — open
            while a layer is selected, closed (Esc or the header X) by
            clearing it. Non-modal and overlay-free so the preview and the
            Layers list stay clickable while inspecting. active gate: the
            sheet portals to document.body, escaping the shell's display:none. */}
        <Sheet open={active && !!inspected} modal={false}
          // Only a deliberate close clears the selection — the sheet has no
          // backdrop, so every click in the list or on the canvas reports as
          // "outside-press", and honouring it wiped ⇧/⌘ selections.
          onOpenChange={(open, details) => {
            if (!open && (details.reason === "escape-key" || details.reason === "close-press"))
              clearSelection();
          }}>
          <SheetContent side="right" showOverlay={false} showCloseButton={false}
            finalFocus={(closeType) => closeType === "keyboard"}
            className="w-[300px] gap-0 overflow-y-auto border-l-0! bg-sidebar p-0 sm:max-w-[300px]">
            {inspected && (
              <LayerInspector key={inspected.layer.id} layer={inspected.layer}
                unit={dimensionUnit} onUnitChange={setDimensionUnit}
                layerNames={rows.map((r) => ({ id: r.layer.id, name: r.layer.name }))}
                overridden={overridden}
                onChange={(p) => patch(inspected.layer.id, p)}
                onReset={resetOverride}
                onUnbind={() => onUnbind(inspected.layer.id)}
                onBind={(to, side) => {
                  const box = rowBoxes()?.get(inspected.layer.id);
                  if (box) patch(inspected.layer.id, bindingPatch(inspected.layer, to, side, box));
                }}
                content={contentFor(inspected.layer)}
                fontFamily={family} />
            )}
          </SheetContent>
        </Sheet>
        {/* Drop a texture or mask anywhere in the window. Only the active
            tab mounts the window-level listeners. */}
        {active && <AssetDropOverlay
          onTexture={(f) => void onTexture(f)}
          onMask={(f) => void onMask(f)} />}
        {active && <CommandMenu actions={commands} />}
      </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}, makeHiddenPropsEqual<DocumentEditorProps>("render"));
