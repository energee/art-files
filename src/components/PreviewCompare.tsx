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
import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { drawPlate, type CanvasRenderSource } from "@/canvas/draw";
import { facesOf, planLayerScene } from "@/planLayers";
import {
  hitBoxesFromLayout, hitTestBoxes, type LayerBox,
} from "@/hittestLayers";
import type { Face } from "@/plan";
import type { ResizeHandle } from "@/model/edit";
import type { Layer, TextLayer, TextLine } from "@/model/layers";
import { uppercaseOf } from "@/model/layers";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  ART, BLEED_SHIFT, FONT_ASC, FONT_DESC, PAGE, PREVIEW_MAX_W,
  PREVIEW_RASTER_MAX_EDGE, previewRasterScale, trackedWidth,
} from "@/layout";
import type { Style } from "@/types";
import { FACE_WEIGHT, labelFontCss } from "@/fonts";
import { TextToolbarButtons, useTextField, type LinePaint } from "@/components/TextEditor";
import { modsOf, type SelectMods } from "@/selection";
import { cn } from "@/lib/utils";

/** The selection box's four corner ticks, each already placed. */
/** The eight selection ticks, which double as resize handles. hx/hy name
 *  the grabbed edge (-1 left/top, 0 not grabbed, 1 right/bottom); position
 *  and cursor follow from them. */
const HANDLES = ([-1, 0, 1] as const).flatMap((hy) => ([-1, 0, 1] as const)
  .filter((hx) => hx || hy)
  .map((hx) => {
    const at = `${hy < 0 ? "-top-[3px]" : hy > 0 ? "-bottom-[3px]" : "top-1/2 -translate-y-1/2"} ${
      hx < 0 ? "-left-[3px]" : hx > 0 ? "-right-[3px]" : "left-1/2 -translate-x-1/2"}`;
    const cursor = !hx ? "cursor-ns-resize" : !hy ? "cursor-ew-resize" : hx === hy ? "cursor-nwse-resize" : "cursor-nesw-resize";
    const base = `absolute size-2 rounded-[1px] border border-sky-400 bg-background ${at}`;
    return { handle: { hx, hy } as ResizeHandle, key: `${hx},${hy}`, cls: `${base} pointer-events-auto touch-none ${cursor}`, clsLocked: base };
  }));

/** Pointer travel (px) before a press becomes a drag; below it is a click. */
const DRAG_THRESHOLD_PX = 3;

/** Breathing room between a layer's measured box and its selection
 *  outline, in screen px. */
const SEL_PAD = 4;
/** The multi-selection group frame sits outside the per-layer rings. */
const GROUP_PAD = SEL_PAD * 3;

/** Drag snap distance to a guide or another layer's edge/middle, in label points. */
export const SNAP_PT = 6;

/** Blue for a page guide (the master's margins/centre, or a manual one),
 *  fuchsia for another layer's edge or middle — the Photoshop/Sketch
 *  convention, and the only way to tell at a glance WHICH kind of alignment
 *  the drag caught. App classifies the line (SnapMark.guide); comparing
 *  coordinates here could not tell a manual guide from a layer edge, nor an
 *  X guide's value landing on a Y line. */
const snapColor = (mark: SnapMark) => (mark.guide ? "bg-sky-400" : "bg-fuchsia-500");

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

/** Label points as the inches the readout speaks in — Photoshop's move/resize
 *  badge, three decimals. */
const inches = (pt: number) => `${(pt / 72).toFixed(3)} in`;

/** Bleed per side, in label-space points: the gap between the trimmed art box
 *  and the printed page. The die cuts at ART, so the sheet's own corners are
 *  the die's, offset outward by this much. */
const BLEED = ART.x;

/** A circular corner of `r` points, expressed against a box of `w` x `h`
 *  points. Percentages rather than px so the corner tracks the preview at any
 *  on-screen size (same reason pageBox works in percentages); the two-value
 *  `x / y` form keeps it circular in page space instead of letting each axis
 *  scale to its own edge, which is what a single percentage would do. */
const cornerRadius = (r: number, w: number, h: number): React.CSSProperties => ({
  borderRadius: `${(r / w) * 100}% / ${(r / h) * 100}%`,
});

