// PreviewCompare.tsx — the single preview: both plates painted straight from
// the display list by the canvas backend and stacked; a resizable divider
// reveals the white-ink layer (left side) over the art (right side). Click
// selects the element under the cursor; double-clicking a text element
// (see elements.ts's editableText) floats an editor panel over its outline —
// the description gets the sidebar's WYSIWYG field, everything else a plain
// input — applying live, one undo step per session. Pointer-down on a
// draggable element (see elements.ts's dragTarget) arms a vertical drag that
// nudges its offsetY live, folded into one undo step the same way.
import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { planLabel } from "@/plan";
import { drawPlate, type CanvasRenderSource } from "@/canvas/draw";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  ART, FONT_ASC, FONT_DESC, PAGE, PREVIEW_MAX_W, PREVIEW_RASTER_MAX_EDGE,
  previewRasterScale,
} from "@/layout";
import type { LabelConfig, StyledLine } from "@/types";
import { dragTarget, editableText, elementById, type ElementId } from "@/elements";
import { LABEL_FONT_FAMILY } from "@/fonts";
import { DescriptionEditor } from "@/components/DescriptionEditor";
import { Input } from "@/components/ui/input";
import { boxesFor, hitTest, type CollabSlots, type Measure } from "@/hittest";
import { modsOf, type SelectMods } from "@/selection";
import { cn } from "@/lib/utils";

/** The selection box's four corner ticks, each already placed. */
const CORNER_CLASS = {
  tl: "-top-[3px] -left-[3px]",
  tr: "-top-[3px] -right-[3px]",
  bl: "-bottom-[3px] -left-[3px]",
  br: "-bottom-[3px] -right-[3px]",
};

/** Breathing room between an element's measured box and its selection
 *  outline, in screen px. */
const SEL_PAD = 4;

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
 *  label's short side (see presets.ts), and the label is the trimmed piece —
 *  so it measures against ART, not the bleed-inclusive page, and matches the
 *  same computation the 3D die uses in canScene. */
const dieRadius = (pct: number) => (pct / 100) * Math.min(ART.w, ART.h);

const DASH = 6; // px per tone, so the cycle repeats every 2 * DASH
const dashes = (dir: string) =>
  `repeating-linear-gradient(${dir}, #000 0 ${DASH}px, #fff ${DASH}px ${DASH * 2}px)`;
