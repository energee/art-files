// Rulers.tsx — fixed screen-space rulers and preview-only layout/manual guides
// registered to the transformed 2D PDF page.
import {
  useEffect, useLayoutEffect, useMemo, useState, type PointerEvent, type RefObject,
} from "react";
import { ART, PAGE } from "@/layout";
import {
  clampMargin, layoutGuides, pointToScreen, rulerTicks, screenToPoint,
  type GuideAxis, type ManualGuide, type RulerUnit,
} from "@/rulers";
import type { PreviewCompareHandle } from "@/components/PreviewCompare";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const RULER_SIZE = 20;

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

export function Rulers(props: {
  paneRef: RefObject<HTMLDivElement | null>;
  previewRef: RefObject<PreviewCompareHandle | null>;
  transform: { z: number; x: number; y: number };
  showRulers: boolean;
  unit: RulerUnit;
  onUnitChange: (unit: RulerUnit) => void;
  showMargins: boolean;
  showCenter: boolean;
  showManual: boolean;
  marginPt: number;
  onMarginChange: (points: number) => void;
  manual: readonly ManualGuide[];
  onAddManual: (axis: GuideAxis, point: number) => void;
  onMoveManual: (id: number, point: number) => void;
  onRemoveManual: (id: number) => void;
}) {
  const {
    paneRef, previewRef, transform, showRulers, unit, onUnitChange,
    showMargins, showCenter, showManual, marginPt, onMarginChange,
    manual, onAddManual, onMoveManual, onRemoveManual,
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
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [paneRef, previewRef]);

  // Pointer readout lives here rather than in App, so moving across the page
  // re-renders only this small overlay instead of the complete editor.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const move = (event: globalThis.PointerEvent) => {
      const r = pane.getBoundingClientRect();
      setCursor({ x: event.clientX - r.left, y: event.clientY - r.top });
    };
    const leave = () => setCursor(null);
    pane.addEventListener("pointermove", move);
    pane.addEventListener("pointerleave", leave);
    return () => {
      pane.removeEventListener("pointermove", move);
      pane.removeEventListener("pointerleave", leave);
    };
  }, [paneRef]);

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
    if (event.button !== 0) return;
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

  const layoutVertical = showMargins ? locked.verticalMargins : [];
  const layoutHorizontal = showMargins ? locked.horizontalMargins : [];
  const shownManual = showManual ? manual : [];
  const paintedManual = shownManual.filter((guide) => guide.id !== drag?.id);
  const marginValue = unit === "in" ? marginPt / 72 : marginPt;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <svg width={geometry.width} height={geometry.height} className="absolute inset-0" aria-hidden="true">
        {/* Guides are painted before the opaque rulers so lines stop cleanly
            at their edges even when the transformed page sits underneath. */}
        {layoutVertical.map((point, index) => (
          <line key={`margin-x-${index}`} x1={xOf(point)} x2={xOf(point)}
            y1={contentStart} y2={geometry.height} className="stroke-cyan-500/70" />
        ))}
        {layoutHorizontal.map((point, index) => (
          <line key={`margin-y-${index}`} x1={contentStart} x2={geometry.width}
            y1={yOf(point)} y2={yOf(point)} className="stroke-cyan-500/70" />
        ))}
        {showCenter && (
          <>
            <line x1={xOf(locked.center)} x2={xOf(locked.center)} y1={contentStart}
              y2={geometry.height} className="stroke-cyan-400/80 [stroke-dasharray:4_3]" />
            <line x1={contentStart} x2={geometry.width} y1={yOf(locked.middle)}
              y2={yOf(locked.middle)} className="stroke-cyan-400/80 [stroke-dasharray:4_3]" />
          </>
        )}
        {paintedManual.map((guide) => guide.axis === "x" ? (
          <line key={guide.id} x1={xOf(guide.point)} x2={xOf(guide.point)}
            y1={contentStart} y2={geometry.height} className="stroke-primary" />
        ) : (
          <line key={guide.id} x1={contentStart} x2={geometry.width}
            y1={yOf(guide.point)} y2={yOf(guide.point)} className="stroke-primary" />
        ))}
        {drag && (drag.axis === "x" ? (
          <line x1={xOf(drag.point)} x2={xOf(drag.point)} y1={contentStart}
            y2={geometry.height} className="stroke-primary" />
        ) : (
          <line x1={contentStart} x2={geometry.width} y1={yOf(drag.point)}
            y2={yOf(drag.point)} className="stroke-primary" />
        ))}

        {showRulers && (
          <>
            <rect x={RULER_SIZE} width={geometry.width - RULER_SIZE} height={RULER_SIZE}
              className="fill-sidebar stroke-border" />
            <rect y={RULER_SIZE} width={RULER_SIZE} height={geometry.height - RULER_SIZE}
              className="fill-sidebar stroke-border" />
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
          grab without turning the whole overlay into a selection blocker. */}
      {shownManual.map((guide) => guide.axis === "x" ? (
        <div key={`hit-${guide.id}`}
          className="pointer-events-auto absolute bottom-0 w-2 -translate-x-1 cursor-col-resize outline-none focus-visible:bg-primary/15"
          style={{ left: xOf(guide.point), top: contentStart }}
          role="button" tabIndex={0} aria-label="Vertical manual guide; press Delete to remove"
          onPointerDown={(event) => startExisting(guide, event)}
          onKeyDown={(event) => {
            if (event.key === "Delete" || event.key === "Backspace") onRemoveManual(guide.id);
          }}
          onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} />
      ) : (
        <div key={`hit-${guide.id}`}
          className="pointer-events-auto absolute right-0 h-2 -translate-y-1 cursor-row-resize outline-none focus-visible:bg-primary/15"
          style={{ top: yOf(guide.point), left: contentStart }}
          role="button" tabIndex={0} aria-label="Horizontal manual guide; press Delete to remove"
          onPointerDown={(event) => startExisting(guide, event)}
          onKeyDown={(event) => {
            if (event.key === "Delete" || event.key === "Backspace") onRemoveManual(guide.id);
          }}
          onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} />
      ))}

      {showRulers && (
        <>
          <div className="pointer-events-auto absolute top-0 right-0 left-5 h-5 cursor-row-resize"
            title="Drag down to create a horizontal guide"
            onPointerDown={(event) => startNew("y", event)}
            onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} />
          <div className="pointer-events-auto absolute top-5 bottom-0 left-0 w-5 cursor-col-resize"
            title="Drag right to create a vertical guide"
            onPointerDown={(event) => startNew("x", event)}
            onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} />
          <Popover>
            <PopoverTrigger
              className="pointer-events-auto absolute top-0 left-0 grid size-5 place-items-center border-r border-b border-border bg-sidebar text-[8px] text-muted-foreground hover:text-foreground"
              title="Ruler units and margin settings" aria-label="Ruler settings">
              {unit}
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-52">
              <div className="text-xs font-medium">Ruler units</div>
              <div className="flex gap-1">
                <Button size="xs" variant={unit === "in" ? "default" : "outline"}
                  onClick={() => onUnitChange("in")}>Inches</Button>
                <Button size="xs" variant={unit === "pt" ? "default" : "outline"}
                  onClick={() => onUnitChange("pt")}>Points</Button>
              </div>
              <Label htmlFor="guide-margin" className="mt-1 text-xs">Margin inset ({unit})</Label>
              <Input id="guide-margin" type="number" min={0}
                max={unit === "in" ? 2.5 : 180} step={unit === "in" ? 0.125 : 1}
                value={Number(marginValue.toFixed(unit === "in" ? 3 : 1))}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value))
                    onMarginChange(clampMargin(unit === "in" ? value * 72 : value));
                }} />
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
