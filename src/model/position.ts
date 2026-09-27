// src/model/position.ts — pure anchor & snap math (spec: "Lock, snap &
// guides"). An anchor is the layer's reference edge: content-size changes
// re-align around it, which is what makes a snap survive edits. Snapping a
// drag to a guide SETS the anchor (offset 0); a free drop keeps the nearest
// anchor with the offset that reproduces the dropped spot exactly.
export type Anchor = "left" | "center" | "right";
type VAnchor = "top" | "bottom";
export interface LayerPosition {
  anchor: Anchor; vAnchor: VAnchor; offsetX: number; offsetY: number;
}
export interface GuideLines {
  left: number; center: number; right: number; top: number; bottom: number;
}

/** How far along the box (0 = left/top edge, 0.5 = middle, 1 = right/bottom
 *  edge) an anchor sits — the one place the anchor names become numbers. */
export function anchorFraction(a: Anchor | "top" | "middle" | "bottom"): 0 | 0.5 | 1 {
  return a === "left" || a === "top" ? 0 : a === "center" || a === "middle" ? 0.5 : 1;
}

export function anchoredX(p: LayerPosition, w: number, g: GuideLines): number {
  return g[p.anchor] - anchorFraction(p.anchor) * w + p.offsetX;
}

export function anchoredY(p: LayerPosition, h: number, g: GuideLines): number {
  return g[p.vAnchor] - anchorFraction(p.vAnchor) * h + p.offsetY;
}
