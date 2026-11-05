// useZoomPan.ts — the preview pane's zoom and pan: wheel-to-zoom, right-drag
// pan, the typed zoom field and the Zoom In / Out / to Fit steps, plus the
// zoom handover between the 2D pane and the 3D views (CanView dollies its
// own camera). Moved out of App.tsx with no behavior change.
import { useEffect, useRef, useState, type RefObject } from "react";
import { PREVIEW_OVERSAMPLE } from "@/layout";
import type { CanViewHandle } from "@/components/CanView";

/** Largest wheel delta any single event is allowed to contribute: a mouse
 *  notch reports 100 at once, which unclamped overshoots the zoom range. */
const ZOOM_STEP_CAP = 50;

/** One Zoom In / Zoom Out step (⌘= / ⌘-). */
export const ZOOM_FACTOR = 1.25;

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
  r: DOMRect, v: { z: number; x: number; y: number }, z: number, ax: number, ay: number,
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
  // Preview pane zoom: scale `z` about the pane's top-left, then offset by
  // (x, y) screen px. z === 1 is the fitted view.
  const [zoom, setZoom] = useState({ z: 1, x: 0, y: 0 });
  // Whole percent, so the camera's per-frame emissions bail out of React.
  const [camZoomPct, setCamZoomPct] = useState(100);
  // Zoom level follows you across views (see CanView's initialView). A ref:
  // only a view change hands it over.
  const carried = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const carriedIs2d = useRef(is2d);
  // Captured on the single render that leaves 2D — `zoom` still holds the
  // 2D value there and the pane still has its rect. Render-time, not an
  // effect: CanView reads it as a prop while mounting.
  if (!is2d && carriedIs2d.current) {
    const r = previewPane.current?.getBoundingClientRect();
    if (r?.width) carried.current = {
      zoom: zoom.z,
      pan: {
        x: (r.width * (1 - zoom.z) / 2 - zoom.x) / r.width,
        y: (r.height * (1 - zoom.z) / 2 - zoom.y) / r.height,
      },
    };
  }
  useEffect(() => {
    carriedIs2d.current = is2d;
    if (!is2d) return; // CanView takes it as a prop — see initialView
    const { zoom: z, pan } = carried.current;
    const r = previewPane.current?.getBoundingClientRect();
    if (!r?.width) return setZoom({ z, x: 0, y: 0 });
    setZoom(clampView(r, z,
      r.width * (1 - z) / 2 - pan.x * r.width,
      r.height * (1 - z) / 2 - pan.y * r.height));
  }, [is2d, previewPane]);
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
      setZoom((v) => {
        const z = clampZoom(next(v.z));
        return r?.width ? zoomAbout(r, v, z, r.width / 2, r.height / 2) : { z, x: 0, y: 0 };
      });
    } else canView.current?.setZoom(clampZoom(next(camZoomPct / 100)));
  };
  const applyTypedZoom = () => {
    const pct = parseFloat(zoomDraft ?? "");
    setZoomDraft(null);
    if (isFinite(pct)) zoomTo(() => pct / 100);
  };

  // Wheel-to-zoom, scoped to the preview pane (2D only; the 3D views run
  // this through OrbitControls). Attached by hand: React's synthetic wheel
  // handler is passive at the root. setZoom's functional form is
  // load-bearing: a pinch delivers events faster than React re-renders.
  useEffect(() => {
    const el = previewPane.current;
    if (!el || !is2d) return;
    function onWheel(e: WheelEvent) {
      const r = el!.getBoundingClientRect();
      if (!r.width || !r.height) return; // not laid out yet
      e.preventDefault();
      setZoom((v) => {
        const step = Math.max(-ZOOM_STEP_CAP, Math.min(ZOOM_STEP_CAP, e.deltaY));
        const z = clampZoom(v.z * Math.exp(-step / 150));
        return zoomAbout(r, v, z, e.clientX - r.left, e.clientY - r.top);
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [is2d, previewPane]);

  // Drag-to-pan on the right button — the same button OrbitControls pans
  // with in the 3D views.
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
    setZoom((v) => clampView(from.r, v.z, v.x + dx, v.y + dy));
  }
  function onPanEnd() {
    if (!panFrom.current) return;
    panFrom.current = null;
    setPanning(false);
  }

  return {
    zoom, camZoomPct, carried, onCameraChange, zoomDraft, setZoomDraft, zoomTo, applyTypedZoom,
    panning, onPanStart, onPanMove, onPanEnd,
  };
}
