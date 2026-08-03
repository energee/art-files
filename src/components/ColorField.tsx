// ColorField.tsx — Fill editor: native color swatch + hex text + optional
// "no ink" toggle rendered as a checkerboard chip ("none").
import { useState } from "react";
import type { Fill } from "@/types";
import { cn } from "@/lib/utils";
import { GOLD } from "@/layout";

const CHECKER =
  "repeating-conic-gradient(#3a3d43 0% 25%, #1a1c1f 0% 50%) 0 0 / 8px 8px";
const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField(props: {
  value: Fill;
  onChange: (v: Fill) => void;
  allowNone?: boolean;
}) {
  const none = props.value === "none";
  // Local text state so a half-typed hex doesn't clobber the config.
  const [text, setText] = useState<string | null>(null);
  const hex = none ? "#ffffff" : props.value;
  return (
    <div className="flex items-center gap-1">
      {props.allowNone !== false && (
        <button
          type="button"
          title='No ink ("none")'
          aria-pressed={none}
          onClick={() => props.onChange(none ? GOLD : "none")}
          className={cn(
            "size-6 shrink-0 rounded-sm border border-border",
            none && "ring-2 ring-ring",
          )}
          style={{ background: CHECKER }}
        />
      )}
      <input
        type="color"
        value={hex}
        disabled={none}
        onChange={(e) => { setText(null); props.onChange(e.target.value as Fill); }}
        className="size-6 shrink-0 cursor-pointer rounded-sm border border-border bg-input p-0 disabled:opacity-30"
      />
      <input
        type="text"
        value={none ? "none" : (text ?? props.value)}
        disabled={none}
        onChange={(e) => {
          setText(e.target.value);
          if (HEX.test(e.target.value)) props.onChange(e.target.value as Fill);
        }}
        onBlur={() => setText(null)}
        className="h-6 w-[4.6rem] rounded-sm border border-border bg-input px-1 font-mono text-xs disabled:opacity-50"
      />
    </div>
  );
}
