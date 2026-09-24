// ScrubField.tsx — a numeric style field you tune by dragging its label, the
// gesture Photoshop and Figma use for values judged against a live preview
// (tracking, stroke width) rather than known in advance. The interface is
// entirely shadcn — a Label as the scrub handle, an InputGroup holding the
// Input and its unit addon — so this stays inside the mature-component rule;
// only the pointer gesture is ours, since no shadcn primitive scrubs. Typing
// still works, and the Input keeps its native arrow-key stepping.
import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  InputGroup, InputGroupAddon, InputGroupInput, InputGroupText,
} from "@/components/ui/input-group";
// Round to the decimal places the step implies, so a drag can't accumulate float noise
// (0.4 + 0.1 = 0.5000000000000001) straight into the saved config. Shared with
// the callers that have to predict what this field commits — see numeric.ts.
import { roundToStep } from "@/numeric";

/** Pixels of pointer travel per drag increment. Two keeps a full-range drag
 *  comfortable (tracking's -2..20 in 0.1s is ~440px) while leaving a single
 *  increment easy to land on. */
const PX_PER_STEP = 2;

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
  /** Typing and arrow-key granularity, and the precision values snap to. */
  step: number;
  /** Drag granularity, when a finger-friendly increment is coarser than the
   *  typed precision — tracking types in hundredths but scrubs in tenths,
   *  since 0.01 per drag increment would make its full range ~4400px of
   *  travel. Defaults to `step`, i.e. drag and type at the same granularity. */
  dragStep?: number;
  /** The selection's elements disagree about this number (multi-select):
   *  show an empty field instead of one element's value. Typing or dragging
   *  still writes the new value to every selected element — a drag starts
   *  from `value`, which the caller sets to the first element's. */
  mixed?: boolean;
  onChange: (v: number) => void;
}) {
  // Half-typed text ("0.", "-") would round-trip through Number() as a
  // different value and fight the keystroke, so it lives here until it
  // parses — the same guard ColorField's hex field uses.
  const [text, setText] = useState<string | null>(null);
  const drag = useRef<{ x: number; v: number } | null>(null);

  const shown = props.mixed ? "" : roundToStep(props.value, props.step);
  const snap = (v: number) =>
    roundToStep(Math.min(props.max, Math.max(props.min, v)), props.step);

  return (
    <div className="flex items-center justify-between gap-2">
      <Label
        htmlFor={props.id}
        title="Drag to change"
        className="cursor-ew-resize select-none gap-1 text-xs text-muted-foreground"
        onPointerDown={(e) => {
          // Left button only: a right-click on the label shouldn't scrub.
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, v: props.value };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          // Coarse/fine modifiers, as on Photoshop's scrubby sliders.
          const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
          const inc = props.dragStep ?? props.step;
          setText(null);
          props.onChange(snap(d.v + ((e.clientX - d.x) / PX_PER_STEP) * inc * mult));
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        {props.icon && <props.icon className="size-3.5" aria-hidden="true" />}
        {props.label}
      </Label>
      <InputGroup className="h-6 w-24">
        <InputGroupInput
          id={props.id}
          type="number"
          min={props.min}
          max={props.max}
          step={props.step}
          className="h-6 text-xs"
          // Match editing precision without mutating imported geometry on render.
          // Keep the draft untouched until blur so typing remains uninterrupted.
          value={text ?? shown}
          placeholder={props.mixed ? "Mixed" : undefined}
          onChange={(e) => {
            setText(e.target.value);
            // Clamp on commit: `min`/`max` on a number input do not stop a
            // typed value, and both fields feed straight into the renderer.
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) props.onChange(snap(n));
          }}
          onBlur={(e) => {
            setText(null);
            // React skips the DOM write when the input's text loosely equals
            // the new value ("1e2" == 100), so a typed exponent would stay on
            // screen after it applied as 100 (#135). Write the value we show.
            e.currentTarget.value = String(shown);
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-[10px]">{props.unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
