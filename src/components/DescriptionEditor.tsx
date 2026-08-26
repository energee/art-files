// DescriptionEditor.tsx — WYSIWYG replacement for the description textarea.
// The block used to be authored as a markdown subset (`# header`,
// `**bold**`, `_white ink_`) in a plain textarea, with the syntax explained
// only in a tooltip; since this app is used every few weeks, that syntax
// never became muscle memory. This editor keeps the same single multiline
// field but renders the text in its real appearance (gold/white, bold,
// header size) instead of encoding it as punctuation — per LINE, and per
// inline RUN inside a line (`**bold**` mid-sentence is a painted span, not
// asterisks on screen; see runsOf and readLineEl, which are inverses).
//
// Consumers share the machinery here through useDescriptionField: the
// sidebar's DescriptionEditor below (a chromed form field with an inline
// toolbar row and an "Edit as Markdown" escape hatch — used by both the
// description block and the one-line Info row), and PreviewCompare's
// in-place sessions (the same contenteditable positioned over the drawn
// element on the 2D preview, with DescriptionToolbarButtons floating above
// it as a pill). The hook owns the DOM/caret strategy; each consumer owns
// its own chrome and paint.
//
// markdownToLines/linesToMarkdown are thin adapters over description.ts's
// parseDescription/serializeDescription — they do NOT re-implement the
// markdown grammar. serializeDescription canonicalizes (white-inside/
// bold-outside marker order, header's redundant `**` dropped). Blank lines
// round-trip as empty body lines and render as vertical gaps; only LEADING
// blanks are dropped (see parseDescription).
//
// Markers in typed text are INTERPRETED, not escaped: a line whose text
// happens to be symmetrically wrapped in `**...**` or `_..._` reseeds as
// bold / white ink, asterisks or underscores gone, same as any other line
// that carries that marker. This is not new behaviour — the old plain
// textarea stored those characters and both renderers (PDF/PSD) already
// drew the styled result with no asterisks, silently. This editor just
// makes that same interpretation visible instead of hiding it behind a
// field/render divergence. There is no escape syntax for a literal `**` or
// `_` pair; adding one would change the markdown format both renderers
// parse, which is a bigger, riskier change than this task took on.
import { useEffect, useRef, useState } from "react";
import { Bold, Droplet, Heading as HeaderIcon } from "lucide-react";
import type { Style } from "@/types";
import { markRun, parseDescription, parseRuns, serializeDescription } from "@/description";
import { GOLD } from "@/layout";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** `white` is how the line RENDERS (what the field paints), which is not the
 *  same thing as the `_…_` marker: when the block's base layer is already
 *  white every line renders white without carrying one. linesToMarkdown is
 *  what turns rendering back into markers, and it needs `base` to tell the
 *  two apart — see its comment. */
export interface EditorLine { text: string; bold: boolean; white: boolean; header: boolean }

export function markdownToLines(md: string, base: Style): EditorLine[] {
  const d = parseDescription(md, base);
  const head: EditorLine[] = d.header
    ? [{ text: d.header.text, bold: true, white: d.header.layer === "white", header: true }]
    : [];
  return [
    ...head,
    ...d.lines.map((l) => ({
      text: l.text, bold: !!l.bold, white: l.layer === "white", header: false,
    })),
  ];
}

/** Serializes the field's lines back to the stored markdown subset.
 *
 *  `base` (cfg.descStyle) is required because `_…_` is a PER-LINE OVERRIDE,
 *  never a restatement of the block's base layer. markdownToLines resolves
 *  every plain line's `white` from the base, so writing a marker whenever
 *  `white` is true would bake a base of layer "white" into the text itself:
 *  one keystroke with the Description Layer set to white rewrote every line
 *  as `_line_`, and setting Layer back to metallic no longer undid it — the
 *  art PDF printed the description with no gold ink and the mask put the
 *  whole block on the white plate, recoverable only by hand-editing each
 *  line. So a marker is emitted only where it actually differs from what the
 *  base resolves to. (The format has no "not white" marker, so while the base
 *  IS white an individual line cannot opt out; the toggle's effect on such a
 *  line lasts until the next reseed. That is a limit of the stored format,
 *  which both renderers parse — not something this adapter can fix.)
 *
 *  Extra header lines are DEMOTED to body lines rather than dropped: the
 *  browser's native Enter inside a header clones the div, data-header and
 *  all, and the storage format has exactly one header slot, so filtering
 *  them out would silently delete everything after the split point. */
