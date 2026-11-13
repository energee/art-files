// useSheetPress.ts — the label sheet's presses (PreviewCompare.tsx): a press
// on an unlocked layer moves it, a press on a selection tick resizes it, a
// finger's tap picks the layer under it and two taps open a text layer in
// place (the rules are touchPress.ts), and the click a drag leaves behind is
// swallowed. A move or resize reports cumulative deltas to App, which folds
// the gesture into one undo step; cancelLayerGesture undoes it, as Escape, a
// cancelled touch, a starting pinch (useZoomPan) and a hidden preview do.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { LayerBox } from "@/hittestLayers";
import { PAGE } from "@/layout";
import type { ResizeHandle } from "@/model/edit";
import { modsOf, type SelectMods } from "@/selection";
import type { SnapLines } from "./previewOverlay";
import { extraFinger, foldTap, isTap, stillPress, type Tap } from "./touchPress";

type Point = { x: number; y: number };

export function useSheetPress({
  pageElement, boxesById, editing, hitOf, startEditing, onPick, onDrag, onResize, onDragCancel,
}: {
  /** The sheet: its box turns client pixels into label points. */
  pageElement: RefObject<HTMLDivElement | null>;
  boxesById: Map<string, LayerBox>;
  /** The layer open in place, if any: presses then neither move nor resize. */
  editing: string | null;
  /** The layer under the event, null for bare sheet, undefined when it can't tell. */
  hitOf: (e: React.MouseEvent) => string | null | undefined;
  /** Opens a text layer in place (a double-tap or a double-click). */
  startEditing: (e: React.MouseEvent<HTMLDivElement>, id: string) => void;
  onPick: (id: string | null, mods: SelectMods) => void;
  onDrag: (id: string, dx: number, dy: number, first: boolean) => SnapLines;
  onResize: (id: string, handle: ResizeHandle, dx: number, dy: number, uniform: boolean, first: boolean) => SnapLines;
  onDragCancel: () => void;
}) {
  // Which lines (if any) the in-flight drag has snapped to, purely to drive
  // the highlights — the drag math itself is App's (snapDelta/moveBy),
  // which reports back what it landed on.
  const [snap, setSnap] = useState<SnapLines>({ x: null, y: null, dx: 0, dy: 0 });

  // The live measurement badge: the layer it hangs off, and the distance
  // travelled (a move) or nothing (a resize, which reads its size off the
  // box the patch just produced). Null when no gesture is running.
  const [readout, setReadout] = useState<{ id: string; moved: { dx: number; dy: number } | null } | null>(null);

  // Drag-to-move: pointerdown on an unlocked layer arms a two-axis drag;
  // crossing the threshold (3px, a finger 10px) starts the gesture
  // (first=true); App folds every move into ONE undo step.
  const drag = useRef<{
    id: string; startClientX: number; startClientY: number;
    pxPerPtX: number; pxPerPtY: number; started: boolean;
  } | null>(null);

  // Drag-to-resize from any selection tick. Its own pointer session
  // (capture on the tick, owned by `pointerId`) so it never competes with
  // the move drag on the wrapper: a tick that takes the press stops its
  // propagation, so the wrapper's move never starts. A press the tick does
  // not take (during in-place editing, on a locked layer, an extra finger, a
  // finger on any layer) bubbles on as any other press would. A finger
  // resizes only past the tap slop; before that a second finger may pinch
  // (resizeFinger). `last` is the finger's latest point.
  const resize = useRef<{
    id: string; handle: ResizeHandle; pointerId: number; startClientX: number; startClientY: number;
    pxPerPtX: number; pxPerPtY: number; started: boolean; last: Point;
  } | null>(null);

  // A finished drag still fires a click; swallow it so moving a
  // multi-selection can't collapse it to the grabbed layer (LayerList's
  // suppressClick, the same guard).
  const swallowClick = useRef(false);
  // The last press's pointerType. On touch only our own tap picks (at the
  // lift, under the finger): Chrome's click, aimed elsewhere or after no
  // tap, picks nothing, and its dblclick opens nothing.
  const pressType = useRef("");
  // Finger double-tap (touchPress.ts): where a touch that may be a tap landed.
  const tapFrom = useRef<Point | null>(null);
  // The last tap, for the double-tap counter.
  const lastTap = useRef<Tap | null>(null);
  // A tap opened the in-place session, until the next press.
  const tapOpened = useRef(false);

  /** Label points per CSS pixel for the page element, captured once per
   *  gesture (the wrapper's aspect ratio is locked to the page). */
  const pageScale = () => {
    const r = pageElement.current!.getBoundingClientRect();
    return { pxPerPtX: r.width / PAGE.w, pxPerPtY: r.height / PAGE.h };
  };

  function onHandleDown(e: React.PointerEvent<HTMLSpanElement>, id: string, handle: ResizeHandle) {
    if (extraFinger(e) || e.button !== 0 || editing || boxesById.get(id)?.locked) return;
    // Chrome aims a finger NEAR a tick at the tick, but the event keeps the
    // finger's own position: on any layer it goes on to the sheet, which
    // moves and picks that layer; only on bare stock does it resize.
    if (e.pointerType === "touch" && hitOf(e)) return;
    e.stopPropagation();
    // A resize is no tap, and breaks a pending double-tap.
    tapFrom.current = null;
    lastTap.current = null;
    resize.current = {
      id, handle, pointerId: e.pointerId, startClientX: e.clientX, startClientY: e.clientY, ...pageScale(), started: false,
      last: { x: e.clientX, y: e.clientY },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onHandleMove(e: React.PointerEvent<HTMLSpanElement>) {
    const d = resize.current;
    if (d?.pointerId !== e.pointerId) return;
    const dxPx = e.clientX - d.startClientX, dyPx = e.clientY - d.startClientY;
    d.last = { x: e.clientX, y: e.clientY };
    if (!d.started && stillPress(e.pointerType, { x: d.startClientX, y: d.startClientY }, d.last)) return;
    const first = !d.started;
    d.started = true;
    setSnap(onResize(d.id, d.handle, dxPx / d.pxPerPtX, dyPx / d.pxPerPtY, e.shiftKey, first));
    setReadout({ id: d.id, moved: null }); // a resize reads its own W x H
  }
  /** The resize's own pointer lifting ends it; its cancel reverts it like
   *  Escape. Every lift goes on to the sheet and the pane: a pinch may hold
   *  the resize's finger, and a finger on a layer that onHandleDown handed to
   *  the sheet ends its move there. */
  function onHandleUp(e: React.PointerEvent<HTMLSpanElement>) {
    if (resize.current?.pointerId !== e.pointerId) return;
    if (e.type === "pointercancel") { cancelLayerGesture(); return; }
    swallowClick.current ||= resize.current.started;
    resize.current = null;
    setSnap({ x: null, y: null, dx: 0, dy: 0 });
    setReadout(null);
  }

  /** Capture phase, so every press starts afresh: no swallow left armed by a
   *  drag whose click never came (a moved touch sends none) eats its click; a
   *  first finger starts a tap unless a session is open (an extra one ends
   *  it: endTap). */
  function onPointerDownCapture(e: React.PointerEvent<HTMLDivElement>) {
    swallowClick.current = false;
    tapOpened.current = false;
    pressType.current = e.pointerType;
    if (e.isPrimary) tapFrom.current = e.pointerType === "touch" && !editing ? { x: e.clientX, y: e.clientY } : null;
  }
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (extraFinger(e) || e.button !== 0 || editing) return;
    const id = hitOf(e);
    if (!id) return; // bare sheet, or no source to hit-test
    const target = boxesById.get(id);
    if (!target || target.locked) return; // locked, or draws nothing
    drag.current = {
      id, startClientX: e.clientX, startClientY: e.clientY,
      ...pageScale(), started: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const at = { x: e.clientX, y: e.clientY };
    if (tapFrom.current && !isTap(tapFrom.current, at)) tapFrom.current = null; // past the slop once is no tap
    const d = drag.current;
    if (!d) return;
    const dxPx = e.clientX - d.startClientX, dyPx = e.clientY - d.startClientY;
    if (!d.started && stillPress(e.pointerType, { x: d.startClientX, y: d.startClientY }, at)) return; // no undo step
    const first = !d.started;
    d.started = true;
    const dx = dxPx / d.pxPerPtX;
    const dy = dyPx / d.pxPerPtY;
    const snapped = onDrag(d.id, dx, dy, first);
    setSnap(snapped);
    setReadout({ id: d.id, moved: { dx: snapped.dx, dy: snapped.dy } });
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (extraFinger(e)) return; // an ignored finger's lift ends nothing
    if (e.pointerType === "touch") {
      const from = tapFrom.current;
      tapFrom.current = null;
      const hit = from && !drag.current?.started && isTap(from, { x: e.clientX, y: e.clientY }) ? hitOf(e) : undefined;
      if (hit !== undefined) onPick(hit, {}); // under the finger, not the click
      const { open, last } = foldTap(lastTap.current, hit ?? null, e.timeStamp);
      lastTap.current = last;
      if (open && hit) {
        tapOpened.current = true;
        startEditing(e, hit);
      }
    }
    swallowClick.current ||= !!drag.current?.started;
    drag.current = null;
    setSnap({ x: null, y: null, dx: 0, dy: 0 });
    setReadout(null);
  }
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (swallowClick.current || pressType.current === "touch") {
      swallowClick.current = false;
      return;
    }
    const id = hitOf(e);
    if (id !== undefined) onPick(id, modsOf(e));
  }
  // Mouse and pen only: on touch the tap counter (onPointerUp) decides, and
  // Chrome's own dblclick, sent past our slop and window, is ignored. An open
  // session ignores it too: on a desktop the click-away has closed it by then.
  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const id = editing || pressType.current === "touch" ? undefined : hitOf(e);
    if (id) startEditing(e, id);
  }
  // The mousedowns Chrome sends after the tap that opened the field would blur it
  // (off the field) or select a word (on it, as a double-click): the field opens with a caret.
  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (tapOpened.current) e.preventDefault();
  }
  // A cancelled press (an incoming call, the OS taking the touch) puts the
  // layer back, as Escape and a starting pinch do; an ignored extra finger's
  // cancel leaves the first finger's gesture alone.
  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!extraFinger(e)) cancelLayerGesture();
  }

  // Held in a ref so cancelLayerGesture keeps one identity: App passes a new
  // onDragCancel every render, and PreviewCompare's no-source effect must not
  // re-run (and render again) on each of them.
  const onDragCancelRef = useRef(onDragCancel);
  onDragCancelRef.current = onDragCancel;
  /** Undo the single step the move or resize opened (if any) and drop the
   *  in-flight session so a further pointermove can't resume it. True when
   *  it undid a started gesture. */
  const cancelLayerGesture = useCallback((): boolean => {
    const started = !!(drag.current?.started || resize.current?.started);
    if (started) onDragCancelRef.current();
    drag.current = null;
    resize.current = null;
    tapFrom.current = null;
    setSnap({ x: null, y: null, dx: 0, dy: 0 });
    setReadout(null);
    return started;
  }, []);

  // Escape mid-drag cancels it, the same path a starting pinch takes
  // (cancelLayerGesture). Capture phase + preventDefault marks the Escape as
  // spent before the inspector Sheet's document listener sees it, so
  // cancelling a drag doesn't also close the inspector and deselect (App's
  // Sheet onOpenChange, #117).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || !cancelLayerGesture()) return;
      e.preventDefault();
      swallowClick.current = true;
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [cancelLayerGesture]);

  /** PreviewCompareHandle's press members (see their docs there), one
   *  identity for the editor's life: they read refs only. */
  const gesture = useMemo(() => ({
    layerGestureArmed: () => !!(drag.current || resize.current),
    cancelLayerGesture: () => { cancelLayerGesture(); },
    endTap: () => { tapFrom.current = null; },
    resizeFinger: () => {
      const d = resize.current;
      return d && { pointerId: d.pointerId, ...d.last, started: d.started };
    },
  }), [cancelLayerGesture]);

  return {
    snap, readout, cancelLayerGesture, gesture,
    /** The sheet's pointer and click handlers. */
    sheet: {
      onClick, onDoubleClick, onPointerDownCapture, onPointerDown, onPointerMove, onPointerUp, onMouseDown, onPointerCancel,
    },
    /** A selection tick's resize handlers. */
    tick: (id: string, handle: ResizeHandle) => ({
      onPointerDown: (e: React.PointerEvent<HTMLSpanElement>) => onHandleDown(e, id, handle),
      onPointerMove: onHandleMove,
      onPointerUp: onHandleUp,
      onPointerCancel: onHandleUp,
    }),
  };
}
