// PreviewCompare.tsx — the single preview: both plates painted straight from
// the v3 display list (planLayers) by the canvas backend and stacked; a
// resizable divider reveals the white-ink layer (left side) over the art
// (right side). Click selects the layer under the cursor (hittestLayers);
// double-clicking (or double-tapping) a text layer edits it IN PLACE — the
// same rich-lines field the sidebar uses (TextEditor's useTextField), sized
// to the drawn glyphs, a pill toolbar floating above it, or a plain box for
// a number/code layer — applying live, one undo step per session. Pointer-
// down on an unlocked layer arms a two-axis drag that reports cumulative
// deltas; App turns them into the layer's position patch (moveBy) and folds
// the drag into one undo step the same way.
//
// The overlay geometry (page-space boxes, trim guide, selection ticks) lives
// in previewOverlay.ts, the rich-text in-place session in InPlaceRichField.tsx
// (#433), and the presses (move, resize, tap, double-tap) in useSheetPress.ts;
// this file owns the plates, hit-testing and the in-place session.
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { useTranslation } from "@/i18n";
import { drawPlate, type CanvasRenderSource } from "@/canvas/draw";
import { planLayerScene } from "@/planLayers";
import { hitBoxesFromLayout, hitTestBoxes, type LayerBox } from "@/hittestLayers";
import type { ResizeHandle } from "@/model/edit";
import type { Layer, TextLine } from "@/model/layers";
import {
  ART, BLEED_SHIFT, PAGE, PREVIEW_MAX_W, PREVIEW_RASTER_MAX_EDGE, previewRasterScale,
} from "@/layout";
import { labelFontCss } from "@/fonts";
import type { SelectMods } from "@/selection";
import { errMsg } from "@/lib/utils";
import { lengthLabel, type LengthUnit } from "@/rulers";
import {
  BLEED, BLEED_STROKE, cornerRadius, dieRadius, GROUP_PAD, HANDLES, pageBox, pagePointOf,
  pillPos, SEL_PAD, snapColor, type SnapLines,
} from "./previewOverlay";
import { InPlaceRichField } from "./InPlaceRichField";
import { InPlacePlainField } from "./InPlacePlainField";
import { useSheetPress } from "./useSheetPress";

/** The plates worth painting: the art always (it is the base the mask sits
 *  over), the mask only once the divider reveals any of it (split > 0) — at
 *  split 0 it is fully clipped, so painting it would double the per-keystroke
 *  raster work for nothing (#395). */
export const platesToPaint = (maskShown: boolean): ("art" | "mask")[] =>
  maskShown ? ["art", "mask"] : ["art"];

/** Drag snap distance to a guide or another layer's edge/middle, in label points. */
export const SNAP_PT = 6;

/** Wheel/pinch events arrive every frame. Keep the CSS transform immediate,
 *  then replace its backing bitmap once the gesture pauses. */
const RASTER_DEBOUNCE_MS = 160;

export interface PreviewCompareHandle {
  showArt: () => void;
  showMask: () => void;
  /** The exact page box rulers measure; its client rect includes App's CSS transform. */
  getPageElement: () => HTMLDivElement | null;
  /** A press is down on a layer (move) or a tick (resize), started or not. */
  layerGestureArmed: () => boolean;
  /** Ends that gesture exactly as Escape does: undoes its step if it had
   *  moved (onDragCancel), clears the snap lines and readout, and drops it
   *  so later moves do nothing. */
  cancelLayerGesture: () => void;
  /** A second finger landed: the first finger's press is no tap. */
  endTap: () => void;
  /** The tick resize's finger, if one is down, at its latest point: the pane
   *  can pinch with it while the resize has not started. */
  resizeFinger: () => { pointerId: number; x: number; y: number; started: boolean } | null;
}

