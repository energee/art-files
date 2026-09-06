// Rulers.tsx — fixed screen-space rulers and preview-only layout/manual guides
// registered to the transformed 2D PDF page. Guides is one switch for every
// guide kind here (margin, center, manual) and for creating new ones; a manual
// guide is removed from the × that appears in the ruler when its handle is
// hovered, by dragging it back into a ruler, or with Delete while focused.
import {
  useEffect, useLayoutEffect, useMemo, useState, type PointerEvent, type RefObject,
} from "react";
import { ART, PAGE } from "@/layout";
import {
  clampMargin, layoutGuides, pointToScreen, pointToUnit, rulerTicks, screenToPoint,
  unitToPoint,
  type GuideAxis, type ManualGuide, type RulerUnit,
} from "@/rulers";
import { cn } from "@/lib/utils";
import type { PreviewCompareHandle } from "@/components/PreviewCompare";
import { ScrubField } from "@/components/ScrubField";
import { Label } from "@/components/ui/label";
import {
  Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const RULER_SIZE = 20;
/** The manual-guide × (px) — sits centred in the ruler's thickness. */
const REMOVE_SIZE = 14;
const MARGIN_STROKE = "stroke-cyan-500/70";
const CENTER_STROKE = "stroke-cyan-400/80 [stroke-dasharray:4_3]";

interface Geometry {
  width: number;
  height: number;
  paneLeft: number;
  paneTop: number;
  pageLeft: number;
  pageTop: number;
  pageWidth: number;
  pageHeight: number;
}

type Drag = { axis: GuideAxis; id?: number; point: number };

/** The compact form inside the ruler-corner settings popover. */
function RulerSettings(props: {
  unit: RulerUnit;
  onUnitChange: (unit: RulerUnit) => void;
  marginPt: number;
  onMarginChange: (points: number) => void;
}) {
  const { unit, onUnitChange, marginPt, onMarginChange } = props;
  const marginValue = pointToUnit(marginPt, 0, unit);
  const marginMax = pointToUnit(Math.min(ART.w, ART.h) / 2, 0, unit);
  const marginStep = unit === "in" ? 0.125 : unit === "px" ? 25 : 1;

  return (
    <div className="flex flex-col gap-2.5">
      <Label className="text-xs text-muted-foreground">Measurement</Label>
      <ToggleGroup value={[unit]} spacing={0} variant="outline"
        className="w-full" aria-label="Ruler measurement units"
        onValueChange={(value) => {
          if (value[0]) onUnitChange(value[0] as RulerUnit);
        }}>
        <ToggleGroupItem value="in" size="sm" className="min-w-0 flex-1">Inches</ToggleGroupItem>
        <ToggleGroupItem value="pt" size="sm" className="min-w-0 flex-1">Points</ToggleGroupItem>
        <ToggleGroupItem value="px" size="sm" className="min-w-0 flex-1">Pixels</ToggleGroupItem>
      </ToggleGroup>
      {/* The inspector's numeric field, so the inset scrubs like every other
          number in the app and clamps/rounds through the same snap(). */}
      <ScrubField id="guide-margin" label="Margin inset" unit={unit}
        value={Number(marginValue.toFixed(unit === "in" ? 3 : 0))}
        min={0} max={marginMax} step={marginStep}
        onChange={(value) => onMarginChange(clampMargin(unitToPoint(value, 0, unit)))} />
    </div>
  );
}

export function Rulers(props: {
  paneRef: RefObject<HTMLDivElement | null>;
  previewRef: RefObject<PreviewCompareHandle | null>;
  transform: { z: number; x: number; y: number };
  showRulers: boolean;
  unit: RulerUnit;
  onUnitChange: (unit: RulerUnit) => void;
  /** One switch for every guide kind — margin, center, manual — and for
   *  whether dragging off a ruler creates a new one. Decided once in App
   *  (it also gates the View menu), so nothing here re-derives it per kind. */
  showGuides: boolean;
  marginPt: number;
  onMarginChange: (points: number) => void;
  manual: readonly ManualGuide[];
  onAddManual: (axis: GuideAxis, point: number) => void;
  onMoveManual: (id: number, point: number) => void;
  onRemoveManual: (id: number) => void;
}) {
  const {
    paneRef, previewRef, transform, showRulers, unit, onUnitChange, showGuides,
    marginPt, onMarginChange, manual, onAddManual, onMoveManual, onRemoveManual,
  } = props;
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  function measure() {
    const pane = paneRef.current?.getBoundingClientRect();
    const page = previewRef.current?.getPageElement()?.getBoundingClientRect();
    if (!pane?.width || !pane.height || !page?.width || !page.height) return;
    setGeometry({
      width: pane.width,
      height: pane.height,
      paneLeft: pane.left,
      paneTop: pane.top,
      pageLeft: page.left - pane.left,
      pageTop: page.top - pane.top,
      pageWidth: page.width,
      pageHeight: page.height,
    });
  }

  // CSS transforms do not trigger ResizeObserver, so zoom/pan explicitly
  // re-measures; observers cover pane/sidebar and responsive page resizing.
  useLayoutEffect(() => { measure(); }, [transform.z, transform.x, transform.y]);
  useEffect(() => {
    const pane = paneRef.current;
    const page = previewRef.current?.getPageElement();
    if (!pane || !page) return;
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    observer.observe(page);
    return () => observer.disconnect();
  }, [paneRef, previewRef]);

  // Pointer readout lives here rather than in App, so moving across the page
  // re-renders only this small overlay instead of the complete editor. Not
  // attached at all when the rulers are hidden — the markers it feeds only
  // exist inside the ruler strips. The pane offset comes from the measured
  // geometry rather than a fresh rect: re-measuring per move is a forced
  // layout flush up to 120 times a second, and nothing can move the pane
  // without the measure above running anyway.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || !geometry || !showRulers) return;
    const move = (event: globalThis.PointerEvent) =>
      setCursor({ x: event.clientX - geometry.paneLeft, y: event.clientY - geometry.paneTop });
    const leave = () => setCursor(null);
    pane.addEventListener("pointermove", move);
    pane.addEventListener("pointerleave", leave);
    return () => {
      pane.removeEventListener("pointermove", move);
      pane.removeEventListener("pointerleave", leave);
    };
  }, [paneRef, geometry, showRulers]);

  const horizontalTicks = useMemo(() => geometry && showRulers ? rulerTicks({
    visibleStart: RULER_SIZE,
    visibleEnd: geometry.width,
    frameStart: geometry.pageLeft,
    frameSize: geometry.pageWidth,
    pageSize: PAGE.w,
    origin: ART.x,
    unit,
  }) : [], [geometry, showRulers, unit]);
  const verticalTicks = useMemo(() => geometry && showRulers ? rulerTicks({
    visibleStart: RULER_SIZE,
    visibleEnd: geometry.height,
    frameStart: geometry.pageTop,
    frameSize: geometry.pageHeight,
    pageSize: PAGE.h,
    origin: ART.y,
    unit,
  }) : [], [geometry, showRulers, unit]);
  const locked = useMemo(() => layoutGuides(marginPt), [marginPt]);

  if (!geometry) return null;

  const xOf = (point: number) =>
    pointToScreen(point, geometry.pageLeft, geometry.pageWidth, PAGE.w);
  const yOf = (point: number) =>
    pointToScreen(point, geometry.pageTop, geometry.pageHeight, PAGE.h);
  const pointAt = (axis: GuideAxis, event: PointerEvent<HTMLElement>) => axis === "x"
    ? screenToPoint(event.clientX - geometry.paneLeft, geometry.pageLeft, geometry.pageWidth, PAGE.w)
    : screenToPoint(event.clientY - geometry.paneTop, geometry.pageTop, geometry.pageHeight, PAGE.h);
  const contentStart = showRulers ? RULER_SIZE : 0;
  const overRuler = (event: PointerEvent<HTMLElement>) => showRulers && (
    event.clientX - geometry.paneLeft <= RULER_SIZE
    || event.clientY - geometry.paneTop <= RULER_SIZE
  );

  function startNew(axis: GuideAxis, event: PointerEvent<HTMLDivElement>) {
    if (!showGuides || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ axis, point: pointAt(axis, event) });
  }

  function startExisting(guide: ManualGuide, event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ axis: guide.axis, id: guide.id, point: guide.point });
  }

  function moveDrag(event: PointerEvent<HTMLElement>) {
    if (!drag) return;
    setDrag({ ...drag, point: pointAt(drag.axis, event) });
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (!drag) return;
    if (overRuler(event)) {
      if (drag.id !== undefined) onRemoveManual(drag.id);
    } else if (drag.id === undefined) onAddManual(drag.axis, drag.point);
    else onMoveManual(drag.id, drag.point);
    setDrag(null);
  }

  function cancelDrag() {
    setDrag(null);
  }

  const shownManual = showGuides ? manual : [];
  /** A guide line runs the full content box across its axis, stopping at the
   *  rulers. One shape for all four kinds — margin, center, manual, and the
   *  one being dragged — so a stroke or clipping change lands once. */
  const guideLine = (axis: GuideAxis, point: number, key: string, className: string) =>
    axis === "x" ? (
      <line key={key} x1={xOf(point)} x2={xOf(point)}
        y1={contentStart} y2={geometry.height} className={className} />
    ) : (
      <line key={key} x1={contentStart} x2={geometry.width}
        y1={yOf(point)} y2={yOf(point)} className={className} />
    );
  // The dragged guide is painted at its live point instead of its stored one;
  // a brand-new one (no id yet) is simply appended.
  const paintedManual = drag
    ? [...shownManual.filter((guide) => guide.id !== drag.id),
      { id: -1, axis: drag.axis, point: drag.point }]
    : shownManual;

  return (
    // The pane deselects on a click that misses the label sheet; this overlay
    // sits in the pane but is NOT pasteboard — dragging out a guide or hitting
    // a guide's remove button must not clear the selection.
    <div data-slot="rulers" className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <svg width={geometry.width} height={geometry.height} className="absolute inset-0" aria-hidden="true">
        {/* Guides are painted before the opaque rulers so lines stop cleanly
            at their edges even when the transformed page sits underneath. */}
        {showGuides && locked.verticalMargins.map((point, index) =>
          guideLine("x", point, `margin-x-${index}`, MARGIN_STROKE))}
        {showGuides && locked.horizontalMargins.map((point, index) =>
          guideLine("y", point, `margin-y-${index}`, MARGIN_STROKE))}
        {showGuides && guideLine("x", locked.center, "center-x", CENTER_STROKE)}
        {showGuides && guideLine("y", locked.middle, "center-y", CENTER_STROKE)}
        {paintedManual.map((guide) =>
          guideLine(guide.axis, guide.point, `manual-${guide.id}`, "stroke-primary"))}

        {showRulers && (
          <>
            {/* One continuous L-shaped surface. Separate stroked rectangles
                doubled the seams around the corner and made its trigger look
                like a small input pasted over the rulers. */}
            <rect width={geometry.width} height={RULER_SIZE} className="fill-sidebar" />
            <rect width={RULER_SIZE} height={geometry.height} className="fill-sidebar" />
            <line x1={0} x2={geometry.width} y1={RULER_SIZE} y2={RULER_SIZE}
              className="stroke-border" />
            <line x1={RULER_SIZE} x2={RULER_SIZE} y1={0} y2={geometry.height}
              className="stroke-border" />
            {horizontalTicks.map((tick) => (
              <g key={`x-${tick.value}`}>
                <line x1={tick.screen} x2={tick.screen} y1={tick.major ? 10 : 14}
                  y2={RULER_SIZE} className="stroke-muted-foreground" />
                {tick.label !== undefined && (
                  <text x={tick.screen + 2} y={8} className="fill-muted-foreground text-[8px]">
                    {tick.label}
                  </text>
                )}
              </g>
            ))}
            {verticalTicks.map((tick) => (
              <g key={`y-${tick.value}`}>
                <line x1={tick.major ? 10 : 14} x2={RULER_SIZE}
                  y1={tick.screen} y2={tick.screen} className="stroke-muted-foreground" />
                {tick.label !== undefined && (
                  <text transform={`translate(8 ${tick.screen - 2}) rotate(-90)`}
                    className="fill-muted-foreground text-[8px]">
                    {tick.label}
                  </text>
                )}
              </g>
            ))}
            {cursor && cursor.x > RULER_SIZE && cursor.y > RULER_SIZE && (
              <>
                <path d={`M ${cursor.x - 3} 0 h 6 l -3 5 z`} className="fill-primary" />
                <path d={`M 0 ${cursor.y - 3} v 6 l 5 -3 z`} className="fill-primary" />
              </>
            )}
          </>
        )}
      </svg>

      {/* Eight-pixel invisible handles make a one-pixel guide practical to
          grab without turning the whole overlay into a selection blocker.
          Each handle and its × share a `group` wrapper spanning the guide's
          full run, ruler included, so hovering anywhere along the guide
          reveals the × sitting in the ruler at the guide's own tick — and
          keyboard focus on the handle reveals it too. The × is inert until
          revealed: an invisible-but-clickable target in the ruler would
          delete a guide the moment someone dragged a new one out at the same
          spot. */}
      {shownManual.map((guide) => {
        const vertical = guide.axis === "x";
        const kind = vertical ? "Vertical" : "Horizontal";
        return (
          <div key={`hit-${guide.id}`}
            className={cn("group pointer-events-none absolute",
              vertical ? "top-0 bottom-0 w-0" : "left-0 right-0 h-0")}
            style={vertical ? { left: xOf(guide.point) } : { top: yOf(guide.point) }}>
            <div
              className={cn("pointer-events-auto absolute outline-none focus-visible:bg-primary/15",
                vertical
                  ? "left-0 bottom-0 w-2 -translate-x-1 cursor-col-resize"
                  : "top-0 right-0 h-2 -translate-y-1 cursor-row-resize")}
              style={vertical ? { top: contentStart } : { left: contentStart }}
              role="button" tabIndex={0}
              aria-label={`${kind} manual guide; press Delete to remove`}
              onPointerDown={(event) => startExisting(guide, event)}
              onKeyDown={(event) => {
                if (event.key === "Delete" || event.key === "Backspace") onRemoveManual(guide.id);
              }}
              onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} />
            <button type="button"
              aria-label={`Remove ${kind.toLowerCase()} manual guide`} title="Remove guide"
              onClick={() => onRemoveManual(guide.id)}
              className={cn(
                "absolute z-10 grid size-3.5 place-items-center rounded-sm bg-sidebar text-[10px] leading-none",
                "pointer-events-none text-muted-foreground opacity-0",
                "group-hover:pointer-events-auto group-hover:opacity-100",
                "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                "hover:bg-destructive hover:text-white focus-visible:ring-2 focus-visible:ring-ring",
                vertical ? "left-0 -translate-x-1/2" : "top-0 -translate-y-1/2")}
              style={vertical
                ? { top: (RULER_SIZE - REMOVE_SIZE) / 2 }
                : { left: (RULER_SIZE - REMOVE_SIZE) / 2 }}>
              ×
            </button>
          </div>
        );
      })}

      {showRulers && (
        <>
          {/* Sized from RULER_SIZE, not Tailwind literals that happen to
              match it: these strips have to stay flush with the painted
              rulers above, which read the constant. */}
          <div className={cn("pointer-events-auto absolute top-0 right-0",
              showGuides ? "cursor-row-resize" : "cursor-default")}
            style={{ left: RULER_SIZE, height: RULER_SIZE }}
            title={showGuides ? "Drag down to create a horizontal guide" : "Turn on Guides to add guides"}
            onPointerDown={(event) => startNew("y", event)}
            onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} />
          <div className={cn("pointer-events-auto absolute bottom-0 left-0",
              showGuides ? "cursor-col-resize" : "cursor-default")}
            style={{ top: RULER_SIZE, width: RULER_SIZE }}
            title={showGuides ? "Drag right to create a vertical guide" : "Turn on Guides to add guides"}
            onPointerDown={(event) => startNew("x", event)}
            onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} />
          <Popover>
            <PopoverTrigger
              style={{ height: RULER_SIZE, width: RULER_SIZE }}
              className="pointer-events-auto absolute top-0 left-0 z-10 grid place-items-center rounded-none bg-transparent p-0 text-[8px] leading-none font-normal text-muted-foreground outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              title={`Ruler settings — ${unit}`} aria-label={`Ruler settings, current unit ${unit}`}>
              {unit}
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-56 gap-3">
              <PopoverHeader>
                <PopoverTitle>Ruler settings</PopoverTitle>
              </PopoverHeader>
              <RulerSettings unit={unit} onUnitChange={onUnitChange}
                marginPt={marginPt} onMarginChange={onMarginChange} />
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
