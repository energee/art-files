// description.ts — parses the description block's markdown subset into styled
// lines: `# text` = header, `**text**` = bold, `_text_` = white ink (white
// fill + white layer), combinable. Plain lines and the header take the
// caller's base style (cfg.descStyle: fill, layer, outer stroke); the white
// marker overrides fill/layer but keeps the base stroke.
// ponytail: per-line styling only, no inline spans — add if a label ever
// needs them.
import type { Style, StyledLine } from "./types";
import { GOLD } from "./layout";

const DEFAULT_BASE: Style = { fill: GOLD, layer: "metallic" };

export interface ParsedDescription {
  header: StyledLine | null;
  lines: StyledLine[];
}

function styleLine(raw: string, base: Style, bold = false): StyledLine {
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
    fill: white ? "none" : base.fill,
    layer: white ? "white" : base.layer,
    stroke: base.stroke,
    strokeWidth: base.strokeWidth,
  };
}

export function parseDescription(src: string, base: Style = DEFAULT_BASE): ParsedDescription {
  const out: ParsedDescription = { header: null, lines: [] };
  for (const raw of src.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("#")) out.header = styleLine(t.replace(/^#+\s*/, ""), base, true);
    else out.lines.push(styleLine(t, base));
  }
  return out;
}

/** Inverse of parseDescription — the WYSIWYG editor edits styled lines and
 *  writes back the markdown string LabelConfig still stores. Canonicalizes
 *  marker order to white-inside/bold-outside (e.g., `**_text_**`), and drops
 *  the redundant `**` from headers since they are always bold. */
export function serializeDescription(d: ParsedDescription): string {
  const line = (l: StyledLine, header = false) => {
    let s = l.text;
    if (l.layer === "white") s = `_${s}_`;
    if (l.bold && !header) s = `**${s}**`;
    return header ? `# ${s}` : s;
  };
  const head = d.header ? [line(d.header, true)] : [];
  return [...head, ...d.lines.map((l) => line(l))].join("\n");
}
