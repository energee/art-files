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
import { ART, PAGE } from "@/layout";
import type { LabelConfig } from "@/types";
import type { ElementId } from "@/elements";
import { boxOf, hitTest, type CollabSlots, type Measure } from "@/hittest";
import type { SelectMods } from "@/selection";
import { cn } from "@/lib/utils";

/** The selection box's four corner ticks, as top/bottom + left/right. */
const CORNERS = ["tl", "tr", "bl", "br"] as const;

/** Breathing room between an element's measured box and its selection
 *  outline, in screen px. */
const SEL_PAD = 4;

// ponytail: fixed oversample, CSS downscales; add a ResizeObserver only if
// crispness on very large screens ever matters.
const RENDER_SCALE = 2.5;

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
  if (canvas) await renderPdfPage(bytes, { canvas, scale: RENDER_SCALE, isCancelled });
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
  }
>(function PreviewCompare(
  { artBytes, maskBytes, cfg, measure, collab, selected, onPick, onSplit, bleed },
  ref,
) {
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
    const xPt = ((e.clientX - r.left) / r.width) * PAGE.w;
    const yPt = ((e.clientY - r.top) / r.height) * PAGE.h;
    onPick(hitTest(xPt, yPt, measure, cfg, collab),
      { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
  }

  // Selection outline geometry, as a percentage box so it tracks the
  // container at any on-screen size without its own resize handling.
  // Memoized: boxOf rebuilds every element's box (including the warning's
  // word-by-word wrap measurement), and dragging the divider re-renders this
  // component per pointer-move frame without any of these inputs changing.
  const selBoxes = useMemo(
    // boxOf returns null for an element the renderer isn't drawing (an empty
    // collab slot); those simply get no outline.
    () => (measure
      ? selected
        .map((id) => [id, boxOf(id, cfg, measure, collab)] as const)
        .filter((pair): pair is [ElementId, NonNullable<typeof pair[1]>] => pair[1] !== null)
      : []),
    [selected, cfg, measure, collab],
  );

  return (
    <div
      className="relative m-auto w-full max-w-[900px] overflow-hidden rounded-md border border-border bg-input"
      style={{ aspectRatio: `${PAGE.w} / ${PAGE.h}` }}
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
        <div
          className="pointer-events-none absolute border border-dashed border-destructive/70"
          style={{
            left: `${(ART.x / PAGE.w) * 100}%`,
            top: `${(ART.y / PAGE.h) * 100}%`,
            width: `${(ART.w / PAGE.w) * 100}%`,
            height: `${(ART.h / PAGE.h) * 100}%`,
          }}
        />
      )}
      {selBoxes.map(([id, selBox]) => (
        // Figma's selection read: a 1px accent stroke with a dark outer halo
        // so it stays visible over both the gold art and bare white stock (a
        // single-tone ring disappeared into one or the other), plus corner
        // ticks that make the box read as a selected object rather than as
        // more label art. Outline, not border/ring: it draws OUTSIDE the box,
        // so the outline can't shave a pixel off the element it marks.
        <div
          key={id}
          className="pointer-events-none absolute outline-1 outline-sky-400 outline-solid [box-shadow:0_0_0_2px_rgba(0,0,0,0.45)]"
          // SEL_PAD of air between the glyphs and the stroke, so the outline
          // frames the element instead of crowding its ascenders. In px, not
          // a % of the box: the gap should look the same on a two-character
          // ABV and on the description block.
          style={{
            left: `calc(${(selBox.x0 / PAGE.w) * 100}% - ${SEL_PAD}px)`,
            top: `calc(${(selBox.y0 / PAGE.h) * 100}% - ${SEL_PAD}px)`,
            width: `calc(${((selBox.x1 - selBox.x0) / PAGE.w) * 100}% + ${SEL_PAD * 2}px)`,
            height: `calc(${((selBox.y1 - selBox.y0) / PAGE.h) * 100}% + ${SEL_PAD * 2}px)`,
          }}
        >
          {/* Four corner ticks, centred on the corners. Fixed px (not a % of
              the box) so a small element's handles don't shrink to nothing. */}
          {CORNERS.map((c) => (
            <span
              key={c}
              className={cn(
                "absolute size-1.5 rounded-[1px] border border-sky-400 bg-background",
                c.includes("t") ? "-top-[3px]" : "-bottom-[3px]",
                c.includes("l") ? "-left-[3px]" : "-right-[3px]",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
});