export const PreviewCompare = forwardRef<
  PreviewCompareHandle,
  {
    /** The render source: fonts + decoded bitmaps for drawPlate. Null means
     *  "not ready yet / a 3D view is up / a hidden tab" — nothing shows, so
     *  the canvases empty, and hit-testing is skipped rather than guessed. */
    canvasRender: CanvasRenderSource | null;
    /** The resolved layers that draw (enabled, values applied), in draw
     *  order — what the display list, the hit boxes and the drag targets are
     *  all computed from, so they cannot disagree. A QR's value trails the
     *  typing (useSettledQr). */
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
    /** An in-place session that changed something ended — Enter, Escape,
     *  click-away, or the preview going away; every end keeps the typing.
     *  Called once, after the last onEditText; App learns the final value
     *  into the layer's choices here, never per keystroke (the sidebar
     *  picker's commit rule). */
    onEditCommit: (id: string) => void;
    onEditUppercase: (id: string, uppercase: boolean, first: boolean) => void;
    /** Drag-to-move: called on every pointermove past the threshold with
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
    /** The settled CSS zoom: it trails a gesture, so nothing here should
     *  position against it. Rasterization follows it after a short debounce. */
    zoom: number;
    /** Repaint trigger only: the paint effect reads geometry from the live
     *  PAGE, which App's render already updated via setLayoutBleed. */
    bleedIn: number;
    /** A failed frame, for App's error strip; "" on the next good frame. */
    onRenderError?: (message: string) => void;
    /** The app's length unit (rulers.ts), which the drag/resize readout speaks. */
    unit: LengthUnit;
  }
