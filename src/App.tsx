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
// buildArtPdf / buildMaskPdf / buildPsd on export (useExport.ts). The asset
// file I/O (decoding drops and packed assets, the bytes a Save packs) is
// assets/io.ts; the .label Save/Save As binding is useProjectSave.ts.
//
// There is ONE mode (spec 2026-09-04: Removed): the Layers list (LayerList)
// with its Changed filter replaces Fill mode, and the inspector
// (LayerInspector) edits the selected layer. Every edit lands in the LABEL —
// a property edit as an override, a text/image/code edit as a fill value
// (model/edit.ts's patchLayers / setContentIn). The master is the template
// and changes only through the reviewed Save Master, so it never drifts
// under an operator filling a label. Master and label edits share one undo
// stack.
//
// TabsShell mounts one DocumentEditor per workspace tab and hides the
// inactive ones, so anything here that registers window/document-level
// listeners or renders a singleton surface (the native menu) MUST honor the
// `active` prop — and per-document renders are dropped while inactive (see
// the deactivation effect). The editor reports its DocumentMeta upward
// through onMeta; the shell owns tabs, file-open routing, render settings,
// and the updater.
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DialogLoadFailed, DialogLoading, loadFailedMessage } from "@/components/LazyDialog";
import { Suspense, lazy, memo, type ComponentPropsWithRef, type ComponentType, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { dialogOpen, isTypingTarget, keyOwner } from "@/keys";
import { isTauri } from "@tauri-apps/api/core";
import { basename } from "@tauri-apps/api/path";
import { legacyCollabEnabled, parseConfigFile } from "@/defaults";
import { machineName } from "@/qr";
import { LABEL_EXT, type LabelAsset } from "@/labelfile";
import { MASTER_FILTER, MASTER_TYPES, isAbort } from "@/filePickers";
import { openThrough, readNativeFile, saveThrough } from "@/files";
import { useHistory, type Coalesce } from "@/history";
import type {
  ImageLayer, LabelFile, Layer, LayerKind, LayerValue, Master,
} from "@/model/layers";
import { PAGE_ART_ID, uppercaseOf, validateLayer } from "@/model/layers";
import { exportBase as exportBaseOf, titleOf, withStoredValue } from "@/model/resolveLayers";
import type { DeepPartial } from "@/model/merge";
import {
  addLayer, addVariant, adoptMaster, referencedAssetIds, masterAssetIds, bindingPatch, unbindPatch, clearLabelOverride, clearOverride,
  applyPromotions, checkLabelBindings, masterChanges, masterDiff, type MasterChange, moveBy, removeVariantIn, renameVariant, showVersion, nearestLine, snapDelta, type SnapTarget, moveLayers, resizeBy, type ResizeHandle, overrideBadges, overriddenPaths, patchLayers, removeLayerIn, setContentIn, setValue, structureOnlyMaster,
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
import { SHIPPED_MASTER_ID, hintPath, hintTrusted, labelRelativeHint, masterIndex, newMasterId, rememberMaster, removeFromLibrary, resolveDefaultMaster, resolveLabelMaster, resolveMasterById, saveTargetFor, type MasterSaveTarget, type ResolvedMaster } from "@/masters";
import { layerBoxes } from "@/planLayers";
import type { Box } from "@/model/place";
import { makeHiddenPropsEqual, unsaved, type TabMeta } from "@/tabs";
import { dropRecovery, keepRecovery } from "@/recovery";
import {
  assetToFile, imageBundle, previewOnce, readCustomImage, readPacked, readRaster, slotAsset,
  type CustomFile, type LoadedRaster,
} from "@/assets/io";
import { useExport } from "@/useExport";
import { useProjectSave } from "@/useProjectSave";
// setBleed is aliased so the call site reads as what it writes: the
// document's actual geometry (layout.ts), not a view option.
import {
  ART, BLEED_SHIFT, PAGE, PREVIEW_OVERSAMPLE, setBleed as setLayoutBleed, setOutputDpi,
} from "@/layout";
import { LayerList } from "@/components/LayerList";
import { LayerInspector } from "@/components/LayerInspector";
import { ChoiceBox, TextEditor } from "@/components/TextEditor";
import { FileDrop } from "@/components/FileDrop";
import { MasterPicker, type LibraryEntry } from "@/components/MasterPicker";
import { AssetDropOverlay } from "@/components/AssetDropOverlay";
import type { RenderSettings } from "@/settings";
import {
  EMPTY_SELECTION, gestureIds, resolveSelect, type Selection,
} from "@/selection";
import { CommandMenu, type Command } from "@/components/CommandMenu";
import { AppMenu } from "@/components/AppMenu";
import { PreviewCompare, SNAP_PT, type PreviewCompareHandle, type SnapLines, type SnapMark } from "@/components/PreviewCompare";
import { Rulers } from "@/components/Rulers";
import type { CanViewHandle } from "@/components/CanView";
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
import { cn, errMsg } from "@/lib/utils";
import { loadLabelFaces, labelFontCss } from "@/fonts";
import { fontFamilyOf, usedFontFamilies, type FontFamilyId } from "@/fontCatalog";
import type { MeasureFace, PlanAssets } from "@/plan";
import type { CanvasAssets, CanvasRenderSource } from "@/canvas/draw";
import { createBitmapCache } from "@/canvas/bitmapCache";
import logoSvg from "@/assets/logo2025.svg?raw";

// three.js is the largest thing in the bundle and most sessions never leave
// the 2D view, so the 3D can view (and three.js with it) loads on first use —
// the same split pdf/build and psd/build already get via import(). A chunk
// that fails to load (a stale dev chunk, a broken install) reports through
// the view's own onRenderError instead of unmounting the editor — there is
// no error boundary above it.
type CanViewProps = ComponentPropsWithRef<typeof import("@/components/CanView").CanView>;
const CanView = lazy<ComponentType<CanViewProps>>(() => import("@/components/CanView").then(
  (m) => ({ default: m.CanView }),
  (err: unknown) => ({
    default: function CanViewLoadFailed({ onRenderError }: CanViewProps) {
      useEffect(() => onRenderError(`The 3D view failed to load: ${errMsg(err)}`), [onRenderError]);
      return null;
    },
  })));

// Settings and the Save Master review are opened rarely, so their modules
// (and the checkbox only the review uses) load on first open, not with the
// editor (#410). The ⌘K palette does the same inside CommandMenu. Like
// CanView, a chunk that fails to load says so where the surface would have
// opened instead of unmounting the editor and its unsaved edits; while one
// loads, DialogLoading keeps the keys off the tab (LazyDialog.tsx).
const RenderSettingsFields = lazy<typeof import("@/components/RenderSettings").RenderSettings>(() => import("@/components/RenderSettings").then(
  (m) => ({ default: m.RenderSettings }),
  (err: unknown) => ({
    default: () => <p className="text-xs text-destructive-text">{loadFailedMessage("Settings", err)}</p>,
  })));
type MasterSaveReviewProps = Parameters<typeof import("@/components/MasterSaveReview").MasterSaveReview>[0];
const MasterSaveReview = lazy<ComponentType<MasterSaveReviewProps>>(() => import("@/components/MasterSaveReview").then(
  (m) => ({ default: m.MasterSaveReview }),
  (err: unknown) => ({
    default: ({ open, onCancel }: MasterSaveReviewProps) => (
      <DialogLoadFailed title="Save Master" what="The Save Master review" err={err}
        open={open} onOpenChange={(o) => { if (!o) onCancel(); }} />
    ),
  })));

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

/** A fresh label on `master`: nothing filled, no variant on. */
const newLabel = (master: Master): LabelFile =>
  ({ formatVersion: 3, masterId: master.id, enabledVariants: [], values: {} });

/** Mint a new image asset id. One spelling of the format, so every drop
 *  site mints ids a saved project's `ImageLayer.asset` can always resolve
 *  against a customImages entry here, regardless of which added it. */
function mintCustomAssetId(): string {
  return `custom-asset-${crypto.randomUUID().slice(0, 8)}`;
}

/** The page-art layers bound to the loaded slots: a background/mask layer
 *  draws the slot's art (under PAGE_ART_ID) while the slot holds any, and
 *  nothing otherwise — a layer the master switched off is not in `layers`
 *  at all, so switching Background off is what the old eye did. */
function withPageArt(layers: Layer[], hasTexture: boolean, hasMask: boolean): Layer[] {
  return layers.map((l) => {
    if (l.kind !== "image" || (l.role !== "background" && l.role !== "mask")) return l;
    const has = l.role === "background" ? hasTexture : hasMask;
    return { ...l, asset: has ? PAGE_ART_ID[l.role] : "" };
  });
}

/** Colour classes per HeaderAlert tone: [Alert border/background, text]. */
const HEADER_ALERT_TONE = {
  destructive: ["border-destructive/50", ""],
  warning: ["border-warning/50 bg-warning-soft", "text-warning-text"],
  success: ["border-success/50 bg-success-soft", "text-success-text"],
  blocked: ["border-destructive/50", ""],
} as const;

/** Chrome-level error (or, with `tone="warning"`, a resolveLayers validation
 *  warning; with `tone="success"`, an export confirmation), sized for the
 *  menu bar: the shadcn Alert (the app's one notification surface — see
 *  ui/alert.tsx) compacted to fit inline beside the menus rather than as a
 *  full-width block. Warning and success use `variant` "default" plus their
 *  own colour classes rather than the destructive variant, which paints its
 *  descendant text through a selector on Alert itself that a className
 *  override can't reach. A success note is hidden from screen readers here:
 *  it is announced politely through the always-mounted status region beside
 *  it, since a live region mounted already holding its text is not read.
 *  The blocked-export note (tone "blocked") looks like an error but is no
 *  alert: it changes with every keystroke that keeps a value invalid, and an
 *  alert would interrupt the reader each time. Its own always-mounted polite
 *  status region announces it; the note itself stays a plain button. */
function HeaderAlert({ children, tone = "destructive" }: { children: React.ReactNode; tone?: keyof typeof HEADER_ALERT_TONE }) {
  const [box, text] = HEADER_ALERT_TONE[tone];
  return (
    <Alert variant={tone === "destructive" || tone === "blocked" ? "destructive" : "default"} className={cn("w-auto px-2 py-0.5", box)}
      {...(tone === "success" && { role: undefined, "aria-hidden": true })}
      {...(tone === "blocked" && { role: undefined })}>
      <AlertDescription className={cn("text-xs", text)}>
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

/** The "N value(s) benched" notes a rebind reports for what didn't fit. */
const benchedNotes = (dropped: { values: string[]; variants: string[] }): string[] => [
  ...(dropped.values.length ? [`${dropped.values.length} value(s) benched: ${dropped.values.join(", ")}`] : []),
  ...(dropped.variants.length ? [`${dropped.variants.length} variant(s) benched: ${dropped.variants.join(", ")}`] : []),
];

/** What every open path hands to openProject. Each entry point converts
 *  to this shape itself (fileSource for picked Files), so the shared
 *  pipeline never branches on where the bytes came from. The one exception
 *  is `path`, set only when the label came off disk (desktop): its folder
 *  is where the label's masterHint may be read from (masters.ts hintTrusted). */
type LabelSource = { name: string; bytes: Uint8Array; path?: string };
const fileSource = async (f: File): Promise<LabelSource> =>
  ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });

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

/** One Zoom In / Zoom Out step (⌘= / ⌘-). */
const ZOOM_FACTOR = 1.25;

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

/** A file the shell wants this editor to open. seq is monotonic — a new
 *  value triggers the open, so a re-render can never re-open. Exactly one
 *  of path (Tauri), handle (FS-Access picker), or file (hidden-input
 *  fallback, a window-dropped .label, or a crash-recovery snapshot — no
 *  save identity) is set. `recovered` is that snapshot's recovery.ts key:
 *  the opened tab stays unsaved, and takes the snapshot over from the key. */
export type FileToOpen = {
  seq: number;
  path?: string;
  handle?: FileSystemFileHandle;
  file?: File;
  recovered?: string;
};

/** What the tab strip shows for this document (src/tabs.ts TabMeta — one
 *  definition, so a new field can't drift) — reported through onMeta
 *  whenever any field changes. */
export type DocumentMeta = TabMeta;

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
  /** Shell-owned slot for the close prompt's Review Master…: opens this
   *  editor's Save Master review and resolves true only once the master
   *  file is written (false on Cancel or a failed save). Omitted by tests
   *  mounting a lone editor. */
  masterSaveSlot?: { current: (() => Promise<boolean>) | null };
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
  /** Where this tab's crash-recovery snapshot lives (recovery.ts); omitted
   *  (tests mounting a lone editor) means no snapshots. */
  recoveryKey?: string;
};

// memo is load-bearing: every keystroke in any tab updates the shell's tab
// list (onMeta → title/dirty), and without the bail every HIDDEN editor's
// body would re-run per keystroke. It only holds if the shell passes
// identity-stable props to inactive editors (see TabsShell's extrasFor).
export const DocumentEditor = memo(function DocumentEditor({
  active, fileToOpen, onOpenSettled, onMeta, saveSlot, masterSaveSlot, render, onRenderChange,
  onOpenProject, onNewTab, onCloseTab, onCheckForUpdates, updateInstalled, tabStripHost, updateStatusHost,
  recoveryKey,
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
  /** Which save the review dialog is standing in front of, or null. `done`
   *  is set when the close prompt asked for it (masterSaveSlot): it hears
   *  whether the review ended in a written master. */
  const [pendingSave, setPendingSave] = useState<{ as: boolean; done?: (saved: boolean) => void } | null>(null);
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
  const [texture, setTexture] = useState<LoadedRaster | null>(null);
  const [mask, setMask] = useState<LoadedRaster | null>(null);
  // Every per-id image asset this document carries: image layers' art,
  // collab logos included (an image layer's value is a key here).
  const [customImages, setCustomImages] = useState<Record<string, CustomFile>>({});
  /** False once this tab has unmounted (set by the unmount cleanup that
   *  releases `held`): every asset commit checks it (#432). */
  const alive = useRef(true);
  const savedAssetsRef = useRef({ texture, mask, customImages });
  savedAssetsRef.current = { texture, mask, customImages };
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
  // Two error channels, split by who can clear them: renderError belongs to
  // the renderers (every good frame clears it); buildError to asset
  // assembly, exports and native menu failures. A successful export clears
  // it only while it still holds that export's own message (#473).
  const [buildError, setBuildError] = useState("");
  const [renderError, setRenderError] = useState("");
  const [loadError, setLoadError] = useState("");
  // A .label whose master can't be found asks what to open it on; openProject
  // awaits `choose` (missingMasterChoice).
  const [missingMaster, setMissingMaster] = useState<{
    id: string; where: string; current: string; choose: (c: "current" | "locate" | null) => void;
  } | null>(null);
  // Bumped wherever this tab changes the library (a row remembered, removed
  // or retired): the index lives in localStorage, so nothing else in the
  // document changes. `library` below is read once per bump, not on every
  // render (a pan or wheel renders per event). Another tab's changes are
  // picked up when this tab comes to the front, another window's through
  // the storage event.
  const [libraryTick, refreshLibrary] = useReducer((n: number) => n + 1, 0);
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
  const nextView = VIEW_CYCLE[(viewIndex + 1) % VIEW_CYCLE.length];
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
  /** Zoom to `next(current)`, clamped, about the pane's centre — the 3D
   *  views dolly their camera instead. Shared by the typed field and the
   *  Zoom In / Out / to Fit commands. */
  const zoomTo = (next: (z: number) => number) => {
    if (viewMode === "2d") {
      const r = previewPane.current?.getBoundingClientRect();
      setZoom((v) => {
        const z = clampZoom(next(v.z));
        return r?.width ? zoomAbout(r, v, z, r.width / 2, r.height / 2) : { z, x: 0, y: 0 };
      });
    } else canView.current?.setZoom(clampZoom(next(camZoomPct / 100)));
  };
  const applyTypedZoom = () => {
    const pct = parseFloat(zoomDraft ?? "");
    setZoomDraft(null);
    if (isFinite(pct)) zoomTo(() => pct / 100);
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
   *  File → Save disables while clean. Clear it ONLY after a completed open
   *  or save: the shell reads false as "holds a file" (tabs.ts isPristine). */
  const [dirty, setDirty] = useState(true);
  /** Whether the user has actually touched this document — the shell
   *  prompts about closing a tab only when edited AND unsaved (tabs.ts). */
  const [edited, setEdited] = useState(false);
  const editFlags = useRef({ dirty, edited });
  editFlags.current = { dirty, edited };
  const beforeTextEdit = useRef(editFlags.current);
  const onEditSession = useCallback((id: string | null) => {
    if (id) beforeTextEdit.current = editFlags.current;
    setEditSession(id);
  }, []);
  const editedRef = useRef(edited);
  editedRef.current = edited;
  /** Boot-restore's resetDocument goes through swapLoaded, which markDirty.
   *  While this is set they must not flip `edited` — an untitled tab has to
   *  stay pristine so an OS-open can reuse it, and a keystroke during the
   *  await must not be cleared afterwards. */
  const restoringRef = useRef(false);
  const markDirty = () => { setDirty(true); exportStale(); if (!restoringRef.current) setEdited(true); };

  /** THE write path. Every document edit is a pure Doc → Doc transition
   *  (model/edit.ts), recorded as one history entry; `coalesce` folds a
   *  gesture's many updates (a drag, an in-place text session) into one undo
   *  step, and an inspector field passes its id so its typing is one step of
   *  its own — see history.ts's `Coalesce`. Computed against the doc THIS render
   *  sees so a no-op can return before marking the tab dirty. Returns whether
   *  the edit was recorded (false for a no-op or a rejected edit). */
  const edit = (fn: (d: Doc) => Doc, coalesce?: Coalesce): boolean => {
    // Binding check on every result, both applications below — see checkLabelBindings (#93).
    const checked = (d: Doc) => { const n = fn(d); return n === d ? n : checkLabelBindings(n, d); };
    let next: Doc;
    try {
      next = checked(doc);
    } catch (err) {
      setBuildError(errMsg(err)); // parseMaster / checkLabelBindings refusals
      return false;
    }
    if (next === doc || (next.master === doc.master && next.label === doc.label)) return false;
    // Always mark edited: boot-restore's restoringRef only suppresses
    // swapLoaded/onTexture, not a keystroke while assets are still loading.
    setDirty(true);
    setEdited(true);
    exportStale();
    setDoc((d) => (d === doc ? next : checked(d)), coalesce);
    return true;
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
  const setContent = (layer: Layer, value: LayerValue, coalesce?: Coalesce) =>
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
    // The selection can hold an id that no longer exists (an undone add, a
    // deleted variant's layer); removing it would throw and delete nothing.
    const ids = gestureIds(selected, id).filter((k) => rows.some((r) => r.layer.id === k));
    const boxes = rowBoxes();
    if (edit((d) => ids.reduce((next, key) => removeLayerIn(next, key, boxes), d)))
      setSelection((s) => ({ ids: s.ids.filter((x) => !ids.includes(x)),
        anchor: s.anchor && ids.includes(s.anchor) ? null : s.anchor }));
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
    // Minted outside the edit so the id is in hand for the version switch —
    // `edit`'s callback stays a pure Doc → Doc.
    const { master: m, id } = addVariant(master);
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
    // Its own undo step, never folded into a quick edit before it: the
    // picker's note promises one ⌘Z brings the variant back (#426).
    edit((d) => removeVariantIn(d, id, rowBoxes()), false);
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

  // Warm the face-aware measure for the families this label uses (the single
  // font gate) and surface a font-load failure early. Only the master's
  // family and the layers' overrides load (#411); picking another family
  // changes fontKey and loads it. The planner callers below each await
  // loadLabelFaces themselves, so nothing here is stored. Every listed row
  // counts, disabled ones too, since the inspector measures those boxes.
  const family = fontFamilyOf(master);
  const fontKey = useMemo(() => usedFontFamilies(family, rows.map((r) => r.layer)).join(","), [family, rows]);
  const fontOverrides = useMemo(() => fontKey.split(",").slice(1) as FontFamilyId[], [fontKey]);
  useEffect(() => {
    let cancelled = false;
    loadLabelFaces(family, fontOverrides)
      .catch((error) => { if (!cancelled) setBuildError(errMsg(error)); });
    return () => { cancelled = true; };
  }, [family, fontOverrides]);

  // Which instance the window/document-level key listeners below belong to.
  const activeRef = useRef(active);
  activeRef.current = active;

  // ⌘Z / ⇧⌘Z (and ⌘Y) for the history, marking the document dirty like the
  // menu commands do. Inert while a text field has focus — there the
  // browser's own per-field undo is the one the user means — or a modal
  // dialog is open, which must not change the canvas behind it (#225, #244).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return; // a hidden tab owns no shortcuts
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (!e.metaKey && !e.ctrlKey) return;
      if (isTypingTarget(e.target) || dialogOpen()) return;
      e.preventDefault();
      // History moves bypass `edit`; without mutating, ⌘Z after a save left the tab clean (#76).
      // Nothing to step over is a no-op, as the disabled menu item is.
      const redoing = key === "y" || e.shiftKey;
      if (redoing ? canRedo : canUndo) mutating(redoing ? redo : undo)();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutating only calls state setters and reads a ref; a stale copy is equivalent
  }, [undo, redo, canUndo, canRedo]);

  // Figma-style bare keys plus the ⌘-modified file and export commands.
  // Registered once — reads the table through a ref.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (e.altKey) return;
      const mods = e.metaKey || e.ctrlKey ? (e.shiftKey ? "⇧⌘" : "⌘") : undefined;
      if (!mods && e.shiftKey) return;
      // The BARE keys (1/2/3/r/g) stand aside where they are someone else's
      // input: a text field, a dialog, or a popup — a menu, a Select's
      // typeahead, the inspector. The ⌘ shortcuts stay live in fields and
      // popups — ⌘S saves from inside a field.
      if (!mods) {
        const owner = keyOwner(e.target);
        if (owner && owner !== "widget") return;
      }
      // ⌘+ is Zoom In as well as ⌘=: "+" is Shift+= on a US keyboard (so it
      // arrives as ⇧⌘) and a key of its own on many others.
      const cmd = e.key === "+" && mods
        ? commandsRef.current.find((c) => c.id === "zoom-in")
        : commandsRef.current.find((c) => c.key === e.key.toLowerCase() && c.mods === mods);
      if (!cmd) return;
      // The key is the app's even while its command is disabled: ⌘S on a
      // clean document must not fall through to the browser's Save Page.
      e.preventDefault();
      // Nor does a modal dialog let ⌘W, ⌘S… reach the tab behind it (#244).
      if (!cmd.disabled && !dialogOpen()) cmd.run();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Arrow-key nudge for the selection: 1pt a press, 10pt with shift. Inert
  // while typing, like undo and the bare-key commands; registered once and
  // reading the live move through a ref, like the command table above.
  const nudgeRef = useRef<(dx: number, dy: number, held: boolean) => void>(() => {});
  useEffect(() => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘← is "go back", not a nudge
      const step = steps[e.key];
      if (!step) return;
      // A field, popup, the inspector or a roving-focus widget owns the arrow
      // keys while it holds focus: nudging the canvas behind an open Select
      // (and eating the key the list needs) is never what the arrow meant.
      // A modal dialog blocks the canvas wherever focus is (#244).
      if (keyOwner(e.target) || dialogOpen()) return;
      // Already handled on the way up — the 3D can's OrbitControls pan and
      // rotate on the arrows and preventDefault them.
      if (e.defaultPrevented) return;
      e.preventDefault();
      const by = e.shiftKey ? NUDGE_SHIFT_PT : 1;
      nudgeRef.current(step[0] * by, step[1] * by, e.repeat);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Delete / Backspace removes the selected layers (the Remove Layer
  // command) when focus is on the canvas or the page. Gated like the nudge:
  // a field, popup, the inspector or a widget owns the key, and so does a
  // focused Layers row, which removes with its own focus hand-off. So does
  // any other focused button (the header's blocked-export note, a toolbar
  // control): Backspace on the note that just selected a layer must not
  // delete it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current || (e.key !== "Delete" && e.key !== "Backspace")) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (keyOwner(e.target) || dialogOpen()) return;
      if ((e.target as Element | null)?.closest?.("[data-layer-id], button")) return;
      const cmd = commandsRef.current.find((c) => c.id === "layer-remove");
      if (!cmd || cmd.disabled) return;
      e.preventDefault();
      cmd.run();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Invalid filled values (such as a bad UPC) block exports. The header note
  // selects the first of them; the Layers list marks each with a dot.
  const errorList = Object.entries(errors).map(([id, e]) => `${rowById.get(id)?.layer.name ?? id}: ${e}`);
  const blocked = errorList.length > 0;
  const blockedWhy = errorList.join(" · ");
  const errorIds = useMemo(() => new Set(Object.keys(errors)), [errors]);

  /** Replaces (or, with null, removes) a loaded asset, revoking the old
   *  thumbnail URL — the one shape every drop and every X share. `next` is a
   *  previewOnce minter, called in the updater, so the new thumbnail URL is
   *  minted only as the value commits (#432); a closed tab commits nothing. */
  const swapLoaded = <T extends { previewUrl: string }>(
    set: (fn: (old: T | null) => T | null) => void, next: (() => T) | null,
  ) => {
    if (!alive.current) return;
    markDirty();
    set((old) => { if (old) URL.revokeObjectURL(old.previewUrl); return next?.() ?? null; });
  };

  /** The texture/mask well's X. Those slots are outside the history (see
   *  history.ts), so ⌘Z can't bring a cleared file back; this always returns
   *  the well's Undo instead (#426). It restores the value the clear actually
   *  removed (read in the updater, not a render's closure, so a decode landing
   *  in between can't swap in an older file), keeping its bytes and minting a
   *  fresh thumbnail URL, since the clear revoked the old one. */
  const clearLoaded = (set: (fn: (old: LoadedRaster | null) => LoadedRaster | null) => void) => {
    let gone: LoadedRaster | null = null;
    swapLoaded<LoadedRaster>((fn) => set((old) => { gone = old; return fn(old); }), null);
    return () => {
      const was: LoadedRaster | null = gone;
      if (was) swapLoaded(set, previewOnce(was, assetToFile({ name: was.name, bytes: was.srcBytes })));
    };
  };

  /** A successful decode clears only its own slot's earlier failure — not a
   *  benched-values note or the other slot's error, which it may land beside
   *  (adoptMasterAssets decodes both at once, right after commitRebind's note). */
  const clearLoadErrorOf = (what: string) =>
    setLoadError((e) => e.startsWith(`Could not load ${what} `) ? "" : e);
  async function onTexture(f: File) {
    try { swapLoaded(setTexture, previewOnce(await readRaster(f), f)); clearLoadErrorOf("texture"); }
    catch (err) { setLoadError(`Could not load texture "${f.name}": ${errMsg(err)}`); }
  }
  async function onMask(f: File) {
    try { swapLoaded(setMask, previewOnce(await readRaster(f), f)); clearLoadErrorOf("mask"); }
    catch (err) { setLoadError(`Could not load mask "${f.name}": ${errMsg(err)}`); }
  }

  /** An image layer's well: read the dropped file into the per-id store
   *  and point the layer (its fill value, or the master's own asset) at the
   *  minted id. The previous asset's bytes are deliberately KEPT: undo can
   *  point the layer back at it (#75); see liveImages. */
  async function onLayerImage(layer: ImageLayer, f: File) {
    const assetId = mintCustomAssetId();
    const mint = previewOnce(await readCustomImage(f), f);
    if (!alive.current) return;
    setCustomImages((old) => ({ ...old, [assetId]: mint() }));
    setContent(layer, assetId);
  }

  /** The images the doc still names. The store also keeps replaced/cleared
   *  art so undo can bring it back (#75); the preview, the exports and Save
   *  read only this live subset, so kept art is never decoded or packed
   *  (#84). Keyed by the live-id list, so an edit that changes no image
   *  reference keeps the same object and the preview doesn't re-decode. */
  const liveIds = useMemo(() => {
    const refs = referencedAssetIds(master, label);
    return Object.keys(customImages).filter((id) => refs.has(id)).join("\n");
  }, [customImages, master, label]);
  const liveImages = useMemo(() => Object.fromEntries(
    liveIds ? liveIds.split("\n").map((id) => [id, customImages[id]]) : []), [customImages, liveIds]);
  /** The planner's asset descriptors: every image's intrinsic aspect (an
   *  SVG source's ink too, so it plans as paths), plus the page art under
   *  PAGE_ART_ID while the slots hold it. */
  const planAssetsOf = (): PlanAssets => ({
    logoSvg, guides,
    custom: {
      ...Object.fromEntries(Object.entries(liveImages).map(([id, c]) => [
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

  // What the tab strip, window title and export names call this document.
  const title = titleOf(drawLayers) || "Untitled";
  const exportBase = exportBaseOf(drawLayers);
  // The PDF/PSD exports and the export-in-flight state (useExport.ts). Its
  // exportStale runs from markDirty and edit above, which only fire from
  // handlers, after this render has declared it.
  const { exporting, exportNote, exportStale, startSaveBatch, saveBytes, buildFull, exportPsd } = useExport({
    drawLayers, family, liveImages, planAssets: planAssetsOf, pageArt, title, exportBase, render, setBuildError,
  });
  const exportBlocked = blocked || exporting !== null;

  // The render source for BOTH views: fonts + decoded bitmaps for drawPlate,
  // assembled off the asset inputs alone (debounced). Layer edits, a raster's
  // tint included, deliberately DON'T re-run this: the layers flow into the
  // views as a prop and repaint with these same bitmaps (drawPlate tints,
  // #414). The one layer edit that does is a font pick that adds a family to
  // fontOverrides, so its faces load (#411). Bitmaps come from a per-editor
  // cache keyed by source bytes, so a re-assembly decodes only new or changed
  // assets (#413); `sources` lists the bytes this generation draws from.
  const [bitmaps] = useState(createBitmapCache);
  const [decodedAssets, setDecodedAssets] = useState<{
    m: MeasureFace; planAssets: PlanAssets; drawAssets: CanvasAssets; fontCss: string;
    sources: Uint8Array[];
  } | null>(null);
  // Guide movement changes placement immediately, without decoding image bytes again.
  const canvasAssets = useMemo(() => decodedAssets ? {
    ...decodedAssets, planAssets: { ...decodedAssets.planAssets, guides },
  } : null, [decodedAssets, guides]);
  const bgOn = pageOn("background"), maskOn = pageOn("mask");
  useEffect(() => {
    // Not gated on `blocked`: this only decodes fonts and art, and a rejected
    // value already falls back to the master's, so the preview keeps drawing (#127).
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const m = await loadLabelFaces(family, fontOverrides);
        // The cache owns every bitmap: a throw or a cancelled run leaves its
        // decodes there for the next committed generation (or unmount) to
        // keep or close. A cancelled run asks for nothing more, so it can't
        // add bitmaps after that settling already ran (#413).
        const sources: Uint8Array[] = [];
        const bitmap = (bytes: Uint8Array | undefined) => {
          if (!bytes || cancelled) return null;
          sources.push(bytes);
          return bitmaps.get(bytes);
        };
        const art = pageArt(true);
        // Raster bytes become a bitmap for the canvas to draw; an SVG
        // source stays undecoded (it plans as paths) and is absent here.
        const [customBitmaps, textureBmp, maskBmp] = await Promise.all([
          Promise.all(Object.entries(liveImages).map(async ([id, { image: img }]) =>
            [id, img.kind === "svg" ? null : await bitmap(img.bytes)] as const))
            .then((entries): Record<string, ImageBitmap | null> => Object.fromEntries(entries)),
          bitmap(art.texture?.bytes), bitmap(art.maskPng),
        ]);
        // The page art rides under its PAGE_ART_ID keys too, so a backend
        // that draws the `page` items by asset id finds the same bitmaps.
        if (textureBmp) customBitmaps[PAGE_ART_ID.background] = textureBmp;
        if (maskBmp) customBitmaps[PAGE_ART_ID.mask] = maskBmp;
        // Superseded: a newer run, a background tab or unmount settles the cache.
        if (cancelled) return;
        setDecodedAssets({
          m, planAssets: planAssetsOf(), drawAssets: { images: customBitmaps }, fontCss: labelFontCss(family), sources,
        });
        setBuildError("");
      })().catch((err) => {
        if (!cancelled) setBuildError(errMsg(err));
      });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
    // Asset inputs only — the layers reach this effect through the two
    // page-art switches (see the comment above); fontOverrides is the set of
    // layer font families, so picking a new one reloads its faces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture, mask, liveImages, family, fontOverrides, bgOn, maskOn, active]);
  // Once a generation is live, close the cached bitmaps it no longer draws
  // (bitmaps aren't GC'd on their own); unchanged assets keep theirs. No
  // generation (a background tab) or unmount closes them all.
  useEffect(() => { bitmaps.retain(decodedAssets?.sources ?? []); }, [bitmaps, decodedAssets]);
  useEffect(() => () => bitmaps.retain([]), [bitmaps]);

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

  /** The doc before the in-flight canvas drag or resize opened its undo
   *  step; null until a move actually patches something (a first move that
   *  snapped to zero opens nothing, so the next can't fold into the edit
   *  before it — #74). Every move is applied to this base, not to the last
   *  move's result, so an axis whose delta is back at 0 returns to where the
   *  drag began (#164). Escape undoes only a step that exists. */
  const gestureBase = useRef<Doc | null>(null);
  const gesturePatch = (entries: [string, DeepPartial<Layer>][]) => {
    const real = entries.filter(([, p]) => Object.keys(p).length);
    const opened = gestureBase.current;
    if (!opened && !real.length) return;
    if (edit((d) => patchLayers(opened ?? d, real), !!opened)) gestureBase.current ??= doc;
  };
  const cancelGesture = () => {
    if (gestureBase.current) mutating(undo)();
    gestureBase.current = null;
  };

  /** Drag-to-move. PreviewCompare reports the cumulative delta from the
   *  drag's start; the patch is moveBy against the layer AS IT WAS at the
   *  start (kept in a ref for the gesture), so every move replaces the last
   *  rather than stacking on it, and the whole drag is one undo step (see
   *  `gestureBase`). Horizontal snapping to the master's guides is moveBy's.
   *  When the grabbed layer is selected, every selected unlocked layer moves
   *  with it. */
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
    if (first) gestureBase.current = null;
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
      .map(({ layer }): [string, DeepPartial<Layer>] => [layer.id, moveBy(layer, sx.delta, sy.delta, moving)]);
    gesturePatch(entries);
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
   *  to reach for the arrow keys. One press is one undo step; a held key's
   *  auto-repeats (`held`) fold into the step its first press opened. */
  nudgeRef.current = (dx, dy, held) => {
    const moving = new Set(
      drawLayers.filter((l) => selected.includes(l.id) && !l.locked).map((l) => l.id));
    if (!moving.size) return;
    const entries = drawLayers.filter((l) => moving.has(l.id))
      .map((layer): [string, DeepPartial<Layer>] => [layer.id, moveBy(layer, dx, dy, moving)])
      .filter(([, p]) => Object.keys(p).length);
    if (entries.length) patchMany(entries, held);
  };

  /** Handle resize: like onDrag, the patch is resizeBy against the layer
   *  and box captured at the gesture's start, one undo step per gesture.
   *  Only the grabbed layer resizes, never the group. */
  const resizeBase = useRef<
    { layer: Layer; box: Box; lines: { x: SnapTarget[]; y: SnapTarget[] } } | null
  >(null);
  const onResize = (
    id: string, handle: ResizeHandle, dx: number, dy: number, uniform: boolean, first: boolean,
  ): SnapLines => {
    if (first) {
      gestureBase.current = null;
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
    gesturePatch([[id, p]]);
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

  /** The assets this tab holds right now, read by the unmount cleanup: a
   *  closed tab releases their thumbnails, or each one pins its file's bytes
   *  for the rest of the session (#85). useExport releases its export URLs.
   *  `alive` goes false with it, so a decode that lands after the tab closed
   *  commits nothing: React 19 still runs a setState updater on an unmounted
   *  component, and the updater is where the thumbnail is minted (#432). */
  const held = useRef({ texture, mask, customImages });
  held.current = { texture, mask, customImages };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const { texture, mask, customImages } = held.current;
      for (const a of [texture, mask, ...Object.values(customImages)]) if (a) URL.revokeObjectURL(a.previewUrl);
    };
  }, []);

  const downloadArt = () => void buildFull("art");
  const downloadMask = () => void buildFull("mask");
  const exportPdfs = () => void buildFull("both");

  /** The same save-identity pattern for the .master this document's master
   *  was last saved to or opened from — tagged with that master's id, since
   *  undo can swap the document's master without touching these refs. Read
   *  them only through saveTargetFor (#78). */
  const masterFileHandle = useRef<MasterSaveTarget<FileSystemFileHandle> | null>(null);
  const masterFilePath = useRef<MasterSaveTarget<string> | null>(null);
  const masterInput = useRef<HTMLInputElement>(null);

  /** Full-document replacement for Open: swap the whole Doc in (resetting
   *  history) and clear every asset slot — an open is a full restore.
   *  `masterPath` is the file the master was read from (ResolvedMaster.path);
   *  without one, Save Master binds to the library's path for the id. */
  function resetDocument(next: Doc, masterPath?: string) {
    resetDoc(next);
    pristineMaster.current = next.master;
    masterFileHandle.current = null;
    const bound = isTauri() ? masterPath ?? masterIndex()[next.master.id]?.path : undefined;
    masterFilePath.current = bound ? { id: next.master.id, target: bound } : null;
    clearSelection();
    swapLoaded(setTexture, null);
    swapLoaded(setMask, null);
    setCustomImages((old) => {
      for (const c of Object.values(old)) URL.revokeObjectURL(c.previewUrl);
      return {};
    });
  }

  /** This document as .label bytes: the v3 label plus its embedded art —
   *  what Save writes and what a crash-recovery snapshot keeps. The hint names
   *  this tab's own master file: another tab may have opened a different file
   *  with the same id since (#405). Saved to `labelPath`, it is written
   *  relative to that label, so a shared .label carries no absolute path
   *  (#428); a snapshot (no labelPath) stays on this machine and keeps it. */
  const packProject = (labelPath?: string) => {
    const masterHint = labelRelativeHint(
      saveTargetFor(masterFilePath.current, master.id) ?? masterIndex()[master.id]?.path, labelPath);
    return packLabel({ ...label, masterHint }, {
      texture: slotAsset(texture), mask: slotAsset(mask),
      customImages: imageBundle(customImages, Object.keys(liveImages)),
    });
  };

  /** What a completed Save means here: the document reads saved unless it
   *  changed during the write. */
  const onProjectSaved = () => {
    const current = savedAssetsRef.current;
    const unchanged = docRef.current === doc && current.texture === texture
      && current.mask === mask && current.customImages === customImages;
    setDirty(!unchanged);
    // A save inside an in-place text session moves the baseline its cancel
    // would restore: the reverted text no longer matches the file.
    beforeTextEdit.current = { dirty: true, edited: true };
    setLoadError("");
    // The close-tab caller must not close over edits made during this write.
    return unchanged;
  };
  const { filePath, bindPath, bindHandle, forgetProjectFile, saveProject } = useProjectSave({
    pack: packProject, exportBase, onSaved: onProjectSaved, setLoadError, startSaveBatch, saveBytes,
  });
  // masterUnsaved is templateMoved, NOT the Save Master `masterDirty` above:
  // label overrides ride in the .label, so ⌘S already saves them.
  useEffect(() => {
    onMeta({ title, dirty, edited, masterUnsaved: templateMoved, filePath });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, dirty, edited, templateMoved, filePath]);
  saveSlot.current = () => saveProject();
  if (masterSaveSlot) masterSaveSlot.current = () =>
    new Promise<boolean>((done) => setPendingSave({ as: false, done }));

  // Crash recovery (#394): while this tab holds unsaved work, keep a packed
  // .label of it a moment after each change; drop it once the work is saved.
  // Never dropped on unmount — a render crash unmounts too, and that is the
  // snapshot the next launch must find. The shell drops it on a tab close.
  const hasUnsaved = unsaved({ dirty, edited, masterUnsaved: templateMoved });
  useEffect(() => {
    if (!recoveryKey) return;
    if (!hasUnsaved) { void dropRecovery(recoveryKey); return; }
    const timer = setTimeout(() => {
      let bytes: Uint8Array;
      try { bytes = packProject(); } catch { return; } // over the size caps: nothing Save could write either
      void keepRecovery(recoveryKey, { name: exportBase + LABEL_EXT, bytes, savedAt: Date.now() });
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the snapshot reads this render's doc/assets
  }, [hasUnsaved, doc, texture, mask, customImages, recoveryKey]);

  /** The template assets a Save Master captures: the loaded texture/mask
   *  (the art being authored IS the template art) plus the bytes of every
   *  image asset the master names — its layers and every variant entry,
   *  including a variant's `{ asset }` patch on an existing layer
   *  (masterAssetIds). Label-only values stay label deltas. `m` is the
   *  master being WRITTEN (promotions applied), so a promoted image value's
   *  bytes ride along instead of leaving the file naming an asset it lacks.
   *  `missing` counts ids the store has no bytes for (a label whose zip lacked
   *  them); saveMaster notes those, since no save can carry them. */
  function masterAssetBundle(m: Master): { assets: MasterAssets; missing: number } {
    const ids = [...masterAssetIds(m)];
    return {
      assets: { texture: slotAsset(texture), mask: slotAsset(mask), customImages: imageBundle(customImages, ids) },
      missing: ids.filter((id) => !customImages[id]).length,
    };
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
    // A promotion re-validates through parseMaster; surface a rejection in the
    // header like the write failures below instead of an unhandled rejection
    // from the `void saveMaster(...)` caller (#92).
    let promoted: ReturnType<typeof applyPromotions>;
    try {
      promoted = applyPromotions(master, label, promote, version ?? undefined);
    } catch (err) {
      setLoadError(`Could not save master: ${errMsg(err)}`);
      return false;
    }
    const forked = as
      ? { ...promoted.master, id: newMasterId() }
      : promoted.master;
    const { assets, missing } = masterAssetBundle(forked);
    const suggested = machineName(forked.name) || "master";
    /** A fork takes its display name from the file it was saved as — without
     *  this the library would list two masters called "Lolev" and no way to
     *  tell them apart (there is no master-name field anywhere in the UI).
     *
     *  Only a name the user actually TYPED counts: accepting the suggested
     *  filename must not rename "Lolev" to its own slug, and that is also the
     *  common case, which keeps the original display name. */
    const titled = (file: string): Master => {
      const base = masterNameFromFile(file);
      return as && base && base !== suggested && base !== forked.name
        ? { ...forked, name: base } : forked;
    };
    /** Adopt `m` as the saved master: the document's, the library's, and the
     *  baseline the next review diffs against. A plain save with nothing
     *  promoted is a no-op edit and pushes no history entry.
     *
     *  A master edited during the write keeps that edit and gets the same
     *  promotions folded in, so the document still carries what the file
     *  now holds; a promotion whose layer or variant was deleted during the
     *  write is skipped (the deletion wins) rather than costing the others.
     *  A document that moved to another master (Open Master during the
     *  write) is left alone: baseline, save target and header note. */
    const commit = async (m: Master, where: string, ours: boolean, bytes?: Uint8Array) => {
      if (ours) edit((d) => {
        if (d.master.id !== master.id) return d;
        const rebased = d.master === master ? m : promote.reduce((acc, c) => {
          try { return applyPromotions(acc, label, [c], version ?? undefined).master; } catch { return acc; }
        }, d.master);
        const liveMaster = as ? { ...rebased, id: m.id, name: m.name } : rebased;
        // Keep newer label edits, including a newly changed promoted field.
        // Redundant overrides can be promoted again on the next master save.
        return { master: liveMaster, label: adoptMaster(d.label === label ? promoted.label : d.label, liveMaster) };
      });
      await rememberMaster(m, where, bytes);
      refreshLibrary();
      if (ours) pristineMaster.current = m;
      repaintMasterDirty((n) => n + 1);
    };
    try {
      startSaveBatch();
      const path = as ? null : saveTargetFor(masterFilePath.current, master.id);
      const handle = as ? null : saveTargetFor(masterFileHandle.current, master.id);
      const saved = await saveThrough((name) => packMaster(titled(name), assets), {
        name: suggested + MASTER_EXT, type: "application/zip", filter: MASTER_FILTER, types: MASTER_TYPES,
        target: path ? { path } : handle ? { handle } : null,
      }, saveBytes);
      if (!saved) return false;
      const ours = docRef.current.master.id === master.id;
      if (ours && saved.target && "path" in saved.target) masterFilePath.current = { id: forked.id, target: saved.target.path };
      else if (ours && saved.target && "handle" in saved.target) masterFileHandle.current = { id: forked.id, target: saved.target.handle };
      await commit(titled(saved.name), saved.name, ours, saved.bytes);
      if (ours) setLoadError(!missing ? ""
        : missing === 1 ? "Note: 1 image has no file to save — it will be blank when this master reopens"
        : `Note: ${missing} images have no file to save — they will be blank when this master reopens`);
      return true;
    } catch (err) {
      setLoadError(`Could not save master: ${errMsg(err)}`);
      return false;
    }
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
   *  and image bytes fill in only for ids the store doesn't hold (checked
   *  again as they commit, so an id filled meanwhile mints no thumbnail). */
  async function adoptMasterAssets(a: MasterAssets): Promise<void> {
    await Promise.all([
      !texture && a.texture ? onTexture(assetToFile(a.texture)) : null,
      !mask && a.mask ? onMask(assetToFile(a.mask)) : null,
      (async () => {
        const missing = Object.entries(a.customImages ?? {}).filter(([id]) => !customImages[id]);
        if (!missing.length) return;
        const entries = await Promise.all(missing.map(async ([id, x]) =>
          [id, await readPacked(x, readCustomImage)] as const));
        if (!alive.current) return;
        setCustomImages((prev) => ({
          ...Object.fromEntries(entries.filter(([id]) => !prev[id]).map(([id, mint]) => [id, mint()])), ...prev,
        }));
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
    const notes = benchedNotes(dropped);
    setLoadError(notes.length ? "Note: " + notes.join(" · ") : "");
  }

  /** File → Open Master…: register the newly opened master in the library
   *  index, then commitRebind onto it. */
  async function applyOpenedMaster(m: Master, path: string, bytes?: Uint8Array) {
    await rememberMaster(m, path, bytes);
    refreshLibrary();
    commitRebind(m);
  }

  /** Parsed bytes from any Open Master source (native path, FS-Access
   *  handle, hidden input): bind the source, register, rebind, adopt assets. */
  async function openMasterBytes(
    bytes: Uint8Array, name: string, src: { handle?: FileSystemFileHandle; path?: string },
  ) {
    const r = tryParseMaster(bytes);
    if (!r) return;
    await applyOpenedMaster(r.master, name, bytes);
    // Bind Save Master only once the doc is on this master (#81).
    const id = r.master.id;
    masterFileHandle.current = src.handle ? { id, target: src.handle } : null;
    masterFilePath.current = src.path ? { id, target: src.path } : null;
    await adoptMasterAssets(r.assets);
  }

  /** MasterPicker's library pick (the preview's Continue). The bytes are
   *  already in the master cache (the picker resolved them from disk or the
   *  cache), so only the index / last-applied record needs touching. */
  async function pickLibraryMaster(target: Master, assets: MasterAssets) {
    const path = masterIndex()[target.id]?.path ?? "";
    await rememberMaster(target, path);
    refreshLibrary();
    masterFileHandle.current = null;
    masterFilePath.current = isTauri() && path ? { id: target.id, target: path } : null;
    commitRebind(target);
    await adoptMasterAssets(assets);
  }

  /** MasterPicker's library listing: the shipped master plus every master
   *  the index remembers, id → name, file path and lastSeen (resolved
   *  lazily on pick).
   *  `inLibrary` is an index row, which is what Remove can drop. Re-read
   *  only on a libraryTick bump or when this tab comes to the front — see
   *  refreshLibrary. */
  const library = useMemo(() => {
    const idx = masterIndex();
    const entries: Record<string, LibraryEntry> = {
      // Always listed; the loop below replaces it when the index has a row.
      [SHIPPED_MASTER_ID]: { name: lolevMaster().name, builtIn: true },
    };
    for (const [id, e] of Object.entries(idx)) entries[id] = { ...entries[id], ...e, inLibrary: true };
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the inputs live in localStorage; libraryTick and active say when to re-read
  }, [libraryTick, active]);
  useEffect(() => {
    window.addEventListener("storage", refreshLibrary);
    return () => window.removeEventListener("storage", refreshLibrary);
  }, []);

  /** MasterPicker's resolve. A lookup can retire an index row whose file now
   *  holds another master, or whose file is gone with no remembered copy
   *  (#428), so the menu re-reads the library afterwards. */
  async function resolveLibraryMaster(id: string) {
    const r = await resolveMasterById(id);
    refreshLibrary();
    return r;
  }

  /** Drop a remembered master from the library. The open document and the
   *  file on disk stay as they are. Returns the picker's Undo, which puts the
   *  library row back and re-lists it. */
  async function forgetLibraryMaster(id: string) {
    const undo = await removeFromLibrary(id);
    refreshLibrary();
    return async () => { await undo(); refreshLibrary(); };
  }

  /** File → Open Master…: native dialog on desktop (a real path, so the
   *  next launch can re-read the file), FS-Access picker in the browser,
   *  hidden-input fallback elsewhere. */
  async function openMasterPicker() {
    try {
      const target = await openThrough({ filter: MASTER_FILTER, types: MASTER_TYPES });
      if (target === undefined) { masterInput.current?.click(); return; }
      if (target === null) return;
      if ("path" in target) await openMasterBytes(await readNativeFile(target.path), target.path, target);
      else {
        const file = await target.handle.getFile();
        await openMasterBytes(new Uint8Array(await file.arrayBuffer()), file.name, target);
      }
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
        refreshLibrary(); // a resolve can remember or retire library rows
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
        // The template images structureOnlyMaster kept need their bytes. Not
        // the texture or mask: those are the last beer's, stripped above.
        await adoptMasterAssets({ customImages: r.assets.customImages });
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

  /** A .label's master couldn't be resolved: ask the operator. "Use current"
   *  opens it on this tab's master (as last saved); "Locate…" registers a picked .master and
   *  opens on that. Either way openProject rebinds the label onto the result
   *  (values the master lacks are benched, not lost). null = cancelled. */
  async function missingMasterChoice(id: string, hint: string | undefined, labelPath?: string): Promise<ResolvedMaster | null> {
    // An untrusted hint was never read, so it must not read as a file that
    // was looked for and found missing. A label-relative hint is shown as
    // the full path it was looked for at.
    if (hint) hint = hintPath(hint, labelPath);
    const where = !hint ? "" : hintTrusted(hint, labelPath) ? ` (last seen at ${hint})` : ` (remembered at ${hint}, which was not read)`;
    const choice = await new Promise<"current" | "locate" | null>((choose) =>
      setMissingMaster({ id, where, current: docRef.current.master.name, choose }));
    setMissingMaster(null);
    // Read after the dialog: the tab may have switched masters meanwhile.
    const current = docRef.current.master;
    // Through this tab's own file: the library may name another file with the
    // same id (#405). That file is its own trust root (hintTrusted).
    if (choice === "current") {
      const own = saveTargetFor(masterFilePath.current, current.id) ?? undefined;
      return (await resolveMasterById(current.id, own, own)) ?? { master: current, assets: {} };
    }
    if (choice !== "locate") return null;
    // Failures are reported here, never thrown: openWithRetry would swallow
    // one on a quiet attempt and ask again with no explanation.
    let bytes: Uint8Array, path: string;
    try {
      const target = await openThrough({ filter: MASTER_FILTER, types: MASTER_TYPES });
      if (target === undefined) { setLoadError("Could not open master: this browser has no file picker. Use File → Open Master… first."); return null; }
      if (target === null) return null;
      [bytes, path] = "path" in target
        ? [await readNativeFile(target.path), target.path]
        : [new Uint8Array(await (await target.handle.getFile()).arrayBuffer()), ""];
    } catch (err) {
      if (!isAbort(err)) setLoadError(`Could not open master: ${errMsg(err)}`);
      return null;
    }
    const r = tryParseMaster(bytes);
    if (r) await rememberMaster(r.master, path, bytes, { applied: false });
    return r && { ...r, path: path || undefined };
  }

  /** Open a .label with quiet retries — shared by ALL entry points. The
   *  first read of a freshly saved, cloud-synced, or large just-downloaded
   *  file can fail while the OS materializes the bytes. */
  async function openWithRetry(getFile: () => Promise<LabelSource>): Promise<boolean> {
    const delays = [0, 300, 1200];
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      const quiet = i < delays.length - 1;
      try {
        const r = await openProject(await getFile(), { quiet });
        if (r !== false) return r === true; // "cancelled": the operator said no — don't ask again
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
  async function openProject(f: LabelSource, opts?: { quiet?: boolean }): Promise<boolean | "cancelled"> {
    try {
      const unpacked = unpackLabel(f.bytes);
      let notes: string[] = [];
      let masterAssets: MasterAssets = {};
      let masterPath: string | undefined;
      let benched = false;
      // Legacy fixed collab ZIP roles (collab-left/, collab-center/) stay
      // READABLE: each is minted an id in the per-id store and becomes the
      // matching image layer's fill value.
      const legacyAssets: Record<string, LabelAsset> = {};
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
        const hint = ref.masterHint;
        const resolved = await resolveLabelMaster(ref.masterId, hint, f.path)
          ?? await missingMasterChoice(ref.masterId, hint, f.path);
        refreshLibrary(); // resolving (or the missing-master prompt) can remember or retire library rows
        if (!resolved) return "cancelled";
        masterAssets = resolved.assets;
        masterPath = resolved.path;
        let l: LabelFile;
        if (unpacked.label) l = unpacked.label;
        else {
          const r = convertLabelV2(unpacked.v2!, resolved.master);
          l = r.label;
          notes = r.warnings;
        }
        // Bind to the master actually resolved — always, not only when the
        // id changed (the file was saved again under a new id): the label's
        // own master may since have dropped a layer or variant, and those
        // orphan ids are benched and reported instead of carried forever (#409).
        // Legacy collab roles are adopted first so they get the same check.
        // On its own master, a bench the FILE already carries (a collab
        // rebind) is not news on every open; checked against the file as
        // written, since convertLabelV2 benches a v2 label's orphans silently.
        const { label: bound, dropped } = rebindLabel(adoptLegacyCollab(l), undefined, resolved.master);
        const old = ref.masterId === resolved.master.id ? ref.dormant : undefined;
        const fresh = {
          values: dropped.values.filter((id) =>
            !old || !Object.hasOwn(old.values, id) || Object.hasOwn(ref.values, id)),
          variants: dropped.variants.filter((id) =>
            !old?.variants.includes(id) || ref.enabledVariants.includes(id)),
        };
        notes.push(...benchedNotes(fresh));
        // What was just benched is not in the file yet: Save stays live and a
        // close asks, so the cleaned label reaches disk.
        benched = fresh.values.length + fresh.variants.length > 0;
        next = { master: resolved.master, label: bound };
      }
      // Resolve untrusted overrides/values before installing the document or
      // decoding its assets; a malformed label must leave the old tab intact.
      // Resolving is not enough: the resolver tolerates layers the UI can't
      // draw (an unknown kind, a required field nulled), which would crash
      // the list or inspector past the open — so each resolved layer must
      // pass the master's own layer check (an off variant's raw diff rows
      // were checked by parseMaster already).
      for (const { layer, variant } of layerRows(next.master, next.label).rows) {
        if (variant && !variant.enabled) continue;
        try { validateLayer(structuredClone(layer), "label"); }
        catch (err) { throw new Error(errMsg(err).replace(/^Invalid master file: /, "invalid override: ")); }
      }
      // Label-delta rule: the label's own embedded role wins; a missing one
      // falls back to the master's template asset. Image bytes merge the
      // same way, per id (spread order: master first, label last).
      const t = unpacked.assets.texture ?? masterAssets.texture;
      const m = unpacked.assets.mask ?? masterAssets.mask;
      const ci = { ...masterAssets.customImages, ...unpacked.assets.customImages, ...legacyAssets };
      // Decode every asset before resetDocument: a failed decode must leave
      // the previous doc and its Save target (rebound by the caller only on
      // success) intact (#81). Decoding mints no thumbnail URL (the commit
      // below does), so a failure here, or a tab closed meanwhile, has none
      // to release (#432).
      const [tex, msk, images] = await Promise.all([
        t && readPacked(t, readRaster),
        m && readPacked(m, readRaster),
        Promise.all(Object.entries(ci).map(async ([id, a]) => [id, await readPacked(a, readCustomImage)] as const)),
      ]);
      if (!alive.current) return "cancelled"; // the tab closed: no retry
      resetDocument(next, masterPath);
      if (tex) swapLoaded(setTexture, tex);
      if (msk) swapLoaded(setMask, msk);
      if (images.length) setCustomImages(() => Object.fromEntries(images.map(([id, mint]) => [id, mint()])));
      setDirty(benched);
      setEdited(benched);
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
    const { path, handle, file, recovered } = fileToOpen;
    openChain.current = openChain.current.then(async () => {
      if (openedSeq.current !== mySeq) return; // a newer open superseded us
      try {
        if (path) {
          const name = await basename(path);
          if (await openWithRetry(async () => ({ name, bytes: await readNativeFile(path), path })))
            bindPath(path);
        } else if (handle) {
          if (await openWithRetry(async () => fileSource(await handle.getFile())))
            bindHandle(handle);
        } else if (file) {
          if (await openWithRetry(() => fileSource(file))) {
            forgetProjectFile();
            if (recovered) {
              // Still unsaved work: Save stays live, a close prompts, and the
              // snapshot moves to this tab's key before the old one goes —
              // a failed copy leaves it for the next launch to offer again.
              setDirty(true);
              setEdited(true);
              const bytes = new Uint8Array(await file.arrayBuffer());
              if (!recoveryKey || await keepRecovery(recoveryKey, { name: file.name, bytes, savedAt: Date.now() }))
                void dropRecovery(recovered);
            }
          }
        }
      } catch (err) {
        reportOpenError(err);
      } finally {
        onOpenSettled(mySeq);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileToOpen]);

  /** Every command the app exposes, once. The palette and AppMenu read this
   *  list, while the key listener dispatches off `key`. A ⌘ key here fires
   *  even inside a text field, so never bind one a field needs (A/C/V/X/Z). */
  const twoD = viewMode === "2d";
  // The PDF exports wait for the preview's render source; say why they are
  // greyed out until it lands. A failed build is not "rendering": its
  // reason is in the header, like the preview's own spinner gives way to it.
  const pdfNote = previewReady || buildError ? undefined : "rendering…";
  const removable = selected.some((id) => rowById.has(id));
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
      disabled: pdfExportBlocked, note: pdfNote, run: exportPdfs },
    { id: "export-art", label: "Export Artwork PDF", disabled: pdfExportBlocked, note: pdfNote, run: downloadArt },
    { id: "export-mask", label: "Export Mask PDF", disabled: pdfExportBlocked, note: pdfNote, run: downloadMask },
    { id: "export-psd", label: "Export PSDs", key: "e", mods: "⇧⌘",
      disabled: exportBlocked, run: () => void exportPsd() },
    { id: "export-psd-art", label: "Export Artwork PSD", disabled: exportBlocked, run: () => void exportPsd("art") },
    { id: "export-psd-mask", label: "Export Mask PSD", disabled: exportBlocked, run: () => void exportPsd("mask") },
    { id: "undo", label: "Undo", shortcut: "⌘Z", disabled: !canUndo, run: mutating(undo) },
    { id: "redo", label: "Redo", shortcut: "⇧⌘Z", disabled: !canRedo, run: mutating(redo) },
    { id: "variant-new", label: "New Variant", run: onNewVariant },
    { id: "layer-add-text", label: "Add Text Layer", run: () => onAddLayer("text") },
    { id: "layer-add-image", label: "Add Image Layer", run: () => onAddLayer("image") },
    { id: "layer-add-barcode", label: "Add Barcode Layer", run: () => onAddLayer("barcode") },
    { id: "layer-add-qr", label: "Add QR Layer", run: () => onAddLayer("qr") },
    // Delete/Backspace reach this through their own listener (see above),
    // which stands aside in text fields; the shortcut here is display-only.
    { id: "layer-remove", label: "Remove Layer", shortcut: "⌫", disabled: !removable,
      run: () => onRemoveLayer(selected[selected.length - 1]) },
    { id: "settings", label: "Settings…", run: () => setSettingsOpen(true) },
    { id: "view-label", label: "Preview: Label", key: "1", run: () => show2d("art") },
    { id: "view-mask", label: "Preview: Mask", key: "2", run: () => show2d("mask") },
    { id: "view-can", label: "Preview: Can", key: "3", run: () => setViewMode("can") },
    { id: "rulers", label: showRulers ? "Hide rulers" : "Show rulers", key: "r",
      disabled: !twoD, run: () => setShowRulers((shown) => !shown) },
    { id: "guides", label: showGuides ? "Hide guides" : "Show guides", key: "g",
      disabled: !twoD, run: () => setShowGuides((shown) => !shown) },
    // Zoom about the pane centre (the 3D views dolly their camera).
    { id: "zoom-in", label: "Zoom In", key: "=", mods: "⌘", run: () => zoomTo((z) => z * ZOOM_FACTOR) },
    { id: "zoom-out", label: "Zoom Out", key: "-", mods: "⌘", run: () => zoomTo((z) => z / ZOOM_FACTOR) },
    { id: "zoom-fit", label: "Zoom to Fit", key: "0", mods: "⌘", run: () => zoomTo(() => 1) },
  ];
  const index = Object.fromEntries(commands.map((c) => [c.id, c])) as Record<string, Command>;
  const byId = (id: string): Command => {
    const c = index[id];
    if (!c) throw new Error(`Unknown command: ${id}`);
    return c;
  };
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  /** The layer a fill field shows: a value the resolver rejected (errors[id])
   *  is shown as STORED, not as the master fallback the resolved layer
   *  carries — the field and the header error must name the same value. Both
   *  fill fields use it: the inspector's (#128/#129) and the on-canvas
   *  editor's (#171). */
  function shownLayer(resolved: Layer): Layer {
    const stored = label.values[resolved.id];
    return errors[resolved.id] && stored !== undefined
      ? withStoredValue(resolved, stored) : resolved;
  }

  /** The inspector's content slot for the selected layer: the rich text
   *  field (or number/code box) for text, the image well for images, the
   *  payload box for barcode/QR — each writing through setContent, so every
   *  layer's content belongs to this label. */
  function contentFor(resolved: Layer): React.ReactNode {
    const layer = shownLayer(resolved);
    const id = `${layer.id}-content`;
    if (layer.kind === "text") {
      return (
        <TextEditor id={id} label="Text" lines={layer.lines} base={layer.style}
          onChange={(lines) => setContent(layer, lines, id)}
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
          onFile={(f) => void onTexture(f)} onClear={() => clearLoaded(setTexture)} />;
      }
      if (layer.role === "mask") {
        return <FileDrop label="Metallic mask" accept={{ "image/png": [".png"], "image/webp": [".webp"] }}
          fileName={mask?.name} previewUrl={mask?.previewUrl}
          onFile={(f) => void onMask(f)} onClear={() => clearLoaded(setMask)} />;
      }
      if (layer.asset === "builtin:logo") return null;
      const file = customImages[layer.asset];
      return <FileDrop label="Image" accept={{ "image/svg+xml": [".svg"], "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] }}
        fileName={file?.name} previewUrl={file?.previewUrl}
        onFile={(f) => onLayerImage(layer, f).catch((err) => setBuildError(`Could not load image: ${errMsg(err)}`))}
        // In history (the well names ⌘Z): returns no undo of its own. Its own
        // step (coalesce false), so ⌘Z right after a fast drop-then-X brings
        // the art back instead of undoing the drop too.
        onClear={() => { setContent(layer, "", false); }} />;
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
      // what the picker shows. Handed to the Select as `items` too, so the
      // trigger shows an option's label rather than its raw value (#222).
      const sources = [{ value: "none", label: "nothing" }, ...rows.flatMap((r) =>
        r.layer.kind === "text" ? [{ value: r.layer.id, label: r.layer.name }] : [])];
      const src = link.id ?? "";
      // The link box types as one session keyed by its id; a suffix pick is
      // a discrete choice and gets a step of its own (false).
      const write = (prefix: string, ref: string, coalesce: Coalesce) =>
        setContent(layer, formatLink(prefix, ref), coalesce);
      return (
        <div className="space-y-1">
          <Label htmlFor={id} className="text-xs text-muted-foreground">Link</Label>
          <Input id={id} className="h-7 font-mono text-xs" value={link.prefix}
            placeholder="https://lolev.beer/beer/"
            aria-invalid={errors[layer.id] ? true : undefined}
            onChange={(e) => write(e.target.value, src, id)} />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">followed by</span>
            <Select items={sources} value={src || "none"} onValueChange={(v) => write(link.prefix, v === "none" ? "" : (v ?? ""), false)}>
              <SelectTrigger id={`${id}-src`} size="sm" aria-label="Link suffix"
                className="h-6 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
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
            onCommit={(v) => setContent(layer, v, id)} />
        ) : (
          <Input id={id} className="h-7 font-mono text-xs" value={template}
            placeholder={layer.kind === "qr" ? "https://lolev.beer/beer/{name|slug}" : "digits"}
            aria-invalid={errors[layer.id] ? true : undefined}
            onChange={(e) => setContent(layer, e.target.value, id)} />
        )}
        {foot}
      </div>
    );
  }

  // A build "Note:" (a cancelled export) is only a warning: a render error outranks it.
  const headerError = buildError && !(renderError && buildError.startsWith("Note: ")) ? buildError : renderError;

  return (
    <TooltipProvider>
      {/* Suspense around the Dialog, not inside it: the first open then
          mounts the dialog with its fields already there, so it opens
          focused on the first field rather than on Close. Only an open
          dialog renders its fields, so only an open one suspends. */}
      <Suspense fallback={<DialogLoading />}>
        <Dialog open={active && settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogTitle>Settings</DialogTitle>
            <RenderSettingsFields value={render} onChange={onRenderChange} />
          </DialogContent>
        </Dialog>
      </Suspense>
      <Dialog open={!!missingMaster} onOpenChange={(open) => !open && missingMaster?.choose(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>This label was made with a different master</DialogTitle>
            <DialogDescription>
              Master “{missingMaster?.id}”{missingMaster?.where} isn’t in your library.
              Open the label on “{missingMaster?.current}”, or locate its .master file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => missingMaster?.choose(null)}>Cancel</Button>
            <Button variant="outline" onClick={() => missingMaster?.choose("locate")}>Locate .master…</Button>
            <Button onClick={() => missingMaster?.choose("current")}>Use “{missingMaster?.current}”</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Gated on `active` like Settings and the inspector Sheet: a pending
          review stays with its tab (hidden while another tab is in front,
          back on return) so a confirm can only write the visible tab's master. */}
      {pendingSave && (
        <Suspense fallback={active ? <DialogLoading /> : null}>
          <MasterSaveReview open={active} as={pendingSave.as} changes={masterChangeList}
            target={master.variants.find((v) => v.id === version)?.name}
            onCancel={() => { pendingSave.done?.(false); setPendingSave(null); }}
            onConfirm={(promote) => {
              const { as, done } = pendingSave;
              setPendingSave(null);
              void saveMaster(as, promote).then((saved) => done?.(saved));
            }} />
        </Suspense>
      )}
      {/* Figma-style three-region shell: collapsible left Sidebar (Layers),
          preview center, inspector sheet right. */}
      <SidebarProvider hotkey={active} className="min-h-0 h-full">
        <Sidebar>
          {/* Click on empty sidebar space deselects. React bubbles a
              PORTALED menu's click (Add layer, the master picker) through
              here too, so only a target really inside the sidebar counts. */}
          <SidebarContent onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && event.currentTarget.contains(target) && !target.closest('[data-layer-id], button, a, input, [role="button"], [role="combobox"], [contenteditable="true"]')) clearSelection();
          }}>
            {/* The master picker, then the ONE Layers list (spec: UI). */}
            <MasterPicker master={master} label={label}
              library={library} resolve={resolveLibraryMaster}
              onMaster={pickLibraryMaster} onNewVariant={onNewVariant}
              onRenameVersion={onRenameVersion} onRemoveVersion={onRemoveVersion}
              onSaveMaster={() => setPendingSave({ as: false })} masterDirty={masterDirty}
              onForget={forgetLibraryMaster}
              version={version} onVersion={switchVersion} />
            <LayerList rows={rows} selected={selected}
              onSelect={pick}
              onToggle={(id, prop, value) => patch(id, { [prop]: value })}
              onRename={(id, name) => patch(id, { name })}
              onReorder={(id, delta) => editMaster((m) => moveLayers(m, gestureIds(selected, id), id, delta))}
              onAdd={onAddLayer} onRemove={onRemoveLayer} invalid={errorIds}
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
          {blocked && (
            <HeaderAlert tone="blocked">
              <button type="button" data-blocked-export
                className="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Export is blocked. Click to select the invalid layer."
                onClick={() => { const id = Object.keys(errors)[0]; setSelection({ ids: [id], anchor: id }); }}>
                {blockedWhy}
              </button>
            </HeaderAlert>
          )}
          {loadError && <HeaderAlert tone={loadError.startsWith("Note: ") ? "warning" : "destructive"}>{loadError}</HeaderAlert>}
          {headerError && <HeaderAlert tone={headerError.startsWith("Note: ") ? "warning" : "destructive"}>{headerError}</HeaderAlert>}
          {/* An error in the header replaces the export confirmation. */}
          {exportNote && !headerError && <HeaderAlert tone="success">{exportNote}</HeaderAlert>}
          {/* The success note's announcement, from a region that exists
              before the note lands (see HeaderAlert's success tone). It
              keeps the note while an error hides it, so a render error
              clearing doesn't refill it and re-announce a stale "Saved …". */}
          <span role="status" data-export-saved className="sr-only">{exportNote}</span>
          {/* The blocked-export reason's announcement, mounted before the
              label is blocked for the same reason. */}
          <span role="status" data-export-blocked-status className="sr-only">
            {blocked ? `Export blocked: ${blockedWhy}` : ""}
          </span>
          {resolveWarnings.length > 0 && <HeaderAlert tone="warning">{resolveWarnings.join(" · ")}</HeaderAlert>}
          {/* Open Master's fallback — see masterInput/openMasterPicker. */}
          <input ref={masterInput} type="file" accept={MASTER_EXT} hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              void f.arrayBuffer().then((buf) => openMasterBytes(new Uint8Array(buf), f.name, {}))
                .catch((err) => setLoadError(`Could not open master: ${errMsg(err)}`));
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
            // against. Width must match SheetContent's data-[side=right]:w-[300px] below.
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
                && !t.closest('[data-slot="label-sheet"], [data-guide-control]')) clearSelection();
            }}
            onPointerDown={onPanStart}
            onPointerMove={onPanMove}
            onPointerUp={onPanEnd}
            onPointerCancel={onPanEnd}>
            <div
              className={cn("flex min-h-0 min-w-0 flex-1 transition-[filter,opacity] duration-200",
                exporting && "blur-sm opacity-70")}>
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
              editLayerOf={shownLayer}
              selected={selected}
              onPick={pick}
              // Live per-keystroke updates so the canvas render IS the edit
              // feedback, folded into one undo step per session.
              onEditUppercase={(id, uppercase, first) => patch(id, { style: { uppercase } }, !first)}
              onEditText={(id, lines, first) => {
                const layer = drawLayers.find((l) => l.id === id);
                if (layer) setContent(layer, lines, !first);
              }}
              onEditCancel={() => { undo(); setDirty(beforeTextEdit.current.dirty); setEdited(beforeTextEdit.current.edited); }}
              onDrag={onDrag}
              onResize={onResize}
              onDragCancel={cancelGesture}
              onEditSession={onEditSession}
              onSplit={setSplit}
              bleed={showGuides}
              cornerRadiusPct={render.cornerRadius}
              zoom={zoom.z}
              onRenderError={setRenderError} />
            </div>
            {active && viewMode !== "2d" && (
              <Suspense fallback={null}>
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
              </Suspense>
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
            {/* Always mounted, so a screen reader announces the note when
                an export fills it: a live region that mounts already holding
                its text is not announced. Shown whether or not the preview
                is ready — PSD export doesn't wait for it. */}
            <span role="status" data-export-status className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              {exporting && <>
                <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
                {exporting === "pdf" ? "Building PDFs…" : "Building PSDs…"}
              </>}
            </span>
            {!texture && !exporting && previewReady && (
              <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center">
                <span className="rounded-full border border-dashed border-border bg-background/85 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
                  drop a texture anywhere to fill the background
                </span>
              </div>
            )}
            {!previewReady && !exporting && !buildError && !renderError && (
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
              title="PSD raster resolution and pixel-ruler scale">
              {render.dpi} DPI
            </span>
            <span className="mx-2 h-3.5 w-px shrink-0 bg-border" />
            {/* The aria-label starts with the visible text (label-in-name) and
                adds what a click does; keys 1–3 jump straight to a view. */}
            <button
              onClick={() => byId(nextView.id).run()}
              title="Current preview view — click for the next (View menu, keys 1–3)"
              aria-label={`View Mode: ${viewLabel} — switch to ${nextView.label}`}
              aria-keyshortcuts="1 2 3"
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
            while a layer is selected, closed (Esc or a click on the empty pasteboard) by
            clearing it. Non-modal and overlay-free so the preview and the
            Layers list stay clickable while inspecting. active gate: the
            sheet portals to document.body, escaping the shell's display:none. */}
        <Sheet open={active && !!inspected} modal={false}
          // Only a deliberate close clears the selection — the sheet has no
          // backdrop, so every click in the list or on the canvas reports as
          // "outside-press", and honouring it wiped ⇧/⌘ selections.
          // Escape is deliberate only when nothing else claimed it: Base UI
          // listens on the document and ignores defaultPrevented, so Escape
          // that cancels a field's draft/suggestions, an on-canvas text edit
          // or a canvas drag would otherwise also close this and deselect.
          onOpenChange={(open, details) => {
            if (open) return;
            if (details.reason === "escape-key") {
              if (details.event.defaultPrevented || isTypingTarget(details.event.target)) details.cancel();
              else clearSelection();
            } else if (details.reason === "close-press") clearSelection();
          }}>
          <SheetContent side="right" showOverlay={false} showCloseButton={false}
            // Opening follows a selection, so focus stays where the user
            // selected: Base UI's default would land in the rename box and
            // turn Backspace/arrows into text edits instead of delete/nudge.
            initialFocus={false}
            finalFocus={(closeType) => closeType === "keyboard"}
            // Sized on the base's own `data-[side=right]:` variant so
            // tailwind-merge REPLACES its w-3/4 and sm:max-w-sm (24rem, 312px
            // at the 13px root); an unprefixed w-[300px] lost to both on
            // specificity and left the sheet at 75% below 640px (#132).
            className="gap-0 overflow-y-auto border-l-0! bg-sidebar p-0 data-[side=right]:w-[300px] data-[side=right]:sm:max-w-none">
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
                rasterArt={inspected.layer.kind === "image"
                  && (customImages[inspected.layer.asset]?.image.kind ?? "svg") !== "svg"}
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
