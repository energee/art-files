// useRenderSource.ts — the render source for BOTH preview views: fonts plus
// decoded bitmaps for drawPlate, assembled off the asset inputs alone
// (debounced 150ms, or at once for a tab coming to the front).
//
// Layer edits, a raster's tint included, deliberately DON'T re-run the
// assembly: the layers flow into the views as a prop and repaint with these
// same bitmaps (drawPlate tints, #414). The one layer edit that does is a font
// pick that adds a family to `fontOverrides`, so its faces load (#411).
// Bitmaps come from a per-editor cache keyed by source bytes, so a
// re-assembly decodes only new or changed assets (#413).
import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomFile, LoadedRaster } from "@/assets/io";
import { createBitmapCache } from "@/canvas/bitmapCache";
import type { CanvasAssets, CanvasRenderSource } from "@/canvas/draw";
import type { FontFamilyId } from "@/fontCatalog";
import { loadLabelFaces, labelFontCss } from "@/fonts";
import { errMsg } from "@/lib/utils";
import { PAGE_ART_ID } from "@/model/layers";
import type { MeasureFace, PlanAssets } from "@/plan";

export function useRenderSource(p: {
  /** Only the front tab assembles; a background tab drops its decoded
   *  source (the ImageBitmaps are the heavy, cheaply rebuilt part)... */
  active: boolean;
  /** ...unless it is the last tab shown (TabsState.previous): the one hidden
   *  source kept, so switching back decodes nothing and shows no spinner.
   *  Its cost is that tab's bitmaps and their page layers, whatever the
   *  number of open tabs. */
  keepSource?: boolean;
  family: FontFamilyId; fontOverrides: FontFamilyId[];
  /** The image assets the document references. */
  liveImages: Record<string, CustomFile>;
  /** The page-art slots and their layers' switches: dependencies only, the
   *  bytes come through `pageArt`. */
  texture: LoadedRaster | null; mask: LoadedRaster | null; bgOn: boolean; maskOn: boolean;
  /** Guide moves re-place layers without decoding again. */
  guides: PlanAssets["guides"];
  /** The layer the in-place editor floats over, which the preview omits. */
  editSession: string | null;
  pageArt: (preview: boolean) => { texture?: { bytes: Uint8Array }; maskPng?: Uint8Array };
  planAssets: () => PlanAssets;
  /** The assembly's own error toast (useOwnedToast): its next success
   *  clears only that error, so an image or master error survives a plate
   *  toggle (#511). */
  assetError: { set: (text: string) => void; clear: () => void };
}) {
  const { active, keepSource, assetError } = p;
  const [bitmaps] = useState(createBitmapCache);
  const [decodedAssets, setDecodedAssets] = useState<{
    m: MeasureFace; planAssets: PlanAssets; drawAssets: CanvasAssets; fontCss: string;
    /** The bytes this generation draws from. */
    sources: Uint8Array[];
  } | null>(null);
  // Hides only the "rendering label…" spinner while assembly is failing.
  const [assetsFailed, setAssetsFailed] = useState(false);
  const canvasAssets = useMemo(() => decodedAssets ? {
    ...decodedAssets, planAssets: { ...decodedAssets.planAssets, guides: p.guides },
  } : null, [decodedAssets, p.guides]);
  const wasActive = useRef(active);
  useEffect(() => {
    const cameForward = active && !wasActive.current;
    wasActive.current = active;
    // Not gated on `blocked`: this only decodes fonts and art, and a rejected
    // value already falls back to the master's, so the preview keeps drawing (#127).
    if (!active) return;
    let cancelled = false;
    const assemble = () => {
      (async () => {
        const m = await loadLabelFaces(p.family, p.fontOverrides);
        // The cache owns every bitmap: a throw or a cancelled run leaves its
        // decodes there for the next committed generation (or unmount) to
        // keep or close. A cancelled run asks for nothing more, so it can't
        // add bitmaps after that settling already ran (#413).
        const sources: Uint8Array[] = [];
        const bitmap = (bytes: Uint8Array | undefined) => {
          if (!bytes || cancelled) return null;
          sources.push(bytes);
          return bitmaps.get(bytes);
        };
        const art = p.pageArt(true);
        // Raster bytes become a bitmap for the canvas to draw; an SVG
        // source stays undecoded (it plans as paths) and is absent here.
        const [customBitmaps, textureBmp, maskBmp] = await Promise.all([
          Promise.all(Object.entries(p.liveImages).map(async ([id, { image: img }]) =>
            [id, img.kind === "svg" ? null : await bitmap(img.bytes)] as const))
            .then((entries): Record<string, ImageBitmap | null> => Object.fromEntries(entries)),
          bitmap(art.texture?.bytes), bitmap(art.maskPng),
        ]);
        // The page art rides under its PAGE_ART_ID keys too, so a backend
        // that draws the `page` items by asset id finds the same bitmaps.
        if (textureBmp) customBitmaps[PAGE_ART_ID.background] = textureBmp;
        if (maskBmp) customBitmaps[PAGE_ART_ID.mask] = maskBmp;
        // Superseded: a newer run, a background tab or unmount settles the cache.
        if (cancelled) return;
        setDecodedAssets({
          m, planAssets: p.planAssets(), drawAssets: { images: customBitmaps }, fontCss: labelFontCss(p.family), sources,
        });
        assetError.clear();
        setAssetsFailed(false);
      })().catch((err) => {
        if (cancelled) return;
        assetError.set(errMsg(err));
        setAssetsFailed(true);
      });
    };
    // The debounce is for bursts of edits; a tab switch is one event, and
    // waiting it out is what kept the spinner up on an empty tab (#724).
    const timer = cameForward ? undefined : setTimeout(assemble, 150);
    if (cameForward) assemble();
    return () => { cancelled = true; clearTimeout(timer); };
    // Asset inputs only — the layers reach this effect through the two
    // page-art switches (see the file header); fontOverrides is the set of
    // layer font families, so picking a new one reloads its faces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.texture, p.mask, p.liveImages, p.family, p.fontOverrides, p.bgOn, p.maskOn, active]);
  // Once a generation is live, close the cached bitmaps it no longer draws
  // (bitmaps aren't GC'd on their own); unchanged assets keep theirs. No
  // generation (a background tab past keepSource) or unmount closes them all.
  useEffect(() => { bitmaps.retain(decodedAssets?.sources ?? []); }, [bitmaps, decodedAssets]);
  useEffect(() => () => bitmaps.retain([]), [bitmaps]);

  // What the preview omits: the in-place edit session's layer — hidden
  // while its live editor floats over it. Preview-only: meaningless for a
  // print file. Disabled layers are already gone from the drawn layers.
  const skip = useMemo<{ has(id: string): boolean }>(
    () => ({ has: (id: string) => id === p.editSession }), [p.editSession]);
  const canvasSource = useMemo<CanvasRenderSource | null>(
    () => (canvasAssets ? { ...canvasAssets, skip } : null),
    [canvasAssets, skip],
  );

  useEffect(() => {
    if (!active && !keepSource) setDecodedAssets(null);
  }, [active, keepSource]);

  return { canvasAssets, canvasSource, previewReady: !!canvasAssets, assetsFailed };
}
