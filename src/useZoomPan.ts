// useZoomPan.ts — the preview pane's zoom and pan: wheel-to-zoom, right-drag
// pan, one-finger pan and two-finger pinch, the typed zoom field and the
// Zoom In / Out / to Fit steps, plus the zoom handover between the 2D pane
// and the 3D views (CanView dollies its own camera). The view lives outside
// React: a gesture writes it to the DOM, and only the settled zoom reaches
// the editor's state (#714).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { PREVIEW_OVERSAMPLE } from "@/layout";
import type { CanViewHandle } from "@/components/CanView";
import type { PreviewCompareHandle } from "@/components/PreviewCompare";
import { isTap } from "@/components/doubleTap";

/** Largest wheel delta any single event is allowed to contribute: a mouse
 *  notch reports 100 at once, which unclamped overshoots the zoom range. */
const ZOOM_STEP_CAP = 50;

/** One Zoom In / Zoom Out step (⌘= / ⌘-). */
export const ZOOM_FACTOR = 1.25;

/** Quiet time after a wheel tick before the zoom is published to React. */
const ZOOM_SETTLE_MS = 100;

/** A finger landing in one of these is theirs, not the pane's: the rulers'
 *  strips and guide handles, and the text being edited in place. */
const OWNS_ITS_FINGER = '[data-slot="rulers"], [contenteditable="true"], input, textarea';

/** The pane's transform: scale `z` about its top-left, then offset by (x, y)
 *  screen px. z === 1 is the fitted view. */
type View = { z: number; x: number; y: number };
type Point = { x: number; y: number };

/** The current view, held outside React so a wheel tick or pan move does not
 *  render the editor. `get`/`subscribe` fit useSyncExternalStore. */
