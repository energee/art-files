// src/model/place.ts — pure box placement for v3 layers (spec: "Relative
// position"). Given every layer's measured size, resolves each layer's box:
// x from its anchor (left edge / center / right edge), y from a numeric top
// (or bottom, for vAnchor "bottom") or a binding outside another layer's
// resolved top/left/right/bottom edge plus a gap. Bindings resolve in dependency order and
// chains work; the parser already rejects cycles and dangling references,
// so the guards here are belt-and-braces that name what went wrong.
// No measuring happens here — `sizeOf` returns the box AS IT SITS ON THE
// PAGE (a rotated layer's caller has already swapped w/h).
import { bindingOf, guideOf, vAnchorOf, type Layer } from "./layers";
import { anchorFraction } from "./position";
import type { GuideLines } from "./position";
import { SAFE } from "../layout";

export interface Box { x: number; y: number; w: number; h: number }

export function placeLayers(
  layers: Layer[], sizeOf: (l: Layer) => { w: number; h: number },
  guides: Pick<GuideLines, "top" | "bottom"> & Partial<Pick<GuideLines, "left" | "center" | "right">> = SAFE,
): Map<string, Box> {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const boxes = new Map<string, Box>();
  const visiting = new Set<string>();
  const resolve = (l: Layer): Box => {
    const done = boxes.get(l.id);
    if (done) return done;
    if (visiting.has(l.id)) throw new Error(`Layer "${l.id}" has a cyclic binding`);
    visiting.add(l.id);
    const { w, h } = sizeOf(l);
    const guideX = guideOf(l.guideX);
    let x = l.x + (guideX ? (guides[guideX] ?? SAFE[guideX]) : 0) - anchorFraction(guideX ?? l.anchor) * w;
    let y = 0;
    if (typeof l.y === "number") {
      const guide = guideOf(l.guideY);
      const origin = guide === "middle" ? (guides.top + guides.bottom) / 2 : guide ? guides[guide] : 0;
      y = l.y + origin - anchorFraction(vAnchorOf(l)) * h;
    }
    const binding = bindingOf(l);
    if (binding) {
      const target = byId.get(binding.to);
      if (!target) throw new Error(`Layer "${l.id}" is bound to missing layer "${binding.to}"`);
      const a = resolve(target);
      switch (binding.side) {
        case "top": y = a.y - binding.gap - h; break;
        case "bottom": y = a.y + a.h + binding.gap; break;
        case "left": x = a.x - binding.gap - w; break;
        case "right": x = a.x + a.w + binding.gap; break;
      }
    }
    const box = { x, y, w, h };
    boxes.set(l.id, box);
    visiting.delete(l.id);
    return box;
  };
  for (const l of layers) resolve(l);
  return boxes;
}
