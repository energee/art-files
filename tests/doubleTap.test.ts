// doubleTap.test.ts — foldTap, the finger double-tap rule PreviewCompare uses
// to open a text layer in place: same layer, within DOUBLE_TAP_MS.
import { expect, it } from "vitest";
import { DOUBLE_TAP_MS, foldTap } from "../src/components/doubleTap";

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
