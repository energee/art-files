// ScrubField.tsx — a numeric style field you tune by dragging its label, the
// gesture Photoshop and Figma use for values judged against a live preview
// (tracking, stroke width) rather than known in advance. The interface is
// entirely shadcn — a Label as the scrub handle, an InputGroup holding the
// Input and its unit addon — so this stays inside the mature-component rule;
// only the pointer gesture is ours, since no shadcn primitive scrubs. Typing
// still works, and the Input keeps its native arrow-key stepping.
import { useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  InputGroup, InputGroupAddon, InputGroupInput, InputGroupText,
} from "@/components/ui/input-group";

/** Decimal places implied by the step, so a drag can't accumulate float
 *  noise (0.4 + 0.1 = 0.5000000000000001) straight into the saved config. */
const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

/** Pixels of pointer travel per step. Two keeps a full-range drag
 *  comfortable (tracking's -2..20 at 0.1 is ~440px) while leaving a single
 *  step easy to land on. */
const PX_PER_STEP = 2;

export function ScrubField(props: {
  /** Ties the Label to the Input; callers prefix it per element. */
  id: string;
  label: string;
  /** Shown as the InputGroup's trailing addon, e.g. "pt" or "px". */
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  // Half-typed text ("0.", "-") would round-trip through Number() as a
  // different value and fight the keystroke, so it lives here until it
  // parses — the same guard ColorField's hex field uses.
  const [text, setText] = useState<string | null>(null);
  const drag = useRef<{ x: number; v: number } | null>(null);

  const snap = (v: number) =>
    Number(Math.min(props.max, Math.max(props.min, v)).toFixed(decimals(props.step)));

  return (
    <div className="flex items-center justify-between gap-2">
      <Label
        htmlFor={props.id}
        title="Drag to change"
        className="cursor-ew-resize select-none text-xs text-muted-foreground"
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
          setText(null);
          props.onChange(snap(d.v + ((e.clientX - d.x) / PX_PER_STEP) * props.step * mult));
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
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
          value={text ?? props.value}
          onChange={(e) => {
            setText(e.target.value);
            // Clamp on commit: `min`/`max` on a number input do not stop a
            // typed value, and both fields feed straight into the renderer.
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) props.onChange(snap(n));
          }}
          onBlur={() => setText(null)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-[10px]">{props.unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
