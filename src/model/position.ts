// src/model/position.ts — pure anchor & snap math (spec: "Lock, snap &
// guides"). An anchor is the layer's reference edge: content-size changes
// re-align around it, which is what makes a snap survive edits. Snapping a
// drag to a guide SETS the anchor (offset 0); a free drop keeps the nearest
// anchor with the offset that reproduces the dropped spot exactly.
export type Anchor = "left" | "center" | "right";
export type VAnchor = "top" | "bottom";
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
  if (p.anchor === "left") return g.left + p.offsetX;
  if (p.anchor === "center") return g.center - w / 2 + p.offsetX;
  return g.right - w + p.offsetX;
}

export function anchoredY(p: LayerPosition, h: number, g: GuideLines): number {
  return p.vAnchor === "top" ? g.top + p.offsetY : g.bottom - h + p.offsetY;
}

export function positionFromDrag(
  x: number, y: number, w: number, h: number, g: GuideLines, threshold: number,
): { position: LayerPosition; snappedX: Anchor | null; snappedY: VAnchor | null } {
  const dx: [Anchor, number][] = [
    ["left", x - g.left], ["center", x + w / 2 - g.center], ["right", x + w - g.right],
  ];
  dx.sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
  const [ax, adx] = dx[0];
  const snappedX = Math.abs(adx) <= threshold ? ax : null;

  const dy: [VAnchor, number][] = [["top", y - g.top], ["bottom", y + h - g.bottom]];
  dy.sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
  const [ay, ady] = dy[0];
  const snappedY = Math.abs(ady) <= threshold ? ay : null;

  return {
    position: {
      anchor: ax, offsetX: snappedX ? 0 : adx,
      vAnchor: ay, offsetY: snappedY ? 0 : ady,
    },
    snappedX, snappedY,
  };
}
