// src/model/editGestures.ts — the pointer-gesture patches (edit.ts's
// "gestures" family): binding and unbinding at a measured box, snapping, the
// drag patch (moveBy) and the resize patch (resizeBy). Each returns a minimal
// LayerPatch for App to route; none touches a Master.
import type { Layer, RelativeY, BindingSide } from "./layers";
import type { Box } from "./place";
import { bindingOf, hAnchorOf, vAnchorOf } from "./layers";
import { isPlain } from "./merge";
import { anchorFraction } from "./position";
import { PT_STEP, roundToStep } from "../numeric";
import type { LayerPatch } from "./editRecords";

export const isBound = (y: unknown): y is RelativeY => isPlain(y) && typeof y.below === "string";

/** A position written from a gesture or a measurement, on the model's 0.01pt
 *  grid (#130). Pointer deltas and measured boxes are raw floats, and without
 *  this their noise went straight into the saved master (x: 193.08552000000003)
 *  where a typed or nudged value is clean. */
export const pt = (v: number) => roundToStep(v, PT_STEP);

/** Detach only the bound axis, preserving its current measured position. */
export function unbindPatch(layer: Layer, box: Box): LayerPatch {
  const b = bindingOf(layer);
  return b?.side === "left" || b?.side === "right"
    ? { binding: null, x: pt(box.x), anchor: "left", guideX: "none" }
    : { binding: null, y: pt(box.y), vAnchor: "top", guideY: "none" };
}

/** Switch sides without moving the newly free axis or retaining a conflicting guide. */
export function bindingPatch(layer: Layer, to: string, side: BindingSide, box: Box): LayerPatch {
  const old = bindingOf(layer);
  return {
    ...(old ? unbindPatch(layer, box) : {}),
    ...(side === "left" || side === "right"
      ? { x: pt(box.x), anchor: "left", guideX: "none" } as const
      : { y: pt(box.y), vAnchor: "top", guideY: "none" } as const),
    binding: { to, side, gap: old?.gap ?? 0 },
  };
}

/** One line a gesture can snap to: where it sits on the snapping axis, and
 *  how far the thing that offered it runs along the OTHER axis — a layer's
 *  own span, a guide's the whole page. The extent is what the on-screen
 *  indicator segment is measured from (App's snapMark). `guide` marks the
 *  page's own lines (master margins/centre and manual guides) apart from a
 *  layer's edges, which is what the indicator colours itself by. */
export interface SnapTarget { at: number; min: number; max: number; guide?: boolean }

/** The candidate `at` is closest to, within `snap` — null when nothing is in
 *  range. Ties go to the last candidate, so a layer's own edge wins over the
 *  page guide it sits on. */
export function nearestLine(
  at: number, lines: readonly SnapTarget[], snap: number,
): SnapTarget | null {
  let best: SnapTarget | null = null;
  let bestAbs = snap;
  for (const line of lines) {
    if (Math.abs(line.at - at) <= bestAbs) { bestAbs = Math.abs(line.at - at); best = line; }
  }
  return best;
}

/** The distance a drag ACTUALLY travels on one axis once it has snapped:
 *  `delta` adjusted so the dragged range's near edge, middle or far edge
 *  lands on whichever candidate `line` it comes within `snap` of, and
 *  `delta` unchanged when nothing is in range. `lines` are the master's
 *  guides plus the edges and middles of the layers that are NOT moving —
 *  the Photoshop/Sketch behaviour: things line up with each other, not only
 *  with the page.
 *
 *  App computes this ONCE per axis, from the bounds of the whole selection,
 *  and drags every selected layer by it. Two rules in one:
 *    * a group snaps together or not at all. Snapping only the grabbed layer
 *      re-spaced the selection by up to `snap` every time it crossed a guide.
 *    * what snaps is the SELECTION's bounds, not whichever layer the pointer
 *      happens to be on — "centre this on the label" is about the thing you
 *      can see, and the grabbed layer is rarely centred within it. */
export function snapDelta(
  range: { min: number; size: number }, delta: number, lines: readonly SnapTarget[], snap: number,
): { delta: number; line: number | null } {
  if (delta === 0) return { delta, line: null };
  const start = range.min + delta;
  const edges = [start, start + range.size / 2, start + range.size];
  let best = 0;
  let bestAbs = snap;
  let line: number | null = null;
  for (const edge of edges) {
    const hit = nearestLine(edge, lines, bestAbs);
    if (!hit) continue;
    bestAbs = Math.abs(hit.at - edge); best = hit.at - edge; line = hit.at;
  }
  return { delta: delta + best, line };
}

/** The drag patch. Horizontal: x moves by `dx`, in whatever terms the layer
 *  already states it — an offset from a guide, or an absolute anchored at its
 *  own edge. Vertical: a bound layer moves its `gap` and keeps its binding; an
 *  unbound one moves `y` (bottom-anchored layers included — `y` is their
 *  bottom edge, still += dy). Locked layers return {}. Axes with no movement
 *  are left out of the patch.
 *
 *  It does NOT re-anchor. It used to run positionFromDrag on every move and
 *  adopt whichever anchor came out nearest, which flipped a layer from centre-
 *  to left- or right-anchored as it crossed roughly a quarter and two-thirds
 *  of the way across the page — and since the flip re-reads x against a box
 *  width assumed from the drag's start, any layer whose real box differs
 *  (a rotated column, an image still measuring) jumped at exactly those two
 *  places. Snapping does not need it either: snapDelta already lands the drag
 *  on the guide, and `guideX` is the deliberate way to glue a layer to one.
 *
 *  `moving` is the rest of the dragged SELECTION. A layer bound to another
 *  layer in it already follows that layer, so moving its `gap` as well would
 *  carry it twice as far as the pointer — the axis it is bound on is left out
 *  of the patch instead, and the binding does the work. */
