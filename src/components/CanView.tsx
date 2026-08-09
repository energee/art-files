// CanView.tsx — React wrapper around the vanilla-three CanScene: mounts the
// scene once into a fill-parent div, re-renders the PDF pair into label
// textures whenever the bytes change (App already debounces the byte churn),
// switches view modes, and tears everything down on unmount.
import { useEffect, useRef, useState } from "react";
import { CanScene, type CanSceneMode } from "@/three/canScene";
import { buildLabelTextures } from "@/three/labelTextures";

export function CanView({
  artBytes, maskBytes, mode, cornerRadiusPct, labelHeightPct, labelWidthPct,
  edgeSoftnessPct,
}: {
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CanScene | null>(null);
  const [loading, setLoading] = useState(false);

  // Scene lifecycle + ResizeObserver, once per mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new CanScene(container);
    sceneRef.current = scene;
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(container);
    return () => {
      ro.disconnect();
      sceneRef.current = null;
      scene.dispose();
    };
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
    <div className="relative h-full w-full">
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
}