function createLiveView() {
  let view: View = { z: 1, x: 0, y: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => view,
    /** A clamped pan or a wheel past the range lands where it started: no
     *  change, so nobody is told (#726). */
    set(next: View) {
      if (next.z === view.z && next.x === view.x && next.y === view.y) return;
      view = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
export type LiveView = ReturnType<typeof createLiveView>;

/** Keep the scaled content covering the pane `r`, so neither a pan nor a
 *  zoom-out can strand the label against a band of empty background. */
export const clampView = (r: DOMRect, z: number, x: number, y: number) => ({
  z,
  x: Math.min(0, Math.max(r.width * (1 - z), x)),
  y: Math.min(0, Math.max(r.height * (1 - z), y)),
});

/** The pane's zoom range: 1 (fitted) through the 3D dolly's ceiling. */
export const clampZoom = (z: number) => Math.min(PREVIEW_OVERSAMPLE, Math.max(1, z));

/** Zoom to `z` about the pane point (ax, ay), keeping whatever is under that
 *  point where it is. Shared by the wheel and the typed field. Written as an
 *  offset from `v` so an unchanged zoom keeps x and y exactly. */
export const zoomAbout = (
  r: DOMRect, v: View, z: number, ax: number, ay: number,
) => {
  const k = z / v.z;
  return clampView(r, z, v.x + (1 - k) * (ax - v.x), v.y + (1 - k) * (ay - v.y));
};

/** Two fingers moved from `a0`, `b0` to `a1`, `b1`: pan by their midpoint's
 *  move, then zoom by the change in their spread about the new midpoint,
 *  clamped as the wheel is. Points are finite pane px from its top-left
 *  (pointer client coordinates minus the pane's left/top); anything else is
 *  the caller's bug. A pinch that moves nothing returns `v` exactly, and
 *  fingers closing onto one spot zoom out to the fitted view. */
export const pinchView = (r: DOMRect, v: View, a0: Point, b0: Point, a1: Point, b1: Point): View => {
  const spread0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const spread1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  // Ratio first, so an unchanged spread keeps v.z bit for bit. Fingers that
  // start on one spot have no spread to compare: keep the zoom.
  const z = clampZoom(spread0 ? v.z * (spread1 / spread0) : v.z);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  // The pan is left unclamped so zoomAbout clamps the result once.
  return zoomAbout(r, { z: v.z, x: v.x + m1.x - m0.x, y: v.y + m1.y - m0.y }, z, m1.x, m1.y);
};

/** `is2d`: the pane shows the 2D compare (wheel, pan and typed zoom act on
 *  it); otherwise zoom goes to the 3D camera through `canView`. `preview`
 *  says whether a finger landed on a layer drag, and cancels it when a
 *  second finger turns the touch into a pinch. */
export function useZoomPan(
  is2d: boolean,
  previewPane: RefObject<HTMLDivElement | null>,
  canView: RefObject<CanViewHandle | null>,
  preview: RefObject<PreviewCompareHandle | null>,
) {
  const [liveView] = useState(createLiveView);
  const zoomLayer = useRef<HTMLDivElement>(null);
  const zoomField = useRef<HTMLInputElement>(null);
  // Every view change lands on the transformed layer and the readout here,
  // not through a render. The readout leaves a focused field alone: that is
  // the operator's draft, and the settled zoom corrects it on blur.
  useLayoutEffect(() => {
    const paint = () => {
      const { z, x, y } = liveView.get();
      if (zoomLayer.current) zoomLayer.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
      const field = zoomField.current;
      if (field && field !== document.activeElement) field.value = String(Math.round(z * 100));
    };
    paint();
    return liveView.subscribe(paint);
  }, [liveView]);
  // The zoom as React sees it: what the raster density and the readout's
  // value read. Trails liveView through a gesture.
  const [zoom, setZoom] = useState(1);
  // Whole percent, so the camera's per-frame emissions bail out of React.
  const [camZoomPct, setCamZoomPct] = useState(100);
  // Zoom level follows you across views (see CanView's initialView). A ref:
  // only a view change hands it over.
  const carried = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const carriedIs2d = useRef(is2d);
  // Captured on the single render that leaves 2D — the pane still has its
  // rect there. Render-time, not an effect: CanView reads it as a prop while
  // mounting.
  if (!is2d && carriedIs2d.current) {
    const r = previewPane.current?.getBoundingClientRect();
    const v = liveView.get();
    if (r?.width) carried.current = {
      zoom: v.z,
      pan: {
        x: (r.width * (1 - v.z) / 2 - v.x) / r.width,
        y: (r.height * (1 - v.z) / 2 - v.y) / r.height,
      },
    };
  }
  useEffect(() => {
    carriedIs2d.current = is2d;
    if (!is2d) return; // CanView takes it as a prop — see initialView
    const { zoom: z, pan } = carried.current;
    const r = previewPane.current?.getBoundingClientRect();
    liveView.set(r?.width
      ? clampView(r, z, r.width * (1 - z) / 2 - pan.x * r.width, r.height * (1 - z) / 2 - pan.y * r.height)
      : { z, x: 0, y: 0 });
    setZoom(z);
  }, [is2d, previewPane, liveView]);
  /** The camera reports its zoom and pan: kept for the next view change
   *  while a 3D view is up, and shown as a whole percent. */
  const onCameraChange = (z: number, pan: { x: number; y: number }) => {
    if (!carriedIs2d.current) carried.current = { zoom: z, pan };
    setCamZoomPct(Math.round(z * 100));
  };
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  /** Zoom to `next(current)`, clamped, about the pane's centre — the 3D
   *  views dolly their camera instead. Shared by the typed field and the
   *  Zoom In / Out / to Fit commands. */
  const zoomTo = (next: (z: number) => number) => {
    if (is2d) {
      const r = previewPane.current?.getBoundingClientRect();
      const v = liveView.get();
      const z = clampZoom(next(v.z));
      liveView.set(r?.width ? zoomAbout(r, v, z, r.width / 2, r.height / 2) : { z, x: 0, y: 0 });
      setZoom(z);
    } else canView.current?.setZoom(clampZoom(next(camZoomPct / 100)));
  };
  const applyTypedZoom = () => {
    const pct = parseFloat(zoomDraft ?? "");
    setZoomDraft(null);
    if (isFinite(pct)) zoomTo(() => pct / 100);
  };

  // Wheel-to-zoom, scoped to the preview pane (2D only; the 3D views run
  // this through OrbitControls). Attached by hand: React's synthetic wheel
  // handler is passive at the root. A pinch delivers events faster than
  // React re-renders, so each tick steps from liveView and React hears about
  // it once the ticks stop.
  useEffect(() => {
    const el = previewPane.current;
    if (!el || !is2d) return;
    let settle = 0;
    function onWheel(e: WheelEvent) {
      const r = el!.getBoundingClientRect();
      if (!r.width || !r.height) return; // not laid out yet
      e.preventDefault();
      const v = liveView.get();
      const step = Math.max(-ZOOM_STEP_CAP, Math.min(ZOOM_STEP_CAP, e.deltaY));
      const z = clampZoom(v.z * Math.exp(-step / 150));
      liveView.set(zoomAbout(r, v, z, e.clientX - r.left, e.clientY - r.top));
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setZoom(liveView.get().z), ZOOM_SETTLE_MS);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(settle);
    };
  }, [is2d, previewPane, liveView]);

  // Drag-to-pan on the right button — the same button OrbitControls pans
  // with in the 3D views. A pan leaves the zoom alone, so React never hears
  // about it. Fingers: below.
  const panFrom = useRef<{ x: number; y: number; r: DOMRect } | null>(null);
  const [panning, setPanning] = useState(false);
  function onPanStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return onTouchDown(e);
    if (e.button !== 2 || !is2d) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panFrom.current = {
      x: e.clientX, y: e.clientY, r: e.currentTarget.getBoundingClientRect(),
    };
    setPanning(true);
  }
  function onPanMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return onTouchMove(e);
    const from = panFrom.current;
    if (!from) return;
    const dx = e.clientX - from.x, dy = e.clientY - from.y;
    from.x = e.clientX;
    from.y = e.clientY;
    const v = liveView.get();
    liveView.set(clampView(from.r, v.z, v.x + dx, v.y + dy));
  }
  function onPanEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch") return onTouchEnd(e);
    if (!panFrom.current) return;
    panFrom.current = null;
    setPanning(false);
  }

  // Fingers on the pane (touch only), by pointerId, at their last event: one
  // pans unless the layer drag took it, two pinch, a third is ignored. The
  // browser captures each touch to the element it landed on (while that
  // element stays in the DOM), and its moves bubble here, so the pane takes
  // no capture of its own.
  const fingers = useRef(new Map<number, Point>());
  const lonePans = useRef(false);
  /** Where each of two fingers was when the second landed; the pinch starts
   *  only once one of them leaves the tap slop around it, so a finger resting
   *  while another taps moves nothing. */
  const pinchFrom = useRef(new Map<number, Point>());
  const pinching = useRef(false);
  /** The finger gesture moved the view: swallow the click it ends with. */
  const touchMoved = useRef(false);
  /** Capture phase, so it runs even for a press a tick or a ruler keeps. A
   *  primary touch means no other finger is down, so any id still listed
   *  missed its lift; a press with no finger down starts a new gesture,
   *  which never inherits an old swallow. */
  function onPanePointerDownCapture(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "touch" && e.isPrimary) fingers.current.clear();
    if (!fingers.current.size) touchMoved.current = false;
  }
  function onTouchDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!is2d || fingers.current.size === 2) return;
    // An extra finger whose first went to a control that keeps it (a ruler,
    // the divider, a resize past the tap slop) belongs to that gesture:
    // ignored. A resize still within the slop gives its finger up to pinch.
    if (!e.isPrimary && !fingers.current.size) {
      const first = preview.current?.releaseResizeFinger();
      if (!first) return;
      fingers.current.set(first.pointerId, { x: first.x, y: first.y });
    }
    if (e.target instanceof Element && e.target.closest(OWNS_ITS_FINGER)) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.current.size === 1) lonePans.current = !preview.current?.layerGestureArmed();
    else {
      preview.current?.cancelLayerGesture();
      pinchFrom.current = new Map(fingers.current); pinching.current = false;
    }
  }
  function onTouchMove(e: React.PointerEvent<HTMLDivElement>) {
    const from = fingers.current.get(e.pointerId);
    if (!from || !is2d) return;
    const to = { x: e.clientX, y: e.clientY };
    const r = e.currentTarget.getBoundingClientRect();
    const v = liveView.get();
    if (fingers.current.size === 2 && !pinching.current) {
      // The move that leaves the slop starts the pinch from here: no jump.
      pinching.current = !isTap(pinchFrom.current.get(e.pointerId) ?? from, to);
    } else if (fingers.current.size === 2) {
      const other = [...fingers.current].find(([id]) => id !== e.pointerId)![1];
      const local = (p: Point) => ({ x: p.x - r.left, y: p.y - r.top });
      liveView.set(pinchView(r, v, local(from), local(other), local(to), local(other)));
    } else if (lonePans.current) {
      liveView.set(clampView(r, v.z, v.x + to.x - from.x, v.y + to.y - from.y));
    }
    fingers.current.set(e.pointerId, to);
    if (liveView.get() !== v) touchMoved.current = true;
  }
  function onTouchEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!fingers.current.delete(e.pointerId)) return;
    pinching.current = false;
    lonePans.current = true; // the finger left after a pinch pans
    setZoom(liveView.get().z);
  }
  /** Capture-phase click on the pane: the click that ends a finger gesture
   *  which moved the view never reaches the pane (deselect) or the sheet
   *  (pick). */
  function onPaneClickCapture(e: React.MouseEvent) {
    if (!touchMoved.current) return;
    touchMoved.current = false;
    e.stopPropagation();
  }

  return {
    zoom, liveView, zoomLayer, zoomField, camZoomPct, carried, onCameraChange,
    zoomDraft, setZoomDraft, zoomTo, applyTypedZoom, panning, onPanStart, onPanMove, onPanEnd,
    onPanePointerDownCapture, onPaneClickCapture,
  };
}
