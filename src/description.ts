// description.ts — parses the description block's markdown subset into styled
// lines: `# text` = header, `**text**` = bold, `_text_` = white ink (white
// fill + white layer), combinable. Plain lines and the header take the
// caller's base style (cfg.descStyle: fill, layer, outer stroke); the white
// marker overrides fill/layer but keeps the base stroke. Only the FIRST
// non-blank line can become the header — any later line starting with `#` is
// literal body text (the `#` stays in it verbatim), never a second header;
// there is only ever one header slot, so it can't silently overwrite it.
// A body line that would itself be emitted first (a header-less block whose
// opening line reads e.g. "#3 Citra") is written escaped as `\#3 Citra` and
// unescaped on the way back in, so it round-trips as a body line instead of
// being promoted to the header on the next parse. That escape is the format's
// only one: `\` is literal everywhere else, including before a `#` that is
// not at the start of a line.
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

/** Strips the leading-`#` escape serializeDescription writes (`\#` -> `#`).
 *  Only ever a single backslash immediately before a leading `#`. */
const unescapeHash = (s: string) => s.replace(/^\\(?=#)/, "");

export function parseDescription(src: string, base: Style = DEFAULT_BASE): ParsedDescription {
  const out: ParsedDescription = { header: null, lines: [] };
  for (const raw of src.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    // Header eligibility is "nothing emitted yet": only the first non-blank
    // line can be one. `!out.header` alone would let a `#` line ANYWHERE in a
    // header-less block become the header — which then jumps to the top of
    // the block and renders at the header baseline (e.g. a hop list whose
    // second line reads "#3 Citra"). The extra `lines.length === 0` keeps
    // such a line where the author put it; the `#` stays in it verbatim.
    // `!out.header` still matters on its own for a `#` line following a
    // header-only block, where lines.length is also 0.
    if (t.startsWith("#") && !out.header && out.lines.length === 0)
      out.header = styleLine(t.replace(/^#+\s*/, ""), base, true);
    else out.lines.push(styleLine(unescapeHash(t), base));
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
  const body = d.lines.map((l) => line(l));
  // Only a body line emitted FIRST can be misread as a header on the way
  // back in (parseDescription only considers the first non-blank line), so
  // that is the only place the escape is needed — every later `#` line
  // survives verbatim without one.
  if (!d.header && body.length && body[0].startsWith("#")) body[0] = `\\${body[0]}`;
  return [...head, ...body].join("\n");
}
