// module-size.test.ts — issue #433: the modules split by operation family
// stay under the 750-line budget the production-readiness audit set, so a
// split cannot quietly grow back into one file. Only the files already split
// are listed; add a module here when its own split lands.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAX_LINES = 750;
const SPLIT = [
  "src/model/edit.ts",
  "src/components/LayerInspector.tsx",
  "src/components/PreviewCompare.tsx",
];

describe("split modules stay under the line budget (#433)", () => {
  for (const file of SPLIT) {
    it(`${file} is at most ${MAX_LINES} lines`, () => {
      const lines = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n").length;
      expect(lines).toBeLessThanOrEqual(MAX_LINES);
    });
  }
});
