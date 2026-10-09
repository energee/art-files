// ColorField.tsx — Fill editor: a swatch Button opening a react-colorful
// picker in a nested popover, a hex Input, and an optional "no ink"
// checkerboard toggle. All controls are shadcn; the picker is react-colorful
// (no shadcn color-picker primitive exists). The popover also offers a
// screen eyedropper where the browser supports the native EyeDropper API.
import { useState } from "react";
import { flushSync } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { Pipette } from "lucide-react";
import type { Fill } from "@/types";
import { cn } from "@/lib/utils";
import { GOLD } from "@/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addColor, setSwatches, useSwatches } from "@/settings";

/** "No ink" checkerboard chip background. */
const CHECKER =
  "repeating-conic-gradient(#3a3d43 0% 25%, #1a1c1f 0% 50%) 0 0 / 8px 8px";
function normalizeHex(value: string): Fill | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  const hex = match[1].toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}` as Fill;
}

// ponytail: EyeDropper is Chromium-only and still absent from lib.dom, so it
// gets a local type instead of a global Window augmentation. Read once here:
// narrowing a const survives into the click handler, a window property doesn't.
const EyeDropper = (window as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } })
  .EyeDropper;

export function ColorField(props: {
  value: Fill;
  onChange: (v: Fill) => void;
  allowNone?: boolean;
  /** id for the hex Input, so an external Label can point at this field. */
  id?: string;
  /** The selection's elements disagree about this color (multi-select): show
   *  an empty field rather than one element's value standing in for all of
   *  them. Typing or picking still writes to the whole selection. */
  mixed?: boolean;
}) {
  // Only "no ink" when the whole selection agrees. A mixed selection whose
  // first element happens to have none would otherwise disable the hex Input
  // and the picker for everyone, leaving no way to set a color without first
  // toggling no-ink off — which stamps GOLD over the lot.
  const none = !props.mixed && props.value === "none";
  // Local text state so a half-typed hex doesn't clobber the config.
  const [text, setText] = useState<string | null>(null);
  // Picker and Save still need a real color when a mixed value reads "none".
  const hex = props.value === "none" ? "#ffffff" : props.value;
  // Commit a picked color and drop any half-typed hex sitting in the Input.
  const apply = (v: string) => { setText(null); props.onChange(v as Fill); };
  // Blur / Enter: apply a valid typed hex (the 3-digit form lands only here)
  // and drop the local text; an invalid entry stays up, flagged.
  const commitText = () => {
    const parsed = text === null ? undefined : normalizeHex(text);
    if (!parsed) return;
    if (parsed === props.value) setText(null);
    else apply(parsed);
  };
  // Saved swatches are this operator's, not the element's, so a color saved
  // here is offered by every other ColorField the moment it lands — all the
  // fields read one shared list (see settings.ts).
  const colors = useSwatches();
  // addColor owns the lowercase-canonicalization rule; "already saved" is just
  // "adding it changes nothing", so the two can't drift apart.
  const saved = addColor(colors, hex) === colors;
  return (
    <div className="flex items-center gap-1">
      {props.allowNone !== false && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          title='No ink ("none")'
          aria-pressed={none}
          onClick={() => { setText(null); props.onChange(none ? GOLD : "none"); }}
          className={cn("size-6 rounded-sm", none && "ring-2 ring-ring")}
          style={{ background: CHECKER }}
        />
      )}
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Pick color"
              disabled={none}
              className="size-6 rounded-sm"
              // A mixed selection has no one swatch color to show; the empty
              // button reads as "not one value" the way the blank hex does.
              style={none || props.mixed ? undefined : { background: hex }}
            />
          }
        />
        <PopoverContent align="start" className="w-auto p-2">
          <HexColorPicker color={hex} onChange={apply} />
          {/* Screen eyedropper: the OS takes over the cursor once opened, so
              the user can sample any pixel outside the popover. */}
          {EyeDropper && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() =>
                // Esc / cancel rejects with AbortError; nothing to do.
                new EyeDropper().open().then((r) => apply(r.sRGBHex), () => {})
              }
            >
              <Pipette /> Pick from screen
            </Button>
          )}
          {/* Saved swatches. Click applies, shift-click or Delete removes — a delete
              affordance per chip would double the row's height for something
              used once in a while. */}
          <div className="mt-2 flex max-w-[200px] flex-wrap items-center gap-1">
            {colors.map((c, index) => (
              <button
                key={c}
                type="button"
                title={`${c} (Delete or shift-click to remove)`}
                aria-label={`Saved color ${c}`}
                aria-keyshortcuts="Delete Backspace"
                className="size-5 rounded-sm border border-border"
                style={{ background: c }}
                onKeyDown={(e) => {
                  // A held key must not auto-repeat through the chips that slide into this slot.
                  if ((e.key !== "Delete" && e.key !== "Backspace") || e.repeat) return;
                  e.preventDefault(); e.stopPropagation();
                  // Flush first, then focus what now sits in this slot (the
                  // previous chip after the last one): the Save button next to
                  // the last chip is disabled until this hex stops being saved.
                  const row = e.currentTarget.parentElement!;
                  flushSync(() => setSwatches((cs) => cs.filter((x) => x !== c)));
                  const slot = index < colors.length - 1 ? index : Math.max(index - 1, 0);
                  (row.children[slot] as HTMLElement | undefined)?.focus();
                }}
                onClick={(e) =>
                  e.shiftKey
                    ? setSwatches((cs) => cs.filter((x) => x !== c))
                    : apply(c)
                }
              />
            ))}
            {/* Disabled once this exact hex is saved: a second save is a no-op,
                and a dead button says so up front. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[11px]"
              disabled={saved}
              onClick={() => setSwatches((cs) => addColor(cs, hex))}
            >
              {saved ? "Saved" : "Save"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Input
        id={props.id}
        value={none ? "none" : (text ?? (props.mixed ? "" : props.value))}
        placeholder={props.mixed ? "Mixed" : undefined}
        disabled={none}
        // A full #rrggbb applies as it is typed; a 3-digit hex only on
        // commit (blur / Enter) — every 6-digit entry passes through a valid
        // 3-digit prefix, which must not flash onto the layer mid-typing.
        onChange={(e) => {
          setText(e.target.value);
          const parsed = normalizeHex(e.target.value);
          if (parsed && /[0-9a-f]{6}\s*$/i.test(e.target.value)) props.onChange(parsed);
        }}
        aria-invalid={text !== null && !normalizeHex(text) || undefined}
        title={text !== null && !normalizeHex(text) ? "Enter a 3- or 6-digit hex color." : undefined}
        onKeyDown={(e) => { if (e.key === "Enter") commitText(); }}
        onBlur={commitText}
        // w-24/px-2.5 = a ScrubField's value box, so the hex lands in the
        // same right-hand column as every numeric field in the panel.
        className="h-6 w-24 px-2.5 font-mono text-xs"
      />
    </div>
  );
}
