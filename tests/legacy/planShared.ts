// Historical text layout and fixed asset slots, kept beside the test oracle.
export * from "../../src/plan";
import { strokeSpec, type PlanAssets as LivePlanAssets, type PlanArt, type Face, type MeasureFace, type PlacedText } from "../../src/plan";
import type { GuideLines } from "../../src/model/position";
import type { StyledLine } from "../../src/types";
import { parseRuns } from "../../src/description";
import * as L from "./layout";
export interface PlanAssets extends LivePlanAssets {
  collabLeft?: PlanArt | null;
  collabCenter?: PlanArt | null;
}

/** The guide lines a custom layer's anchor resolves against: the label's
 *  safe-area edges (L.SAFE), center = the midpoint of left/right. The ONE
 *  place this is computed — Task 4's drag-to-position math (model/position.ts)
 *  uses the same GuideLines shape, so a custom layer's plotted position and
 *  its drag guides can never disagree. */
export function labelGuides(): GuideLines {
  return {
    left: L.SAFE.left, right: L.SAFE.right,
    center: (L.SAFE.left + L.SAFE.right) / 2,
    top: L.SAFE.top, bottom: L.SAFE.bottom,
  };
}

/** One styled line as placed runs: walks the parsed runs left to right (or
 *  centered around `at.cx`), advancing x by each run's measured width plus
 *  tracking. `at.face` (the wordmark/name's forced Bold) wins over the bold
 *  flag on each run. This is the PDF backend's former drawLine, minus the
 *  drawing. */
export function lineRuns(
  id: string,
  line: StyledLine,
  m: MeasureFace,
  at: ({ x: number } | { cx: number }) & { baseline: number; size: number; face?: Face },
): PlacedText[] {
  const runs = parseRuns(line);
  const faceOf = (r: StyledLine): Face => at.face ?? (r.bold ? "semibold" : "regular");
  const tracking = line.letterSpacing ?? 0;
  const advances = L.runAdvances(runs, (r) => m(r.text, at.size, faceOf(r)), tracking);
  const total = advances.reduce((a, b) => a + b, 0) - tracking;
  let x = "cx" in at ? at.cx - total / 2 : at.x;
  const stroke = strokeSpec(line);
  return runs.map((run, i) => {
    const placed: PlacedText = {
      kind: "text", id, text: run.text, x, y: at.baseline,
      // The run's drawn width is its advance minus the gap to the next run.
      w: advances[i] - tracking,
      size: at.size, face: faceOf(run), tracking,
      fill: run.fill, layer: run.layer, stroke, rotated: false,
    };
    x += advances[i];
    return placed;
  });
}