export function linesToMarkdown(lines: EditorLine[], base: Style): string {
  const header = lines[0]?.header ? lines[0] : null;
  const body = header ? lines.slice(1) : lines;
  const asStyled = (l: EditorLine) => {
    const marked = l.white && base.layer !== "white";
    return {
      text: l.text, bold: l.bold,
      fill: marked ? ("none" as const) : GOLD,
      layer: marked ? ("white" as const) : ("metallic" as const),
    };
  };
  return serializeDescription({
    header: header ? asStyled(header) : null,
    lines: body.map(asStyled),
  });
}

// ---- DOM layer -------------------------------------------------------
// Everything below operates on live nodes rather than React state. That
// split is the whole caret-preservation strategy: a contenteditable bound
// to React state (children re-rendered from `lines` on every keystroke)
// moves the caret to the start on every input, because reconciliation
// fights the browser's own DOM mutations mid-edit. So the consumers' JSX
// never declares this field's line-divs as children — they exist only
// because these functions put them there — and React's re-renders never
// touch them. The DOM is the source of truth while focused; props are the
// source of truth while not.

/** Writes a line's — or an inline run's — appearance. Each consumer supplies
 *  its own: the sidebar paints UI-sized lines (below), the preview's
 *  in-place editor paints label-metric ones that match the hidden canvas
 *  render. Run-spans are painted with their EFFECTIVE flags (the line's
 *  OR'd with the span's own), since a painter may set weight and colour as
 *  inline style, which a nested span would otherwise not inherit. */
export type LinePaint = (
  el: HTMLElement, l: Pick<EditorLine, "bold" | "white" | "header">,
) => void;

/** A line's inline runs (`**bold**` / `_white ink_` mid-line), split by
 *  description.ts's own parseRuns — the same parser both renderers draw with,
 *  so the field shows what the label prints instead of leaving the markers on
 *  screen as literal text.
 *
 *  Parsed against a PLAIN base (not bold, not white) on purpose: each run's
 *  flags then mean "this run carries that MARKER", never "this run renders
 *  that way". The difference is data loss. With the line — or the block's
 *  base layer — already bold or white, an effective flag would equal the
 *  line's, seedDom would emit the run as a bare text node, and the markers
 *  would vanish from the stored text on the very next keystroke: the same
 *  class of erasure linesToMarkdown's `marked` guard exists to prevent, one
 *  level down. The line's own flags are OR'd back in for painting. */
function runsOf(text: string): { text: string; bold: boolean; white: boolean }[] {
  return parseRuns({ fill: GOLD, layer: "metallic", text, bold: false })
    .map((r) => ({ text: r.text, bold: !!r.bold, white: r.layer === "white" }));
}

/** Every class string the sidebar painter can produce, resolved once at load:
 *  the three flags have eight combinations, and cn() (clsx + tailwind-merge)
 *  would otherwise re-parse a class string once per line AND once per inline
 *  run on every reseed and every toggle. */
const LINE_CLASSES: Record<string, string> = {};
for (const header of [false, true]) {
  for (const bold of [false, true]) {
    for (const white of [false, true]) {
      LINE_CLASSES[`${+header}${+bold}${+white}`] = cn(
        "font-heading leading-snug outline-none",
        header ? "text-sm" : "text-xs",
        bold && "font-semibold",
        white && "text-white",
      );
    }
  }
}
const lineClasses = (l: Pick<EditorLine, "bold" | "white" | "header">) =>
  LINE_CLASSES[`${+l.header}${+l.bold}${+l.white}`];

/** The sidebar's painter: class for size/weight/white, and the gold as an
 *  inline color straight from layout.ts's GOLD. Gold can't be a Tailwind
 *  arbitrary value (`text-[…]` is scanned statically, so it could never
 *  reference the constant) — inline style is what keeps the field's gold
 *  and the renderers' gold the same one value. */