/** The die-cut radius in label-space points. The knob is a share of the
 *  label's short side (see settings.ts), and the label is the trimmed piece —
 *  so it measures against ART, not the bleed-inclusive page, and matches the
 *  same computation the 3D die uses in canScene. */
const dieRadius = (pct: number) => (pct / 100) * Math.min(ART.w, ART.h);

const DASH = 6; // px per tone, so the cycle repeats every 2 * DASH
const dashes = (dir: string) =>
  `repeating-linear-gradient(${dir}, #000 0 ${DASH}px, #fff ${DASH}px ${DASH * 2}px)`;
/** The trim guide's stroke: alternating black and white dashes, one 1px line
 *  per edge — the marquee convention, for the reason the convention exists:
 *  black and white are the one pair with no shared blind spot over
 *  arbitrary label art (measured 4.60:1 worst case over a real texture). */
const BLEED_STROKE: React.CSSProperties = {
  backgroundImage: [dashes("90deg"), dashes("90deg"), dashes("180deg"), dashes("180deg")].join(","),
  backgroundSize: "100% 1px, 100% 1px, 1px 100%, 1px 100%",
  backgroundPosition: "0 0, 0 100%, 0 0, 100% 0",
  backgroundRepeat: "no-repeat",
};

/** An overlay box positioned in page space: label-space points in, CSS
 *  percentages of the preview frame out, so it tracks the container at any
 *  on-screen size without its own resize handling. `pad` grows the box by n
 *  screen px on every side. Shared by the trim guide and the selection
 *  outlines, which must agree about the coordinate basis. */
const pageBox = (
  x: number, y: number, w: number, h: number, pad = 0,
): React.CSSProperties => ({
  left: `calc(${(x / PAGE.w) * 100}% - ${pad}px)`,
  top: `calc(${(y / PAGE.h) * 100}% - ${pad}px)`,
  width: `calc(${(w / PAGE.w) * 100}% + ${pad * 2}px)`,
  height: `calc(${(h / PAGE.h) * 100}% + ${pad * 2}px)`,
});

/** Label-space points as a container-query length — a share of the preview's
 *  HEIGHT, which is the unit the in-place editors size glyphs, tracking and
 *  rotated rows in so they track the sheet at any zoom. Page x and y are the
 *  same points against a wrapper whose aspect ratio is locked to the page,
 *  so this is the right unit on both axes. */
const cqh = (pt: number) => `${(pt / PAGE.h) * 100}cqh`;

/** Just pageBox's top-left corner, for an overlay that sizes itself. */
const corner = (x: number, y: number): React.CSSProperties => ({
  left: `${(x / PAGE.w) * 100}%`,
  top: `${(y / PAGE.h) * 100}%`,
});

/** What a style paints as on screen: white-plate text renders white,
 *  anything else shows its fill (flat — the metallic sheen is the print's,
 *  not the screen's). */
const inkOf = (st: Style) =>
  (st.layer === "white" || st.fill === "none" ? "#FFFFFF" : st.fill);

/** An in-place field's painter for a text layer: plain runs in the layer's
 *  base face, bold runs / header lines in its bold face (facesOf — the same
 *  pair planLayers draws with), white-ink lines white, everything else in
 *  the layer's ink. FACE_WEIGHT is the one face→CSS-weight table measure and
 *  draw already share. whitespace-pre because the renderer wraps only by an
 *  explicit `width`, so the editor must not wrap on its own. */
function paintFor(faces: { base: Face; bold: Face }, st: Style): LinePaint {
  const plainWeight = String(FACE_WEIGHT[faces.base]);
  const boldWeight = String(FACE_WEIGHT[faces.bold]);
  const ink = inkOf(st);
  return (el, l) => {
    el.className = "whitespace-pre outline-none";
    el.style.fontWeight = l.bold || l.header ? boldWeight : plainWeight;
    el.style.color = l.white ? "#FFFFFF" : ink;
  };
}

