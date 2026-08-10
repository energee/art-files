// warning.ts — DOM/PDF-free warning-column wrapping shared by every renderer
// and preview hit-testing, so importing hit-test geometry stays lightweight.
import { WARNING_TEXT } from "./defaults";
import { parseRuns } from "./description";
import { runsWidth } from "./layout";
import type { StyledLine } from "./types";

/** Adapt a caller's plain width function into the measure wrapWarning (and
 *  warningColumnLen) need now that WARNING_TEXT carries inline `**bold**`
 *  markers: marker glyphs must not be measured, and a bold run must be
 *  measured in the bold face it draws in. `plain` speaks each caller's own
 *  metrics (pdf-lib font, fontkit face, or the preview's canvas Measure);
 *  tracking is applied per adjacent glyph pair exactly as runsWidth draws. */
export function warningMeasure(
  plain: (text: string, bold: boolean) => number, tracking = 0,
): (text: string) => number {
  return (t) =>
    runsWidth(parseRuns({ text: t } as StyledLine), (r) => plain(r.text, !!r.bold), tracking);
}

/** The on-page length of a wrapped warning column after justification. A
 * multi-word line fills maxLen; a single word stays at its natural width. */
export function warningColumnLen(
  line: string, maxLen: number, measure: (text: string) => number,
): number {
  return line.includes(" ") ? maxLen : measure(line);
}

/** Wrap the warning paragraph to fit the rotated column height. */
export function wrapWarning(measure: (text: string) => number, maxLen: number): string[] {
  const words = WARNING_TEXT.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next) > maxLen && cur) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
