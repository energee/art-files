// ScrubField.tsx — a numeric style field you tune by dragging its label, the
// gesture Photoshop and Figma use for values judged against a live preview
// (tracking, stroke width) rather than known in advance. Built on Base UI's
// NumberField, which owns clamping, rounding, arrow keys and the scrub gesture
// (ScrubArea, Shift/Alt for coarse/fine). NumberRoot below pins the few
// NumberField defaults that don't suit an editor that writes on every change.
// Styling stays shadcn — a Label as the scrub handle, an InputGroup holding
// the Input and its unit addon. LayerInspector's BlankableField shares
// NumberRoot and UnitInput.
import { useState, type ReactNode } from "react";
import { MoveHorizontal, type LucideIcon } from "lucide-react";
import { NumberField } from "@base-ui/react/number-field";
import { Label } from "@/components/ui/label";
import {
  InputGroup, InputGroupAddon, InputGroupInput, InputGroupText,
} from "@/components/ui/input-group";
// The step's decimal places become NumberField's maximumFractionDigits, so it
// clamps and rounds every typed or scrubbed value (no 0.5000000000000001 in a
// saved config) — the rule numeric.ts states for callers that predict it.
import { decimalsOf } from "@/numeric";

/** Text NumberField (en-US, no grouping) parses as a number. */
const PARSEABLE = /^[-+]?(\d+\.?\d*|\.\d+)$/;

/** A NumberField.Root for this app's fields. `step` is the typed precision
 *  (shown and rounded to); `dragStep` what one arrow press or scrub
 *  increment moves, with Shift/Alt at ×10/÷10 — never finer than `step`, or
 *  a fine step would round straight back to where it started. Fixed to en-US
 *  without grouping, so a value reads "1200.5" whatever the OS locale. */
export function NumberRoot(props: {
  id: string; min: number; max: number; step: number; dragStep?: number;
  value: number | null;
  /** Whether blank is a value (BlankableField's "none"); otherwise a blank
   *  field reverts on blur, like any other text that isn't a number. */
  blankable?: boolean;
  onChange: (v: number | null) => void;
  className?: string;
  children: ReactNode;
}) {
  const inc = props.dragStep ?? props.step;
  // NumberField leaves unparseable text ("-", ".", or blank here) on screen
  // after blur, since there is no number to reformat. Remounting re-seeds it
  // from `value`, the number actually applied.
  const [epoch, setEpoch] = useState(0);
  return (
    <NumberField.Root
      key={epoch}
      id={props.id} min={props.min} max={props.max}
      step={inc} smallStep={Math.max(inc / 10, props.step)} largeStep={inc * 10}
      locale="en-US"
      format={{ useGrouping: false, maximumFractionDigits: decimalsOf(props.step) }}
      value={props.value}
      // Typing already applied the value (reason "input-change"). The blur
      // commit only re-sends a stale or re-rounded copy — merely focusing an
      // imported 15.829999 would write 15.83 — so it is dropped.
      onValueChange={(v, details) => { if (details.reason !== "input-blur") props.onChange(v); }}
      onBlur={(e) => {
        const text = (e.target as HTMLInputElement).value.trim();
        const ok = text === "" ? props.blankable : PARSEABLE.test(text);
        if (!ok) setEpoch((n) => n + 1);
      }}
      className={props.className}
    >
      {props.children}
    </NumberField.Root>
  );
}

/** The input and its unit addon; render inside a NumberRoot. */
export function UnitInput(props: { unit: string; placeholder?: string }) {
  return (
    <InputGroup className="h-6 w-24">
      <NumberField.Input
        render={<InputGroupInput className="h-6 text-xs" />}
        placeholder={props.placeholder}
        // NumberField maps Home/End to min/max; here they move the caret, as
        // in every other text field (End on X would throw a layer off-page).
        onKeyDown={(e) => { if (e.key === "Home" || e.key === "End") e.preventBaseUIHandler(); }}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText className="text-[10px]">{props.unit}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

export function ScrubField(props: {
  /** Ties the Label to the Input; callers prefix it per element. */
  id: string;
  label: string;
  /** Optional icon shown before the label text; part of the scrub handle. */
  icon?: LucideIcon;
  /** Shown as the InputGroup's trailing addon, e.g. "pt" or "px". */
  unit: string;
  value: number;
  min: number;
  max: number;
  /** Typed precision: the decimals shown, and what values round to. */
  step: number;
  /** Scrub and arrow-key granularity, when a finger-friendly increment is
   *  coarser than the typed precision — tracking types in hundredths but
   *  scrubs in tenths, since 0.01 per pixel would make its full range
   *  ~2200px of travel. Defaults to `step`. */
  dragStep?: number;
  onChange: (v: number) => void;
}) {
  return (
    <NumberRoot {...props} onChange={(v) => { if (v !== null) props.onChange(v); }}
      className="flex items-center justify-between gap-2">
      <NumberField.ScrubArea
        render={<Label htmlFor={props.id} />}
        title="Drag to change"
        // One step per pixel. At the default 2, NumberField applies only the
        // triggering event's movement, so the rate varied with pointer speed.
        pixelSensitivity={1}
        className="cursor-ew-resize select-none gap-1 text-xs text-muted-foreground"
      >
        {props.icon && <props.icon className="size-3.5" aria-hidden="true" />}
        {props.label}
        {/* Stands in for the OS cursor, which pointer lock hides during a
            scrub (Chromium and Firefox; WebKit skips pointer lock). */}
        <NumberField.ScrubAreaCursor className="drop-shadow">
          <MoveHorizontal className="size-4" aria-hidden="true" />
        </NumberField.ScrubAreaCursor>
      </NumberField.ScrubArea>
      <UnitInput unit={props.unit} />
    </NumberRoot>
  );
}
