// FormatBuilder.tsx — the chip-based editor for a custom barcode/QR layer's
// RAW `value` (spec: "Format strings (derived content)"). A format string is
// literal text interleaved with {fieldId} / {fieldId|transform} refs
// (format.ts); this renders each literal run as inline editable text and
// each ref as a chip carrying the field's label and a transform dropdown,
// with an "Insert field" menu to append new refs and a live preview line
// (missing refs stay visible as literal braces, per expandFormat's
// contract). A "Raw" toggle swaps the whole row for a plain input over the
// stored string, for anyone who'd rather type the grammar directly.
import { useState } from "react";
import type { FieldDecl } from "@/model/types";
import { expandFormat, segments, TRANSFORMS } from "@/model/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Plain-language description of each transform, shown as the option's
 *  title — "none" leaves the field's raw value untouched. */
const TRANSFORM_TITLES: Record<string, string> = {
  none: "Use the field's value as-is",
  slug: "Lowercase and hyphenated, for use in a URL (spaces/punctuation become dashes)",
  upper: "Convert the field's value to UPPERCASE",
  lower: "convert the field's value to lowercase",
  trim: "Remove leading and trailing whitespace",
};
const TRANSFORM_ORDER = ["none", "slug", "upper", "lower", "trim"] as const;

/** Rebuilds the raw format string from `segments`' own parsed form — the
 *  inverse of format.ts's REF grammar, so a round trip through segments()
 *  and this never drifts from what expandFormat itself would read back. */
function serialize(segs: ReturnType<typeof segments>): string {
  return segs.map((s) => ("lit" in s ? s.lit : `{${s.id}${s.tr ? `|${s.tr}` : ""}}`)).join("");
}

export function FormatBuilder(props: {
  /** Raw format string (storage form) — may contain zero, one, or many refs. */
  value: string;
  /** Insertable refs, e.g. visibleFieldsOf's output. */
  fields: FieldDecl[];
  /** Current stringified values, for the live preview only. */
  preview: Record<string, string>;
  onChange: (value: string) => void;
}) {
  const [raw, setRaw] = useState(false);
  const segs = segments(props.value);
  const live = expandFormat(props.value, props.preview);

  const setLiteral = (i: number, text: string) =>
    props.onChange(serialize(segs.map((s, idx) => (idx === i ? { lit: text } : s))));
  const setTransform = (i: number, tr: string) =>
    props.onChange(serialize(segs.map((s, idx) => {
      if (idx !== i || !("id" in s)) return s;
      return tr === "none" ? { id: s.id } : { id: s.id, tr };
    })));
  const insertField = (id: string) => props.onChange(`${props.value}{${id}}`);

  return (
    <div className="space-y-1.5">
      {raw ? (
        <Input
          type="text" className="h-6 w-full font-mono text-xs" value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {segs.map((s, i) => "lit" in s ? (
            <input
              key={i} type="text"
              className="h-6 min-w-4 flex-1 bg-transparent text-xs outline-none"
              value={s.lit}
              onChange={(e) => setLiteral(i, e.target.value)}
            />
          ) : (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
            >
              {props.fields.find((f) => f.id === s.id)?.label ?? s.id}
              <select
                aria-label={`${s.id} transform`}
                className="bg-transparent text-[11px]"
                value={s.tr && s.tr in TRANSFORMS ? s.tr : "none"}
                onChange={(e) => setTransform(i, e.target.value)}
              >
                {TRANSFORM_ORDER.map((tr) => (
                  <option key={tr} value={tr} title={TRANSFORM_TITLES[tr]}>{tr}</option>
                ))}
              </select>
            </span>
          ))}
          <select
            aria-label="Insert field"
            className="h-6 bg-transparent text-xs text-muted-foreground"
            value=""
            onChange={(e) => { if (e.target.value) insertField(e.target.value); }}
          >
            <option value="">Insert field ▾</option>
            {props.fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </div>
      )}
      <div className="flex items-center justify-between gap-1.5">
        <p
          title={live.text}
          className="truncate font-mono text-[11px] text-muted-foreground"
        >
          {live.text}
        </p>
        <Button
          type="button" variant="ghost" size="sm"
          className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground"
          onClick={() => setRaw((v) => !v)}
        >
          {raw ? "Chips" : "Raw"}
        </Button>
      </div>
    </div>
  );
}
