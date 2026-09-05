// PreviewCompare.tsx — the single preview: both plates painted straight from
// the display list by the canvas backend and stacked; a resizable divider
// reveals the white-ink layer (left side) over the art (right side). Click
// selects the element under the cursor; double-clicking a text element
// (see elements.ts's editableText) edits it IN PLACE over the artwork —
// every element becomes live DOM text where it sits: the markdown-backed
// ones (the description block, the Info row) as the WYSIWYG field with a
// floating pill toolbar, the rotated column turned -90deg with the text,
// everything else a plain styled input — applying live, one undo step per
// session. Pointer-down on a draggable element (see
// elements.ts's dragTarget) arms a vertical drag that nudges its offsetY
// live, folded into one undo step the same way.
import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { drawPlate, planFrom, type CanvasRenderSource } from "@/canvas/draw";
import { labelGuides, type Face, type MeasureFace } from "@/plan";
import { anchoredX, anchoredY, positionFromDrag, type LayerPosition } from "@/model/position";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  ART, BLEED_SHIFT, DESC, FONT_ASC, FONT_DESC, GOLD, HANDLE_ADDR, PAGE, PREVIEW_MAX_W,
  PREVIEW_RASTER_MAX_EDGE, previewRasterScale, trackedWidth,
} from "@/layout";
import type { LabelConfig, Style, StyledLine } from "@/types";
import {
  dragTarget2, editableText, elementById, type EditableText, type ElementId,
} from "@/elements";
import { fontFamilyOf } from "@/fontCatalog";
import { FACE_WEIGHT, labelFontCss } from "@/fonts";
import {
  DescriptionToolbarButtons, useDescriptionField, type LinePaint,
} from "@/components/DescriptionEditor";
import { boxOf, boxesFor, hitTest, type CollabSlots, type Measure } from "@/hittest";
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
 *  label's short side (see settings.ts), and the label is the trimmed piece —
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

/** An in-place field's painter, for an element that draws in `base` and its
 *  `**bold**` runs in `boldFace` — the same pair plan.ts hands the renderers
 *  (see its rotatedRuns/lineRuns calls). The same data-driven flags the
 *  sidebar field paints, but at label metrics: weight and ink only, since
 *  size/leading/family live on the container. FACE_WEIGHT is the one
 *  face→CSS-weight table measure and draw already share, so the editor
 *  can't paint a weight the canvas wouldn't. whitespace-pre because neither
 *  renderer auto-wraps a line, so the editor must not either. */
function paintFor(faces: { base: Face; bold: Face }, st: StyledLine): LinePaint {
  // The element's Bold checkbox is a FLOOR, not a flag the markdown can
  // clear: parseInfoLine ORs it into the drawn line, so the editor must too
  // or a bold Info row loses a weight for the session (its own text carries
  // no `**`, so the line reads unbold here).
  const plainWeight = String(FACE_WEIGHT[st.bold ? faces.bold : faces.base]);
  const boldWeight = String(FACE_WEIGHT[faces.bold]);
  // The element's own ink, exactly as the plain in-place input resolves it —
  // the canvas is skipping this element, so the field IS the element, and a
  // hardcoded gold would make a re-inked block jump colour for the session.
  const ink = inkOf(st);
  return (el, l) => {
    el.className = "whitespace-pre outline-none";
    el.style.fontWeight = l.bold ? boldWeight : plainWeight;
    el.style.color = l.white ? "#FFFFFF" : ink;
  };
}

/** What an element's style paints as on screen: white-plate text renders
 *  white, anything else shows its fill (flat — the metallic sheen is the
 *  print's, not the screen's). */
const inkOf = (st: Style) =>
  (st.layer === "white" || st.fill === "none" ? "#FFFFFF" : st.fill);

