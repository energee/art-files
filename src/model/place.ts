// src/model/place.ts — pure box placement for v3 layers (spec: "Relative
// position"). Given every layer's measured size, resolves each layer's box:
// x from its anchor (left edge / center / right edge), y from a numeric top
// (or bottom, for vAnchor "bottom") or a `below` binding to another layer's
// resolved bottom plus a gap. Bindings resolve in dependency order and
// chains work; the parser already rejects cycles and dangling references,
// so the guards here are belt-and-braces that name what went wrong.
// No measuring happens here — `sizeOf` returns the box AS IT SITS ON THE
// PAGE (a rotated layer's caller has already swapped w/h).
import type { Layer } from "./layers";

export interface Box { x: number; y: number; w: number; h: number }

export function placeLayers(
  layers: Layer[], sizeOf: (l: Layer) => { w: number; h: number },
): Map<string, Box> {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const boxes = new Map<string, Box>();
  const visiting = new Set<string>();
  const resolve = (l: Layer): Box => {
    const done = boxes.get(l.id);
    if (done) return done;
    if (visiting.has(l.id)) throw new Error(`Layer "${l.id}" has a cyclic y binding`);
    visiting.add(l.id);
    const { w, h } = sizeOf(l);
    const x = l.anchor === "left" ? l.x : l.anchor === "center" ? l.x - w / 2 : l.x - w;
    let y: number;
    if (typeof l.y === "number") y = l.vAnchor === "bottom" ? l.y - h : l.y;
    else {
      const above = byId.get(l.y.below);
      if (!above) throw new Error(`Layer "${l.id}" is bound below missing layer "${l.y.below}"`);
      const a = resolve(above);
      y = a.y + a.h + l.y.gap;
    }
    const box = { x, y, w, h };
    boxes.set(l.id, box);
    visiting.delete(l.id);
    return box;
  };
  for (const l of layers) resolve(l);
  return boxes;
}
