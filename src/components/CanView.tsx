// CanView.tsx — React wrapper around the vanilla-three CanScene: mounts the
// scene once into a fill-parent div, re-renders the PDF pair into label
// textures whenever the bytes change (App already debounces the byte churn),
// switches view modes, and tears everything down on unmount.
import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from "react";
import { CanScene, type CanSceneMode } from "@/three/canScene";
import { buildLabelTextures } from "@/three/labelTextures";
import { cn } from "@/lib/utils";

export interface CanViewHandle {
  /** Dolly to a multiple of the mode's framing distance — 1 is "as framed", 2
   *  twice as close. The only thing the host pushes in through the ref: the
   *  view travels back out through onZoom, and travels in at build time
   *  through initialView, for the StrictMode reason noted there. */
  setZoom: (zoom: number) => void;
}

export const CanView = forwardRef<CanViewHandle, {
  /** Die-cut corner radius, % of the label's short edge (Settings layer). */
  cornerRadiusPct: number;
  /** Label height as % of can height (Settings layer). */
  labelHeightPct: number;
  /** How far the label wraps, % of the can's circumference (Settings layer). */
  labelWidthPct: number;
  /** Foil-mask blur, % of label width (Settings layer). */
  edgeSoftnessPct: number;
  artBytes: Uint8Array | null;
  maskBytes: Uint8Array | null;
  mode: CanSceneMode;
  /** Current dolly as a multiple of the mode's framing distance (1 = as
   *  framed) plus the pan as a fraction of the frame, on every camera change,
   *  so the host can show the zoom and hand the view to the 2D pane. */
  onZoom?: (zoom: number, pan: { x: number; y: number }) => void;
  /** Where the view being left off was — applied to the scene as it is built,
   *  not through a ref afterwards: under StrictMode the scene that survives is
   *  created after the host's effects have run, so anything pushed in from
   *  outside landed on the instance that was about to be thrown away. */
  initialView?: { zoom: number; pan: { x: number; y: number } };
}>(function CanView({
  artBytes, maskBytes, mode, cornerRadiusPct, labelHeightPct, labelWidthPct,
  edgeSoftnessPct, onZoom, initialView,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CanScene | null>(null);
  const [loading, setLoading] = useState(false);
  // True only while the right button is down, which is the button
  // OrbitControls pans with — the 3D half of the 2D pane's pan cursor. A
  // left-drag orbits and a wheel dollies, and neither wants the grab hand.
  const [panning, setPanning] = useState(false);

  useImperativeHandle(ref, () => ({
    setZoom: (zoom: number) => sceneRef.current?.setZoom(zoom),
  }), []);

  // Held in a ref so the mount-once effect below can reach the current
  // callback without listing it as a dependency and rebuilding the scene.
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  // Scene lifecycle + ResizeObserver, once per mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new CanScene(container);
    // Pan rides along on the scene's own callback: the same 'change' event
    // covers both, and the host wants them together to hand the view over to
    // the 2D pane.
    scene.onZoomChange = (z, pan) => onZoomRef.current?.(z, pan);
    sceneRef.current = scene;
    // Read straight from the prop: this effect runs on the first commit, so
    // the value here is the first render's by construction — and its [] deps
    // mean a later object identity can't rebuild the scene either way.
    if (initialView) { scene.setZoom(initialView.zoom); scene.setPan(initialView.pan); }
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(container);
    return () => {
      ro.disconnect();
      sceneRef.current = null;
      // Detach first: teardown moves the camera one last time, and the host
      // takes every emission as the view's current position — letting the
      // dying scene report handed the 2D pane a reset instead of where the
      // operator left the can.
      scene.onZoomChange = undefined;
      scene.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Texture rebuilds are serialized and superseded ones dropped, mirroring
  // PreviewCompare's render chain: pdf.js work can outlast the next byte
  // change, and a slow stale result must not overwrite a newer one.
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!artBytes || !maskBytes) return;
    let cancelled = false;
    setLoading(true);
    chain.current = chain.current
      .then(async () => {
        if (cancelled) return;
        const tex = await buildLabelTextures({ artBytes, maskBytes });
        if (!cancelled) sceneRef.current?.applyTextures(tex);
      })
      .catch((err) => console.warn("3D label texture build failed:", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [artBytes, maskBytes]);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    sceneRef.current?.setLabelOptions({
      cornerRadiusPct,
      heightRatio: labelHeightPct / 100,
      widthRatio: labelWidthPct / 100,
      edgeSoftnessRatio: edgeSoftnessPct / 100,
    });
  }, [cornerRadiusPct, labelHeightPct, labelWidthPct, edgeSoftnessPct]);

  return (
    <div
      className={cn("relative h-full w-full", panning && "cursor-grabbing")}
      // OrbitControls does the panning and suppresses the context menu itself;
      // these only dress the gesture, so a two-finger drag reads the same here
      // as over the 2D preview. Pointer capture lives on the canvas
      // OrbitControls owns, so the release still bubbles through here even
      // when the drag ends outside the pane.
      onPointerDown={(e) => { if (e.button === 2) setPanning(true); }}
      onPointerUp={() => setPanning(false)}
      onPointerCancel={() => setPanning(false)}
    >
      {/* Paints the 3D stage's backdrop: the renderer clears transparent, so
          the flat colour behind the can comes from the app's own theme token
          (see canScene's note) rather than a hex duplicated in the scene. */}
      <div ref={containerRef} className="absolute inset-0 overflow-hidden rounded-md bg-background" />
      {loading && (
        <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
          rendering…
        </span>
      )}
    </div>
  );
});
