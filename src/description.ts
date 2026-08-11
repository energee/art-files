// description.ts — parses the description block's markdown subset into styled
// lines: `# text` = header, `**text**` = bold, `_text_` = white ink (the
// white-ink LAYER), combinable. Plain lines and the header take the caller's
// base style (cfg.descStyle: fill, layer, outer stroke); the white marker
// overrides the fill layer only — stroke, its own layer, and tracking all
// stay the block's. Only the FIRST
// non-blank line can become the header — any later line starting with `#` is
// literal body text (the `#` stays in it verbatim), never a second header;
// there is only ever one header slot, so it can't silently overwrite it.
// A body line that would itself be emitted first (a header-less block whose
// opening line reads e.g. "#3 Citra") is written escaped as `\#3 Citra` and
// unescaped on the way back in, so it round-trips as a body line instead of
// being promoted to the header on the next parse. That escape is the format's
// only one: `\` is literal everywhere else, including before a `#` that is
// not at the start of a line.
// Inline spans: `**bold**` and `_white ink_` also apply to a RUN inside a
// line (parseRuns), not just to a whole line. The line-level pass runs first
// and strips a marker pair wrapping the entire line; whatever is left is
// tokenized into runs that inherit the line's style and override only bold
// and layer. A marker with no closer later in the line stays literal text,
// so an address containing a lone `_` is not silently swallowed.
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
    // White ink is a LAYER choice, nothing to do with the fill: it decides
    // which plate the line prints on, and the line keeps whatever color the
    // block is set to — exactly how fill and layer behave for every other
    // element's style panel. A line that should carry no color ink sets its
    // fill to "none" itself; the marker no longer does that for it.
    fill: base.fill,
    layer: white ? "white" : base.layer,
    stroke: base.stroke,
    ...(base.strokeLayer ? { strokeLayer: base.strokeLayer } : {}),
    strokeWidth: base.strokeWidth,
    // Tracking is a block-level setting like the stroke: the white marker
    // overrides the fill layer only, never the stroke plate or spacing.
    letterSpacing: base.letterSpacing,
  };
}

/** Strips the leading-`#` escape serializeDescription writes (`\#` -> `#`).
 *  Only ever a single backslash immediately before a leading `#`. */
const unescapeHash = (s: string) => s.replace(/^\\(?=#)/, "");

export function parseDescription(src: string, base: Style = DEFAULT_BASE): ParsedDescription {
  const out: ParsedDescription = { header: null, lines: [] };
  for (const raw of src.split("\n")) {
    const t = raw.trim();
    // Blank lines are KEPT as empty body lines — they render as vertical
    // gaps (each line draws at firstBaseline + i * leading, and an empty
    // drawText is a no-op), and dropping them made the editor silently eat
    // an author's returns on every reseed. Only LEADING blanks are skipped:
    // nothing renders above the first line, and the header rule below stays
    // "first non-blank line", as it always was.
    if (!t) {
      if (out.header || out.lines.length) out.lines.push(styleLine("", base));
      continue;
    }
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

/** Splits a styled line into inline runs. Each run carries the line's whole
 *  style and overrides only what its markers set, so a caller can draw runs
 *  with the same code path it used for the line. A marker-free line yields
 *  exactly one run equal to the line — the no-inline-spans case stays a
 *  single drawText, byte-identical to before.
 *
 *  Markers nest in either order (`**_x_**` == `_**x**_`). An unmatched
 *  marker is literal: `A_B` has no closing `_`, so it renders as typed. */
export function parseRuns(line: StyledLine): StyledLine[] {
  const src = line.text;
  const baseBold = !!line.bold;
  const baseWhite = line.layer === "white";
  const out: StyledLine[] = [];
  let openBold = false;
  let openWhite = false;
  let buf = "";
  const flush = () => {
    if (!buf) return;
    out.push({
      ...line,
      text: buf,
      bold: baseBold || openBold,
      // A `_` run moves to the white plate; without one the line's own layer
      // stands, exactly as the line-level marker behaves.
      layer: openWhite || baseWhite ? "white" : line.layer,
    });
    buf = "";
  };
  for (let i = 0; i < src.length; ) {
    const mark = src.startsWith("**", i) ? "**" : src[i] === "_" ? "_" : null;
    const open = mark === "**" ? openBold : openWhite;
    // Opening costs a closer; closing never does.
    if (mark && (open || src.indexOf(mark, i + mark.length) !== -1)) {
      flush();
      if (mark === "**") openBold = !openBold;
      else openWhite = !openWhite;
      i += mark.length;
      continue;
    }
    buf += src[i];
    i += 1;
  }
  flush();
  return out.length ? out : [{ ...line, text: "" }];
}

/** The Info line (cfg.handleAddress) authored in the SAME markdown subset as
 *  the description block, but rendered as one rotated line: `**bold**` and
 *  `_white ink_` over the element's own style. Header markup collapses to
 *  bold — the Info slot has one baseline, so there is nowhere for a header
 *  to render differently — and anything past the first line is dropped,
 *  matching what the renderer can draw. Plain text parses to itself, so
 *  every config written before this existed is unaffected.
 *
 *  `bold` is OR'd with the base's: the style row's Bold checkbox still
 *  applies to the whole line, and a marker can only add emphasis on top. */
export function parseInfoLine(src: string, base: StyledLine): StyledLine {
  const d = parseDescription(src, base);
  const line = d.header ?? d.lines[0];
  if (!line) return { ...base, text: "" };
  return { ...line, bold: !!base.bold || !!line.bold };
}

/** Inverse of parseDescription — the WYSIWYG editor edits styled lines and
 *  writes back the markdown string LabelConfig still stores. Canonicalizes
 *  marker order to white-inside/bold-outside (e.g., `**_text_**`), and drops
 *  the redundant `**` from headers since they are always bold. */
export function serializeDescription(d: ParsedDescription): string {
  const line = (l: StyledLine, header = false) => {
    let s = l.text;
    // An empty line stays empty: wrapping "" in markers would write `__` or
    // `****`, which parse back as marked empty lines — style on a blank
    // line has nothing to apply to anyway.
    if (!s && !header) return "";
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
