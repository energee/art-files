// TextEditor.tsx — the WYSIWYG field for a text layer's `lines` (spec:
// docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "Text").
// Every text layer — the beer name, the description block, the rotated
// Info row — is a TextLine[] (model/layers.ts: a StyledLine plus a per-line
// `header` flag), and this is the one editor for all of them. Lines in,
// lines out: no markdown at the boundary. The only markdown left is INSIDE
// a line's text, where `**bold**` / `_white ink_` mark an inline run the
// way both renderers' parseRuns reads it; the field paints those runs as
// spans (runsOf / readLineEl are inverses) rather than showing the markers.
//
// Supersedes DescriptionEditor.tsx (markdown string in and out, one header
// slot, an "Edit as Markdown" escape hatch); that file is deleted once its
// two consumers move over. Consumers share the machinery through
// useTextField: the sidebar's TextEditor below (label, inline toolbar row,
// the field — or a plain number / code box when the layer's `input` says
// so), and PreviewCompare's in-place session (the same contenteditable
// positioned over the drawn layer at label metrics, with TextToolbarButtons
// floating above it as a pill). The hook owns the DOM/caret strategy; each
// consumer owns its own chrome and paint.
//
// Markers in typed text are INTERPRETED, not escaped: a `**...**` or `_..._`
// pair typed into a line reseeds as a painted run, markers gone, exactly as
// the renderers would draw it. There is no escape for a literal pair; adding
// one would change the run grammar both renderers parse.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaseUpper, Bold, Droplet, Heading as HeaderIcon } from "lucide-react";
import type { Style } from "@/types";
import type { Choice, Symbology, TextLine } from "@/model/layers";
import { validateField } from "@/model/fields";
import { markRun, parseRuns, printableText } from "@/description";
import { GOLD } from "@/layout";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The field's per-line shape: the three toolbar flags plus the line's text
 *  with its inline run markers left in. `white` is the line's white-ink
 *  LAYER (TextLine.layer === "white"); bold and header are the line-level
 *  flags. Run-level bold/white live in `text` as markers. */
export interface EditorLine { text: string; bold: boolean; white: boolean; header: boolean }

const EMPTY_LINE: EditorLine = { text: "", bold: false, white: false, header: false };

export function toEditorLines(lines: TextLine[]): EditorLine[] {
  return lines.map((l) => ({
    text: l.text, bold: !!l.bold, white: l.layer === "white", header: !!l.header,
  }));
}

/** The inverse: every line takes the block's `base` style (fill, stroke,
 *  tracking — what a new line typed into the field should look like), then
 *  its own flags. `layer` is written explicitly per line: the White-ink
 *  toggle IS the per-line layer control, so off means the metallic plate
 *  even under a white base — the old markdown format had no "not white"
 *  marker, but a line object does. `bold`/`header` are present only when
 *  set, matching how model/lolevLayers.ts authors lines.
 *
 *  `base` must be the layer's block Style, not a StyledLine: its keys are
 *  spread onto every line, so a `text`/`bold` on it would leak through. */
