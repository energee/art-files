// PreviewCompare.tsx — the single preview: both generated PDFs rendered to
// bitmaps via pdf.js and stacked; a resizable divider reveals the white-ink
// layer (left side) over the art (right side). Replaces <embed> + tabs.
import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { renderPdfPage } from "@/pdf/render";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ART, PAGE, PREVIEW_MAX_W, PREVIEW_OVERSAMPLE } from "@/layout";
import type { LabelConfig } from "@/types";
import type { ElementId } from "@/elements";
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

async function renderPdf(
  bytes: Uint8Array, canvas: HTMLCanvasElement | null, isCancelled: () => boolean,
) {
  // isCancelled: bytes can change while a render is in flight, and a slower
  // superseded render must not overwrite a newer one on the shared canvas.
  if (canvas) await renderPdfPage(bytes, { canvas, scale: PREVIEW_OVERSAMPLE, isCancelled });
}

/** Render `bytes` into `canvas` whenever they change. Renders are chained:
 *  pdf.js hard-throws on two concurrent render() calls into one canvas, so a
 *  new render must wait out the one in flight; superseded queued renders skip
 *  before copying bytes or opening a worker doc. The catch keeps a
 *  superseded/failed render from surfacing as an unhandled rejection. */
function useRenderPdf(bytes: Uint8Array | null, canvas: RefObject<HTMLCanvasElement | null>) {
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    if (bytes)
      chain.current = chain.current
        .then(() => (cancelled ? undefined : renderPdf(bytes, canvas.current, () => cancelled)))
        .catch(() => {});
    return () => { cancelled = true; };
  }, [bytes, canvas]);
}

export interface PreviewCompareHandle {
  showArt: () => void;
  showMask: () => void;
}

export const PreviewCompare = forwardRef<
  PreviewCompareHandle,
  {
    artBytes: Uint8Array | null;
    maskBytes: Uint8Array | null;
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
  }
>(function PreviewCompare(
  { artBytes, maskBytes, cfg, measure, collab, selected, onPick, onSplit, bleed, cornerRadiusPct },
  ref,
) {
  // The die at the trim line, and the sheet's own corners as that die offset
  // out by the bleed — an outward offset of a rounded rect grows its radius by
  // the offset, so the two edges stay concentric.
  const dieR = dieRadius(cornerRadiusPct);
  const artCanvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);
  const leftPanel = useRef<PanelImperativeHandle>(null);
  const [split, setSplit] = useState(0); // % width showing white-ink

  useImperativeHandle(ref, () => ({
    // Numbers in resize() are pixels, not percent — units must be explicit.
    showArt: () => leftPanel.current?.resize("0%"),
    showMask: () => leftPanel.current?.resize("100%"),
  }));

  useRenderPdf(artBytes, artCanvas);
  useRenderPdf(maskBytes, maskCanvas);

  // Click-to-select: the canvases fill the wrapper exactly and the wrapper's
  // aspect ratio is locked to PAGE.w/PAGE.h (see the style below), so a
  // click maps to label-space points proportionally off the bounding rect —
  // no separate art/mask coordinate math needed, both canvases share one box.
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!measure) return; // real metrics not in yet — skip rather than guess
    // The handle tracks the pointer while dragging, so at drag-end the
    // cursor (and the click the browser synthesizes right after mouseup) is
    // still over it; that click bubbles up through the pointer-events-none
    // ResizablePanelGroup to land here anyway. Ignore anything whose target
    // is the handle (or its grip child) so finishing a drag can't also
    // hit-test the divider's position and change or clear the selection.
    if (e.target instanceof Element && e.target.closest('[data-slot="resizable-handle"]')) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return; // not laid out yet (e.g. display:none)
    // getBoundingClientRect already reflects any CSS zoom App applies to the
    // preview pane, so the proportion holds at any scale without extra math.
    const xPt = ((e.clientX - r.left) / r.width) * PAGE.w;
    const yPt = ((e.clientY - r.top) / r.height) * PAGE.h;
    onPick(hitTest(xPt, yPt, measure, cfg, collab), modsOf(e));
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
      className="relative m-auto w-full overflow-hidden border border-border bg-input"
      style={{
        // Width cap in the style object, not the class list, so the 3D scene
        // can import the same number and frame its label to this sheet.
        maxWidth: PREVIEW_MAX_W,
        aspectRatio: `${PAGE.w} / ${PAGE.h}`,
        ...cornerRadius(dieR + BLEED, PAGE.w, PAGE.h),
      }}
      onClick={onClick}
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
    </div>
  );
});
