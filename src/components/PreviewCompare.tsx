// PreviewCompare.tsx — the single preview: both plates painted straight from
// the display list by the canvas backend and stacked; a resizable divider
// reveals the white-ink layer (left side) over the art (right side). Click
// selects the element under the cursor; double-clicking a text element
// (see elements.ts's editableText) edits it IN PLACE over the artwork —
// unrotated elements (the description included) become live DOM text where
// they sit, the description with a floating pill toolbar above it; only the
// rotated column still floats a small input beside its outline — applying
// live, one undo step per session. Pointer-down on a draggable element (see
// elements.ts's dragTarget) arms a vertical drag that nudges its offsetY
// live, folded into one undo step the same way.
import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { drawPlate, planFrom, type CanvasRenderSource } from "@/canvas/draw";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  ART, DESC, FONT_ASC, FONT_DESC, GOLD, PAGE, PREVIEW_MAX_W,
  PREVIEW_RASTER_MAX_EDGE, previewRasterScale,
} from "@/layout";
import type { LabelConfig, Style, StyledLine } from "@/types";
import { dragTarget, editableText, elementById, type ElementId } from "@/elements";
import { fontFamilyOf } from "@/fontCatalog";
import { labelFontCss } from "@/fonts";
import {
  DescriptionToolbarButtons, useDescriptionField, type LinePaint,
} from "@/components/DescriptionEditor";
import { Input } from "@/components/ui/input";
import { boxesFor, hitTest, type CollabSlots, type Measure } from "@/hittest";
import { modsOf, type SelectMods } from "@/selection";

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

/** The in-place description's per-line painter: the same data-driven flags
 *  the sidebar field paints, but at label metrics — weight and ink only,
 *  since size/leading/family live on the container (uniform: DESC and
 *  DESC_HEADER share size 9 / leading 10.8; the header differs by weight
 *  alone). Bold means the SemiBold face, the same convention the renderers
 *  and the single-line editor use. whitespace-pre because the canvas never
 *  auto-wraps description lines, so the editor must not either. Module
 *  constant, not a closure, so the hook's seed effect stays stable. */
const paintLabelLine: LinePaint = (el, l) => {
  el.className = "whitespace-pre outline-none";
  el.style.fontWeight = l.bold ? "600" : "400";
  el.style.color = l.white ? "#FFFFFF" : GOLD;
};

/** The description's IN-PLACE session: the same rich-lines engine as the
 *  sidebar field (useDescriptionField), but the contenteditable sits over
 *  the element's own spot on the sheet at label metrics — the canvas skips
 *  the element for the session (see onEditSession), so this DOM text IS the
 *  description while you type — and the Header/Bold/White-ink toggles float
 *  above it as a fixed pill, portaled to <body> so App's CSS zoom scales
 *  the text with the artwork but never the toolbar chrome. */
