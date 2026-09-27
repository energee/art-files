// ScrubField.tsx — a numeric style field you tune by dragging its label, the
// gesture Photoshop and Figma use for values judged against a live preview
// (tracking, stroke width) rather than known in advance. Built on Base UI's
// NumberField, which owns the parts we used to hand-roll: the half-typed draft
// ("0.", "-"), clamping, the scrub gesture (ScrubArea, with Shift/Alt for
// coarse/fine), and reformatting on blur. Styling stays shadcn — a Label as the
// scrub handle, an InputGroup holding the Input and its unit addon.
import type { LucideIcon } from "lucide-react";
import { NumberField } from "@base-ui/react/number-field";
import { Label } from "@/components/ui/label";
import {
  InputGroup, InputGroupAddon, InputGroupInput, InputGroupText,
} from "@/components/ui/input-group";
// Round to the decimal places the step implies, so a drag can't accumulate float noise
// (0.4 + 0.1 = 0.5000000000000001) straight into the saved config. Shared with
// the callers that have to predict what this field commits — see numeric.ts.
import { decimalsOf, roundToStep } from "@/numeric";

/** The Root props every numeric field here shares: `step` is the typed
 *  precision (shown and snapped to), `dragStep` what one arrow press or one
 *  scrub increment moves. Fixed to en-US without grouping so a value reads
 *  "1200.5" whatever the OS locale — the same text the old native number
 *  input showed, and what a saved config holds. */
export function numberRootProps(p: {
  id: string; min: number; max: number; step: number; dragStep?: number;
}) {
  const inc = p.dragStep ?? p.step;
  return {
    id: p.id, min: p.min, max: p.max,
    step: inc, smallStep: inc / 10, largeStep: inc * 10,
    locale: "en-US",
    format: { useGrouping: false, maximumFractionDigits: decimalsOf(p.step) },
  };
}

/** The input and its unit addon; render inside a NumberField.Root. */
export function UnitInput(props: { unit: string; placeholder?: string }) {
  return (
    <InputGroup className="h-6 w-24">
      <NumberField.Input
        render={<InputGroupInput className="h-6 text-xs" />}
        placeholder={props.placeholder}
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
  /** Typed precision: the decimals shown, and what values snap to. */
  step: number;
  /** Scrub and arrow-key granularity, when a finger-friendly increment is
   *  coarser than the typed precision — tracking types in hundredths but
   *  scrubs in tenths, since 0.01 per increment would make its full range
   *  ~4400px of travel. Defaults to `step`. */
  dragStep?: number;
  /** The selection's elements disagree about this number (multi-select):
   *  show an empty field instead of one element's value. Typing or dragging
   *  still writes the new value to every selected element. */
  // ponytail: a scrub on a Mixed field starts from 0 (or min), not the first
  // element's value; pass an explicit start if anyone notices.
  mixed?: boolean;
  onChange: (v: number) => void;
}) {
  const snap = (v: number) =>
    roundToStep(Math.min(props.max, Math.max(props.min, v)), props.step);
  return (
    <NumberField.Root
      {...numberRootProps(props)}
      value={props.mixed ? null : roundToStep(props.value, props.step)}
      // Blank is not a value here; the field restores the last one on blur.
      onValueChange={(v) => { if (v !== null) props.onChange(snap(v)); }}
      className="flex items-center justify-between gap-2"
    >
      <NumberField.ScrubArea
        render={<Label htmlFor={props.id} />}
        title="Drag to change"
        className="cursor-ew-resize select-none gap-1 text-xs text-muted-foreground"
      >
        {props.icon && <props.icon className="size-3.5" aria-hidden="true" />}
        {props.label}
      </NumberField.ScrubArea>
      <UnitInput unit={props.unit} placeholder={props.mixed ? "Mixed" : undefined} />
    </NumberField.Root>
  );
}
