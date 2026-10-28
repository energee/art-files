// PreviewCompare.tsx — the single preview: both plates painted straight from
// the v3 display list (planLayers) by the canvas backend and stacked; a
// resizable divider reveals the white-ink layer (left side) over the art
// (right side). Click selects the layer under the cursor (hittestLayers);
// double-clicking a text layer edits it IN PLACE over the artwork — the
// same rich-lines field the sidebar uses (TextEditor's useTextField), sized
// to the drawn glyphs, a pill toolbar floating above it, or a plain box for
// a number/code layer — applying live, one undo step per session. Pointer-
// down on an unlocked layer arms a two-axis drag that reports cumulative
// deltas; App turns them into the layer's position patch (moveBy) and folds
// the drag into one undo step the same way.
//
// The overlay geometry (page-space boxes, trim guide, selection ticks) lives
// in previewOverlay.ts and the rich-text in-place session in
// InPlaceRichField.tsx (#433); this file owns the plates, hit-testing and the
// pointer gestures.
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { drawPlate, type CanvasRenderSource } from "@/canvas/draw";
import { planLayerScene } from "@/planLayers";
import { hitBoxesFromLayout, hitTestBoxes, type LayerBox } from "@/hittestLayers";
import type { ResizeHandle } from "@/model/edit";
import type { Layer, TextLine } from "@/model/layers";
import {
  ART, BLEED_SHIFT, PAGE, PREVIEW_MAX_W, PREVIEW_RASTER_MAX_EDGE, previewRasterScale,
} from "@/layout";
import { labelFontCss } from "@/fonts";
import { modsOf, type SelectMods } from "@/selection";
import { errMsg } from "@/lib/utils";
import {
  BLEED, BLEED_STROKE, cornerRadius, dieRadius, GROUP_PAD, HANDLES, inches, pageBox,
  SEL_PAD,
} from "./previewOverlay";
import { InPlaceRichField } from "./InPlaceRichField";
import { InPlacePlainField } from "./InPlacePlainField";

/** The plates worth painting: the art always (it is the base the mask sits
 *  over), the mask only once the divider reveals any of it (split > 0) — at
 *  split 0 it is fully clipped, so painting it would double the per-keystroke
 *  raster work for nothing (#395). */
export const platesToPaint = (maskShown: boolean): ("art" | "mask")[] =>
  maskShown ? ["art", "mask"] : ["art"];

/** Pointer travel (px) before a press becomes a drag; below it is a click. */
const DRAG_THRESHOLD_PX = 3;


/** Drag snap distance to a guide or another layer's edge/middle, in label points. */
export const SNAP_PT = 6;

/** Blue for a page guide (the master's margins/centre, or a manual one),
 *  fuchsia for another layer's edge or middle — the Photoshop/Sketch
 *  convention, and the only way to tell at a glance WHICH kind of alignment
 *  the drag caught. App classifies the line (SnapMark.guide); comparing
 *  coordinates here could not tell a manual guide from a layer edge, nor an
 *  X guide's value landing on a Y line. */
const snapColor = (mark: SnapMark) => (mark.guide ? "bg-info" : "bg-primary");

/** A snap that happened: the line (guide space), how far the indicator
 *  segment runs along it — from the moving box to the far end of what it
 *  lined up with — and whether a page guide, rather than another layer's
 *  edge, is the only thing that offered it. */
export interface SnapMark { at: number; from: number; to: number; guide: boolean }

export interface SnapLines {
  x: SnapMark | null; y: SnapMark | null;
  /** The distance the drag ACTUALLY travelled after snapping, in label
   *  points — what the drag readout shows. */
  dx: number; dy: number;
}


/** Wheel/pinch events arrive every frame. Keep the CSS transform immediate,
 *  then replace its backing bitmap once the gesture pauses. */
const RASTER_DEBOUNCE_MS = 160;

export interface PreviewCompareHandle {
  showArt: () => void;
  showMask: () => void;
  /** The exact page box rulers measure; its client rect includes App's CSS transform. */
  getPageElement: () => HTMLDivElement | null;
}

