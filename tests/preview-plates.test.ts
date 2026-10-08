// preview-plates.test.ts — the hidden mask plate is not repainted while the
// split divider fully clips it (issue #395).
import { expect, it } from "vitest";
import { platesToPaint } from "../src/components/PreviewCompare";

it("skips the mask plate at split 0 and paints it once revealed", () => {
  expect(platesToPaint(0)).toEqual(["art"]);
  expect(platesToPaint(1)).toEqual(["art", "mask"]);
  expect(platesToPaint(100)).toEqual(["art", "mask"]);
});
