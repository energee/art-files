// module-size.test.ts — issue #433: the modules split by operation family
// stay under the 750-line budget the production-readiness audit set, so a
// split cannot quietly grow back into one file. Each split module is listed
// with the siblings that now hold its code; add a module and its parts here
// when its own split lands.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAX_LINES = 750;
const SPLIT = [
  "src/model/edit.ts",
  "src/model/editRecords.ts",
  "src/model/editLayers.ts",
  "src/model/editGestures.ts",
  "src/model/editVariants.ts",
  "src/model/editLabel.ts",
  "src/model/editSave.ts",
  "src/components/LayerInspector.tsx",
  "src/components/LayerInspectorControls.tsx",
  "src/components/LayerInspectorSections.tsx",
  "src/components/LayerInspectorTemplate.tsx",
  "src/components/PreviewCompare.tsx",
  "src/components/previewOverlay.ts",
  "src/components/InPlaceRichField.tsx",
];

describe("split modules stay under the line budget (#433)", () => {
  for (const file of SPLIT) {
    it(`${file} is at most ${MAX_LINES} lines`, () => {
      const lines = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").trimEnd().split("\n").length;
      expect(lines).toBeLessThanOrEqual(MAX_LINES);
    });
  }
});