const paintSidebarLine: LinePaint = (el, l) => {
  el.className = lineClasses(l);
  el.style.color = l.white ? "" : GOLD;
};

/** Re-encodes one node of a line back into the stored markdown subset: a
 *  text node verbatim, a run-span wrapped in the markers its data-* flags
 *  stand for (white inside, bold outside — serializeDescription's canonical
 *  order). Nested spans recurse, so a bold span inside a white one comes
 *  back as `_**x**_`. An emptied span writes nothing rather than a bare
 *  `****`, which would parse back as a marked empty run. */
function runMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  // markRun owns the marker alphabet, its canonical order and the
  // empty-run rule, so this reader cannot drift from serializeDescription.
  return markRun(Array.from(node.childNodes).map(runMarkdown).join(""), flagsOf(node));
}

/** A line-div's or run-span's data-* flags — everything a LinePaint reads.
 *  Separate from readLineEl, which also re-encodes the line's whole
 *  markdown: repainting wants the three booleans, not a string it discards.
 *  Missing data-* (e.g. a brand-new div the browser inserted for a native
 *  Enter keypress) reads as plain/non-bold/non-white/non-header. */
function flagsOf(el: HTMLElement): Pick<EditorLine, "bold" | "white" | "header"> {
  return {
    bold: el.dataset.bold === "true",
    white: el.dataset.white === "true",
    header: el.dataset.header === "true",
  };
}

/** Reads a line-div's data-* flags and its inline runs back into an
 *  EditorLine. `text` is the line's MARKDOWN (runsOf's inverse): the spans
 *  the field paints become the `**`/`_` pairs the stored format keeps and
 *  both renderers parse. Missing data-* (e.g. a brand-new div the browser
 *  inserted for a native Enter keypress) reads as
 *  plain/non-bold/non-white/non-header.
 *
 *  Exported for tests/description-editor-dom.test.ts only — it and seedDom
 *  are inverses, and that pairing is what the suite pins. No src/ module
 *  imports it. */
export function readLineEl(el: HTMLDivElement): EditorLine {
  return { ...flagsOf(el), text: Array.from(el.childNodes).map(runMarkdown).join("") };
}

/** Strips data-header from every line-div except the first.
 *
 *  Pressing Enter inside the header makes the browser split the block by
 *  CLONING its div — data-header and all — so the field ends up with two
 *  header lines, which the storage format has no room for. Called before
 *  every read, so the extra line becomes an ordinary body line in the DOM at
 *  the same moment linesToMarkdown demotes it in the markdown: the two agree,
 *  the text is kept, and the Header toggle's pressed/disabled state stops
 *  claiming a second header exists. Only attributes and classes are touched,
 *  never text nodes, so the caret does not move. */
function demoteStrayHeaders(kids: HTMLDivElement[], paint: LinePaint) {
  for (const el of kids.slice(1)) {
    if (el.dataset.header !== "true") continue;
    delete el.dataset.header;
    repaintLine(el, paint);
  }
}

/** The field's line-divs, in document order — everything the browser may
 *  have added (a stray <br>, a pasted element) is not one. */
const lineDivs = (root: HTMLDivElement): HTMLDivElement[] =>
  Array.from(root.children).filter((el): el is HTMLDivElement => el.tagName === "DIV");

/** Repaints a line-div AND every run-span under it, each with its effective
 *  flags. One call rather than two because the runs are exactly what a
 *  line-level change breaks: a painter that writes inline style (the
 *  preview's label painter sets fontWeight and colour on every element it
 *  paints) leaves spans deaf to the line's own weight, so bolding a line has
 *  to reach them too. Attributes and styles only — never text nodes, so the
 *  caret does not move. */
function repaintLine(line: HTMLDivElement, paint: LinePaint) {
  const flags = flagsOf(line);
  paint(line, flags);
  const header = flags.header;
  const walk = (node: HTMLElement, bold: boolean, white: boolean) => {
    for (const kid of Array.from(node.children)) {
      if (!(kid instanceof HTMLElement) || kid.tagName !== "SPAN") continue;
      const b = bold || kid.dataset.bold === "true";
      const w = white || kid.dataset.white === "true";
      paint(kid, { bold: b, white: w, header });
      walk(kid, b, w);
    }
  };
  walk(line, flags.bold, flags.white);
}