/** The trim guide's stroke: alternating black and white dashes, one 1px line
 *  per edge — the marquee convention, for the reason the convention exists.
 *
 *  Contrast against arbitrary label art is the whole problem here: the guide
 *  crosses whatever the texture happens to be. A single tone always has a
 *  ground it vanishes into (the old red at 70% fell to 1.06:1, invisible), and
 *  so does pure inversion, which maps mid-grey back onto itself (1.53:1 over
 *  grey 112 — and rock textures live right there). Black and white are the one
 *  pair with no shared blind spot: a ground can sit near one or the other,
 *  never both, so the better of the two always clears 4.58:1 — the floor, at
 *  the crossover around L=0.18. Measured 4.60:1 worst case over a real
 *  texture, which is that floor. */
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
    /** The render source: fonts + decoded bitmaps for drawPlate, assembled
     *  from the display list. Null means "not ready yet / a 3D view is up" —
     *  the canvases keep their last frame. */
    canvasRender: CanvasRenderSource | null;
    /** Current label config — read-only here, needed to hit-test a click
     *  against the same geometry the renderer just painted. */
    cfg: LabelConfig;
    /** Real glyph-width lookup (see hittest.ts); null until App's one-time
     *  font embed resolves. Hit-testing is skipped, not guessed, until then. */
    measure: Measure | null;
    /** Which collab logo slots hold art. The renderer skips an empty slot, so
     *  its hit box must not exist either (see hittest.ts's CollabSlots). */
    collab: CollabSlots;
    /** Which elements the sidebar (or previous clicks here) have selected —
     *  one outline is drawn per id, so canvas and panel agree about what a
     *  multi-selection looks like. Document layers are filtered out by App:
     *  the preview knows only renderer elements. */
    selected: readonly ElementId[];
    /** Called with the clicked element's id (null for empty background) and
     *  the click's modifiers, so shift/⌘ on the canvas extend the selection
     *  exactly as they do in the layers panel. */
    onPick: (id: ElementId | null, mods: SelectMods) => void;
    /** Called on every keystroke of a floating-editor session, so the canvas
     *  re-renders the real styled text live. `first` is true on the
     *  session's opening keystroke; App uses it to fold the whole session
     *  into one undo step (see useHistory's coalesce override). */
    onEditText: (id: ElementId, text: string, first: boolean) => void;
    /** Escape mid-session: App undoes the session's single step, restoring
     *  the text as it was when the editor opened. Never called when nothing
     *  was typed. */
    onEditCancel: () => void;
    /** Drag-to-move: called on every pointermove past the 3px threshold with
     *  the dragged element's new offsetY, `first` true on the movement that
     *  crosses the threshold — App folds the whole drag into one undo step
     *  the same way it folds a text-edit session (see onEditText). */
    onNudge: (id: ElementId, offsetY: number, first: boolean) => void;
    /** Escape mid-drag: App undoes the drag's single step, restoring the
     *  pre-drag position. Never called when the drag never crossed the
     *  threshold (a plain click). */
    onNudgeCancel: () => void;
    /** The element currently in an IN-PLACE session (null when idle or when
     *  the session floats — description, rotated column). planLabel skips it
     *  via the render flag so the editor's live DOM text is the element. */
    onEditSession: (id: ElementId | null) => void;
    /** Divider position as % of width showing white-ink, on every change —
     *  including a manual drag, so the View menu's checkmarks track the real
     *  divider rather than whichever menu item was picked last. */
    onSplit?: (pct: number) => void;
    /** Draw the trim guide at the edge of the art box — 38px of bleed at
     *  600dpi on every side. Preview-only; never part of the PDFs. */
    bleed?: boolean;
    /** Die-cut corner radius, % of the label's short side (the Settings
     *  layer's knob, shared with the 3D views). Rounds the sheet and the trim
     *  guide so the 2D preview shows the shape that actually gets cut. */
    cornerRadiusPct: number;
    /** Current CSS zoom. Rasterization follows it after a short debounce so
     *  settled zoom shows new pixel detail instead of stretching old pixels. */
    zoom: number;
    /** Repaint trigger only: the paint effect reads geometry from the live
     *  PAGE, which App's render already updated via setLayoutBleed. Without
     *  this dep a bleed change would leave the canvas stale. */
    bleedIn: number;
    /** A failed frame, for App's error strip. Called with the message on
     *  failure, "" on the next successful frame — the same clearing contract
     *  a cleared error strip needs. */
    onRenderError?: (message: string) => void;
  }
