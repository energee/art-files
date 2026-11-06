// useZoomPan.ts — the preview pane's zoom and pan: wheel-to-zoom, right-drag
// pan, the typed zoom field and the Zoom In / Out / to Fit steps, plus the
// zoom handover between the 2D pane and the 3D views (CanView dollies its
// own camera). The view lives outside React: a gesture writes it to the DOM,
// and only the settled zoom reaches the editor's state (#714).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { PREVIEW_OVERSAMPLE } from "@/layout";
import type { CanViewHandle } from "@/components/CanView";

/** Largest wheel delta any single event is allowed to contribute: a mouse
 *  notch reports 100 at once, which unclamped overshoots the zoom range. */
const ZOOM_STEP_CAP = 50;

/** One Zoom In / Zoom Out step (⌘= / ⌘-). */
export const ZOOM_FACTOR = 1.25;

/** Quiet time after a wheel tick before the zoom is published to React. */
const ZOOM_SETTLE_MS = 100;

/** The pane's transform: scale `z` about its top-left, then offset by (x, y)
 *  screen px. z === 1 is the fitted view. */
type View = { z: number; x: number; y: number };

/** The current view, held outside React so a wheel tick or pan move does not
 *  render the editor. `get`/`subscribe` fit useSyncExternalStore. */
function createLiveView() {
  let view: View = { z: 1, x: 0, y: 0 };
  const listeners = new Set<() => void>();
  return {
    get: () => view,
    set(next: View) {
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
 *  point where it is. Shared by the wheel and the typed field. */
export const zoomAbout = (
  r: DOMRect, v: View, z: number, ax: number, ay: number,
) => {
  const k = z / v.z;
  return clampView(r, z, ax - k * (ax - v.x), ay - k * (ay - v.y));
};

/** `is2d`: the pane shows the 2D compare (wheel, pan and typed zoom act on
 *  it); otherwise zoom goes to the 3D camera through `canView`. */
export function useZoomPan(
  is2d: boolean,
  previewPane: RefObject<HTMLDivElement | null>,
  canView: RefObject<CanViewHandle | null>,
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
  // about it.
  const panFrom = useRef<{ x: number; y: number; r: DOMRect } | null>(null);
  const [panning, setPanning] = useState(false);
  function onPanStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 2 || !is2d) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panFrom.current = {
      x: e.clientX, y: e.clientY, r: e.currentTarget.getBoundingClientRect(),
    };
    setPanning(true);
  }
  function onPanMove(e: React.PointerEvent<HTMLDivElement>) {
    const from = panFrom.current;
    if (!from) return;
    const dx = e.clientX - from.x, dy = e.clientY - from.y;
    from.x = e.clientX;
    from.y = e.clientY;
    const v = liveView.get();
    liveView.set(clampView(from.r, v.z, v.x + dx, v.y + dy));
  }
  function onPanEnd() {
    if (!panFrom.current) return;
    panFrom.current = null;
    setPanning(false);
  }

  return {
    zoom, liveView, zoomLayer, zoomField, camZoomPct, carried, onCameraChange,
    zoomDraft, setZoomDraft, zoomTo, applyTypedZoom, panning, onPanStart, onPanMove, onPanEnd,
  };
}