/** The IN-PLACE session for a rich text layer: the same rich-lines engine as
 *  the sidebar field (useTextField), but the contenteditable sits over the
 *  layer's own spot on the sheet at label metrics, so `**bold**` and
 *  `_white ink_` show as bold and white ink rather than as punctuation. The
 *  canvas skips the layer for the session (see onEditSession), so this DOM
 *  text IS the layer while you type, and the Header/Bold/White-ink toggles
 *  float above it as a fixed pill, portaled to <body> so App's CSS zoom
 *  scales the text with the artwork but never the toolbar chrome. */
function InPlaceRichField(props: {
  layer: TextLayer;
  fontCss: string;
  /** The layer's drawn box, label-space points, BLEED_SHIFT applied. */
  box: LayerBox;
  /** Pill position, viewport px, captured once at open. */
  toolbarPos: { left: number; top: number };
  onApply: (lines: TextLine[]) => void;
  onUppercase: (uppercase: boolean) => void;
  /** Ends the session: Escape asks to undo it (`cancel`). */
  onClose: (cancel: boolean) => void;
  /** Click-away guards — the field wrapper and the portaled pill both count
   *  as "inside the session" (see the pointerdown capture effect). */
  fieldRef: React.RefObject<HTMLDivElement | null>;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { layer, fontCss, box, toolbarPos, onApply, onClose, fieldRef, toolbarRef } = props;
  const size = layer.size;
  const leading = (layer.leading ?? 1.2) * size;
  const faces = facesOf(layer);
  const rotated = layer.rotation === 90;
  // Rebuilt only when the layer's faces or ink change — the field seeds
  // from it, and every reseed repaints every line and run through it.
  const paint = useMemo(
    () => paintFor(faces, layer.style),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faces.base, faces.bold, layer.style.fill, layer.style.layer],
  );
  const { rootRef, caret, toggle, toggleHeader, fieldProps } = useTextField({
    lines: layer.lines, onChange: onApply, base: layer.style, multiline: true,
    uppercase: uppercaseOf(layer), paint,
  });

  // Focus with the caret at the end once on open — the hook's seed effect
  // registered first, so the line-divs exist by the time this runs.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(root);
      sel.collapseToEnd();
    }
  }, [rootRef]);

  // CSS positions the first BASELINE where the canvas drew it: the box's
  // leading edge is FONT_ASC beyond the baseline (see planLayers), while a
  // CSS line box of `leading` height centers the font's (FONT_ASC+FONT_DESC)
  // content area inside it — the half-leading difference is the offset
  // between the two. Rotated, that edge is the box's LEFT (the column grows
  // rightward from the baseline) rather than its top.
  const cross = ((FONT_ASC + FONT_DESC) * size - leading) / 2;
  // The room to type INTO, where the text grows: from the anchor point
  // outward per the layer's alignment — to the sheet's right edge for a
  // left-aligned block, symmetric about the anchor for a centred one, back
  // to the sheet's left edge for a right-aligned one. A declared wrap width
  // is the field's width instead. The rotated column reads bottom-to-top
  // from its own start, up to the sheet's top edge.
  const ax = box.x + (layer.align === "center" ? box.w / 2 : box.w);
  const align = layer.align === "justify" ? "left" : layer.align;
  let place: React.CSSProperties;
  if (rotated) {
    const bottom = box.y + box.h;
    place = {
      ...corner(box.x + cross, bottom),
      width: cqh(layer.width ?? bottom),
      transformOrigin: "0 0",
      transform: "rotate(-90deg)",
    };
  } else if (layer.width !== undefined) {
    place = { ...corner(box.x, box.y + cross), width: `${(layer.width / PAGE.w) * 100}%` };
  } else if (align === "center") {
    const half = Math.min(ax, PAGE.w - ax);
    place = { ...corner(ax - half, box.y + cross), width: `${((2 * half) / PAGE.w) * 100}%` };
  } else if (align === "right") {
    place = { ...corner(0, box.y + cross), width: `${(ax / PAGE.w) * 100}%` };
  } else {
    place = { ...corner(box.x, box.y + cross), width: `${((PAGE.w - box.x) / PAGE.w) * 100}%` };
  }
  return (
    <>
      <div
        ref={fieldRef}
        className="absolute"
        style={{
          ...place,
          fontSize: cqh(size),
          lineHeight: leading / size,
          fontFamily: fontCss,
          letterSpacing: cqh(layer.style.letterSpacing ?? 0),
          textAlign: align,
        }}
        // The wrapper's click/dblclick handlers hit-test the canvas;
        // interacting with the editor must not re-select or reopen.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(true); }}
      >
        <div
          {...fieldProps}
          aria-label={`Edit ${layer.name.toLowerCase()} text`}
          className="outline-none caret-sky-400"
        />
      </div>
      {createPortal(
        <div
          ref={toolbarRef}
          className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-md"
          style={toolbarPos}
        >
          <TextToolbarButtons caret={caret} toggle={toggle} toggleHeader={toggleHeader}
            uppercase={uppercaseOf(layer)} onUppercase={props.onUppercase} />
        </div>,
        document.body,
      )}
    </>
  );
}

