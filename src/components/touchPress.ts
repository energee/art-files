// touchPress.ts — the press rules PreviewCompare and the pane (useZoomPan)
// share: which finger may start a layer gesture, when a press is still a
// click or a tap rather than a drag or a pinch, and the finger double-tap
// that opens a text layer in place on the preview.
// Chrome does send dblclick after a double-tap, but near a small selected
// layer it aims it (and the clicks) at a resize tick, so PreviewCompare
// counts taps itself from where each finger lifted.

/** A finger that lands while another is down: only the first finger of a
 *  touch may move or resize a layer; the rest belong to the pane's pinch.
 *  (A mouse or a pen is always primary.) */
export const extraFinger = (e: { pointerType: string; isPrimary: boolean }) => e.pointerType === "touch" && !e.isPrimary;

/** Mouse/pen travel (px) before a press drags; below it, a click. */
const DRAG_THRESHOLD_PX = 3;

/** Two finger taps on the same layer this close (ms) open it in place, like
 *  a double-click. */
export const DOUBLE_TAP_MS = 300;

/** How far (px) a finger may drift between landing and lifting and still
 *  count as a tap: a real fingertip rolls a few px. */
export const TAP_SLOP_PX = 10;

/** Whether a touch that landed at `from` and lifted at `to` is a tap. */
export const isTap = (from: { x: number; y: number }, to: { x: number; y: number }): boolean =>
  Math.hypot(to.x - from.x, to.y - from.y) <= TAP_SLOP_PX;

/** Whether a press that landed at `from` and is now at `to` is still a click
 *  or a tap, so neither a move nor a resize starts: a finger within
 *  TAP_SLOP_PX (an imprecise tap must not nudge the layer), a mouse or pen
 *  under DRAG_THRESHOLD_PX. */
export const stillPress = (pointerType: string, from: { x: number; y: number }, to: { x: number; y: number }): boolean =>
  pointerType === "touch" ? isTap(from, to) : Math.hypot(to.x - from.x, to.y - from.y) < DRAG_THRESHOLD_PX;

/** A tap that may start a double-tap: the layer under the lift, and when
 *  (the lift's event timeStamp, ms: monotonic, unlike Date.now()). */
export type Tap = { id: string; at: number };

/** Folds a finished touch press into the `last` tap. `id` is the layer under
 *  the lift, or null when the press was no tap (it moved, or another finger
 *  joined) or missed every layer. `open` when it is the second tap on the
 *  same layer within DOUBLE_TAP_MS; then nothing is kept, so a third tap
 *  starts afresh. Otherwise this tap (or none) is the one to remember. */
export function foldTap(last: Tap | null, id: string | null, at: number): { open: boolean; last: Tap | null } {
  if (id && last?.id === id && at - last.at <= DOUBLE_TAP_MS) return { open: true, last: null };
  return { open: false, last: id ? { id, at } : null };
}
