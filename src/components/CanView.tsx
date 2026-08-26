// CanView.tsx — React wrapper around the vanilla-three CanScene: mounts the
// scene once into a fill-parent div, rebuilds the label textures from the
// canvas backend's plates whenever the render source or config changes
// (debounced — see the rebuild effect), switches view modes, and tears
// everything down on unmount.
import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from "react";
import { CanScene, type CanSceneMode } from "@/three/canScene";
import { drawPlates, buildLabelTextures } from "@/three/labelTextures";
import { planFrom, type CanvasRenderSource } from "@/canvas/draw";
import type { LabelConfig } from "@/types";
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
  /** Foil-mask blur, % of label width (Settings layer). */
  edgeSoftnessPct: number;
  cfg: LabelConfig;
  /** The render source: fonts + decoded bitmaps for drawPlate, assembled
   *  from the display list. Null means "not ready yet". */
  source: CanvasRenderSource | null;
  /** Repaint trigger only — see PreviewCompare's prop of the same name. */
  bleedIn: number;
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
  cfg, source, bleedIn, mode, cornerRadiusPct,
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

  // Texture rebuilds are debounced: each one is a synchronous two-plate draw
  // plus deriveMetalness' per-pixel pass over ~3.4M px — fine per pause,
  // too heavy per keystroke. A superseded rebuild simply never fires
  // (clearTimeout), so stale textures can't overwrite newer ones.
  useEffect(() => {
    if (!source) return;
    setLoading(true);
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      try {
        const plan = planFrom(cfg, source);
        sceneRef.current?.applyTextures(
          buildLabelTextures(drawPlates(plan, source.drawAssets, source.fontCss)));
      } catch (err) {
        console.warn("3D label texture build failed:", err);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => { clearTimeout(timer); if (!done) setLoading(false); };
  }, [source, cfg, bleedIn]);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    sceneRef.current?.setLabelOptions({
      cornerRadiusPct,
      edgeSoftnessRatio: edgeSoftnessPct / 100,
    });
  }, [cornerRadiusPct, edgeSoftnessPct]);

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