/** Replaces the field's content with fresh line-divs built from `lines`,
 *  each line's inline runs painted as spans (see runsOf) rather than left
 *  as markers in the text. Only ever called while NOT focused (mount,
 *  external value/base change, the post-blur snap to serializeDescription's
 *  canonical form, or switching back from "Edit as text") — see the hook's
 *  seed effect. That blur-time reseed is also what canonicalizes whatever
 *  span nesting an edit session produced.
 *
 *  Exported for tests/description-editor-dom.test.ts only (see readLineEl). */
export function seedDom(root: HTMLDivElement, lines: EditorLine[], paint: LinePaint) {
  root.replaceChildren();
  // An empty description still needs one focusable/clickable line to type
  // into — parseDescription("", base) legitimately yields zero lines.
  const list = lines.length ? lines : [{ text: "", bold: false, white: false, header: false }];
  for (const line of list) {
    const div = document.createElement("div");
    div.dataset.bold = String(line.bold);
    div.dataset.white = String(line.white);
    if (line.header) div.dataset.header = "true";
    // A completely empty block-level div collapses to zero height in most
    // engines, making it unclickable; <br> keeps it visible and focusable
    // the same way a blank line in a textarea is, without adding a text
    // node that would show up in readLines' text.
    if (!line.text) div.appendChild(document.createElement("br"));
    else for (const r of runsOf(line.text)) {
      // An unmarked run needs no span — a marker-free line stays one text
      // node, exactly as it was before inline runs were painted.
      if (!r.bold && !r.white) {
        div.appendChild(document.createTextNode(r.text));
        continue;
      }
      // data-* records the run's OWN markers — what readLineEl writes back,
      // and what repaintLine turns into effective flags below.
      const span = document.createElement("span");
      if (r.bold) span.dataset.bold = "true";
      if (r.white) span.dataset.white = "true";
      span.textContent = r.text;
      div.appendChild(span);
    }
    // The line and its runs are painted by the same walk a toggle repaints
    // through, so the "a run inherits the line's flags" rule has one
    // spelling rather than two that can drift.
    repaintLine(div, paint);
    root.appendChild(div);
  }
}

/** Reads the field's current line-divs back into EditorLine[] — the other
 *  half of the caret-preservation split: while focused, this (not props)
 *  is where onChange's data comes from. Missing data-* (e.g. a brand new
 *  div the browser inserted for a native Enter keypress, which carries no
 *  attributes of ours) reads as a plain, non-bold, non-white, non-header
 *  line — the Bold/White toggles remain available to restyle it. */
function readLines(root: HTMLDivElement, kids: HTMLDivElement[]): EditorLine[] {
  if (kids.length === 0) {
    // Fully cleared (select-all + delete): some engines leave a bare <br>
    // or nothing at all rather than a div. Either way, one empty line.
    return [{ text: root.textContent ?? "", bold: false, white: false, header: false }];
  }
  return kids.map(readLineEl);
}

/** Walks up from a selection endpoint to the line-div that is a direct
 *  child of `root` and contains it. Null if `node` isn't inside root at
 *  all (e.g. the browser's selection currently lives in a different
 *  field). */
function closestLineEl(node: Node | null, root: HTMLElement): HTMLDivElement | null {
  let n = node;
  while (n) {
    if (n.parentNode === root) return n as HTMLDivElement;
    n = n.parentNode;
  }
  return null;
}

/** Every line-div the current selection touches, in document order — one
 *  for a collapsed caret, several for a multi-line selection. Empty when
 *  there's no selection, or it isn't inside `root`. */
function linesInSelection(root: HTMLDivElement): HTMLDivElement[] {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return [];
  const a = closestLineEl(sel.anchorNode, root);
  const f = closestLineEl(sel.focusNode, root);
  if (!a || !f) return [];
  const kids = lineDivs(root);
  const ia = kids.indexOf(a);
  const ib = kids.indexOf(f);
  if (ia === -1 || ib === -1) return [];
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  const lines = kids.slice(lo, hi + 1);
  // A line the selection merely GRAZES at offset 0 is excluded: triple-click
  // and shift-↓ both park the range's end at the very start of the following
  // line, and counting it made Bold/White ink restyle a line the user never
  // meant to select.
  if (lines.length > 1 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const last = closestLineEl(range.endContainer, root);
    if (last === lines[lines.length - 1] && range.endOffset === 0) lines.pop();
  }
  return lines;
}

