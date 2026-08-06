// CanView.tsx — React wrapper around the vanilla-three CanScene: mounts the
// scene once into a fill-parent div, re-renders the PDF pair into label
// textures whenever the bytes change (App already debounces the byte churn),
// switches view modes, and tears everything down on unmount.
import { useEffect, useRef, useState } from "react";
import { CanScene } from "@/three/canScene";
import type { LabelViewSettings } from "@/three/labelSettings";
import type { CanSceneMode } from "@/three/viewMode";
import { buildLabelTextures } from "@/three/labelTextures";

export function CanView({
  artBytes, maskBytes, mode, settings, active,
}: {
  artBytes: Uint8Array | null;
  maskBytes: Uint8Array | null;
  mode: CanSceneMode;
  /** The Document > Settings knobs, passed whole. */
  settings: LabelViewSettings;
  /** False while a 2D view is showing. App keeps this component mounted so
   *  the GLTF, the HDRI and the label textures survive a trip to 2D and
   *  back; skipping the rebuild keeps that from costing anything while the
   *  scene is hidden. The pending bytes are applied on reactivation. */
  active: boolean;
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
    if (!artBytes || !maskBytes || !active) return;
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
  }, [artBytes, maskBytes, active]);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    sceneRef.current?.setLabelOptions(settings);
  }, [settings]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0 overflow-hidden rounded-md" />
      {loading && (
        <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
          rendering…
        </span>
      )}
    </div>
  );
}