export const PreviewCompare = forwardRef<
  PreviewCompareHandle,
  {
    /** The render source: fonts + decoded bitmaps for drawPlate. Null means
     *  "not ready yet / a 3D view is up" — the canvases keep their last
     *  frame, and hit-testing is skipped rather than guessed. */
    canvasRender: CanvasRenderSource | null;
    /** The resolved layers that draw (enabled, values applied), in draw
     *  order — what the display list, the hit boxes and the drag targets are
     *  all computed from, so they cannot disagree. */
    layers: Layer[];
    /** Maps a resolved layer to the one the in-place editor opens on (App:
     *  its stored value, if the resolver rejected it — see shownLayer). */
    editLayerOf: (layer: Layer) => Layer;
    /** Which layers the list (or previous clicks here) have selected — one
     *  outline is drawn per id. */
    selected: readonly string[];
    /** Called with the clicked layer's id (null for empty background) and
     *  the click's modifiers, so shift/⌘ on the canvas extend the selection
     *  exactly as they do in the Layers list. */
    onPick: (id: string | null, mods: SelectMods) => void;
    /** Called on every keystroke of an in-place session with the layer's
     *  new lines. `first` is true on the session's opening keystroke; App
     *  uses it to fold the whole session into one undo step. */
    onEditText: (id: string, lines: TextLine[], first: boolean) => void;
    /** An in-place session that changed something ended WITHOUT Escape —
     *  Enter, click-away, or the preview going away. Called once, after the
     *  last onEditText; App learns the final value into the layer's choices
     *  here, never per keystroke (the sidebar picker's commit rule). */
    onEditCommit: (id: string) => void;
    onEditUppercase: (id: string, uppercase: boolean, first: boolean) => void;
    /** Escape mid-session: App undoes the session's single step. Never
     *  called when nothing was typed. */
    onEditCancel: () => void;
    /** Drag-to-move: called on every pointermove past the 3px threshold with
     *  the CUMULATIVE delta from the drag's start, in label points, `first`
     *  true on the movement that crosses the threshold — App applies moveBy
     *  against the layer as it was at the start (and every other selected
     *  layer, if `id` is selected) and folds the drag into one undo step.
     *  Returns the lines the drag snapped to, which drive
     *  the highlights here. */
    onDrag: (id: string, dx: number, dy: number, first: boolean) => SnapLines;
    /** Escape mid-drag or mid-resize: App undoes the gesture's single step,
     *  if it opened one. Never called when the drag never crossed the
     *  threshold (a plain click). */
    onDragCancel: () => void;
    /** Corner-handle resize, same session contract as onDrag: cumulative
     *  page-space pointer deltas and the grabbed handle, `uniform` while shift is held, `first` on the
     *  movement that opens the undo step. App applies resizeBy, and reports
     *  back what the grabbed edge snapped to (same contract as onDrag). */
    onResize: (id: string, handle: ResizeHandle, dx: number, dy: number, uniform: boolean, first: boolean) => SnapLines;
    /** The layer currently being edited on the preview, null when idle.
     *  planLayers skips it (the render source's skip set) so the editor's
     *  live DOM text is the layer. */
    onEditSession: (id: string | null) => void;
    /** Divider position as % of width showing white-ink, on every change. */
    onSplit?: (pct: number) => void;
    /** Draw the trim guide at the edge of the art box. One of the overlays
     *  App's Guides toggle switches together with the ruler guides. */
    bleed?: boolean;
    /** Die-cut corner radius, % of the label's short side. */
    cornerRadiusPct: number;
    /** Current CSS zoom. Rasterization follows it after a short debounce. */
    zoom: number;
    /** Repaint trigger only: the paint effect reads geometry from the live
     *  PAGE, which App's render already updated via setLayoutBleed. */
    bleedIn: number;
    /** A failed frame, for App's error strip; "" on the next good frame. */
    onRenderError?: (message: string) => void;
  }
