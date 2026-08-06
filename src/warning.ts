// warning.ts — DOM/PDF-free warning-column wrapping shared by every renderer
// and preview hit-testing, so importing hit-test geometry stays lightweight.
import { WARNING_TEXT } from "./defaults";

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
