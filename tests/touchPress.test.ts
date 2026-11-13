// touchPress.test.ts — the press rules PreviewCompare and the pane share
// (src/components/touchPress.ts): foldTap, the finger double-tap that opens a
// text layer in place (same layer, within DOUBLE_TAP_MS); isTap, a lift
// within TAP_SLOP_PX of where the finger landed; and stillPress, when a
// press has moved far enough to drag or resize.
import { expect, it } from "vitest";
import { DOUBLE_TAP_MS, foldTap, isTap, stillPress, TAP_SLOP_PX } from "../src/components/touchPress";

it("a second tap on the same layer within the window opens it and forgets both", () => {
  expect(foldTap({ id: "name", at: 1000 }, "name", 1000 + DOUBLE_TAP_MS)).toEqual({ open: true, last: null });
});

it("a second tap stamped the same instant as the first still opens", () => {
  expect(foldTap({ id: "name", at: 1000 }, "name", 1000)).toEqual({ open: true, last: null });
});

it("a tap too late, or on another layer, becomes the new first tap", () => {
  expect(foldTap({ id: "name", at: 1000 }, "name", 1001 + DOUBLE_TAP_MS)).toEqual({ open: false, last: { id: "name", at: 1301 } });
  expect(foldTap({ id: "volume", at: 1000 }, "name", 1100)).toEqual({ open: false, last: { id: "name", at: 1100 } });
  expect(foldTap(null, "name", 1100)).toEqual({ open: false, last: { id: "name", at: 1100 } });
});

it("a press that was no tap, or missed every layer, clears the first tap", () => {
  expect(foldTap({ id: "name", at: 1000 }, null, 1100)).toEqual({ open: false, last: null });
});

it("a finger that drifts up to TAP_SLOP_PX (10px) between landing and lifting still taps", () => {
  expect(TAP_SLOP_PX).toBe(10);
  expect(isTap({ x: 0, y: 0 }, { x: 6, y: 8 })).toBe(true);
  expect(isTap({ x: 0, y: 0 }, { x: 6, y: 8.1 })).toBe(false);
});

it("a finger stays a tap up to TAP_SLOP_PX; a mouse or pen drags from 3px", () => {
  expect(stillPress("touch", { x: 0, y: 0 }, { x: 6, y: 0 })).toBe(true);
  expect(stillPress("touch", { x: 0, y: 0 }, { x: 11, y: 0 })).toBe(false);
  expect(stillPress("mouse", { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
  expect(stillPress("mouse", { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
  expect(stillPress("pen", { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
});