>(function PreviewCompare(
  {
    canvasRender, layers, editLayerOf, selected, onPick, onEditText, onEditCommit, onEditUppercase, onEditCancel, onDrag,
    onDragCancel, onResize, onEditSession, onSplit, bleed, cornerRadiusPct, zoom, bleedIn, onRenderError,
  },
  ref,
) {
  const dieR = dieRadius(cornerRadiusPct);
  const artCanvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);
  const pageElement = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(0); // % width showing white-ink
  const changeSplit = useCallback((value: number) => {
    const next = Math.max(0, Math.min(100, value));
    setSplit(next); onSplit?.(next);
  }, [onSplit]);
  // Repaint trigger: a boolean, so dragging the divider repaints only when
  // the mask plate is first revealed (or hidden again), not per pixel.
  const maskShown = split > 0;
  const [rasterScale, setRasterScale] = useState(() =>
    previewRasterScale(zoom, window.devicePixelRatio));

  useEffect(() => {
    // Follows the zoom in both directions — the settled density is paid again
    // on every repaint (which is per keystroke), so it has to come back down.
    const timeout = window.setTimeout(
      () => setRasterScale(previewRasterScale(zoom, window.devicePixelRatio)),
      RASTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [zoom]);

  useImperativeHandle(ref, () => ({
    showArt: () => changeSplit(0),
    showMask: () => changeSplit(100),
    getPageElement: () => pageElement.current,
  }), [changeSplit]);

  // The display list and boxes, measured once per layers/source change. A throw here
  // (a bad binding, an unparsable payload) is caught by the paint effect
  // below, so the last frame stays up.
  const plan = useMemo<ReturnType<typeof planLayerScene> | Error | null>(() => {
    if (!canvasRender) return null;
    try {
      return planLayerScene(layers, canvasRender.m, canvasRender.planAssets, { skip: canvasRender.skip });
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  }, [layers, canvasRender]);

  const hitBoxes = useMemo(() => plan && !(plan instanceof Error)
    ? hitBoxesFromLayout(layers, plan.boxes) : [], [layers, plan]);
  const boxesById = useMemo(() => new Map(hitBoxes.map((b) => [b.id, b])), [hitBoxes]);

  // The one render path: repaint the visible plates (platesToPaint) straight from the display list
  // on every change, on a rAF so a burst of keystrokes coalesces into one
  // paint per frame. null canvasRender (assets still assembling, or a 3D
  // view is up) paints nothing and the canvases keep their last frame.
  useEffect(() => {
    if (!canvasRender || !plan) return;
    const raf = requestAnimationFrame(() => {
      try {
        if (plan instanceof Error) throw plan;
        // Long-edge guard: rasterScale alone would let a user-expanded bleed
        // grow the backing store past PREVIEW_RASTER_MAX_EDGE. PAGE.w and
        // PAGE.h both move linearly with BLEED, so their ratio (and so the
        // derived edge) never depends on which one triggered the cap.
        const rawW = PAGE.w * rasterScale, rawH = PAGE.h * rasterScale;
        const cap = Math.min(1, PREVIEW_RASTER_MAX_EDGE / Math.max(rawW, rawH));
        for (const mode of platesToPaint(maskShown)) {
          const canvas = mode === "art" ? artCanvas.current : maskCanvas.current;
          if (!canvas) continue;
          const w = Math.round(rawW * cap);
          const h = Math.round(rawH * cap);
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          drawPlate(canvas.getContext("2d")!, plan.items, canvasRender.drawAssets, mode, canvasRender.fontCss);
        }
        onRenderError?.("");
      } catch (err) {
        // Routed to App's error strip; the canvases keep whatever frame
        // last painted successfully.
        onRenderError?.(errMsg(err));
      }
    });
    return () => cancelAnimationFrame(raf);
    // onRenderError is a useState setter in App — identity-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRender, plan, rasterScale, bleedIn, maskShown]);

  // Click-to-select: the canvases fill the wrapper exactly and the wrapper's
  // aspect ratio is locked to PAGE.w/PAGE.h, so a click maps to label-space
  // points proportionally off the bounding rect.
  function pagePointOf(
    e: { clientX: number; clientY: number; currentTarget: HTMLDivElement },
  ): { xPt: number; yPt: number } | undefined {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return undefined; // not laid out yet (e.g. display:none)
    return {
      xPt: ((e.clientX - r.left) / r.width) * PAGE.w,
      yPt: ((e.clientY - r.top) / r.height) * PAGE.h,
    };
  }

  // Which layer under the event, or null — undefined means "can't tell":
  // source not assembled, not laid out, or the click was really the divider.
  function hitOf(e: React.MouseEvent<HTMLDivElement>): string | null | undefined {
    if (!canvasRender) return undefined;
    // The handle tracks the pointer while dragging, so at drag-end the
    // synthesized click still lands over it; ignore anything whose target
    // is the handle so finishing a drag can't change the selection.
    if (e.target instanceof Element && e.target.closest('[data-slot="resizable-handle"]')) return undefined;
    const p = pagePointOf(e);
    if (!p) return undefined;
    return hitTestBoxes(p.xPt, p.yPt, hitBoxes);
  }

  // A finished drag still fires a click at pointerup; swallow it so moving a
  // multi-selection can't collapse the selection to the grabbed layer.
  // (LayerList's suppressClick is the same guard for row reorders.)
  const swallowClick = useRef(false);
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (swallowClick.current) { swallowClick.current = false; return; }
    const id = hitOf(e);
    if (id !== undefined) onPick(id, modsOf(e));
  }

  // Inline text editing: double-click a text layer to edit it IN PLACE over
  // the artwork. Every keystroke goes straight to the document (see
  // onEditText's doc), so the drawn render is the live feedback.
  const [editing, setEditing] = useState<string | null>(null);
  // The pill toolbar position (viewport px, captured at open).
  const [toolbarPos, setToolbarPos] = useState({ left: 8, top: 8 });
  // The open session's click-away boundary.
  const sessionRef = useRef<HTMLDivElement>(null);
  // The pill portals to <body>, so click-away must ask it separately.
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Whether this session has applied any keystroke yet — the first one opens
  // the undo step, and Escape has nothing to undo before it.
  const edited = useRef(false);

  // Drag-to-move: pointerdown on an unlocked layer arms a two-axis drag;
  // crossing a 3px threshold starts the gesture (first=true); App folds every
  // move into ONE undo step.
  const drag = useRef<{
    id: string; startClientX: number; startClientY: number;
    pxPerPtX: number; pxPerPtY: number; started: boolean;
  } | null>(null);

  // Which lines (if any) the in-flight drag has snapped to, purely to drive
  // the highlights below — the drag math itself is App's (snapDelta/moveBy),
  // which reports back what it landed on.
  const [snap, setSnap] = useState<SnapLines>({ x: null, y: null, dx: 0, dy: 0 });

  // The live measurement badge: the layer it hangs off, and the distance
  // travelled (a move) or nothing (a resize, which reads its size off the
  // box the patch just produced). Null when no gesture is running.
  const [readout, setReadout] = useState<{ id: string; moved: { dx: number; dy: number } | null } | null>(null);

  /** Label points per CSS pixel for the page element, captured once per
   *  gesture (the wrapper's aspect ratio is locked to the page). */
  const pageScale = () => {
    const r = pageElement.current!.getBoundingClientRect();
    return { pxPerPtX: r.width / PAGE.w, pxPerPtY: r.height / PAGE.h };
  };

  // Drag-to-resize from any selection tick. Its own pointer session
  // (capture on the tick) so it never competes with the move drag on the
  // wrapper; the wrapper's move never starts because the tick stops
  // pointerdown propagation.
  const resize = useRef<{
    id: string; handle: ResizeHandle; startClientX: number; startClientY: number;
    pxPerPtX: number; pxPerPtY: number; started: boolean;
  } | null>(null);
  function onHandleDown(e: React.PointerEvent<HTMLSpanElement>, id: string, handle: ResizeHandle) {
    if (e.button !== 0 || editing || boxesById.get(id)?.locked) return;
    e.stopPropagation();
    resize.current = { id, handle, startClientX: e.clientX, startClientY: e.clientY, ...pageScale(), started: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onHandleMove(e: React.PointerEvent<HTMLSpanElement>) {
    const d = resize.current;
    if (!d) return;
    const dxPx = e.clientX - d.startClientX;
    const dyPx = e.clientY - d.startClientY;
    if (!d.started && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;
    const first = !d.started;
    d.started = true;
    setSnap(onResize(d.id, d.handle, dxPx / d.pxPerPtX, dyPx / d.pxPerPtY, e.shiftKey, first));
    setReadout({ id: d.id, moved: null }); // a resize reads its own W x H below
  }
  function onHandleUp(e: React.PointerEvent<HTMLSpanElement>) {
    // A pointercancel fires no click, so only a real pointerup arms the swallow.
    if (e.type === "pointerup") swallowClick.current ||= !!resize.current?.started;
    resize.current = null;
    setSnap({ x: null, y: null, dx: 0, dy: 0 }); setReadout(null);
    e.stopPropagation();
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || editing || !canvasRender) return;
    const id = hitOf(e);
    if (!id) return;
    const target = boxesById.get(id);
    if (!target || target.locked) return; // locked, or draws nothing
    drag.current = {
      id, startClientX: e.clientX, startClientY: e.clientY,
      ...pageScale(), started: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dxPx = e.clientX - d.startClientX;
    const dyPx = e.clientY - d.startClientY;
    if (!d.started && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return; // plain click, no undo step
    const first = !d.started;
    d.started = true;
    const dx = dxPx / d.pxPerPtX;
    const dy = dyPx / d.pxPerPtY;
    const snapped = onDrag(d.id, dx, dy, first);
    setSnap(snapped);
    setReadout({ id: d.id, moved: { dx: snapped.dx, dy: snapped.dy } });
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    // A pointercancel fires no click, so only a real pointerup arms the swallow.
    if (e.type === "pointerup") swallowClick.current ||= !!drag.current?.started;
    drag.current = null; setSnap({ x: null, y: null, dx: 0, dy: 0 }); setReadout(null);
  }

  // Escape mid-drag: undo the single step the drag opened (if any) and drop the
  // in-flight session so a further pointermove can't resume it. Capture
  // phase + preventDefault marks the Escape as spent before the inspector
  // Sheet's document listener sees it, so cancelling a drag doesn't also
  // close the inspector and deselect (App's Sheet onOpenChange, #117).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (drag.current?.started || resize.current?.started) {
        e.preventDefault();
        swallowClick.current = true;
        onDragCancel();
      }
      drag.current = null; resize.current = null;
      setSnap({ x: null, y: null, dx: 0, dy: 0 }); setReadout(null);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onDragCancel]);

  useEffect(() => { if (!canvasRender) setEditing(null); }, [canvasRender]);

  // Report the open session so App can skip the layer from the render for
  // its duration, and COMMIT the one that just ended if it changed anything
  // (Escape clears `edited`, so a cancel commits nothing). One effect covers
  // every open/close path.
  const openSession = useRef<string | null>(null);
  useEffect(() => {
    const ended = openSession.current;
    openSession.current = editing;
    if (ended && ended !== editing && edited.current) onEditCommit(ended);
    onEditSession(editing);
    // onEditSession is a useState setter in App — identity-stable; this
    // render's onEditCommit already sees the session's last keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Click-away ends the session (capture phase, so it beats stopPropagation
  // anywhere in the app). The pill portals outside this component's DOM
  // tree, so "inside the session" must be asked of that node itself.
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: PointerEvent) => {
      if (
        e.target instanceof Node
        && !sessionRef.current?.contains(e.target)
        && !toolbarRef.current?.contains(e.target)
      ) setEditing(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editing]);

  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const id = hitOf(e);
    const layer = id ? layers.find((l) => l.id === id) : undefined;
    if (!id || !layer || layer.kind !== "text" || !canvasRender) return;
    if (!layer.input && !layer.choices?.length) {
      // Anchor the pill over the layer's box, mapped page → viewport px off
      // the same rect the click math uses. Captured once, because the pill
      // portals to <body>: App's CSS zoom can't scale it there.
      const b = boxesById.get(id);
      if (!b) return;
      const r = e.currentTarget.getBoundingClientRect();
      const boxLeft = r.left + (b.x / PAGE.w) * r.width;
      const boxTop = r.top + (b.y / PAGE.h) * r.height;
      // ponytail: fixed clamp for four toggles; measure if the toolbar grows.
      setToolbarPos({
        left: Math.max(8, Math.min(boxLeft, window.innerWidth - 188)),
        top: Math.max(8, boxTop - 48),
      });
    }
    edited.current = false;
    setEditing(id);
  }

  // Selection changes reuse the scene's boxes; they never remeasure text or codes.
  const boxes = useMemo(
    () => [...new Set(editing ? [...selected, editing] : selected)]
      .map((id) => boxesById.get(id)).filter((b): b is LayerBox => !!b),
    [selected, editing, boxesById],
  );
  const selBoxes = useMemo(
    () => boxes.filter((b) => selected.includes(b.id)),
    [boxes, selected],
  );
  // A multi-selection's union box: the dashed group frame below, so a group
  // drag reads as one thing moving rather than several outlines drifting.
  const groupBox = useMemo(() => {
    if (selBoxes.length < 2) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of selBoxes) {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, [selBoxes]);
  const editBox = useMemo(
    () => boxes.find((b) => b.id === editing) ?? null,
    [boxes, editing],
  );
  const found = editing ? layers.find((l) => l.id === editing) : undefined;
  const editLayer = found && editLayerOf(found);
  return (
    <div
      ref={pageElement}
      // The pasteboard around this sheet belongs to the pane, not to us: the
      // pane's own click handler deselects when a click misses this box.
      data-slot="label-sheet"
      className="relative m-auto w-full overflow-hidden border border-border bg-input"
      style={{
        // Width cap in the style object, not the class list, so the 3D scene
        // can import the same number and frame its label to this sheet.
        maxWidth: PREVIEW_MAX_W,
        aspectRatio: `${PAGE.w} / ${PAGE.h}`,
        // Query container, so the in-place editor can size its invisible
        // glyphs as a share of the page height (cqh) at any zoom.
        containerType: "size",
        ...cornerRadius(dieR + BLEED, PAGE.w, PAGE.h),
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={artCanvas} className="absolute inset-0 h-full w-full" />
      <canvas
        ref={maskCanvas}
        className="absolute inset-0 h-full w-full"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      />
      <div role="separator" tabIndex={0} aria-label="White ink comparison"
        aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split)}
        data-slot="resizable-handle"
        className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline focus-visible:outline-ring"
        style={{ left: `${split}%` }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          e.stopPropagation();
          const box = pageElement.current!.getBoundingClientRect();
          if (box.width) changeSplit((e.clientX - box.left) / box.width * 100);
        }}
        onPointerUp={(e) => { e.stopPropagation(); e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={(e) => { e.stopPropagation(); e.currentTarget.releasePointerCapture(e.pointerId); }}
        onKeyDown={(e) => {
          const value = e.key === "Home" ? 0 : e.key === "End" ? 100
            : e.key === "ArrowLeft" ? split - (e.shiftKey ? 10 : 1)
            : e.key === "ArrowRight" ? split + (e.shiftKey ? 10 : 1) : undefined;
          if (value === undefined) return;
          e.preventDefault(); e.stopPropagation(); changeSplit(value);
        }}>
        <span className="absolute inset-y-0 left-1/2 w-px bg-border/60" />
        {/* The grip: slid by -split% of its own width so it stays inside the
            sheet at both ends (the sheet clips; at 0% a centred grip lost half). */}
        <span data-divider-grip className="absolute top-1/2 left-1/2 h-8 w-1.5 rounded-full border border-background bg-foreground/70"
          style={{ transform: `translate(-${split}%, -50%)` }} />
      </div>
      {/* Trim guide: the ART box. Percentages off PAGE so it tracks the
          wrapper at any size, same trick as the selection box below. */}
      {bleed && (
        <div
          className="pointer-events-none absolute"
          style={{
            ...pageBox(ART.x, ART.y, ART.w, ART.h),
            ...BLEED_STROKE,
            ...cornerRadius(dieR, ART.w, ART.h),
          }}
        />
      )}
      {/* The live measurement badge: how far a move has travelled, or the
          W x H a resize has reached — Photoshop's readout, hung off the top-
          left of the layer under the gesture. */}
      {readout && boxesById.get(readout.id) && (() => {
        const b = boxesById.get(readout.id)!;
        const rows = readout.moved
          ? [`X ${inches(readout.moved.dx)}`, `Y ${inches(readout.moved.dy)}`]
          : [`W ${inches(b.w)}`, `H ${inches(b.h)}`];
        return (
          <div
            className="pointer-events-none absolute"
            style={pageBox(b.x, b.y, 0, 0)}
          >
            <div className="absolute bottom-1 left-0 whitespace-nowrap rounded-sm bg-neutral-900/90 px-1.5 py-1 text-[10px] leading-3 text-white tabular-nums">
              {rows.map((r) => <div key={r}>{r}</div>)}
            </div>
          </div>
        );
      })()}
      {/* The smart guide: a segment along the line that was caught, running
          from the moving box to the far end of what it lined up with — so the
          indicator names the thing you aligned to, not just the coordinate.
          Points are master-space at the master's own bleed; BLEED_SHIFT
          re-bases them to the live bleed the way hittestLayers does.
          Its 1px thickness is INLINE, not a `w-px` class: this element also
          carries an inline `width`/`height` for its length, and an inline
          declaration beats a class — which is why the old full-page version
          of this line was `width: 0` and never drew. */}
      {snap.x && (
        <div
          className={`pointer-events-none absolute ${snapColor(snap.x)}`}
          style={{
            left: `${((snap.x.at + BLEED_SHIFT) / PAGE.w) * 100}%`,
            top: `${((snap.x.from + BLEED_SHIFT) / PAGE.h) * 100}%`,
            height: `${((snap.x.to - snap.x.from) / PAGE.h) * 100}%`,
            width: 1,
          }}
        />
      )}
      {snap.y && (
        <div
          className={`pointer-events-none absolute ${snapColor(snap.y)}`}
          style={{
            left: `${((snap.y.from + BLEED_SHIFT) / PAGE.w) * 100}%`,
            top: `${((snap.y.at + BLEED_SHIFT) / PAGE.h) * 100}%`,
            width: `${((snap.y.to - snap.y.from) / PAGE.w) * 100}%`,
            height: 1,
          }}
        />
      )}
      {groupBox && (
        <div
          className="pointer-events-none absolute border border-dashed border-sky-400"
          style={pageBox(groupBox.x, groupBox.y, groupBox.w, groupBox.h, GROUP_PAD)}
        >
          <span className="absolute -top-5 left-0 rounded-sm bg-info-soft px-1 text-[10px] font-medium leading-4 text-info-text">
            {selBoxes.length} layers
          </span>
        </div>
      )}
      {selBoxes.map((b) => (
        // Figma's selection read: a 1px accent stroke with a dark outer halo
        // so it stays visible over both the gold art and bare white stock,
        // plus corner ticks. Outline, not border: it draws OUTSIDE the box.
        <div
          key={b.id}
          className="pointer-events-none absolute outline-1 outline-sky-400 outline-solid [box-shadow:0_0_0_2px_rgba(0,0,0,0.45)]"
          style={pageBox(b.x, b.y, b.w, b.h, SEL_PAD)}
        >
          {HANDLES.map((h) => (
            // Every tick is a resize handle (shift = uniform); the grabbed
            // edge follows the pointer and the opposite edge stays put.
            // Locked layers keep inert ticks; onHandleDown re-checks the lock.
            <span
              key={h.key} aria-hidden="true" data-resize-handle={h.key}
              title="Drag to resize (shift: keep proportions)"
              className={b.locked ? h.clsLocked : h.cls}
              onClick={(e) => { e.stopPropagation(); swallowClick.current = false; }}
              onPointerDown={(e) => onHandleDown(e, b.id, h.handle)}
              onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
            />
          ))}
        </div>
      ))}
      {/* IN-PLACE editor — the one editor every text layer gets. The render
          source skips the layer for the session (see onEditSession), so the
          editor's styled text IS the layer while you type. Rich layers get
          the lines field with its pill toolbar; a number/code layer, or one
          with choices, the plain box (InPlacePlainField), turned with the
          text for a rotated layer. */}
      {editing && editLayer?.kind === "text" && editBox && canvasRender && (() => {
        const layer = editLayer;
        const b = editBox;
        const fontCss = layer.fontFamily ? labelFontCss(layer.fontFamily) : canvasRender.fontCss;
        const apply = (lines: TextLine[]) => {
          onEditText(editing, lines, !edited.current);
          edited.current = true;
        };
        const close = (cancel: boolean) => {
          if (cancel && edited.current) onEditCancel();
          if (cancel) edited.current = false;
          setEditing(null);
        };
        // A layer with choices gets the plain box, as the sidebar's picker
        // field is one plain line (TextEditor's PlainLineField rule).
        if (!layer.input && !layer.choices?.length) {
          return (
            <InPlaceRichField
              layer={layer}
              fontCss={fontCss}
              box={b}
              toolbarPos={toolbarPos}
              onApply={apply}
              onUppercase={(uppercase) => {
                onEditUppercase(editing, uppercase, !edited.current);
                edited.current = true;
              }}
              onClose={close}
              fieldRef={sessionRef}
              toolbarRef={toolbarRef}
            />
          );
        }
        return (
          <InPlacePlainField
            layer={layer}
            fontCss={fontCss}
            box={b}
            measure={canvasRender.m}
            onApply={apply}
            onClose={close}
            fieldRef={sessionRef}
          />
        );
      })()}
    </div>
  );
});
