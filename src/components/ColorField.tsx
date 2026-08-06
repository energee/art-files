// ColorField.tsx — Fill editor: a swatch Button opening a react-colorful
// picker in a nested popover, a hex Input, and an optional "no ink"
// checkerboard toggle. All controls are shadcn; the picker is react-colorful
// (no shadcn color-picker primitive exists). The popover also offers a
// screen eyedropper where the browser supports the native EyeDropper API.
import { useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Pipette } from "lucide-react";
import type { Fill } from "@/types";
import { cn } from "@/lib/utils";
import { GOLD } from "@/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePresets } from "./PresetBar";
import { addColor } from "@/presets";

/** "No ink" checkerboard chip background. */
export const CHECKER =
  "repeating-conic-gradient(#3a3d43 0% 25%, #1a1c1f 0% 50%) 0 0 / 8px 8px";
const HEX = /^#[0-9a-fA-F]{6}$/;

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
}) {
  const none = props.value === "none";
  // Local text state so a half-typed hex doesn't clobber the config.
  const [text, setText] = useState<string | null>(null);
  const hex = none ? "#ffffff" : props.value;
  // Commit a picked color and drop any half-typed hex sitting in the Input.
  const apply = (v: string) => { setText(null); props.onChange(v as Fill); };
  // Saved swatches live in presets.json, not on the element, so a color saved
  // here is offered by every other ColorField. Reloaded when the popover
  // opens: the other field's copy of the hook may have saved since mount.
  const { presets, commit, error, reload } = usePresets();
  const saved = presets.colors.includes(hex.toLowerCase());
  const setColors = (colors: string[]) => commit({ ...presets, colors });
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
      <Popover onOpenChange={(open) => { if (open) reload(); }}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Pick color"
              disabled={none}
              className="size-6 rounded-sm"
              style={none ? undefined : { background: hex }}
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
          {/* Saved swatches. Click applies, shift-click removes — a delete
              affordance per chip would double the row's height for something
              used once in a while. */}
          <div className="mt-2 flex max-w-[200px] flex-wrap items-center gap-1">
            {presets.colors.map((c) => (
              <button
                key={c}
                type="button"
                title={`${c} (shift-click to remove)`}
                aria-label={c}
                className="size-5 rounded-sm border border-border"
                style={{ background: c }}
                onClick={(e) =>
                  e.shiftKey
                    ? setColors(presets.colors.filter((x) => x !== c))
                    : apply(c)
                }
              />
            ))}
            {/* Disabled once this exact hex is saved: a second save is a no-op,
                and a dead button says so up front (same rule as PresetBar). */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[11px]"
              disabled={saved}
              onClick={() => setColors(addColor(presets.colors, hex))}
            >
              {saved ? "Saved" : "Save"}
            </Button>
          </div>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </PopoverContent>
      </Popover>
      <Input
        id={props.id}
        value={none ? "none" : (text ?? props.value)}
        disabled={none}
        onChange={(e) => {
          setText(e.target.value);
          if (HEX.test(e.target.value)) props.onChange(e.target.value as Fill);
        }}
        onBlur={() => setText(null)}
        className="h-6 w-[4.6rem] px-1 font-mono text-xs"
      />
    </div>
  );
}
