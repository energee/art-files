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

/** "No ink" checkerboard chip background. */
export const CHECKER =
  "repeating-conic-gradient(#3a3d43 0% 25%, #1a1c1f 0% 50%) 0 0 / 8px 8px";
const HEX = /^#[0-9a-fA-F]{6}$/;

// ponytail: EyeDropper is Chromium-only and absent from lib.dom in TS 5.6.
declare global {
  interface Window {
    EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
  }
}

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
              style={none ? undefined : { background: hex }}
            />
          }
        />
        <PopoverContent align="start" className="w-auto p-2">
          <HexColorPicker
            color={hex}
            onChange={(v) => { setText(null); props.onChange(v as Fill); }}
          />
          {/* Screen eyedropper: the OS takes over the cursor once opened, so
              the user can sample any pixel outside the popover. */}
          {typeof window !== "undefined" && window.EyeDropper && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() =>
                new window.EyeDropper!()
                  .open()
                  .then((r) => { setText(null); props.onChange(r.sRGBHex as Fill); })
                  // Esc / cancel rejects with AbortError; nothing to do.
                  .catch(() => {})
              }
            >
              <Pipette /> Pick from screen
            </Button>
          )}
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