>(function PreviewCompare(
  {
    canvasRender, layers, editLayerOf, selected, onPick, onEditText, onEditCommit, onEditUppercase, onDrag,
    onDragCancel, onResize, onEditSession, onSplit, bleed, cornerRadiusPct, zoom, bleedIn, onRenderError, unit,
  },
  ref,
) {
  const { t } = useTranslation();
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

  // The display list and boxes, measured once per layers/source/Bleed change. A throw here
  // (a bad binding, an unparsable payload) is caught by the paint effect
  // below, so the last frame stays up.
  const plan = useMemo<ReturnType<typeof planLayerScene> | Error | null>(() => {
    if (!canvasRender) return null;
    try {
      return planLayerScene(layers, canvasRender.m, canvasRender.planAssets, { skip: canvasRender.skip });
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
    // bleedIn is unused in here, but the plan reads the page size it sets (#789).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, canvasRender, bleedIn]);

  const hitBoxes = useMemo(() => plan && !(plan instanceof Error)
    ? hitBoxesFromLayout(layers, plan.boxes) : [], [layers, plan]);
  const boxesById = useMemo(() => new Map(hitBoxes.map((b) => [b.id, b])), [hitBoxes]);

  // The one render path: repaint the visible plates (platesToPaint) straight from the display list
  // on every change, on a rAF so a burst of keystrokes coalesces into one
  // paint per frame. null canvasRender paints nothing: see the effect below.
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

  // Which layer under the event, or null — undefined means "can't tell":
  // source not assembled, not laid out, or the click was really the divider.
  function hitOf(e: React.MouseEvent): string | null | undefined {
    if (!canvasRender) return undefined;
    // The handle tracks the pointer while dragging, so at drag-end the
    // synthesized click still lands over it; ignore anything whose target
    // is the handle so finishing a drag can't change the selection.
    if (e.target instanceof Element && e.target.closest('[data-slot="resizable-handle"]')) return undefined;
    const p = pagePointOf({ clientX: e.clientX, clientY: e.clientY, currentTarget: pageElement.current! });
    if (!p) return undefined;
    return hitTestBoxes(p.xPt, p.yPt, hitBoxes);
  }

  // Inline text editing: double-click (or double-tap) a text layer to edit
  // it IN PLACE over the artwork. Every keystroke goes straight to the
  // document (see onEditText's doc), so the drawn render is the feedback.
  const [editing, setEditing] = useState<string | null>(null);
  // The pill toolbar position (viewport px, captured at open).
  const [toolbarPos, setToolbarPos] = useState({ left: 8, top: 8 });
  // The open session's click-away boundary.
  const sessionRef = useRef<HTMLDivElement>(null);
  // The pill portals to <body>, so click-away must ask it separately.
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Whether this session has applied any keystroke yet — the first one opens
  // the undo step, and a session that typed nothing commits nothing.
  const edited = useRef(false);

  /** Opens text layer `id` in place, locked too (a lock stops moving, not typing). */
  function startEditing(e: React.MouseEvent<HTMLDivElement>, id: string) {
    const layer = layers.find((l) => l.id === id);
    if (layer?.kind !== "text" || !canvasRender) return;
    if (!layer.input && !layer.choices?.length) {
      // Anchor the pill over the layer's box (captured once: it portals to
      // <body>, where App's CSS zoom can't scale it).
      const b = boxesById.get(id);
      if (!b) return;
      setToolbarPos(pillPos(e.currentTarget.getBoundingClientRect(), b));
    }
    edited.current = false;
    setEditing(id);
  }

  // Presses on the sheet and its ticks: move, resize, tap, double-tap.
  const press = useSheetPress({
    pageElement, boxesById, editing, hitOf, startEditing, onPick, onDrag, onResize, onDragCancel,
  });
  const { snap, readout, cancelLayerGesture } = press;

  useImperativeHandle(ref, () => ({
    showArt: () => changeSplit(0),
    showMask: () => changeSplit(100),
    getPageElement: () => pageElement.current,
    ...press.gesture,
  }), [changeSplit, press.gesture]);

  // No source, no preview: end the session and any armed move or resize (a
  // hidden tab keeps no gesture), and free both plates' backing
  // stores, up to 51MB each on a zoomed tab. The paint effect above resizes
  // them when a source returns (#734).
  useEffect(() => {
    if (canvasRender) return;
    setEditing(null);
    cancelLayerGesture();
    for (const c of [artCanvas.current, maskCanvas.current]) if (c) c.width = c.height = 0;
  }, [canvasRender, cancelLayerGesture]);

  // Report the open session so App can skip the layer from the render for
  // its duration, and COMMIT the one that just ended if it changed anything.
  // One effect covers every open/close path.
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
      className="relative m-auto w-full overflow-hidden border border-plate-edge bg-input"
      style={{
        // Width cap in the style object, not the class list, so the 3D scene
        // can import the same rule (fitSheetWidth) and frame its label to
        // this sheet: at most PREVIEW_MAX_W, and no wider than the zoom
        // layer's height (cqh; App makes it the size container) allows, so
        // 100% shows the whole label on a short pane.
        maxWidth: `min(${PREVIEW_MAX_W}px, ${(100 * PAGE.w) / PAGE.h}cqh)`,
        aspectRatio: `${PAGE.w} / ${PAGE.h}`,
        // Query container, so the in-place editor can size its invisible
        // glyphs as a share of the page height (cqh) at any zoom.
        containerType: "size",
        ...cornerRadius(dieR + BLEED, PAGE.w, PAGE.h),
      }}
      {...press.sheet}
    >
      <canvas ref={artCanvas} className="absolute inset-0 h-full w-full" />
      <canvas
        ref={maskCanvas}
        className="absolute inset-0 h-full w-full"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      />
      <div role="separator" tabIndex={0} aria-label={t("White ink comparison")}
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
          ? [t("X {{value}}", { value: lengthLabel(readout.moved.dx, unit) }), t("Y {{value}}", { value: lengthLabel(readout.moved.dy, unit) })]
          : [t("W {{value}}", { value: lengthLabel(b.w, unit) }), t("H {{value}}", { value: lengthLabel(b.h, unit) })];
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
            {t("{{count}} layer", { count: selBoxes.length })}
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
              title={t("Drag to resize (shift: keep proportions)")}
              className={b.locked ? h.clsLocked : h.cls}
              // A tick keeps its clicks: a mouse resize's would pick, and a
              // finger's tap has already picked where it lifted (onPointerUp).
              onClick={(e) => e.stopPropagation()}
              {...press.tick(b.id, h.handle)}
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
        const close = () => setEditing(null);
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