export function fromEditorLines(lines: EditorLine[], base: Style): TextLine[] {
  const list = lines.length ? lines : [EMPTY_LINE];
  return list.map((e) => {
    const out: TextLine = { ...base, text: e.text, layer: e.white ? "white" : "metallic" };
    if (e.bold) out.bold = true;
    if (e.header) out.header = true;
    return out;
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

type Flag = "bold" | "white" | "header";
type RunFlag = "bold" | "white";

/** A line's inline runs, split by description.ts's own parseRuns — the same
 *  parser both renderers draw with. Parsed against a PLAIN base on purpose:
 *  each run's flags then mean "this run carries that MARKER", never "this
 *  run renders that way". With the line already bold or white, an effective
 *  flag would equal the line's, seedDom would emit the run as bare text, and
 *  the markers would vanish from the stored text on the next keystroke. The
 *  line's own flags are OR'd back in for painting (repaintLine). */
function runsOf(text: string): { text: string; bold: boolean; white: boolean }[] {
  return parseRuns({ fill: GOLD, layer: "metallic", text, bold: false })
    .map((r) => ({ text: r.text, bold: !!r.bold, white: r.layer === "white" }));
}

/** The sidebar's painter: a class, nothing else. Weight and the white-ink
 *  marker only — the field keeps the form's own foreground color, because a
 *  layer's artwork fill (gold on dark, white on white) is what made this
 *  input hard to read. The preview, not the input, is where color belongs. */
const paintSidebarLine: LinePaint = (el, l) => {
  el.className = cn(
    "font-heading leading-snug outline-none",
    l.header ? "text-sm" : "text-xs",
    l.bold && "font-semibold",
    // White ink uses an underline so it stays legible on the form background.
    l.white && "underline decoration-dotted decoration-2 underline-offset-2",
  );
};

/** A line-div's or run-span's data-* flags. Missing data-* (a brand-new div
 *  the browser inserted for a native Enter) reads as plain. */
function flagsOf(el: HTMLElement): Pick<EditorLine, Flag> {
  return {
    bold: el.dataset.bold === "true",
    white: el.dataset.white === "true",
    header: el.dataset.header === "true",
  };
}

/** Re-encodes one node of a line back into run markers: a text node
 *  verbatim, a run-span wrapped in the markers its data-* flags stand for
 *  (markRun owns the alphabet, the canonical white-inside/bold-outside
 *  order, and the empty-run rule). Nested spans recurse. */
function runMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  return markRun(Array.from(node.childNodes).map(runMarkdown).join(""), flagsOf(node));
}

/** Reads a line-div's flags and its inline runs back into an EditorLine —
 *  seedDom's inverse. */
function readLineEl(el: HTMLDivElement): EditorLine {
  return { ...flagsOf(el), text: Array.from(el.childNodes).map(runMarkdown).join("") };
}

/** The field's line-divs, in document order — anything else the browser may
 *  have added (a stray <br>, a pasted element) is not one. */
const lineDivs = (root: HTMLDivElement): HTMLDivElement[] =>
  Array.from(root.children).filter((el): el is HTMLDivElement => el.tagName === "DIV");

/** Repaints a line-div AND every run-span under it, each with its effective
 *  flags — a painter that writes inline style leaves spans deaf to the
 *  line's own weight, so a line-level change has to reach them too.
 *  Attributes and styles only, never text nodes, so the caret stays put. */
function repaintLine(line: HTMLDivElement, paint: LinePaint) {
  const flags = flagsOf(line);
  paint(line, flags);
  const walk = (node: HTMLElement, bold: boolean, white: boolean) => {
    for (const kid of Array.from(node.children)) {
      if (!(kid instanceof HTMLElement) || kid.tagName !== "SPAN") continue;
      const b = bold || kid.dataset.bold === "true";
      const w = white || kid.dataset.white === "true";
      paint(kid, { bold: b, white: w, header: flags.header });
      walk(kid, b, w);
    }
  };
  walk(line, flags.bold, flags.white);
}

/** Replaces the field's content with fresh line-divs built from `lines`,
 *  runs painted as spans. Only ever called while NOT focused (mount, an
 *  external change, the post-blur snap) — see the hook's seed effect. That
 *  blur-time reseed is what canonicalizes whatever span nesting an edit
 *  session produced. */
function seedDom(root: HTMLDivElement, lines: EditorLine[], paint: LinePaint) {
  root.replaceChildren();
  // An empty layer still needs one focusable line to type into.
  for (const line of lines.length ? lines : [EMPTY_LINE]) {
    const div = document.createElement("div");
    div.dataset.bold = String(line.bold);
    div.dataset.white = String(line.white);
    if (line.header) div.dataset.header = "true";
    // An empty block-level div collapses to zero height; <br> keeps it
    // visible and focusable like a blank textarea line, without a text
    // node that would show up in the read-back.
    if (!line.text) div.appendChild(document.createElement("br"));
    else for (const r of runsOf(line.text)) {
      if (!r.bold && !r.white) {
        div.appendChild(document.createTextNode(r.text));
        continue;
      }
      // data-* records the run's OWN markers — what readLineEl writes back.
      const span = document.createElement("span");
      if (r.bold) span.dataset.bold = "true";
      if (r.white) span.dataset.white = "true";
      span.textContent = r.text;
      div.appendChild(span);
    }
    repaintLine(div, paint);
    root.appendChild(div);
  }
}

/** Reads the field's line-divs back — while focused this, not props, is
 *  where onChange's data comes from. */
function readLines(root: HTMLDivElement): EditorLine[] {
  const kids = lineDivs(root);
  // Fully cleared (select-all + delete): some engines leave a bare <br> or
  // nothing at all rather than a div. Either way, one line.
  if (kids.length === 0) return [{ ...EMPTY_LINE, text: root.textContent ?? "" }];
  return kids.map(readLineEl);
}

/** Walks up from a selection endpoint to the line-div that is a direct
 *  child of `root`; null if `node` isn't inside root at all. */
function closestLineEl(node: Node | null, root: HTMLElement): HTMLDivElement | null {
  let n = node;
  while (n) {
    if (n.parentNode === root) return n as HTMLDivElement;
    n = n.parentNode;
  }
  return null;
}

/** Every line-div the current selection touches, in document order. Empty
 *  when there's no selection, or it isn't inside `root`. */
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
  // and shift-down both park the range's end at the very start of the next
  // line, and counting it restyled a line the user never meant to select.
  if (lines.length > 1 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const last = closestLineEl(range.endContainer, root);
    if (last === lines[lines.length - 1] && range.endOffset === 0) lines.pop();
  }
  return lines;
}

/** The innermost run-span carrying `attr` that encloses the selection, or
 *  null. Line-divs are excluded — their flags are line-level state. */
function runSpanAt(root: HTMLDivElement, attr: RunFlag): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let n: Node | null = sel.getRangeAt(0).commonAncestorContainer;
  while (n && n !== root) {
    if (n instanceof HTMLElement && n.parentNode !== root && n.dataset[attr] === "true") return n;
    n = n.parentNode;
  }
  return null;
}