/** The IN-PLACE session for a markdown-backed element — the description
 *  block and the rotated Info row: the same rich-lines engine as the sidebar
 *  field (useDescriptionField), but the contenteditable sits over the
 *  element's own spot on the sheet at label metrics, so `**bold**` and
 *  `_white ink_` show as bold and white ink rather than as punctuation. The
 *  canvas skips the element for the session (see onEditSession), so this DOM
 *  text IS the element while you type, and the Bold/White-ink toggles (plus
 *  Header, for the block) float above it as a fixed pill, portaled to <body>
 *  so App's CSS zoom scales the text with the artwork but never the toolbar
 *  chrome. */
function InPlaceRichField(props: {
  value: string;
  /** The element's own style: the base a `_white ink_` marker overrides,
   *  what linesToMarkdown compares against, and the ink and bold floor the
   *  painter draws with. */
  base: StyledLine;
  fontCss: string;
  /** What the element draws as — size and leading in points, and its face
   *  pair. Straight off the spec (editableText[id].rich), which is also what
   *  says the element gets this field at all. */
  metrics: NonNullable<EditableText["rich"]>;
  /** Union hit box of the drawn lines, label-space points — the anchor. */
  box: { x0: number; y0: number; y1: number };
  /** Drawn rotated 90deg CCW in the right column (Info): the whole field
   *  turns with the text, the way the plain in-place input does. */
  rotated?: boolean;
  /** Enter opens a new line (the description block) rather than ending the
   *  session (the Info row, which the renderer draws as ONE line). */
  multiline?: boolean;
  label: string;
  /** Pill position, viewport px, captured once at open. */
  toolbarPos: { left: number; top: number };
  onApply: (markdown: string) => void;
  /** Ends the session: Escape asks to undo it (`cancel`), Enter on a
   *  one-line field just closes — the plain in-place input's contract. */
  onClose: (cancel: boolean) => void;
  /** Click-away guards — the field wrapper and the portaled pill both count
   *  as "inside the session" (see the pointerdown capture effect). */
  fieldRef: React.RefObject<HTMLDivElement | null>;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}) {
  const {
    value, base, fontCss, metrics, box, rotated, multiline, label,
    toolbarPos, onApply, onClose, fieldRef, toolbarRef,
  } = props;
  const { size, leading, faces } = metrics;
  // Rebuilt only when the element's faces or ink change — the field seeds
  // from it, and every reseed repaints every line and run through it.
  const paint = useMemo(
    () => paintFor(faces, base),
    [faces, base.bold, base.fill, base.layer],
  );
  const { rootRef, caret, toggle, toggleHeader, fieldProps } =
    useDescriptionField({ value, base, onChange: onApply, paint });

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
  // leading edge is FONT_ASC beyond the baseline (see hittest.ts), while a
  // CSS line box of `leading` height centers the font's (FONT_ASC+FONT_DESC)
  // content area inside it — the half-leading difference is the offset
  // between the two. Rotated, that edge is the box's LEFT (the column grows
  // rightward from the baseline) rather than its top; everything else about
  // the field is identical, which is the point.
  const cross = ((FONT_ASC + FONT_DESC) * size - leading) / 2;
  // pageBox keeps this on the same coordinate basis as every other overlay.
  // Only the corner comes from the page mapping — the field states its own
  // width and never a height, so it auto-sizes to however many lines it
  // holds. That width is the room to type INTO, which is where the text
  // grows: to the sheet's right edge for the left-aligned, unwrapped
  // description block; up to its top edge for the rotated column, which
  // reads bottom-to-top from its own start.
  const place: React.CSSProperties = rotated
    // Turned about its own start corner, so that corner stays put and the
    // text runs upward — the canvas's rotate(-PI/2) (see draw.ts).
    ? {
        ...corner(box.x0 + cross, box.y1),
        width: cqh(box.y1),
        transformOrigin: "0 0",
        transform: "rotate(-90deg)",
      }
    // A share of the frame's WIDTH here (the block runs along page x), which
    // the aspect-ratio box makes equal to cqh up to subpixel rounding — the
    // rotated branch above measures along page y and uses cqh for it.
    : { ...corner(box.x0, box.y0 + cross), width: `${((PAGE.w - box.x0) / PAGE.w) * 100}%` };
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
          letterSpacing: cqh(base.letterSpacing ?? 0),
        }}
        // The wrapper's click/dblclick handlers hit-test the canvas;
        // interacting with the editor must not re-select or reopen.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose(true);
          // One drawn line means one field line: Enter ends the session
          // instead of opening a line the renderer would never draw. A
          // pasted newline still gets through (the hook's paste splits
          // lines); the consumer keeps the first line, and the blur reseed
          // makes the field agree.
          if (e.key === "Enter" && !multiline) { e.preventDefault(); onClose(false); }
        }}
      >
        <div
          {...fieldProps}
          aria-label={label}
          className="outline-none caret-sky-400"
        />
      </div>
      {createPortal(
        <div
          ref={toolbarRef}
          className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-md"
          style={toolbarPos}
        >
          {/* No Header toggle on a one-line field: the storage format's
              header slot is the description block's, and on the Info row a
              `# ` would only collapse back to bold (see parseInfoLine). */}
          <DescriptionToolbarButtons
            caret={caret} toggle={toggle} toggleHeader={toggleHeader} showHeader={!!multiline}
          />
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
    /** Called on every keystroke of an in-place session, so the canvas
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
    /** Two-axis drag-to-move for an unlocked custom layer (dragTarget2's
     *  "position" form): called on every pointermove past the 3px threshold
     *  with the anchor+offset positionFromDrag resolved, snapped to a guide
     *  within 6pt. Same first/coalesce contract as onNudge. */
    onNudgePosition: (id: ElementId, position: LayerPosition, first: boolean) => void;
    /** Escape mid-drag: App undoes the drag's single step, restoring the
     *  pre-drag position. Never called when the drag never crossed the
     *  threshold (a plain click). Shared by both the offsetY and position
     *  drag forms — either one folds into exactly one undo step. */
    onNudgeCancel: () => void;
    /** The element currently being edited on the preview, null when idle —
     *  every editable element edits in place. planLabel skips it via the
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
    onEditCancel, onNudge, onNudgePosition, onNudgeCancel, onEditSession, onSplit, bleed,
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

  // Built once: all three read refs, nothing from this render, so rebuilding
  // the handle per keystroke and per divider pointer-move frame was churn.
  useImperativeHandle(ref, () => ({
    // Numbers in resize() are pixels, not percent — units must be explicit.
    showArt: () => leftPanel.current?.resize("0%"),
    showMask: () => leftPanel.current?.resize("100%"),
    getPageElement: () => pageElement.current,
  }), []);

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

  // Inline text editing: double-click a text element to edit it IN PLACE
  // over the artwork — every element, the rotated column included (its
  // editor is the same field, turned with the text). Every keystroke goes
  // straight to the config (see onEditText's doc), so the drawn render is
  // the live feedback.
  const [editing, setEditing] = useState<ElementId | null>(null);
  // The in-place description's pill toolbar position (viewport px, captured
  // at open alongside the session). Only meaningful while editing the
  // description; stale values are harmless — the pill renders only then.
  const [toolbarPos, setToolbarPos] = useState({ left: 8, top: 8 });
  // The open session's click-away boundary, whatever shape the editor takes:
  // the in-place input's wrapper or the in-place description field.
  const sessionRef = useRef<HTMLDivElement>(null);
  // The pill portals to <body>, so click-away must ask it separately
  // whether a pointerdown was "inside the session".
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
  const drag = useRef<
    | {
        kind: "offsetY"; id: ElementId; startClientY: number; base: number;
        pxPerPt: number; started: boolean;
      }
    | {
        kind: "position"; id: ElementId; startClientX: number; startClientY: number;
        baseX: number; baseY: number; w: number; h: number;
        pxPerPtX: number; pxPerPtY: number; started: boolean;
      }
    | null
  >(null);

  // Which guide (if any) the in-flight position drag has snapped to, purely
  // to drive the guide-line highlight below — never read by the drag math
  // itself (positionFromDrag recomputes snapping fresh every move).
  const [snap, setSnap] = useState<{ x: "left" | "center" | "right" | null; y: "top" | "bottom" | null } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || editing || !measure) return;
    const id = hitOf(e);
    if (!id) return;
    // dragTarget2's box() wants a MeasureFace (face-based, three-way) while
    // this component only carries a Measure (bold-boolean, matching
    // hitTest); adapt as hittest.ts's own boxesOf does — semibold and bold
    // both count as "bold" for measurement, the same approximation every
    // hit box already makes.
    const mf: MeasureFace = (t, s, face) => measure(t, s, face !== "regular");
    const target = dragTarget2(cfg, collab, id, mf);
    if (!target) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (target.kind === "offsetY") {
      drag.current = {
        kind: "offsetY", id, startClientY: e.clientY, started: false,
        base: target.get(), pxPerPt: r.height / PAGE.h,
      };
    } else {
      const guides = labelGuides();
      const { w, h } = target.box() ?? { w: 0, h: 0 };
      const position = target.get();
      drag.current = {
        kind: "position", id,
        startClientX: e.clientX, startClientY: e.clientY,
        // Where the anchor+offset currently resolves to, in label-space
        // points — the drag adds pointer deltas onto this exactly the way
        // the offsetY form adds them onto its base.
        baseX: anchoredX(position, w, guides), baseY: anchoredY(position, h, guides),
        w, h, pxPerPtX: r.width / PAGE.w, pxPerPtY: r.height / PAGE.h,
        started: false,
      };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "offsetY") {
      const dyPx = e.clientY - d.startClientY;
      if (!d.started && Math.abs(dyPx) < 3) return; // plain click, no undo step
      const first = !d.started;
      d.started = true;
      onNudge(d.id, d.base + dyPx / d.pxPerPt, first);
      return;
    }
    const dxPx = e.clientX - d.startClientX;
    const dyPx = e.clientY - d.startClientY;
    if (!d.started && Math.hypot(dxPx, dyPx) < 3) return; // plain click, no undo step
    const first = !d.started;
    d.started = true;
    const x = d.baseX + dxPx / d.pxPerPtX;
    const y = d.baseY + dyPx / d.pxPerPtY;
    const { position, snappedX, snappedY } = positionFromDrag(x, y, d.w, d.h, labelGuides(), 6);
    setSnap({ x: snappedX, y: snappedY });
    onNudgePosition(d.id, position, first);
  }
  function onPointerUp() { drag.current = null; setSnap(null); }

  // Escape mid-drag: undo the single step the drag opened (mirrors the
  // in-place editor's Escape) and drop the in-flight session so a further
  // pointermove (the pointer capture is still live until pointerup) can't
  // resume it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (drag.current?.started) onNudgeCancel();
      drag.current = null;
      setSnap(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onNudgeCancel]);

  // Report the open session so App can skip the element from the render via
  // planLabel's render flag for its duration — the editor's DOM text is the
  // element while you type. One effect covers every open/close path — Enter,
  // Escape, click-away.
  useEffect(() => {
    onEditSession(editing);
    // onEditSession is a useState setter in App — identity-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Click-away ends the session (capture phase, so it beats stopPropagation
  // anywhere in the app). The description's pill portals outside this
  // component's DOM tree, so "inside the session" must be asked of that node
  // itself.
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
    // Every element edits truly IN PLACE — plain ones (rotated or not) as
    // an invisible input over the element, the markdown-backed ones (the
    // description block and the Info row) as the rich field over the same
    // spot with a pill toolbar floating above (see InPlaceRichField). All
    // of them leave the DOM text as the element while the canvas skips it
    // for the session.
    if (spec.rich) {
      // Anchor the pill over the element's hit box, mapped page → viewport
      // px off the same rect the click math uses. Viewport px, captured
      // once, because the pill portals to <body>: App's CSS zoom can't scale
      // it there and the preview's overflow-hidden can't clip it near the
      // sheet's edge.
      const b = boxOf(id, cfg, measure, collab);
      if (!b) return;
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
    edited.current = false;
    setEditing(id);
  }

  // Every box this render needs — the selection outlines and the in-place
  // session's own anchor — from ONE measurement pass, in label-space points
  // (pageBox maps them to percentages at render).
  //
  // Memoized, and pooled into a single boxesFor call, because that call is
  // the expensive thing on the keystroke path: it re-plans and re-measures
  // every element, the warning's word-by-word column wrap included. Two
  // calls both keyed on `cfg` invalidated together on every keystroke of a
  // session and paid for that pass twice. Dragging the divider re-renders
  // per pointer-move frame with none of these inputs changing, which the
  // memo covers — `selected` is memoized in App for exactly that reason.
  const boxes = useMemo(
    // Elements the renderer isn't drawing — an empty collab slot — come back
    // absent, and simply get no outline and no editor anchor.
    () => (measure
      ? boxesFor([...new Set(editing ? [...selected, editing] : selected)], cfg, measure, collab)
      : []),
    [selected, editing, cfg, measure, collab],
  );
  const selBoxes = useMemo(
    () => boxes.filter((b) => selected.includes(b.id)),
    [boxes, selected],
  );
  // One box, already the union of the element's drawn lines (see boxesFor),
  // with a stable identity so the editor's `box` prop doesn't churn.
  const editBox = useMemo(
    () => boxes.find((b) => b.id === editing) ?? null,
    [boxes, editing],
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
      {/* Snap-guide highlight: while a two-axis custom-layer drag is engaged
          on a guide (positionFromDrag's snappedX/Y, within its 6pt
          threshold), draw a thin accent line at the engaged edge — the same
          minimal treatment as the trim guide above, just for whichever axis
          is currently snapped. labelGuides() is measured at MEASURED_BLEED
          (a frozen basis), while this overlay draws at the live bleed, so
          BLEED_SHIFT re-bases it the same way hittest.ts's boxesOf does for
          selection boxes. */}
      {snap?.x && (() => {
        const g = labelGuides();
        const at = (snap.x === "left" ? g.left : snap.x === "right" ? g.right : g.center) + BLEED_SHIFT;
        return (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-sky-400"
            style={pageBox(at, 0, 0, PAGE.h)}
          />
        );
      })()}
      {snap?.y && (() => {
        const g = labelGuides();
        const at = (snap.y === "top" ? g.top : g.bottom) + BLEED_SHIFT;
        return (
          <div
            className="pointer-events-none absolute inset-x-0 h-px bg-sky-400"
            style={pageBox(0, at, PAGE.w, 0)}
          />
        );
      })()}
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
      {/* IN-PLACE editor — the ONE editor every element gets. App skips the
          the render for the session (see onEditSession), so the editor's
          styled text IS the element while you type — same family (via the
          fonts.ts gate), size, weight, tracking, and fill, drawn by the DOM
          instead of the canvas render. The box (and the selection outline
          above) grow with the text as it's typed, and the real render takes
          back over the moment the session ends. Markdown-backed elements get
          the rich field with its pill toolbar; everything else the plain
          styled input below, turned with the text for the rotated column. */}
      {editing && measure && (() => {
        const spec = editableText[editing]!;
        const el = elementById(editing);
        // The element's own style: the ink and weight both editors paint
        // with, and the base a `_white ink_` marker overrides.
        const st = el.style(cfg) as StyledLine;
        const label = `Edit ${el.label.toLowerCase()} text`;
        const b = editBox;
        if (!b) return null;
        if (spec.rich) {
          return (
            <InPlaceRichField
              value={spec.get(cfg)}
              base={st}
              fontCss={canvasRender?.fontCss ?? labelFontCss(fontFamilyOf(cfg))}
              metrics={spec.rich}
              box={b}
              rotated={spec.rotated}
              multiline={spec.multiline}
              label={label}
              toolbarPos={toolbarPos}
              onApply={(v) => {
                onEditText(editing, v, !edited.current);
                edited.current = true;
              }}
              onClose={(cancel) => {
                if (cancel && edited.current) onEditCancel();
                setEditing(null);
              }}
              fieldRef={sessionRef}
              toolbarRef={toolbarRef}
            />
          );
        }
        // Glyphs sized off the hit box — the ASC+DESC em axis is its height
        // unrotated, its width in the rotated column (see hittest.ts) — as a
        // share of page height in cqh, so the editor tracks the preview at
        // any zoom. Tracking converts the same way: it's absolute
        // label-space points per glyph gap. Both axes are points against a
        // wrapper whose aspect ratio is locked to the page, so cqh is the
        // right unit for a page-x span too.
        const em = spec.rotated ? b.x1 - b.x0 : b.y1 - b.y0;
        // The drawn glyph size in label points — the em box read back out of
        // the font's own ascent/descent. One derivation, used by both the
        // container's fontSize and the measured field width below, so the
        // two can't disagree about how big a glyph is.
        const size = em / (FONT_ASC + FONT_DESC);
        // A suffixed field (the ABV's unit tail) has to END where its glyphs
        // end, so the redrawn tail lands where the render will put it: the
        // same Measure and trackedWidth the canvas draws and hit-tests with,
        // plus the one trailing gap CSS letter-spacing adds after the last
        // glyph (which the ink measure excludes), plus 2px of caret room.
        // Every other field keeps the full box — shrinking those to their
        // glyphs would only shrink the click target.
        const typed = spec.get(cfg);
        const ls = st.letterSpacing ?? 0;
        const fieldWidth = spec.suffix
          ? `calc(${cqh(trackedWidth(measure(typed, size, !!st.bold), typed, ls) + ls)} + 2px)`
          : "100%";
        return (
          <div
            ref={sessionRef}
            className="absolute"
            style={{
              ...pageBox(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, SEL_PAD),
              fontSize: cqh(size),
              lineHeight: 1,
              // canvasRender.fontCss wins when the render source is ready
              // (it's the family the canvas is actually painting with); the
              // fontFamilyOf(cfg) fallback only covers the gap before the
              // first assembly lands. Both resolve the same family, since
              // canvasRender is itself assembled from fontFamilyOf(cfg).
              fontFamily: canvasRender?.fontCss ?? labelFontCss(fontFamilyOf(cfg)),
              // The name draws in the true Bold face; other bold elements
              // mean SemiBold (the same convention measure/hit-test use).
              fontWeight: FACE_WEIGHT[
                editing === "name" ? "bold" : st.bold ? "semibold" : "regular"
              ],
              letterSpacing: cqh(st.letterSpacing ?? 0),
              color: inkOf(st),
            }}
            // The wrapper's click/dblclick handlers hit-test the canvas;
            // interacting with the editor must not re-select or reopen.
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {/* The row the field sits on. Unrotated it just fills the hit
                box; rotated it is the SAME row, sized to the drawn column,
                centred in the (tall, narrow) box and turned -90deg to match
                the canvas (see draw.ts). Text reads bottom-to-top
                afterwards, so the row's left edge is the baseline's start
                and it grows upward exactly as the box does. */}
            <div
              className="absolute flex items-center"
              style={spec.rotated ? {
                left: "50%",
                top: "50%",
                width: cqh(b.y1 - b.y0),
                height: cqh(b.x1 - b.x0),
                transform: "translate(-50%, -50%) rotate(-90deg)",
              } : { inset: 0 }}
            >
              <input
                autoFocus
                value={typed}
                aria-label={label}
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
                // A measured field gives up its side padding too: width is
                // border-box, so padding would push the redrawn tail back
                // out. Keyed on the suffix, not on `numeric` — being a number
                // is what filters the KEYSTROKES, having a tail is what
                // constrains the WIDTH.
                className={cn("h-full bg-transparent outline-none caret-sky-400",
                  !spec.suffix && "px-1")}
                style={{
                  width: fieldWidth,
                  textAlign: spec.centred ? "center" : "left",
                  textTransform: spec.upper ? "uppercase" : undefined,
                }}
              />
              {spec.suffix && (
                // The drawn tail (the ABV's unit) is hidden with its element
                // for the session, so the editor redraws it, uneditable, in
                // the same style right after the number.
                <span className="whitespace-nowrap">{spec.suffix}</span>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
});