function InPlaceDescription(props: {
  value: string;
  base: Style;
  fontCss: string;
  /** Union hit box of the drawn lines, label-space points — the anchor. */
  box: { x0: number; y0: number };
  /** Pill position, viewport px, captured once at open (like panelPos). */
  toolbarPos: { left: number; top: number };
  onApply: (markdown: string) => void;
  onEscape: () => void;
  /** Click-away guards — the field wrapper and the portaled pill both count
   *  as "inside the session" (see the pointerdown capture effect). */
  fieldRef: React.RefObject<HTMLDivElement | null>;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { value, base, fontCss, box, toolbarPos, onApply, onEscape, fieldRef, toolbarRef } = props;
  const { rootRef, caret, toggle, toggleHeader, fieldProps } =
    useDescriptionField({ value, base, onChange: onApply, paint: paintLabelLine });

  // Focus with the caret at the end once on open — the hook's seed effect
  // registered first, so the line-divs exist by the time this runs. Caret at
  // the end, no select-all, matching the single-line editor's convention.
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

  // CSS positions the first BASELINE where the canvas drew it: the hit box's
  // top is FONT_ASC above the baseline (see hittest.ts), while a CSS line
  // box of `leading` height centers the font's (FONT_ASC+FONT_DESC) content
  // area inside it — the half-leading difference is the offset between the
  // two tops.
  const topPt = box.y0 + ((FONT_ASC + FONT_DESC) * DESC.size - DESC.leading) / 2;
  // pageBox keeps this on the same coordinate basis as every other overlay;
  // height is dropped so the field auto-sizes to its lines. The width runs
  // to the sheet's edge — the block is left-aligned and unwrapped, so that
  // is the room to type rightward.
  const { left, top, width } = pageBox(box.x0, topPt, PAGE.w - box.x0, 0);
  return (
    <>
      <div
        ref={fieldRef}
        className="absolute"
        style={{
          left, top, width,
          fontSize: `${(DESC.size / PAGE.h) * 100}cqh`,
          lineHeight: DESC.leading / DESC.size,
          fontFamily: fontCss,
          letterSpacing: `${((base.letterSpacing ?? 0) / PAGE.h) * 100}cqh`,
        }}
        // The wrapper's click/dblclick handlers hit-test the canvas;
        // interacting with the editor must not re-select or reopen.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onEscape(); }}
      >
        <div
          {...fieldProps}
          aria-label="Edit description text"
          className="outline-none caret-sky-400"
        />
      </div>
      {createPortal(
        <div
          ref={toolbarRef}
          className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-md"
          style={toolbarPos}
        >
          <DescriptionToolbarButtons caret={caret} toggle={toggle} toggleHeader={toggleHeader} />
        </div>,
        document.body,
      )}
    </>
  );
}

/** Union of several hit boxes — the description spans one per drawn line.
 *  Callers guarantee at least one box. */
const unionBox = (boxes: { x0: number; y0: number; x1: number; y1: number }[]) =>
  boxes.reduce((a, x) => ({
    x0: Math.min(a.x0, x.x0), y0: Math.min(a.y0, x.y0),
    x1: Math.max(a.x1, x.x1), y1: Math.max(a.y1, x.y1),
  }));

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
     *  the session floats — the rotated column). planLabel skips it via the
     *  render flag so the editor's live DOM text is the element. */
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
    // Follows the zoom in both directions — the settled density is paid again
    // on every repaint (which is per keystroke), so it has to come back down.
    // The debounce is what keeps the gesture itself cheap.
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
        // planFrom runs before any canvas is touched, so its throws (the
        // realistic failure) leave the last frame intact — the spec's
        // failed-frame policy.
        const plan = planFrom(cfg, canvasRender);
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
          const h = Math.round(rawH * cap);
          // Both dimensions guard the resize: when the long-edge cap pins
          // width, a bleed change moves only the height — a width-only
          // check left the canvas at the old aspect and CSS stretched it.
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          drawPlate(canvas.getContext("2d")!, plan, canvasRender.drawAssets, mode, canvasRender.fontCss);
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
  // The in-place description's pill toolbar position (viewport px, captured
  // at open alongside the session). Only meaningful while editing the
  // description; stale values are harmless — the pill renders only then.
  const [toolbarPos, setToolbarPos] = useState({ left: 8, top: 8 });
  // The open session's click-away boundary, whatever shape the editor takes:
  // the in-place input's wrapper, the in-place description field, or the
  // rotated column's floating panel.
  const sessionRef = useRef<HTMLDivElement>(null);
  // The pill portals to <body> like the floating panel does, so click-away
  // must ask it separately whether a pointerdown was "inside the session".
  const toolbarRef = useRef<HTMLDivElement>(null);
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
  // anywhere in the app). The rotated column's panel and the description's
  // pill both portal outside this component's DOM tree, so "inside the
  // session" must be asked of those nodes themselves.
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
    const spec = id ? editableText[id] : undefined;
    if (!id || !spec || !measure) return;
    // Anchor over the element itself: union of its hit boxes (the
    // description spans one per drawn line), mapped page → viewport px off
    // the same rect the click math uses. Clamped so the right rotated
    // column's panel stays on screen. Captured once — the panel doesn't
    // chase pan/zoom mid-session, it just closes on the next click-away.
    const boxes = boxesFor([id], cfg, measure, collab);
    if (!boxes.length) return;
    const b = unionBox(boxes);
    // Unrotated elements edit truly IN PLACE — no floating field, so no
    // panelPos: single-line ones as an invisible input over the element,
    // the description as the rich-lines field over its block with a pill
    // toolbar floating above (see InPlaceDescription). Both leave the DOM
    // text as the element while the canvas skips it for the session.
    if (!spec.rotated) {
      if (spec.multiline) {
        // Pill position in viewport px, captured once like panelPos was:
        // it portals to <body>, so App's CSS zoom can't scale it and the
        // preview's overflow-hidden can't clip it near the sheet's edge.
        const r = e.currentTarget.getBoundingClientRect();
        const boxLeft = r.left + (b.x0 / PAGE.w) * r.width;
        const boxTop = r.top + (b.y0 / PAGE.h) * r.height;
        // ponytail: fixed clamps sized to the three-toggle pill (~140x40px)
        // instead of measuring it — measure toolbarRef if its content grows.
        setToolbarPos({
          left: Math.max(8, Math.min(boxLeft, window.innerWidth - 148)),
          top: Math.max(8, boxTop - 48),
        });
      }
      setPanelPos(null);
      edited.current = false;
      setEditing(id);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    // The one floating case left — the rotated column's small field —
    // anchors over the element: at least as wide as it, never narrower
    // than a usable field.
    const boxLeft = r.left + (b.x0 / PAGE.w) * r.width;
    const boxTop = r.top + (b.y0 / PAGE.h) * r.height;
    const boxW = ((b.x1 - b.x0) / PAGE.w) * r.width;
    const boxH = ((b.y1 - b.y0) / PAGE.h) * r.height;
    const width = Math.max(200, boxW + 24);
    // ponytail: fixed clamp margins instead of measuring the field —
    // measure the real node if a size ever changes enough to clip.
    setPanelPos({
      width,
      left: Math.max(8, Math.min(boxLeft - 10, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(boxTop + boxH / 2 - 14, window.innerHeight - 320)),
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

  // The in-place session's own measurement pass, memoized for the same
  // reason as selBoxes: every keystroke of the session changes cfg and
  // re-renders this component, and boxesFor re-measures every element.
  const editBoxes = useMemo(
    () => (editing && measure ? boxesFor([editing], cfg, measure, collab) : []),
    [editing, cfg, measure, collab],
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
      {/* IN-PLACE editor for unrotated elements. App skips the element from
          the render for the session (see onEditSession), so the editor's
          styled text IS the element while you type — same family (via the
          fonts.ts gate), size, weight, tracking, and fill, drawn by the DOM
          instead of the canvas render. The box (and the selection outline
          above) grow with the text as it's typed, and the real render takes
          back over the moment the session ends. The description gets the
          rich-lines field with its pill toolbar; everything else the plain
          styled input below. */}
      {editing && !panelPos && measure && (() => {
        const spec = editableText[editing]!;
        if (spec.multiline) {
          if (!editBoxes.length) return null;
          return (
            <InPlaceDescription
              value={spec.get(cfg)}
              base={cfg.descStyle}
              fontCss={canvasRender?.fontCss ?? labelFontCss(fontFamilyOf(cfg))}
              box={unionBox(editBoxes)}
              toolbarPos={toolbarPos}
              onApply={(v) => {
                onEditText(editing, v, !edited.current);
                edited.current = true;
              }}
              onEscape={() => {
                if (edited.current) onEditCancel();
                setEditing(null);
              }}
              fieldRef={sessionRef}
              toolbarRef={toolbarRef}
            />
          );
        }
        const b = editBoxes[0];
        if (!b) return null;
        // Glyphs sized off the hit box — its height is ASC+DESC em by
        // construction (see hittest.ts) — as a share of page height in cqh,
        // so the editor tracks the preview at any zoom. Tracking converts
        // the same way: it's absolute label-space points per glyph gap.
        const fontCqh = ((b.y1 - b.y0) / (FONT_ASC + FONT_DESC) / PAGE.h) * 100;
        const st = elementById(editing).style(cfg);
        return (
          <div
            ref={sessionRef}
            className="absolute flex items-center"
            style={{
              ...pageBox(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, SEL_PAD),
              fontSize: `${fontCqh}cqh`,
              lineHeight: 1,
              // canvasRender.fontCss wins when the render source is ready
              // (it's the family the canvas is actually painting with); the
              // fontFamilyOf(cfg) fallback only covers the gap before the
              // first assembly lands. Both resolve the same family, since
              // canvasRender is itself assembled from fontFamilyOf(cfg).
              fontFamily: canvasRender?.fontCss ?? labelFontCss(fontFamilyOf(cfg)),
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
          rotated column's fields — the one case that can't edit in place
          (the DOM text would have to lie on its side). The drawn render is
          still the live text — every keystroke updates the config and the
          canvas repaints the real style. The element's outline comes from
          the selection boxes above (double-clicking selects it). */}
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
            ref={sessionRef}
            // No chrome for the bare field — anything more reads as a popup.
            className="fixed z-50"
            style={{ left: panelPos.left, top: panelPos.top, width: panelPos.width }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (edited.current) onEditCancel();
                close();
              }
            }}
          >
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
          </div>,
          document.body,
        );
      })()}
    </div>
  );
});