/** The innermost run-span carrying `attr` that encloses the current
 *  selection, or null. Line-divs are excluded (a direct child of `root` is
 *  a line, and its flags are line-level state the callers read straight off
 *  the dataset), so this reports inline runs only. */
function runSpanAt(root: HTMLDivElement, attr: "bold" | "white"): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let n: Node | null = sel.getRangeAt(0).commonAncestorContainer;
  while (n && n !== root) {
    if (n instanceof HTMLElement && n.parentNode !== root && n.dataset[attr] === "true") return n;
    n = n.parentNode;
  }
  return null;
}

/** Bold/white/header pressed-state (for the toolbar buttons) derived from
 *  the line-divs the current selection touches. Callers must only invoke
 *  this with a non-empty `lines` (mirrors linesInSelection's own "bail if
 *  empty" contract at each call site) so the `.every()` calls below can't
 *  vacuously read `true` off zero lines.
 *
 *  `header` needs its own eligibility flag rather than just "is this line
 *  a header": description.ts's storage format has exactly one header slot
 *  and always treats the first line as it (see that file's parseDescription/
 *  serializeDescription) — so the toggle can only ever act on line index 0.
 *  `headerEnabled` is true only when every touched line *is* that first
 *  line-div, which the toolbar uses to disable the button everywhere else
 *  instead of offering a "promote this line to header" action that would
 *  silently reorder content on the next serialize. */
function computeCaret(root: HTMLDivElement, lines: HTMLDivElement[]) {
  const first = root.children[0] as HTMLDivElement | undefined;
  const headerEnabled = first != null && lines.every((l) => l === first);
  return {
    bold: lines.every((l) => l.dataset.bold === "true") || runSpanAt(root, "bold") != null,
    white: lines.every((l) => l.dataset.white === "true") || runSpanAt(root, "white") != null,
    header: headerEnabled && first?.dataset.header === "true",
    headerEnabled,
  };
}

/** Manual Range-based plain-text insert, used only if execCommand is ever
 *  unavailable. Doesn't split embedded newlines into separate line-divs
 *  (execCommand does, matching what pressing Enter would have done) — an
 *  acceptable narrower fallback for browsers modern enough to run this app
 *  but hypothetically missing execCommand. */
