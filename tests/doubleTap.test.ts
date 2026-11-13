// doubleTap.test.ts — foldTap, the finger double-tap rule PreviewCompare uses
// to open a text layer in place: same layer, within DOUBLE_TAP_MS; and isTap,
// a lift within TAP_SLOP_PX of where the finger landed.
import { expect, it } from "vitest";
import { DOUBLE_TAP_MS, foldTap, isTap, TAP_SLOP_PX } from "../src/components/doubleTap";

it("a second tap on the same layer within the window opens it and forgets both", () => {
  expect(foldTap({ id: "name", at: 1000 }, "name", 1000 + DOUBLE_TAP_MS)).toEqual({ open: true, last: null });
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
