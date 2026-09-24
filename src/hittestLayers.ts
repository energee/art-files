// hittestLayers.ts — maps a point in label space (points, top-left origin)
// to the v3 layer under it. Boxes come from planLayers' own placement
// (layerBoxes / planLayerScene), so a hit box cannot drift from the artwork;
// like hittest.ts, one BLEED_SHIFT is applied at the end so the outlines land
// on the art the preview draws at the current bleed. Locked layers stay in the boxes and are refused as drag
// targets by the preview.
import type { Layer, TextLayer } from "./model/layers";
import type { Box } from "./model/place";
import * as L from "./layout";

export interface LayerBox {
  id: string; x: number; y: number; w: number; h: number;
  /** Fillers cannot move it (LayerBase.locked). */
  locked: boolean;
}

/** One hit box per drawing layer, in draw order, from the scene's measured
 *  boxes (planLayerScene / layerBoxes). Page-role images (background, mask)
 *  are omitted so a click there selects the page; a layer that draws nothing
 *  has a zero box and is omitted too — except empty text (#116), which gets
 *  a line-height square (see emptyTextBox) so it can still be clicked,
 *  outlined and edited in place. */
export function hitBoxesFromLayout(layers: Layer[], boxes: ReadonlyMap<string, Box>): LayerBox[] {
  const out: LayerBox[] = [];
  for (const l of layers) {
    if (l.kind === "image" && (l.role === "background" || l.role === "mask")) continue;
    let b = boxes.get(l.id)!;
    if (l.kind === "text") b = emptyTextBox(l, b);
    if (b.w <= 0 || b.h <= 0) continue;
    out.push({
      id: l.id, x: b.x + L.BLEED_SHIFT, y: b.y + L.BLEED_SHIFT, w: b.w, h: b.h,
      locked: !!l.locked,
    });
  }
  return out;
}

/** An empty text layer measures zero along its run (w, or h when rotated)
 *  but a full line across it. Hit-testing only: pad the run to that line
 *  height so the layer stays a target, growing from the anchor point the way
 *  typed text will — per `align` horizontally, upward from the bottom when
 *  rotated — which is also the point the in-place editor recovers from this
 *  box, so its caret stays put. The layout box itself (drags, snapping,
 *  export) is untouched. Any other box comes back as-is. */
function emptyTextBox(l: TextLayer, b: Box): Box {
  if (b.w <= 0 && b.h > 0) {
    const shift = l.align === "center" ? b.h / 2 : l.align === "right" ? b.h : 0;
    return { ...b, x: b.x - shift, w: b.h };
  }
  if (b.h <= 0 && b.w > 0) return { ...b, y: b.y - b.w, h: b.w };
  return b;
}

/** The topmost box under the point, or null on bare stock. */
export function hitTestBoxes(xPt: number, yPt: number, boxes: readonly LayerBox[]): string | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (xPt >= b.x && xPt <= b.x + b.w && yPt >= b.y && yPt <= b.y + b.h) return b.id;
  }
  return null;
}
