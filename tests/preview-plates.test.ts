// preview-plates.test.ts — the hidden mask plate is not repainted while the
// split divider fully clips it (issue #395).
import { expect, it } from "vitest";
import { platesToPaint } from "../src/components/PreviewCompare";

it("skips the mask plate while hidden and paints it once revealed", () => {
  expect(platesToPaint(false)).toEqual(["art"]);
  expect(platesToPaint(true)).toEqual(["art", "mask"]);
});
