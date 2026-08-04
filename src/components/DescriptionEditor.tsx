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
import type { Style } from "@/types";
import { parseDescription, serializeDescription } from "@/description";
import { GOLD } from "@/layout";

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