export function moveBy(
  layer: Layer, dx: number, dy: number, moving: ReadonlySet<string> = new Set(),
): LayerPatch {
  if (layer.locked) return {};
  const patch: LayerPatch = {};
  const binding = layer.binding;
  const horizontal = binding?.side === "left" || binding?.side === "right";
  // Legacy `y: { below }` binds vertically without a `binding` record.
  const anchoredTo = bindingOf(layer);
  const carried = !!anchoredTo && moving.has(anchoredTo.to);
  const carriedH = carried && (anchoredTo.side === "left" || anchoredTo.side === "right");
  const carriedV = carried && !carriedH;
  if (carriedH) return moveBy({ ...layer, binding: null }, 0, dy, moving);
  if (binding && !carriedV && (horizontal ? dx !== 0 : dy !== 0)) {
    const delta = horizontal ? dx : dy;
    patch.binding = { ...binding, gap: pt(binding.gap + (binding.side === "left" || binding.side === "top" ? -delta : delta)) };
  }
  if (dx !== 0 && !horizontal) patch.x = pt(layer.x + dx);
  if (dy !== 0 && !carriedV && (!binding || horizontal)) {
    patch.y = isBound(layer.y) ? { below: layer.y.below, gap: pt(layer.y.gap + dy) } : pt(layer.y + dy);
  }
  return patch;
}

/** Which handle a resize drag grabbed: -1 = left/top edge, 0 = the axis is
 *  not grabbed (a side handle), 1 = right/bottom edge. */
export interface ResizeHandle { hx: -1 | 0 | 1; hy: -1 | 0 | 1 }

/** The resize patch for a drag on any of the eight selection handles.
 *  `dx`/`dy` are the pointer's page-space deltas; the grabbed edge follows the pointer and the opposite edge stays
 *  put, whatever the layer's anchor (the anchor only decides how that
 *  translates into x/y — a center-anchored box dragged by its left edge
 *  shifts x by half). A bound axis keeps its binding and only sizes. Image
 *  and barcode stretch freely unless `uniform` (shift), which applies the
 *  grabbed axis's factor to both; QR, and an image without `h`, are always
 *  uniform. Text resizes only its wrap width — type size stays the
 *  inspector's — so for text only the width axis (page-vertical when rotated)
 *  does anything. Locked layers and degenerate boxes return {}. */
export function resizeBy(
  layer: Layer, box: { w: number; h: number }, handle: ResizeHandle, dx: number, dy: number, uniform: boolean,
): LayerPatch {
  if (layer.locked || box.w <= 0 || box.h <= 0) return {};
  const rot = layer.rotation === 90;
  // Page-space box deltas, clamped so a box never inverts.
  let dw = handle.hx === 0 ? 0 : Math.max(handle.hx * dx, 0.05 * box.w - box.w);
  let dh = handle.hy === 0 ? 0 : Math.max(handle.hy * dy, 0.05 * box.h - box.h);
  const lockAspect = uniform || layer.kind === "qr" || (layer.kind === "image" && layer.h == null);
  if (lockAspect) {
    // The grabbed axis drives; a corner drives by the larger relative pull.
    const byW = handle.hy === 0 || (handle.hx !== 0 && Math.abs(dw) / box.w >= Math.abs(dh) / box.h);
    if (byW) dh = box.h * (dw / box.w); else dw = box.w * (dh / box.h);
  }
  // Text: only the width axis exists (page-vertical when rotated).
  if (layer.kind === "text") { if (rot) dw = 0; else dh = 0; }
  if (!dw && !dh) return {};
  // Layer-space size deltas.
  const [lw, lh] = rot ? [dh, dw] : [dw, dh];
  const [bw, bh] = rot ? [box.h, box.w] : [box.w, box.h];
  const sx = (bw + lw) / bw, sy = (bh + lh) / bh;
  const size = ((): LayerPatch => {
    switch (layer.kind) {
      // Sizes on the same 0.01pt grid as positions; moduleW keeps its own,
      // finer precision (a module is under a point).
      case "text": return { width: pt(Math.max((layer.width ?? bw) + lw, 1)) };
      case "qr": return { size: pt(layer.size * sx) };
      case "barcode": return { h: pt(layer.h * sy), moduleW: roundToStep(layer.moduleW * sx, 0.0001) };
      case "image": return { w: pt(layer.w * sx), ...(layer.h != null ? { h: pt(layer.h * sy) } : {}) };
    }
  })();
  // Keep the opposite edge still: the anchored point moves by its share of
  // the size change, minus the whole change when the left/top edge was grabbed.
  // Both axes read the guide before the raw anchor (hAnchorOf / vAnchorOf),
  // the same rule place.ts positions them by.
  const b = bindingOf(layer);
  const ax = dw * (anchorFraction(hAnchorOf(layer)) - (handle.hx === -1 ? 1 : 0));
  const ay = dh * (anchorFraction(vAnchorOf(layer)) - (handle.hy === -1 ? 1 : 0));
  const pos: LayerPatch = {};
  if (ax && !(b?.side === "left" || b?.side === "right")) pos.x = pt(layer.x + ax);
  if (ay && typeof layer.y === "number" && !(b?.side === "top" || b?.side === "bottom")) pos.y = pt(layer.y + ay);
  return { ...size, ...pos };
}