>(function PreviewCompare(
  {
    canvasRender, cfg, measure, collab, selected, onPick, onEditText,
    onEditCancel, onNudge, onNudgeCancel, onEditSession, onSplit, bleed,
    cornerRadiusPct, zoom, bleedIn, onRenderError,
  },
  ref,
) {
  // The die at the trim line, and the sheet's own corners as that die offset
  // out by the bleed — an outward offset of a rounded rect grows its radius by
  // the offset, so the two edges stay concentric.
  const dieR = dieRadius(cornerRadiusPct);
  const artCanvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);
  const pageElement = useRef<HTMLDivElement>(null);
  const leftPanel = useRef<PanelImperativeHandle>(null);
  const [split, setSplit] = useState(0); // % width showing white-ink
  const [rasterScale, setRasterScale] = useState(() =>
    previewRasterScale(zoom, window.devicePixelRatio));

  useEffect(() => {
    const next = previewRasterScale(zoom, window.devicePixelRatio);
    // Ratchet up only: zooming out just shrinks the on-screen bitmap via CSS,
    // which is visually lossless — repainting now would cost reallocating a
    // large canvas backing store for strictly less detail than what's already
    // painted.
    const timeout = window.setTimeout(
      () => setRasterScale((prev) => Math.max(prev, next)), RASTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [zoom]);

  useImperativeHandle(ref, () => ({
    // Numbers in resize() are pixels, not percent — units must be explicit.
    showArt: () => leftPanel.current?.resize("0%"),
    showMask: () => leftPanel.current?.resize("100%"),
    getPageElement: () => pageElement.current,
  }));

  // The one render path: repaint both plates straight from the display list
  // on every config/asset change, on a rAF so a burst of keystrokes coalesces
  // into one paint per frame. drawPlate is synchronous and cheap — no
  // debounce, no worker. null canvasRender (assets still assembling, or a 3D
  // view is up) paints nothing and the canvases keep their last frame.
  useEffect(() => {
    if (!canvasRender) return;
    const raf = requestAnimationFrame(() => {
      try {
        // planLabel runs before any canvas is touched, so its throws (the
        // realistic failure) leave the last frame intact — the spec's
        // failed-frame policy.
        const plan = planLabel(cfg, canvasRender.m,
          { skip: canvasRender.skip, assets: canvasRender.planAssets });
        // Long-edge guard: rasterScale alone would let a user-expanded bleed
        // grow the backing store past PREVIEW_RASTER_MAX_EDGE (measured 5040px
        // at bleed 0.2, past the 4876 cap). Capping the long edge and deriving
        // the other side from the same PAGE aspect ratio is safe because
        // PAGE.w and PAGE.h both move linearly with BLEED, so their ratio (and
        // so the derived edge) never depends on which one triggered the cap.
        const rawW = PAGE.w * rasterScale, rawH = PAGE.h * rasterScale;
        const cap = Math.min(1, PREVIEW_RASTER_MAX_EDGE / Math.max(rawW, rawH));
        for (const [canvas, mode] of
            [[artCanvas.current, "art"], [maskCanvas.current, "mask"]] as const) {
          if (!canvas) continue;
          const w = Math.round(rawW * cap);
          if (canvas.width !== w) {
            canvas.width = w;
            canvas.height = Math.round(rawH * cap);
          }
          drawPlate(canvas.getContext("2d")!, plan, canvasRender.drawAssets, mode);
        }
        onRenderError?.("");
      } catch (err) {
        // Routed to App's buildError strip; the canvases keep whatever frame
        // last painted successfully.
        onRenderError?.(String(err));
      }
    });
    return () => cancelAnimationFrame(raf);
    // onRenderError is a useState setter in App — identity-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRender, cfg, rasterScale, bleedIn]);

  // Click-to-select: the canvases fill the wrapper exactly and the wrapper's
  // aspect ratio is locked to PAGE.w/PAGE.h (see the style below), so a
  // click maps to label-space points proportionally off the bounding rect —
  // no separate art/mask coordinate math needed, both canvases share one box.
  // Shared by hitOf (click/dblclick) and the pointer-drag handlers below,
  // which need the same mapping to arm and track a drag.
  function pagePointOf(
    e: { clientX: number; clientY: number; currentTarget: HTMLDivElement },
  ): { xPt: number; yPt: number } | undefined {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return undefined; // not laid out yet (e.g. display:none)
    // getBoundingClientRect already reflects any CSS zoom App applies to the
    // preview pane, so the proportion holds at any scale without extra math.
    return {
      xPt: ((e.clientX - r.left) / r.width) * PAGE.w,
      yPt: ((e.clientY - r.top) / r.height) * PAGE.h,
    };
  }

  // Which element under the event, or null — undefined means "can't tell":
  // metrics not loaded, not laid out, or the click was really the divider.
  function hitOf(e: React.MouseEvent<HTMLDivElement>): ElementId | null | undefined {
    if (!measure) return undefined; // real metrics not in yet — skip rather than guess
    // The handle tracks the pointer while dragging, so at drag-end the
    // cursor (and the click the browser synthesizes right after mouseup) is
    // still over it; that click bubbles up through the pointer-events-none
    // ResizablePanelGroup to land here anyway. Ignore anything whose target
    // is the handle (or its grip child) so finishing a drag can't also
    // hit-test the divider's position and change or clear the selection.
    if (e.target instanceof Element && e.target.closest('[data-slot="resizable-handle"]')) return undefined;
    const p = pagePointOf(e);
    if (!p) return undefined;
    return hitTest(p.xPt, p.yPt, measure!, cfg, collab);
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const id = hitOf(e);
    if (id !== undefined) onPick(id, modsOf(e));
  }

  // Inline text editing: double-click a text element to float an editor
  // panel under its outline. Every keystroke goes straight to the config
  // (see onEditText's doc), so the drawn render is the live feedback.
  const [editing, setEditing] = useState<ElementId | null>(null);
  // Viewport px, captured once at open (see onDoubleClick). Fixed rather
  // than page-relative because the panel PORTALS to <body>: the preview's
  // overflow-hidden would clip a panel near the sheet's edge, and App's
  // CSS zoom transform would scale the panel's UI with the artwork.
  const [panelPos, setPanelPos] =
    useState<{ left: number; top: number; width: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Whether this session has applied any keystroke yet — the first one opens
  // the undo step, and Escape has nothing to undo before it.
  const edited = useRef(false);

  // Drag-to-move: pointerdown on a draggable element arms a vertical drag;
  // crossing a 3px threshold opens ONE undo step (first=true) and every
  // further move coalesces into it — the same session contract as onEditText.
  // The browser's synthesized click after pointerup lands on the element at
  // its NEW position (it moved with the cursor), so selection stays correct
  // with no click suppression.
  const drag = useRef<{
    id: ElementId; startClientY: number; base: number;
    pxPerPt: number; started: boolean;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || editing || !measure) return;
    const id = hitOf(e);
    if (!id || !dragTarget(cfg, collab, id)) return;
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = {
      id, startClientY: e.clientY, started: false,
      base: dragTarget(cfg, collab, id)!.get(), pxPerPt: r.height / PAGE.h,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dyPx = e.clientY - d.startClientY;
    if (!d.started && Math.abs(dyPx) < 3) return; // plain click, no undo step
    const first = !d.started;
    d.started = true;
    onNudge(d.id, d.base + dyPx / d.pxPerPt, first);
  }
  function onPointerUp() { drag.current = null; }

  // Escape mid-drag: undo the single step the drag opened (mirrors the
  // in-place editor's Escape) and drop the in-flight session so a further
  // pointermove (the pointer capture is still live until pointerup) can't
  // resume it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (drag.current?.started) onNudgeCancel();
      drag.current = null;
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onNudgeCancel]);

  // Report in-place sessions (editing with no floating panel) so App can
  // skip the element from the render via planLabel's render flag for the
  // session's duration. One effect covers every open/close path — Enter,
  // Escape, click-away.
  useEffect(() => {
    onEditSession(editing && !panelPos ? editing : null);
    // onEditSession is a useState setter in App — identity-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, panelPos]);

  // Click-away ends the session (capture phase, so it beats stopPropagation
  // anywhere in the app). The panel lives outside this component's DOM tree,
  // so "inside the panel" must be asked of the panel node itself.
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !panelRef.current?.contains(e.target)) setEditing(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editing]);

  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const id = hitOf(e);
    const spec = id ? editableText[id] : undefined;
    if (!id || !spec || !measure) return;
    // Anchor over the element itself: union of its hit boxes (the
    // description spans one per drawn line), mapped page → viewport px off
    // the same rect the click math uses. Clamped so the right rotated
    // column's panel stays on screen. Captured once — the panel doesn't
    // chase pan/zoom mid-session, it just closes on the next click-away.
    const boxes = boxesFor([id], cfg, measure, collab);
    if (!boxes.length) return;
    const b = boxes.reduce((a, x) => ({
      id: a.id, x0: Math.min(a.x0, x.x0), y0: Math.min(a.y0, x.y0),
      x1: Math.max(a.x1, x.x1), y1: Math.max(a.y1, x.y1),
    }));
    // Unrotated single-line elements edit truly IN PLACE: an invisible
    // input over the element (see the overlay below) whose text is the
    // live canvas render itself — no floating field, so no panelPos.
    if (!spec.multiline && !spec.rotated) {
      setPanelPos(null);
      edited.current = false;
      setEditing(id);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    // Floating cases — the description's WYSIWYG block and the rotated
    // column's small field — anchor over the element: at least as wide as
    // it, never narrower than a usable field.
    const boxLeft = r.left + (b.x0 / PAGE.w) * r.width;
    const boxTop = r.top + (b.y0 / PAGE.h) * r.height;
    const boxW = ((b.x1 - b.x0) / PAGE.w) * r.width;
    const boxH = ((b.y1 - b.y0) / PAGE.h) * r.height;
    const width = Math.max(spec.multiline ? 340 : 200, boxW + 24);
    // ponytail: fixed clamp margins instead of measuring the field —
    // measure the real node if a size ever changes enough to clip.
    setPanelPos({
      width,
      left: Math.max(8, Math.min(boxLeft - 10, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(
        spec.multiline ? boxTop - 8 : boxTop + boxH / 2 - 14,
        window.innerHeight - 320,
      )),
    });
    edited.current = false;
    setEditing(id);
  }

  // Selection outline geometry, in label-space points (pageBox maps it to
  // percentages at render). Memoized: boxesFor re-measures every element,
  // the warning's word-by-word wrap included, and dragging the divider
  // re-renders this component per pointer-move frame without any of these
  // inputs changing — `selected` is memoized in App for exactly that reason.
  const selBoxes = useMemo(
    // One measurement pass for the whole selection (see boxesFor); elements
    // the renderer isn't drawing — an empty collab slot — come back absent
    // and simply get no outline.
    () => (measure ? boxesFor(selected, cfg, measure, collab) : []),
    [selected, cfg, measure, collab],
  );

  return (
    <div
      ref={pageElement}
      className="relative m-auto w-full overflow-hidden border border-border bg-input"
      style={{
        // Width cap in the style object, not the class list, so the 3D scene
        // can import the same number and frame its label to this sheet.
        maxWidth: PREVIEW_MAX_W,
        aspectRatio: `${PAGE.w} / ${PAGE.h}`,
        // Query container, so the in-place editor can size its invisible
        // glyphs as a share of the page height (cqh) at any zoom. Size
        // containment is safe here: this box is sized by width +
        // aspect-ratio, never by its contents.
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
      {/* ResizablePanelGroup is absolutely positioned over both canvases at
          the same inset-0 box, so it would otherwise swallow every click
          before it reaches this div's onClick. pointer-events-none here,
          restored to pointer-events-auto on just the handle below, keeps the
          divider draggable while letting clicks elsewhere fall through to
          the wrapper (pointer-events is inherited, so the two ResizablePanel
          placeholders stay non-interactive without their own override). */}
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
      {/* Trim guide: the ART box, i.e. PAGE minus 38px of bleed per side at
          600dpi. Percentages off PAGE so it tracks the wrapper at any size,
          same trick as the selection box below. */}
      {bleed && (
        // Drawn as four gradient edges rather than a border: the stroke has to
        // alternate two tones to stay legible over any art (see BLEED_STROKE).
        <div
          className="pointer-events-none absolute"
          style={{
            ...pageBox(ART.x, ART.y, ART.w, ART.h),
            ...BLEED_STROKE,
            ...cornerRadius(dieR, ART.w, ART.h),
          }}
        />
      )}
      {selBoxes.map((b) => (
        // Figma's selection read: a 1px accent stroke with a dark outer halo
        // so it stays visible over both the gold art and bare white stock (a
        // single-tone ring disappeared into one or the other), plus corner
        // ticks that make the box read as a selected object rather than as
        // more label art. Outline, not border/ring: it draws OUTSIDE the box,
        // so the outline can't shave a pixel off the element it marks.
        <div
          key={b.id}
          className="pointer-events-none absolute outline-1 outline-sky-400 outline-solid [box-shadow:0_0_0_2px_rgba(0,0,0,0.45)]"
          // SEL_PAD of air between the glyphs and the stroke, so the outline
          // frames the element instead of crowding its ascenders. In px, not
          // a % of the box: the gap should look the same on a two-character
          // ABV and on the description block.
          style={pageBox(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, SEL_PAD)}
        >
          {/* Four corner ticks, centred on the corners. Fixed px (not a % of
              the box) so a small element's handles don't shrink to nothing. */}
          {Object.entries(CORNER_CLASS).map(([corner, at]) => (
            <span
              key={corner}
              className={`absolute size-1.5 rounded-[1px] border border-sky-400 bg-background ${at}`}
            />
          ))}
        </div>
      ))}
      {/* IN-PLACE editor for unrotated single-line elements. App skips the
          element from the render for the session (see onEditSession),
          so this input's styled text IS the element while you type — same
          family (via the fonts.ts gate), size, weight, tracking, and fill,
          drawn by the DOM instead of the canvas render. The box (and the selection
          outline above) grow with the text as it's typed, and the real
          render takes back over the moment the session ends. */}
      {editing && !panelPos && measure && (() => {
        const spec = editableText[editing]!;
        const b = boxesFor([editing], cfg, measure, collab)[0];
        if (!b) return null;
        // Glyphs sized off the hit box — its height is ASC+DESC em by
        // construction (see hittest.ts) — as a share of page height in cqh,
        // so the editor tracks the preview at any zoom. Tracking converts
        // the same way: it's absolute label-space points per glyph gap.
        const fontCqh = ((b.y1 - b.y0) / (FONT_ASC + FONT_DESC) / PAGE.h) * 100;
        const st = elementById(editing).style(cfg);
        return (
          <div
            ref={panelRef}
            className="absolute flex items-center"
            style={{
              ...pageBox(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, SEL_PAD),
              fontSize: `${fontCqh}cqh`,
              lineHeight: 1,
              fontFamily: LABEL_FONT_FAMILY,
              // The name draws in the true Bold face; other bold elements
              // mean SemiBold (the same convention measure/hit-test use).
              fontWeight: editing === "name" ? 700 : (st as StyledLine).bold ? 600 : 400,
              letterSpacing: `${((st.letterSpacing ?? 0) / PAGE.h) * 100}cqh`,
              // White-plate text renders white; anything else shows its fill
              // (flat — the metallic sheen is the print's, not the screen's).
              color: st.layer === "white" || st.fill === "none" ? "#FFFFFF" : st.fill,
            }}
            // The wrapper's click/dblclick handlers hit-test the canvas;
            // interacting with the editor must not re-select or reopen.
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={spec.get(cfg)}
              aria-label={`Edit ${editing} text`}
              // Caret at the end, no select-all: a highlighted block over
              // the artwork reads as a smudge, and typing usually appends.
              onFocus={(e) => {
                const end = e.currentTarget.value.length;
                e.currentTarget.setSelectionRange(end, end);
              }}
              onChange={(e) => {
                const v = spec.numeric
                  ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value;
                onEditText(editing, v, !edited.current);
                edited.current = true;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditing(null);
                if (e.key === "Escape") {
                  if (edited.current) onEditCancel();
                  setEditing(null);
                }
              }}
              className="h-full bg-transparent px-1 outline-none caret-sky-400"
              style={{
                // The ABV input hugs its digits (1ch each, plus caret room)
                // so the redrawn unit tail sits right after the number.
                width: spec.numeric ? `${Math.max(spec.get(cfg).length, 1) + 1}ch` : "100%",
                textAlign: spec.centred ? "center" : "left",
                textTransform: spec.upper ? "uppercase" : undefined,
              }}
            />
            {spec.numeric && (
              // The drawn "% alc by vol" tail is hidden with its element for
              // the session, so the editor re-draws it, uneditable, in the
              // same style right after the number.
              <span className="whitespace-nowrap">% alc by vol</span>
            )}
          </div>
        );
      })()}
      {/* Floating text editor, portaled to <body> (see panelPos), for the
          description's WYSIWYG block and the rotated column's fields. The
          drawn render is still the live text — every keystroke updates the
          config and the canvas repaints the real style. The element's
          outline comes from the selection boxes above (double-clicking
          selects it). */}
      {editing && panelPos && (() => {
        const spec = editableText[editing]!;
        const value = spec.get(cfg); // live: keystrokes land in cfg, so bind it
        const apply = (v: string) => {
          onEditText(editing, v, !edited.current);
          edited.current = true;
        };
        const close = () => setEditing(null);
        return createPortal(
          <div
            ref={panelRef}
            // No chrome for the rotated column's bare field — anything more
            // reads as a popup. The description gets a light glass ground so
            // its WYSIWYG toolbar sits legibly on top of the field without
            // walling the artwork off behind a solid card.
            className={cn(
              "fixed z-50",
              spec.multiline && "rounded-lg bg-background/70 p-1.5 shadow-sm backdrop-blur-sm",
            )}
            style={{ left: panelPos.left, top: panelPos.top, width: panelPos.width }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (edited.current) onEditCancel();
                close();
              }
            }}
          >
            {spec.multiline ? (
              // The description keeps its full WYSIWYG field: buttons style
              // the rendered lines, raw markdown only behind the editor's
              // own "Edit as Markdown" toggle — same field as the sidebar.
              <DescriptionEditor value={value} base={cfg.descStyle} onChange={apply} />
            ) : (
              <div className="flex items-center gap-1.5">
                <Input
                  autoFocus
                  aria-label={`Edit ${editing} text`}
                  // Opaque over the artwork — the stock input is transparent,
                  // which would show the drawn text through the field.
                  className="h-7 bg-background text-xs shadow-sm dark:bg-background"
                  value={value}
                  onChange={(e) => apply(
                    spec.numeric ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") close(); }}
                />
                {spec.numeric && (
                  // Chip-backed so the unit stays legible straight over the
                  // artwork now that there's no panel behind it.
                  <span className="whitespace-nowrap rounded bg-background/85 px-1 text-xs text-muted-foreground">
                    % alc by vol
                  </span>
                )}
              </div>
            )}
          </div>,
          document.body,
        );
      })()}
    </div>
  );
});
