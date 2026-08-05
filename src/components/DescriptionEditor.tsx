// DescriptionEditor.tsx — WYSIWYG replacement for the description textarea.
// The block used to be authored as a markdown subset (`# header`,
// `**bold**`, `_white ink_`) in a plain textarea, with the syntax explained
// only in a tooltip; since this app is used every few weeks, that syntax
// never became muscle memory. This editor keeps the same single multiline
// field but renders each line in its real appearance (gold/white, bold,
// header size) instead of encoding it as punctuation.
//
// markdownToLines/linesToMarkdown are thin adapters over description.ts's
// parseDescription/serializeDescription — they do NOT re-implement the
// markdown grammar. serializeDescription canonicalizes (white-inside/
// bold-outside marker order, header's redundant `**` dropped) and cannot
// represent blank lines (parseDescription skips them on the way back in);
// both are deliberate constraints of that module, not bugs here.
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
import { parseDescription, serializeDescription } from "@/description";
import { GOLD } from "@/layout";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

export function linesToMarkdown(lines: EditorLine[]): string {
  const header = lines.find((l) => l.header);
  const body = lines.filter((l) => !l.header);
  const asStyled = (l: EditorLine) => ({
    text: l.text, bold: l.bold,
    fill: l.white ? ("none" as const) : GOLD,
    layer: l.white ? ("white" as const) : ("metallic" as const),
  });
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
// fights the browser's own DOM mutations mid-edit. So the JSX below never
// declares this field's line-divs as children — they exist only because
// these functions put them there — and React's re-renders never touch
// them. The DOM is the source of truth while focused; props are the
// source of truth while not.

/** Tailwind can't see a class name built from a JS variable at build time
 *  (arbitrary-value scanning is purely static), so this can't reference
 *  GOLD directly — keep it matching layout.ts's GOLD ("#D0B070") by eye. */
function lineClasses(l: Pick<EditorLine, "bold" | "white" | "header">): string {
  return cn(
    "font-heading leading-snug outline-none",
    l.header ? "text-sm" : "text-xs",
    l.bold && "font-semibold",
    l.white ? "text-white" : "text-[#D0B070]",
  );
}

/** Replaces the field's content with fresh line-divs built from `lines`.
 *  Only ever called while NOT focused (mount, external value/base change,
 *  the post-blur snap to serializeDescription's canonical form, or
 *  switching back from "Edit as text") — see the effect below. */
function seedDom(root: HTMLDivElement, lines: EditorLine[]) {
  root.replaceChildren();
  // An empty description still needs one focusable/clickable line to type
  // into — parseDescription("", base) legitimately yields zero lines.
  const list = lines.length ? lines : [{ text: "", bold: false, white: false, header: false }];
  for (const line of list) {
    const div = document.createElement("div");
    div.className = lineClasses(line);
    div.dataset.bold = String(line.bold);
    div.dataset.white = String(line.white);
    if (line.header) div.dataset.header = "true";
    // A completely empty block-level div collapses to zero height in most
    // engines, making it unclickable; <br> keeps it visible and focusable
    // the same way a blank line in a textarea is, without adding a text
    // node that would show up in readLines' textContent.
    if (line.text) div.textContent = line.text;
    else div.appendChild(document.createElement("br"));
    root.appendChild(div);
  }
}

/** Reads the field's current line-divs back into EditorLine[] — the other
 *  half of the caret-preservation split: while focused, this (not props)
 *  is where onChange's data comes from. Missing data-* (e.g. a brand new
 *  div the browser inserted for a native Enter keypress, which carries no
 *  attributes of ours) reads as a plain, non-bold, non-white, non-header
 *  line — the Bold/White toggles remain available to restyle it. */
function readLines(root: HTMLDivElement): EditorLine[] {
  const kids = Array.from(root.children).filter(
    (el): el is HTMLDivElement => el.tagName === "DIV",
  );
  if (kids.length === 0) {
    // Fully cleared (select-all + delete): some engines leave a bare <br>
    // or nothing at all rather than a div. Either way, one empty line.
    return [{ text: root.textContent ?? "", bold: false, white: false, header: false }];
  }
  return kids.map((el) => ({
    text: el.textContent ?? "",
    bold: el.dataset.bold === "true",
    white: el.dataset.white === "true",
    header: el.dataset.header === "true",
  }));
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
  const kids = Array.from(root.children).filter(
    (el): el is HTMLDivElement => el.tagName === "DIV",
  );
  const ia = kids.indexOf(a);
  const ib = kids.indexOf(f);
  if (ia === -1 || ib === -1) return [];
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  return kids.slice(lo, hi + 1);
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
    bold: lines.every((l) => l.dataset.bold === "true"),
    white: lines.every((l) => l.dataset.white === "true"),
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

export function DescriptionEditor(props: {
  value: string;
  base: Style;
  onChange: (markdown: string) => void;
  /** Fired when the field gains focus. Not in the original task interface,
   *  but required by LabelForm.tsx to keep calling onSelect("description")
   *  on focus, exactly like the plain Textarea this replaces — see that
   *  file's Description row. */
  onFocus?: () => void;
}) {
  const { value, base, onChange, onFocus } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [asText, setAsText] = useState(false);
  // Whether every line the caret/selection currently touches is bold/white/
  // header (plus whether Header is even eligible right now) — drives the
  // toolbar buttons' pressed/disabled state. Purely a display cache:
  // re-derived from the DOM (via computeCaret) on every selectionchange and
  // after every toggle, never treated as the source of truth for an edit.
  const [caret, setCaret] = useState({ bold: false, white: false, header: false, headerEnabled: false });

  useEffect(() => {
    if (focused || asText) return;
    const root = rootRef.current;
    if (!root) return;
    seedDom(root, markdownToLines(value, base));
  }, [value, base, focused, asText]);

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
      setCaret(computeCaret(root, lines));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [focused]);

  const emitChange = () => {
    const root = rootRef.current;
    if (!root) return;
    onChange(linesToMarkdown(readLines(root)));
  };

  const toggle = (attr: "bold" | "white") => {
    const root = rootRef.current;
    if (!root) return;
    const lines = linesInSelection(root);
    if (!lines.length) return;
    for (const el of lines) {
      el.dataset[attr] = String(el.dataset[attr] !== "true");
      el.className = lineClasses({
        bold: el.dataset.bold === "true",
        white: el.dataset.white === "true",
        header: el.dataset.header === "true",
      });
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
    first.className = lineClasses({
      bold: first.dataset.bold === "true",
      white: first.dataset.white === "true",
      header: nowHeader,
    });
    setCaret(computeCaret(root, lines));
    emitChange();
  };

  return (
    <div className="space-y-1">
      <div className="flex h-6 items-center justify-between gap-1">
        <div className="flex gap-1">
          {focused && !asText && (
            <>
              {/* Header is wrapped in an extra <span> (rather than putting
                  TooltipTrigger's render prop directly on the button) so the
                  tooltip still opens on hover while the button is disabled:
                  toggleVariants applies disabled:pointer-events-none to the
                  <button> itself, which would otherwise swallow the hover
                  that triggers the tooltip. The span isn't disabled, so it
                  still receives the pointer events the button now ignores. */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <ToggleGroupItem
                        value="header"
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
                      </ToggleGroupItem>
                    </span>
                  }
                />
                <TooltipContent>
                  {caret.headerEnabled ? "Header" : "Header must be the first line"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleGroupItem
                      value="bold"
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
                    </ToggleGroupItem>
                  }
                />
                <TooltipContent>Bold</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToggleGroupItem
                      value="white"
                      aria-label="Toggle white ink underlay"
                      size="sm"
                      pressed={caret.white}
                      onMouseDown={(e) => e.preventDefault()}
                      onPressedChange={() => toggle("white")}
                    >
                      <Droplet />
                    </ToggleGroupItem>
                  }
                />
                {/* White ink is a print layer (a separate underlay plate),
                    not a text colour, hence the explicit label — Droplet
                    alone reads ambiguously next to a colour swatch. */}
                <TooltipContent>White ink underlay</TooltipContent>
              </Tooltip>
            </>
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
          {asText ? "Edit as WYSIWYG" : "Edit as text"}
        </Button>
      </div>

      {asText ? (
        <Textarea
          rows={7}
          aria-label="Description"
          className="font-mono text-xs"
          value={value}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div
          ref={rootRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Description"
          className={cn(
            "min-h-[8.5rem] w-full space-y-0.5 rounded-lg border border-input bg-transparent px-2.5 py-2",
            "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
          onInput={emitChange}
          onFocus={() => { setFocused(true); onFocus?.(); }}
          onBlur={() => setFocused(false)}
          onPaste={(e) => {
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
          }}
        />
      )}
    </div>
  );
}
