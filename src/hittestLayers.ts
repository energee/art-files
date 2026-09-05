// hittestLayers.ts — maps a point in label space (points, top-left origin)
// to the v3 layer under it, and hands the drag gesture the patch a move
// makes. Boxes come from planLayers' own placement (layerBoxes), so a hit
// box cannot drift from the artwork; like hittest.ts, one BLEED_SHIFT is
// applied at the end so the outlines land on the art the preview draws at
// the current bleed. Lock is universal: a locked layer is never a drag
// target, whatever its kind.
import type { Layer } from "./model/layers";
import type { Box } from "./model/place";
import { layerBoxes } from "./planLayers";
import type { MeasureFace, PlanAssets } from "./plan";
import type { DeepPartial } from "./model/merge";
import * as L from "./layout";

export interface LayerBox {
  id: string; x: number; y: number; w: number; h: number;
  /** Fillers cannot move it (LayerBase.locked). */
  locked: boolean;
}

/** Every drawing layer's box, in paint order (later entries sit on top).
 *  The background texture and metallic mask are omitted: they are picked
 *  from the Layers list, and a click on bare stock must clear the selection
 *  rather than select the page. A layer that draws nothing (empty asset,
 *  invalid payload) has a zero box and is omitted too. */
export function hitBoxesLayers(layers: Layer[], m: MeasureFace, assets: PlanAssets): LayerBox[] {
  return hitBoxesFromLayout(layers, layerBoxes(layers, m, assets));
}

/** Reuse an already measured scene for preview selection and pointer hits. */
export function hitBoxesFromLayout(layers: Layer[], boxes: ReadonlyMap<string, Box>): LayerBox[] {
  const out: LayerBox[] = [];
  for (const l of layers) {
    if (l.kind === "image" && (l.role === "background" || l.role === "mask")) continue;
    const b = boxes.get(l.id)!;
    if (b.w <= 0 || b.h <= 0) continue;
    out.push({
      id: l.id, x: b.x + L.BLEED_SHIFT, y: b.y + L.BLEED_SHIFT, w: b.w, h: b.h,
      locked: !!l.locked,
    });
  }
  return out;
}

export function hitTestLayers(
  xPt: number, yPt: number, layers: Layer[], m: MeasureFace, assets: PlanAssets,
): string | null {
  return hitTestBoxes(xPt, yPt, hitBoxesLayers(layers, m, assets));
}

export function hitTestBoxes(xPt: number, yPt: number, boxes: readonly LayerBox[]): string | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (xPt >= b.x && xPt <= b.x + b.w && yPt >= b.y && yPt <= b.y + b.h) return b.id;
  }
  return null;
}

/** The boxes for `ids`, in the order asked for, for drawing selection
 *  outlines. Ids that draw nothing are simply absent. One placement pass
 *  covers the whole selection. */
export function boxesForLayers(
  ids: readonly string[], layers: Layer[], m: MeasureFace, assets: PlanAssets,
): LayerBox[] {
  const byId = new Map(hitBoxesLayers(layers, m, assets).map((b) => [b.id, b]));
  return ids.map((id) => byId.get(id)).filter((b): b is LayerBox => b !== undefined);
}

export function boxOfLayer(
  id: string, layers: Layer[], m: MeasureFace, assets: PlanAssets,
): LayerBox | null {
  return boxesForLayers([id], layers, m, assets)[0] ?? null;
}

/** Drag-to-move target for one layer, or null when it cannot move: locked,
 *  unknown, or drawing nothing. `moved(dx, dy)` is the position patch a
 *  drag by that delta writes — `x` follows the anchor, `y` the edge it
 *  names, and a bound layer keeps its binding and edits the gap (spec:
 *  "Design-mode drag of a bound layer edits gap"). The caller records the
 *  patch on the master, the variant, or the label's overrides. */
export function dragTargetLayers(
  layers: Layer[], id: string, m: MeasureFace, assets: PlanAssets,
): { box: LayerBox; moved(dx: number, dy: number): DeepPartial<Layer> } | null {
  const layer = layers.find((l) => l.id === id);
  if (!layer || layer.locked) return null;
  const box = boxOfLayer(id, layers, m, assets);
  if (!box) return null;
  const y = layer.y;
  return {
    box,
    moved: (dx, dy) => {
      const b = layer.binding;
      const horizontal = b?.side === "left" || b?.side === "right";
      return {
        ...(!horizontal ? { x: layer.x + dx } : {}),
        ...(!b || horizontal ? { y: typeof y === "number" ? y + dy : { below: y.below, gap: y.gap + dy } } : {}),
        ...(b ? { binding: { ...b, gap: b.gap + ((horizontal ? dx : dy) * (b.side === "top" || b.side === "left" ? -1 : 1)) } } : {}),
      };
    },
  };
}