// The installed react-resizable-panels major (Group/Panel/Separator, with
// panelRef instead of a forwarded ref, and onLayoutChange reporting a
// {[panelId]: percent} map instead of a sizes array) postdates the classic
// PanelGroup/Panel/ImperativePanelHandle API; the left panel needs a fixed
// id so its percentage can be read out of that map by key.
const WHITE_INK_PANEL_ID = "white-ink";
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
    canvasRender, layers, selected, onPick, onEditText, onEditUppercase, onEditCancel, onDrag,
    onDragCancel, onResize, onEditSession, onSplit, bleed, cornerRadiusPct, zoom, bleedIn, onRenderError,
  },
  ref,
) {
  const dieR = dieRadius(cornerRadiusPct);
  const artCanvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);
  const pageElement = useRef<HTMLDivElement>(null);
  const leftPanel = useRef<PanelImperativeHandle>(null);
  const [split, setSplit] = useState(0); // % width showing white-ink
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
    // Numbers in resize() are pixels, not percent — units must be explicit.
    showArt: () => leftPanel.current?.resize("0%"),
    showMask: () => leftPanel.current?.resize("100%"),
    getPageElement: () => pageElement.current,
  }), []);

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

  // The one render path: repaint both plates straight from the display list
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
        for (const [canvas, mode] of
            [[artCanvas.current, "art"], [maskCanvas.current, "mask"]] as const) {
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
        onRenderError?.(String(err));
      }
    });
    return () => cancelAnimationFrame(raf);
    // onRenderError is a useState setter in App — identity-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRender, plan, rasterScale, bleedIn]);

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
    swallowClick.current = !!resize.current?.started;
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
  function onPointerUp() {
    swallowClick.current = !!drag.current?.started;
    drag.current = null; setSnap({ x: null, y: null, dx: 0, dy: 0 }); setReadout(null);
  }

  // Escape mid-drag: undo the single step the drag opened (if any) and drop the
  // in-flight session so a further pointermove can't resume it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (drag.current?.started || resize.current?.started) onDragCancel();
      drag.current = null; resize.current = null;
      setSnap({ x: null, y: null, dx: 0, dy: 0 }); setReadout(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDragCancel]);

  // Report the open session so App can skip the layer from the render for
  // its duration. One effect covers every open/close path.
  useEffect(() => {
    onEditSession(editing);
    // onEditSession is a useState setter in App — identity-stable.
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
    if (!layer.input) {
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
  const editLayer = editing ? layers.find((l) => l.id === editing) : undefined;
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
      {/* ResizablePanelGroup is absolutely positioned over both canvases;
          pointer-events-none here, restored on just the handle, keeps the
          divider draggable while letting clicks fall through to the wrapper. */}
      <ResizablePanelGroup
        orientation="horizontal"
        onLayoutChange={(layout) => {
          const pct = layout[WHITE_INK_PANEL_ID] ?? 0;
          setSplit(pct);
          onSplit?.(pct);
        }}
        className="absolute inset-0 pointer-events-none"
      >
        <ResizablePanel id={WHITE_INK_PANEL_ID} panelRef={leftPanel} defaultSize="0%" minSize="0%" />
        <ResizableHandle withHandle className="bg-border/60 pointer-events-auto" />
        <ResizablePanel minSize="0%" />
      </ResizablePanelGroup>
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
          <span className="absolute -top-5 left-0 rounded-sm bg-sky-400 px-1 text-[10px] font-medium leading-4 text-black">
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
              key={h.key} role="slider" aria-label={`Resize layer (${h.key})`}
              title="Drag to resize (shift: keep proportions)"
              className={b.locked ? h.clsLocked : h.cls}
              onPointerDown={(e) => onHandleDown(e, b.id, h.handle)}
              onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
            />
          ))}
        </div>
      ))}
      {/* IN-PLACE editor — the one editor every text layer gets. The render
          source skips the layer for the session (see onEditSession), so the
          editor's styled text IS the layer while you type. Rich layers get
          the lines field with its pill toolbar; a number/code layer the plain
          box below, turned with the text for a rotated layer. */}
      {editing && editLayer?.kind === "text" && editBox && canvasRender && (() => {
        const layer = editLayer;
        const b = editBox;
        const st = layer.style;
        const apply = (lines: TextLine[]) => {
          onEditText(editing, lines, !edited.current);
          edited.current = true;
        };
        const close = (cancel: boolean) => {
          if (cancel && edited.current) onEditCancel();
          setEditing(null);
        };
        if (!layer.input) {
          return (
            <InPlaceRichField
              layer={layer}
              fontCss={layer.fontFamily ? labelFontCss(layer.fontFamily) : canvasRender.fontCss}
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
        const rotated = layer.rotation === 90;
        const faces = facesOf(layer);
        const size = layer.size;
        const typed = layer.lines[0]?.text ?? "";
        const ls = st.letterSpacing ?? 0;
        // A suffixed field (the ABV's unit tail) has to END where its glyphs
        // end, so the redrawn tail lands where the render will put it: the
        // same measure the canvas draws with, plus the one trailing gap CSS
        // letter-spacing adds after the last glyph, plus 2px of caret room.
        const fieldWidth = layer.suffix
          ? `calc(${cqh(trackedWidth(canvasRender.m(typed, size, faces.base, layer.fontFamily), typed, ls) + ls)} + 2px)`
          : "100%";
        return (
          <div
            ref={sessionRef}
            className="absolute"
            style={{
              ...pageBox(b.x, b.y, b.w, b.h, SEL_PAD),
              fontSize: cqh(size),
              lineHeight: 1,
              fontFamily: layer.fontFamily ? labelFontCss(layer.fontFamily) : canvasRender.fontCss,
              fontWeight: FACE_WEIGHT[faces.base],
              letterSpacing: cqh(ls),
              color: inkOf(st),
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {/* The row the field sits on. Unrotated it just fills the box;
                rotated it is the SAME row, sized to the drawn column, centred
                in the (tall, narrow) box and turned -90deg to match the
                canvas. */}
            <div
              className="absolute flex items-center"
              style={rotated ? {
                left: "50%",
                top: "50%",
                width: cqh(b.h),
                height: cqh(b.w),
                transform: "translate(-50%, -50%) rotate(-90deg)",
              } : { inset: 0 }}
            >
              <input
                autoFocus
                value={typed}
                aria-label={`Edit ${layer.name.toLowerCase()} text`}
                onFocus={(e) => {
                  const end = e.currentTarget.value.length;
                  e.currentTarget.setSelectionRange(end, end);
                }}
                onChange={(e) => {
                  const v = layer.input === "number"
                    ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value;
                  apply([{ ...st, text: v }]);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditing(null);
                  if (e.key === "Escape") close(true);
                }}
                className={cn("h-full bg-transparent outline-none caret-sky-400",
                  !layer.suffix && "px-1")}
                style={{
                  width: fieldWidth,
                  textAlign: layer.align === "center" ? "center" : layer.align === "right" ? "right" : "left",
                  textTransform: uppercaseOf(layer) ? "uppercase" : undefined,
                }}
              />
              {layer.suffix && (
                // The drawn tail is hidden with its layer for the session, so
                // the editor redraws it, uneditable, right after the value.
                <span className="whitespace-nowrap">{layer.suffix}</span>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
});
