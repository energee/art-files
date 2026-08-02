// description.ts — parses the description block's markdown subset into styled
// lines: `# text` = header, `**text**` = bold, `_text_` = white ink (white
// fill + white layer), combinable; plain lines are gold metallic.
// ponytail: per-line styling only, no inline spans or black fill — add if a
// label ever needs them.
import type { StyledLine } from "./types";

export interface ParsedDescription {
  header: StyledLine | null;
  lines: StyledLine[];
}

function styleLine(raw: string, bold = false): StyledLine {
  let s = raw.trim();
  let white = false;
  for (;;) {
    let m = s.match(/^\*\*(.*)\*\*$/);
    if (m) { bold = true; s = m[1].trim(); continue; }
    m = s.match(/^_(.*)_$/);
    if (m) { white = true; s = m[1].trim(); continue; }
    break;
  }
  return {
    text: s,
    bold,
    fill: white ? "white" : "gold",
    layer: white ? "white" : "metallic",
  };
}

export function parseDescription(src: string): ParsedDescription {
  const out: ParsedDescription = { header: null, lines: [] };
  for (const raw of src.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("#")) out.header = styleLine(t.replace(/^#+\s*/, ""), true);
    else out.lines.push(styleLine(t));
  }
  return out;
}