/** Pressed state for the toolbar, from the line-divs the selection touches
 *  (never empty — callers bail first) plus the run the caret sits in. */
function computeCaret(root: HTMLDivElement, lines: HTMLDivElement[]) {
  return {
    bold: lines.every((l) => l.dataset.bold === "true") || runSpanAt(root, "bold") != null,
    white: lines.every((l) => l.dataset.white === "true") || runSpanAt(root, "white") != null,
    header: lines.every((l) => l.dataset.header === "true"),
  };
}

/** Manual Range-based plain-text insert, used only if execCommand is ever
 *  unavailable. Doesn't split embedded newlines into separate line-divs
 *  (execCommand does, matching a native Enter). */
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

const UPPERCASE: React.CSSProperties = { textTransform: "uppercase" };

// ---- Hook ------------------------------------------------------------

/** The rich text field's engine, shared by the sidebar editor and the
 *  preview's in-place session. Owns seeding, selection tracking, the
 *  Bold/White/Header actions, and change emission; the consumer renders
 *  the contenteditable div itself (spreading `fieldProps` onto it) plus
 *  whatever toolbar chrome fits its surface.
 *
 *  `multiline: false` (the beer name, the Info row) swallows Enter,
 *  flattens pasted newlines to spaces, and emits one line whatever the DOM
 *  holds. `uppercase` is a display transform on the field (the beer name
 *  renders uppercase): the stored text keeps its typed case, like the
 *  renderer applying the transform at draw time. */