function insertTextAtCaretFallback(text: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ---- Hook ------------------------------------------------------------

/** The rich description field's engine, shared by the sidebar editor and
 *  the preview's in-place session. Owns seeding, selection tracking, the
 *  Bold/White/Header actions, and change emission; the consumer renders
 *  the contenteditable div itself (spreading `fieldProps` onto it) plus
 *  whatever toolbar chrome fits its surface.
 *
 *  `active` gates seeding for consumers that unmount the field while
 *  keeping the hook mounted (the sidebar's "Edit as Markdown" mode): a
 *  remount alone re-runs no effect, so the flag is what re-seeds the
 *  fresh div when the rich field returns. */
export function useDescriptionField(opts: {
  value: string;
  base: Style;
  onChange: (markdown: string) => void;
  paint?: LinePaint;
  active?: boolean;
}) {
  const { value, base, onChange, paint = paintSidebarLine, active = true } = opts;
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // Whether every line the caret/selection currently touches is bold/white/
  // header (plus whether Header is even eligible right now) — drives the
  // toolbar buttons' pressed/disabled state. Purely a display cache:
  // re-derived from the DOM (via computeCaret) on every selectionchange and
  // after every toggle, never treated as the source of truth for an edit.
  const [caret, setCaret] = useState({ bold: false, white: false, header: false, headerEnabled: false });

  // `base.layer` rather than `base`: it is the only field seeding reads (it
  // decides whether a plain line resolves white — see markdownToLines), and
  // the object itself is rebuilt on every keystroke by App's config clone,
  // which would re-run this effect for edits it has nothing to do with.
  // `paint` is stable at both call sites (a module constant in the sidebar,
  // a useMemo in the preview), so it can sit in the deps honestly.
  useEffect(() => {
    if (focused || !active) return;
    const root = rootRef.current;
    if (!root) return;
    seedDom(root, markdownToLines(value, base), paint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, base.layer, paint, focused, active]);

  // Selection tracking is scoped to while the field is focused, via a
  // document-level listener (not onKeyUp/onMouseUp on the div) so it also
  // catches arrow-key and Home/End/Select-All selection changes.
  useEffect(() => {
    if (!focused) return;
    const onSelectionChange = () => {
      const root = rootRef.current;
      if (!root) return;
      const lines = linesInSelection(root);
      if (!lines.length) return;
      // Same four booleans → same object, so a caret move that changes
      // nothing doesn't re-render the consumer (in the preview that is the
      // whole in-place field plus the portaled toolbar pill) on every
      // keystroke and every arrow key.
      const next = computeCaret(root, lines);
      setCaret((prev) => (
        prev.bold === next.bold && prev.white === next.white
        && prev.header === next.header && prev.headerEnabled === next.headerEnabled
          ? prev : next
      ));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [focused]);

  const emitChange = () => {
    const root = rootRef.current;
    if (!root) return;
    // One scan of the field's children for both passes — this runs on every
    // keystroke, and each pass used to build the same array itself.
    const kids = lineDivs(root);
    demoteStrayHeaders(kids, paint);
    onChange(linesToMarkdown(readLines(root, kids), base));
  };

  /** Bold / White ink over a PART of a line: wraps the selection in a
   *  run-span (or unwraps the one it fills), which readLineEl re-encodes as
   *  the `**`/`_` pair the stored format keeps. The markers never appear on
   *  screen — the span is painted, the way both renderers draw the run (see
   *  parseRuns). Returns false when the selection is not a partial one, so
   *  the caller falls through to the line-level toggle.
   *
   *  A bare caret counts as selecting the run it sits in, so the toggle can
   *  turn that run off — computeCaret reads it as pressed there, and a
   *  pressed toggle that instead emphasised the whole LINE would be lying.
   *
   *  Two things the stored format simply cannot express, both no-ops here
   *  rather than edits that would look applied and vanish on the next
   *  reseed: un-emphasising PART of an already-bold (or white) run or line,
   *  since the subset has no negative marker; and nesting a marker inside
   *  the same marker, which parses as a close followed by a re-open. */
  const wrapSelection = (attr: "bold" | "white") => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return false;
    const selected = sel.toString();
    if (selected.includes("\n")) return false;
    const lines = linesInSelection(root);
    if (lines.length !== 1) return false;
    const line = lines[0];
    const owner = runSpanAt(root, attr);
    // Nothing selected (a collapsed caret stringifies empty), or the whole
    // line is: the caret's target is the line, so fall through to the line
    // flag. Inside a run it is that run — computeCaret shows the toggle
    // PRESSED there, and a pressed toggle must turn the run off rather than
    // bold the line it sits in.
    if (!owner && (!selected || selected === line.textContent)) return false;
    if (owner) {
      // Only a selection filling the span exactly — or a bare caret inside
      // it — can turn it off; the format has no marker for "less emphasis
      // over part of a run".
      if (selected && selected !== owner.textContent) return true;
      delete owner.dataset[attr];
      // A span with no flags left is not a run any more — unwrap it so the
      // text rejoins the line rather than accumulating empty wrappers.
      if (owner.dataset.bold !== "true" && owner.dataset.white !== "true")
        owner.replaceWith(...Array.from(owner.childNodes));
    } else if (line.dataset[attr] === "true") {
      return true; // the whole line already carries it
    } else {
      const span = document.createElement("span");
      span.dataset[attr] = "true";
      // extractContents + insertNode rather than surroundContents: the
      // latter throws on a range that starts inside one span and ends in
      // another, which is exactly what selecting across an existing run
      // does. Any span the range only partly covers is split and re-nested
      // inside this one — markers nest in either order, and the blur reseed
      // flattens it back to canonical form.
      const range = sel.getRangeAt(0);
      span.appendChild(range.extractContents());
      range.insertNode(span);
      // Keep the run selected, so the toggle reads as pressed and a second
      // press undoes it.
      const after = document.createRange();
      after.selectNodeContents(span);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    repaintLine(line, paint);
    emitChange();
    setCaret(computeCaret(root, lines));
    return true;
  };

  const toggle = (attr: "bold" | "white") => {
    const root = rootRef.current;
    if (!root) return;
    if (wrapSelection(attr)) return;
    const lines = linesInSelection(root);
    if (!lines.length) return;
    for (const el of lines) {
      el.dataset[attr] = String(el.dataset[attr] !== "true");
      repaintLine(el, paint);
    }
    setCaret(computeCaret(root, lines));
    emitChange();
  };

  /** Toggles whether the FIRST line-div is the header. Guarded by the same
   *  "every touched line is line 0" check computeCaret uses for
   *  `headerEnabled` — the toolbar button is already disabled outside that
   *  case, but this re-checks against the live DOM rather than trusting
   *  possibly-stale React state, matching `toggle`'s own bail-out-on-empty-
   *  selection guard above. Only ever writes `data-header` on that one div,
   *  so at most one line can carry it — the invariant serializeDescription/
   *  parseDescription both assume (see description.ts). */
  const toggleHeader = () => {
    const root = rootRef.current;
    if (!root) return;
    const lines = linesInSelection(root);
    if (!lines.length) return;
    const c = computeCaret(root, lines);
    if (!c.headerEnabled) return;
    const first = root.children[0] as HTMLDivElement;
    const nowHeader = !c.header;
    if (nowHeader) first.dataset.header = "true";
    else delete first.dataset.header;
    repaintLine(first, paint);
    setCaret(computeCaret(root, lines));
    emitChange();
  };

  /** Everything the contenteditable div itself needs — spread onto it. The
   *  consumer adds its own className/aria-label/positioning. */
  const fieldProps = {
    ref: rootRef,
    contentEditable: true,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-multiline": true,
    onInput: emitChange,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onPaste: (e: React.ClipboardEvent) => {
      // Coerce to plain text so pasting, e.g., a hop list copied off
      // a web page can't drag in that page's markup (which could
      // otherwise be misread as our own bold/white-ink syntax).
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      // execCommand is deprecated but still broadly supported, and
      // it's the browser's own well-tested caret/undo-aware insert —
      // including splitting embedded newlines into new line-divs the
      // same way a native Enter keypress would. Reimplementing that
      // split by hand would be exactly the kind of manual caret
      // surgery this file otherwise avoids.
      if (typeof document.execCommand === "function") {
        document.execCommand("insertText", false, text);
      } else {
        insertTextAtCaretFallback(text);
      }
      emitChange();
    },
  } as const;

  return { rootRef, focused, setFocused, caret, toggle, toggleHeader, fieldProps };
}

// ---- Toolbar ---------------------------------------------------------

/** The Header / Bold / White-ink toggles, shared verbatim by the sidebar's
 *  toolbar row and the preview's floating pill so the two surfaces can't
 *  drift. Layout chrome (row vs pill) belongs to the caller. */
export function DescriptionToolbarButtons(props: {
  caret: ReturnType<typeof useDescriptionField>["caret"];
  toggle: (attr: "bold" | "white") => void;
  toggleHeader: () => void;
  /** Hidden on a one-line field (the preview's Info row): the format has a
   *  single header slot and it belongs to the description block. */
  showHeader?: boolean;
}) {
  const { caret, toggle, toggleHeader, showHeader = true } = props;
  return (
    <>
      {/* Header is wrapped in an extra <span> (rather than putting
          TooltipTrigger's render prop directly on the button) so the
          tooltip still opens on hover while the button is disabled:
          toggleVariants applies disabled:pointer-events-none to the
          <button> itself, which would otherwise swallow the hover
          that triggers the tooltip. The span isn't disabled, so it
          still receives the pointer events the button now ignores. */}
      {showHeader && (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex">
              {/* Standalone Toggles, not ToggleGroupItems: the group
                  items' styles assume adjacent siblings inside a
                  ToggleGroup (collapsed rounding/margins) and
                  overlapped when rendered bare. */}
              <Toggle
                aria-label="Toggle header"
                size="sm"
                pressed={caret.header}
                disabled={!caret.headerEnabled}
                // Same focus-preservation trick as Bold/White ink
                // below — see that comment for why this matters.
                onMouseDown={(e) => e.preventDefault()}
                onPressedChange={toggleHeader}
              >
                <HeaderIcon />
              </Toggle>
            </span>
          }
        />
        <TooltipContent>
          {caret.headerEnabled ? "Header" : "Header must be the first line"}
        </TooltipContent>
      </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label="Toggle bold"
              size="sm"
              pressed={caret.bold}
              // Keeps focus (and the selection) in the
              // contenteditable field instead of moving it to the
              // button, so the toggle still knows which line(s) to
              // flip.
              onMouseDown={(e) => e.preventDefault()}
              onPressedChange={() => toggle("bold")}
            >
              <Bold />
            </Toggle>
          }
        />
        <TooltipContent>Bold</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label="Toggle white ink underlay"
              size="sm"
              pressed={caret.white}
              onMouseDown={(e) => e.preventDefault()}
              onPressedChange={() => toggle("white")}
            >
              <Droplet />
            </Toggle>
          }
        />
        {/* White ink is a print layer (a separate underlay plate),
            not a text colour, hence the explicit label — Droplet
            alone reads ambiguously next to a colour swatch. */}
        <TooltipContent>White ink underlay</TooltipContent>
      </Tooltip>
    </>
  );
}

// ---- Sidebar editor --------------------------------------------------

export function DescriptionEditor(props: {
  value: string;
  base: Style;
  onChange: (markdown: string) => void;
  /** The field's accessible name — it is not always the description (the
   *  Info row authors in the same subset through the same editor). */
  label?: string;
  /** Several drawn lines, straight off the element's spec
   *  (editableText[id].multiline) so both of an element's fields agree. A
   *  one-line element (the Info row) gets no Header toggle: the format's
   *  single header slot belongs to the description block, and a `# ` there
   *  would only collapse back to bold (see parseInfoLine). */
  multiline?: boolean;
}) {
  const { value, base, onChange, label = "Description", multiline } = props;
  const [asText, setAsText] = useState(false);
  const { focused, setFocused, caret, toggle, toggleHeader, fieldProps } =
    useDescriptionField({ value, base, onChange, active: !asText });

  return (
    <div className="space-y-1">
      {/* h-7, matching the size-sm toggles inside: a shorter row let them
          overflow onto the field's outline below. */}
      <div className="flex h-7 items-center justify-between gap-1">
        <div className="flex gap-1">
          {focused && !asText && (
            <DescriptionToolbarButtons
              caret={caret} toggle={toggle} toggleHeader={toggleHeader} showHeader={!!multiline}
            />
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          // Escape hatch, and the fallback if the rich field ever proves
          // troublesome: forcing focused false here (rather than relying on
          // the field's own onBlur) keeps the seed effect's guard correct
          // regardless of mousedown/blur/click ordering across browsers.
          onClick={() => { setFocused(false); setAsText((v) => !v); }}
        >
          {asText ? "Edit as WYSIWYG" : "Edit as Markdown"}
        </Button>
      </div>

      {asText ? (
        <>
          <Textarea
            rows={multiline ? 7 : 2}
            aria-label={label}
            className="font-mono text-xs"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {/* The subset, spelled out — this mode exists precisely because
              the syntax isn't muscle memory (see the header comment). */}
          <ul className="space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {multiline && <li><code className="font-mono"># </code>header (first line only)</li>}
            <li><code className="font-mono">**bold**</code></li>
            <li><code className="font-mono">_white ink_</code></li>
            <li>markers also work mid-line</li>
          </ul>
        </>
      ) : (
        <div
          {...fieldProps}
          aria-label={label}
          className={cn(
            "min-h-[8.5rem] w-full space-y-0.5 rounded-lg border border-input bg-transparent px-2.5 py-2",
            "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
        />
      )}
    </div>
  );
}