export function useTextField(opts: {
  lines: TextLine[];
  onChange: (lines: TextLine[]) => void;
  /** The layer's block Style — see fromEditorLines. */
  base: Style;
  multiline: boolean;
  uppercase?: boolean;
  paint?: LinePaint;
}) {
  const { lines, onChange, base, multiline, uppercase = false, paint = paintSidebarLine } = opts;
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // Whether every line the caret/selection touches is bold/white/header —
  // drives the toolbar's pressed state. A display cache re-derived from the
  // DOM on every selectionchange and after every toggle, never the source
  // of truth for an edit.
  const [caret, setCaret] = useState({ bold: false, white: false, header: false });

  // Seeding reads `lines` only; `base` is consulted at emit time, so a style
  // change while unfocused reseeds nothing and a keystroke's config clone
  // never reseeds a focused field.
  useEffect(() => {
    if (focused) return;
    const root = rootRef.current;
    if (!root) return;
    seedDom(root, toEditorLines(lines), paint);
  }, [lines, paint, focused]);

  // Selection tracking is scoped to while the field is focused, via a
  // document-level listener so it also catches arrow-key and Home/End/
  // Select-All selection changes.
  useEffect(() => {
    if (!focused) return;
    const onSelectionChange = () => {
      const root = rootRef.current;
      if (!root) return;
      const sel = linesInSelection(root);
      if (!sel.length) return;
      // Same booleans → same object, so a caret move that changes nothing
      // doesn't re-render the consumer on every keystroke.
      const next = computeCaret(root, sel);
      setCaret((prev) => (
        prev.bold === next.bold && prev.white === next.white && prev.header === next.header
          ? prev : next
      ));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [focused]);

  const emitChange = () => {
    const root = rootRef.current;
    if (!root) return;
    const read = readLines(root);
    // A single-line layer is one line by contract: Enter is swallowed and
    // pasted newlines flattened, so a second div only ever arrives through
    // something like a multi-line drag-drop, and dropping it here is what
    // keeps the layer's value honest.
    onChange(fromEditorLines(multiline ? read : read.slice(0, 1), base));
  };

  /** Bold / White ink over a PART of a line: wraps the selection in a
   *  run-span (or unwraps the one it fills), which readLineEl re-encodes as
   *  the marker pair the line's text keeps. Returns false when the selection
   *  is not a partial one, so the caller falls through to the line flag.
   *
   *  A bare caret counts as selecting the run it sits in, so the toggle can
   *  turn that run off — computeCaret reads it as pressed there.
   *
   *  Two things the run grammar cannot express, both no-ops here rather
   *  than edits that would vanish on the next reseed: un-emphasising PART
   *  of an already-bold (or white) run or line, since there is no negative
   *  marker; and nesting a marker inside the same marker. */
  const wrapSelection = (attr: RunFlag) => {
    const root = rootRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return false;
    const selected = sel.getRangeAt(0).toString();
    if (selected.includes("\n")) return false;
    const sels = linesInSelection(root);
    if (sels.length !== 1) return false;
    const line = sels[0];
    const owner = runSpanAt(root, attr);
    // Nothing selected, or the whole line: the target is the line itself.
    if (!owner && (!selected || selected === line.textContent)) return false;
    if (owner) {
      // Only a selection filling the span exactly — or a bare caret inside
      // it — can turn it off.
      if (selected && selected !== owner.textContent) return true;
      delete owner.dataset[attr];
      // A span with no flags left is not a run any more — unwrap it.
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
      // does. A partly-covered span is split and re-nested; the blur reseed
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
    setCaret(computeCaret(root, sels));
    return true;
  };

  /** Flips a flag on every line the selection touches — after giving a
   *  partial selection the run treatment for bold/white. `header` is a
   *  per-line flag like the other two (TextLayer.headerScale sets every
   *  header line), so it takes the same path. */
  const toggle = (attr: Flag) => {
    const root = rootRef.current;
    if (!root) return;
    if (attr !== "header" && wrapSelection(attr)) return;
    const sels = linesInSelection(root);
    if (!sels.length) return;
    for (const el of sels) {
      el.dataset[attr] = String(el.dataset[attr] !== "true");
      repaintLine(el, paint);
    }
    setCaret(computeCaret(root, sels));
    emitChange();
  };
  const toggleHeader = () => toggle("header");

  /** Everything the contenteditable div itself needs — spread onto it. The
   *  consumer adds its own className/aria-label/positioning. */
  const fieldProps = {
    ref: rootRef,
    contentEditable: true,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-multiline": multiline,
    style: uppercase ? UPPERCASE : undefined,
    onInput: emitChange,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!multiline && e.key === "Enter") e.preventDefault();
    },
    onPaste: (e: React.ClipboardEvent) => {
      // Coerce to plain text so pasting off a web page can't drag in that
      // page's markup (which could be misread as our own run markers).
      e.preventDefault();
      // A tab or other control character would be stored verbatim and print
      // differently from the preview (#282): clean each line, keep the breaks.
      const lines = e.clipboardData.getData("text/plain").split(/\r\n?|\n/).map(printableText);
      const text = lines.join(multiline ? "\n" : " ");
      // execCommand is deprecated but still broadly supported, and it's the
      // browser's own caret/undo-aware insert — including splitting embedded
      // newlines into new line-divs the way a native Enter would.
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

function ToolbarToggle(props: {
  label: string; tip: string; pressed: boolean; onPress: () => void; children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // Standalone Toggles, not ToggleGroupItems: the group items'
          // styles assume adjacent siblings inside a ToggleGroup.
          <Toggle
            aria-label={props.label}
            size="sm"
            pressed={props.pressed}
            // Keeps focus (and the selection) in the contenteditable field
            // instead of moving it to the button, so the toggle still knows
            // which line(s) to flip.
            onMouseDown={(e) => e.preventDefault()}
            onPressedChange={props.onPress}
          >
            {props.children}
          </Toggle>
        }
      />
      <TooltipContent>{props.tip}</TooltipContent>
    </Tooltip>
  );
}

/** The Header / Bold / White-ink toggles, shared verbatim by the sidebar's
 *  toolbar row and the preview's floating pill so the two surfaces can't
 *  drift. Layout chrome (row vs pill) belongs to the caller. */
export function TextToolbarButtons(props: {
  caret: ReturnType<typeof useTextField>["caret"];
  toggle: (attr: "bold" | "white") => void;
  toggleHeader: () => void;
  /** Hidden on a single-line layer: one drawn line has nowhere for a header
   *  to render differently. */
  showHeader?: boolean;
  /** The run toggles (header, bold, white ink) act on the field's SELECTION,
   *  so they are inert with nothing focused. The sidebar shows them while
   *  focus is in the field or has moved from it to the toolbar, keeps
   *  the row mounted for the layer-wide Uppercase switch, and passes false
   *  otherwise rather than offering three buttons that silently do nothing. */
  showRuns?: boolean;
  uppercase?: boolean;
  onUppercase?: (uppercase: boolean) => void;
}) {
  const { caret, toggle, toggleHeader, showHeader = true, showRuns = true } = props;
  return (
    <>
      {showRuns && showHeader && (
        <ToolbarToggle label="Toggle header" tip="Header" pressed={caret.header} onPress={toggleHeader}>
          <HeaderIcon />
        </ToolbarToggle>
      )}
      {showRuns && (
        <ToolbarToggle label="Toggle bold" tip="Bold" pressed={caret.bold} onPress={() => toggle("bold")}>
          <Bold />
        </ToolbarToggle>
      )}
      {props.onUppercase && (
        <ToolbarToggle label="Toggle uppercase" tip="Uppercase entire text layer"
          pressed={props.uppercase ?? false} onPress={() => props.onUppercase!(!props.uppercase)}>
          <CaseUpper />
        </ToolbarToggle>
      )}
      {/* White ink is a print layer (a separate underlay plate), not a text
          colour, hence the explicit label — Droplet alone reads ambiguously
          next to a colour swatch. */}
      {showRuns && (
      <ToolbarToggle
        label="Toggle white ink underlay" tip="White ink underlay"
        pressed={caret.white} onPress={() => toggle("white")}
      >
        <Droplet />
      </ToolbarToggle>
      )}
    </>
  );
}

// ---- Sidebar editor --------------------------------------------------

export interface TextEditorProps {
  /** DOM id of the widget (the contenteditable or the input) — the label's
   *  htmlFor and what tests query. */
  id: string;
  label: string;
  lines: TextLine[];
  onChange: (lines: TextLine[]) => void;
  /** The layer's block Style — what a new line takes (see fromEditorLines). */
  base: Style;
  /** Straight off the layer: a single-line layer gets no Header toggle,
   *  swallows Enter, and emits one line. */
  multiline: boolean;
  uppercase?: boolean;
  onUppercase?: (uppercase: boolean) => void;
  /** TextLayer.input: "number" and "code" swap the rich field for a plain
   *  box that writes one plain line; absent = the rich editor. */
  input?: "number" | "code";
  min?: number; max?: number;
  symbology?: Symbology;
  /** Static text shown after a number/code box (TextLayer.suffix); the
   *  renderer draws it after the value, and it is never edited here. */
  suffix?: string;
  /** The layer's fill vocabulary. Present = a picker that offers these and
   *  still takes anything typed. It rides ALONGSIDE `input` rather than being
   *  one of its modes, so a barcode tier list keeps its code validation
   *  (docs/plans/choice-input.md). */
  choices?: Choice[];
  /** Caption for the field, when the layer's name is not what to say to
   *  whoever is filling it (LayerBase.title). Absent = `label`. Honoured by
   *  every field — the contract offers it on any text layer, so a plain
   *  number box must not be the one that quietly ignores it. The aria name
   *  stays `label`, which is the layer's identity. */
  title?: string;
}

/** The sidebar's field for a text layer: label, the inline toolbar row, and
 *  the widget the layer's `input` calls for. */
export function TextEditor(props: TextEditorProps) {
  return props.choices?.length || props.input ? <PlainLineField {...props} /> : <RichField {...props} />;
}

const LABEL_CLASS = "text-xs text-muted-foreground";

/** THE PICKER: a text box over a fixed vocabulary that still takes anything
 *  typed (docs/plans/choice-input.md). Typing filters on title and value
 *  alike; a value nobody offers appears as its own row rather than being
 *  refused, and committing it teaches the master (edit.ts's setContentIn).
 *
 *  Strings in, strings out, so it serves both fill surfaces: the styled-text
 *  field below, and App's own code field, where a barcode's tiers are filled.
 *  Neither knows what the other validates — this only picks. */
export function ChoiceBox(props: {
  id: string;
  value: string;
  choices: Choice[];
  onCommit: (value: string) => void;
  /** The box's own input hint (a barcode's "digits", a QR's example URL) —
   *  NOT a layer's placeholder, which only the canvas draws. */
  placeholder?: string;
  invalid?: boolean;
  className?: string;
}) {
  const { id, value, choices, onCommit, placeholder, invalid } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const typed = draft ?? value;
  const open = draft !== null;

  // Filtering starts when you TYPE, not when you focus: opening a field that
  // is already filled must show the whole list, not narrow it to the one
  // entry already in the box.
  const needle = draft !== null && draft !== value ? draft.trim().toLowerCase() : "";
  const shown = needle
    ? choices.filter((c) => `${c.title ?? ""} ${c.value}`.toLowerCase().includes(needle))
    : choices;
  // A typed value nobody offers is itself an option — the picker never blocks.
  const novel = !!typed.trim() && !choices.some((c) => c.value === typed.trim());

  const commit = (text: string) => {
    setDraft(null);
    setActive(-1);
    onCommit(text);
  };

  return (
    <div className="relative flex-1">
      <Input
        id={id}
        className={cn("h-7 text-xs", props.className)}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={typed}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onFocus={() => setDraft(value)}
        // Blur COMMITS what was typed — clicking away must not throw the edit
        // out. Escape has already cleared the draft, so it still cancels.
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft.trim());
          setDraft(null);
          setActive(-1);
        }}
        onChange={(e) => { setDraft(e.target.value); setActive(-1); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = shown.length + (novel ? 1 : 0);
            if (!n) return;
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if (e.key === "Enter") {
            e.preventDefault();
            commit(active >= 0 && active < shown.length ? shown[active].value : typed.trim());
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
            setActive(-1);
          }
        }} />
      {open && (shown.length > 0 || novel) && (
        <ul role="listbox" aria-label={`${id} choices`}
          className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {shown.map((c, i) => (
            <li key={c.value} role="option" data-choice aria-selected={i === active}
              // The list is dismissed by blur, so take the press before it.
              onMouseDown={(e) => { e.preventDefault(); commit(c.value); }}
              className={cn("cursor-default rounded-sm px-2 py-1 text-xs",
                i === active ? "bg-accent" : "hover:bg-accent")}>
              {c.title ?? c.value}
            </li>
          ))}
          {novel && (
            <li key="__novel" role="option" data-novel aria-selected={active === shown.length}
              onMouseDown={(e) => { e.preventDefault(); commit(typed.trim()); }}
              className={cn("cursor-default rounded-sm px-2 py-1 text-xs text-muted-foreground",
                active === shown.length ? "bg-accent" : "hover:bg-accent")}>
              Use “{typed.trim()}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** One plain line, entered directly or through a vocabulary, with the same
 *  validation, caption and suffix in either case. */
function PlainLineField(props: TextEditorProps) {
  const { id, label, title, lines, onChange, base, input, min, max, symbology, suffix, choices } = props;
  const value = lines[0]?.text ?? "";
  const check = value === "" || !input ? { ok: true }
    : validateField({ id, label, kind: input, path: id, min, max, symbology }, value);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={LABEL_CLASS}>{title ?? label}</Label>
      <div className="flex items-center gap-1.5">
        {choices?.length ? <ChoiceBox id={id} value={value} choices={choices}
          invalid={!check.ok} onCommit={(text) => onChange([{ ...base, text }])} /> :
          <Input id={id} type={input === "number" ? "number" : "text"}
            className="h-7 text-xs" value={value} min={min} max={max}
            aria-invalid={!check.ok || undefined}
            onChange={(e) => onChange([{ ...base, text: e.target.value }])} />}
        {suffix && <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {!check.ok && <p className="text-xs text-destructive-text">{check.error}</p>}
    </div>
  );
}

function RichField(props: TextEditorProps) {
  const { id, label, title, lines, onChange, base, multiline, uppercase } = props;
  const { focused, setFocused, caret, toggle, toggleHeader, fieldProps } =
    useTextField({ lines, onChange, base, multiline, uppercase });
  // Focus starts in the field (fieldProps' onFocus) but only ends when it
  // leaves this row, so Shift+Tab from the field lands on the run toggles
  // instead of unmounting them, and the blur reseed doesn't wipe the
  // selection they act on (issue #120). Tabbing into the toolbar from
  // outside the field doesn't count: the toggles would have no selection.
  return (
    <div className="space-y-1"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
      {/* h-7, matching the size-sm toggles inside: a shorter row lets them
          overflow onto the field's outline below. */}
      <div className="flex h-7 items-center justify-between gap-1">
        <Label htmlFor={id} className={LABEL_CLASS}>{title ?? label}</Label>
        <div className="flex gap-1">
          {(focused || props.onUppercase) && (
            <TextToolbarButtons
              caret={caret} toggle={toggle} toggleHeader={toggleHeader} showHeader={multiline}
              showRuns={focused} uppercase={uppercase} onUppercase={props.onUppercase}
            />
          )}
        </div>
      </div>
      <div
        {...fieldProps}
        onBlur={undefined}
        id={id}
        aria-label={label}
        className={cn(
          multiline ? "min-h-[8.5rem]" : "min-h-8",
          "w-full space-y-0.5 rounded-lg border border-input bg-transparent px-2.5 py-2",
          "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      />
    </div>
  );
}
