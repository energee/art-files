// LayerInspectorControls.tsx — the inspector's shared building blocks: the
// pt -> length-unit conversion every dimensional field goes through, the row and
// field layouts, the per-source override Badge, the option lists the
// dropdowns and segmented controls offer, and the `Ctx` each section of
// LayerInspector.tsx receives. Split out of LayerInspector.tsx (#433); see
// that file's header for the patch contract these controls write through.
import { useState, type ComponentProps, type ReactNode } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndVertical, AlignStartVertical,
  ArrowDownToLine, ArrowUpToLine, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart,
  type LucideIcon,
} from "lucide-react";
import type { Layer, Symbology } from "@/model/layers";
import type { OverrideBadges as Overridden } from "@/model/edit";
import type { DeepPartial } from "@/model/merge";
import { cn } from "@/lib/utils";
import type { Anchor } from "@/model/position";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NumberRoot, ScrubField, UnitInput } from "./ScrubField";
import { decimalsOf, PT_STEP, roundToStep } from "@/numeric";
import { unitPt, type LengthUnit } from "@/rulers";

export type Patch = DeepPartial<Layer>;

/** Points precision for positions and sizes: typing keeps the model's PT_STEP
 *  and a scrub or arrow press moves in halves — fine enough to land a snap,
 *  coarse enough to cross the label. */
export const PT = { step: PT_STEP, dragStep: 0.5 } as const;

// The model stays in PDF points; only dimensional controls convert for display,
// into the app's one length unit (rulers.ts unitPt).

/** The finest reading each unit shows: fine enough that every 0.01pt model
 *  value (PT_STEP) has its own reading. A millimetre is ~2.8 points, so mm
 *  needs three decimals — at two, a sub-millimetre value (a barcode's module
 *  width) rounds to 0.00 in the field while the layer holds a real one; an
 *  inch needs four, and a 600 DPI pixel (0.12pt) two. */
const DISPLAY_STEP: Record<LengthUnit, number> = { in: 0.0001, mm: 0.001, pt: PT_STEP, px: 0.01 };

/** A field's reading back to points at the model's `step` — the one
 *  conversion both committing a value and choosing its display go through. */
const toPoints = (value: number, unit: LengthUnit, step: number) =>
  roundToStep(value * unitPt(unit), step);

/** A typed or scrubbed reading back to points (toPoints), then clamped to
 *  the field's point bounds — after rounding, so a rounded-up millimetre
 *  reading of a bound (1pt -> 0.353mm -> 1.0006pt) cannot slip past it. */
const clampedPoints = (value: number, b: { unit: LengthUnit; step: number; min: number; max: number }) =>
  Math.min(b.max, Math.max(b.min, toPoints(value, b.unit, b.step)));

/** A stored point value as the field shows it. Other units than points use
 *  the FEWEST decimals (up to their DISPLAY_STEP) that store back to the same
 *  points: 50mm is kept as 141.73pt, which reads 49.999mm at three decimals —
 *  the drift in #131 — but 50 already stores 141.73, so 50 is what shows. A
 *  value that needs the last decimal (1pt is 0.353mm; 0.35 would store
 *  0.99pt) still gets it. Points show the value at `step`. */
function displayValue(points: number, unit: LengthUnit, step: number): number {
  if (unit === "pt") return roundToStep(points, step);
  const exact = points / unitPt(unit);
  const stored = roundToStep(points, step);
  for (let d = 0; d < decimalsOf(DISPLAY_STEP[unit]); d++) {
    const shown = Number(exact.toFixed(d));
    if (toPoints(shown, unit, step) === stored) return shown;
  }
  return roundToStep(exact, DISPLAY_STEP[unit]);
}

/** A point-valued field's bounds, steps and shown value in its display unit
 *  — the one pt->display mapping DimensionField and BlankableField share.
 *  Coming back, clampedPoints returns a reading to points. */
function unitProps(p: { unit: LengthUnit; value: number; min: number; max: number; step: number; dragStep?: number }) {
  if (p.unit === "pt") return { value: displayValue(p.value, "pt", p.step), min: p.min, max: p.max, step: p.step, dragStep: p.dragStep };
  const scale = 1 / unitPt(p.unit);
  const fine = DISPLAY_STEP[p.unit];
  return {
    value: displayValue(p.value, p.unit, p.step), min: p.min * scale, max: p.max * scale,
    // The pt drag step converted, so an arrow press moves the same physical
    // distance in every unit (never below the unit's display precision).
    step: fine,
    dragStep: Math.max(fine, roundToStep((p.dragStep ?? p.step) * scale, fine)),
  };
}

export function DimensionField(props: Omit<ComponentProps<typeof ScrubField>, "unit"> & { unit: LengthUnit }) {
  return <ScrubField {...props} key={props.unit} {...unitProps(props)}
    // Back to points at the MODEL's precision, then clamped (clampedPoints).
    onChange={(value) => props.onChange(clampedPoints(value, props))} />;
}


/** Section heading — the idiom StyleProperties' inspector used, so the new
 *  panel reads in the app's established voice. */
export function Heading(props: { children?: ReactNode }) {
  return (
    <h2 className="mb-2 mt-4 border-t border-border pt-3 text-xs font-medium text-foreground">
      {props.children}
    </h2>
  );
}

/** A field with its (optional) override badge to the right, so the badge
 *  never widens the field's own row. */
export function Row(props: { badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">{props.children}</div>
      {props.badge}
    </div>
  );
}

/** A label on the left, a compact control on the right — the layout every
 *  non-ScrubField row here shares (ScrubField draws its own label). */
export function Field(props: { id?: string; label: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">{props.label}</Label>
      <span className="flex items-center gap-1.5">
        {props.children}
        {props.badge}
      </span>
    </div>
  );
}

/** The override badge — up to TWO marks beside a control, one per source: a
 *  filled dot for a variant, a ring for this label, matching the Layers list.
 *  Each resets only its own source, so clearing your own edit can never
 *  rewrite the shipped variant (which is what one merged badge used to do).
 *
 *  `paths` are checked in order and the first hit is what Reset restores. A
 *  binding and a bound y are each ONE path to edit.ts's leaf-path walk
 *  ("binding", "y"), never split into their fields (#92). */
export function Badge(props: {
  paths: readonly string[];
  overridden: Overridden;
  label: string;
  onReset: (path: string, source: "variant" | "label") => void;
}) {
  const who = props.overridden.variantName ?? "A variant";
  const marks = ([
    { source: "variant", cls: "bg-current", title: `${who} sets ${props.label}. Click to reset it in the master.`,
      aria: `Reset ${props.label} to the master`,
      path: props.paths.find((p) => props.overridden.variant.has(p)) },
    { source: "label", cls: "border border-current", title: `This label sets ${props.label}. Click to use the master value.`,
      aria: `Reset ${props.label} to this label's master value`,
      path: props.paths.find((p) => props.overridden.label.has(p)) },
  ] as const).filter((m) => m.path);
  if (!marks.length) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {marks.map((m) => (
        <button
          key={m.source}
          type="button"
          className="flex size-6 shrink-0 items-center justify-center rounded text-info-text hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={m.title}
          aria-label={m.aria}
          onClick={() => props.onReset(m.path!, m.source)}
        >
          <span aria-hidden="true" className={cn("size-2 rounded-full", m.cls)} />
        </button>
      ))}
    </span>
  );
}

/** A number that may be ABSENT (text wrap width, image height): blank means
 *  "none"/"auto" and emits `undefined` — see LayerInspector.tsx's header for
 *  what the parent must do with that. The same NumberField and InputGroup as
 *  ScrubField, without the scrub, so it sits in the same right-hand column.
 *  `unit` "" is a plain number (a fill's Minimum/Maximum): no conversion and
 *  an empty addon. */
export function BlankableField(props: {
  id: string; label: string; unit: LengthUnit | ""; placeholder: string;
  value: number | undefined; min: number; max: number; step: number; dragStep?: number;
  badge?: ReactNode;
  onChange: (v: number | undefined) => void;
}) {
  const conv = { ...props, unit: props.unit || "pt" as const };
  const shown = unitProps({ ...conv, value: props.value ?? 0 });
  return (
    <Field id={props.id} label={props.label} badge={props.badge}>
      <NumberRoot
        {...shown} id={props.id} blankable
        value={props.value === undefined ? null : shown.value}
        // Back to points at the MODEL's precision before clamping, as
        // DimensionField does: without it a millimetre reading typed back
        // verbatim (35pt -> 12.347mm -> 34.99916pt) never re-matches the
        // master, so the override badge can't be cleared from this field.
        onChange={(v) => props.onChange(v === null ? undefined : clampedPoints(v, conv))}
      >
        <UnitInput unit={props.unit} placeholder={props.placeholder} />
      </NumberRoot>
    </Field>
  );
}

/** A labelled switch row. The Switch carries the accessible name itself
 *  (aria-label) so the row reads the same to AT whether or not the wrapping
 *  label associates with base-ui's button. */
export function SwitchRow(props: {
  label: string; checked: boolean; badge?: ReactNode; onChange: (on: boolean) => void;
}) {
  return (
    <Field label={props.label} badge={props.badge}>
      <Switch
        aria-label={props.label}
        checked={props.checked}
        onCheckedChange={(on) => props.onChange(on === true)}
      />
    </Field>
  );
}

/** A single-choice segmented control (guide, align; undefined = nothing chosen). base-ui's
 *  ToggleGroup reports a re-click of the pressed item as an empty value;
 *  that is ignored so the field never goes blank. */
export function Segmented<T extends string>(props: {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: string; icon: LucideIcon }[];
  badge?: ReactNode;
  onChange: (v: T) => void;
}) {
  return (
    <Field label={props.label} badge={props.badge}>
      <ToggleGroup
        aria-label={props.label}
        variant="outline" size="sm" spacing={0}
        value={props.value ? [props.value] : []}
        onValueChange={(v) => { const next = v[0] as T | undefined; if (next) props.onChange(next); }}
      >
        {props.options.map((o) => (
          <ToggleGroupItem
            key={o.value} value={o.value}
            aria-label={o.label} title={o.label}
            className="h-6 min-w-6 px-1.5"
          >
            <o.icon className="size-3.5" />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}


/** The lock tooltip, on the inspector switch and the Layers row's lock
 *  button. The lock is canvas-only (editGestures): typed X/Y still move it. */
export const LOCK_TITLE = "Locked on canvas: drag, resize and nudge are off. Typed values still apply.";

/** One control per axis: picking a guide anchors that edge of the box ON the
 *  guide (offset 0). Empty selection = a legacy layer placed by an absolute
 *  x/y; choosing any guide converts it. */
export const H_GUIDES = [
  { value: "left", label: "Anchor to left guide", icon: AlignStartVertical },
  { value: "center", label: "Anchor to center guide", icon: AlignCenterVertical },
  { value: "right", label: "Anchor to right guide", icon: AlignEndVertical },
] as const satisfies readonly { value: Anchor; label: string; icon: LucideIcon }[];

export const V_GUIDES = [
  { value: "top", label: "Anchor to top guide", icon: ArrowUpToLine },
  { value: "middle", label: "Anchor to middle guide", icon: AlignCenterHorizontal },
  { value: "bottom", label: "Anchor to bottom guide", icon: ArrowDownToLine },
] as const satisfies readonly { value: NonNullable<Layer["guideY"]>; label: string; icon: LucideIcon }[];

export const ALIGNS = [
  { value: "left", label: "Align left", icon: TextAlignStart },
  { value: "center", label: "Align center", icon: TextAlignCenter },
  { value: "right", label: "Align right", icon: TextAlignEnd },
  { value: "justify", label: "Justify", icon: TextAlignJustify },
] as const;

// Dropdown options. Each list is also handed to its Select as `items`, so the
// closed trigger shows the option's label, not its raw value (#232).
export const SYMBOLOGIES: readonly { value: Symbology; label: string }[] = [
  { value: "upc-a", label: "UPC-A" }, { value: "ean-13", label: "EAN-13" }, { value: "code-128", label: "Code 128" },
];
export const INPUTS = [
  { value: "text", label: "Rich text" }, { value: "number", label: "Number" }, { value: "code", label: "Code" },
] as const;
export const FITS = [{ value: "contain", label: "Contain" }, { value: "cover", label: "Cover" }] as const;
export const QR_STYLES = [
  { value: "square", label: "Square" }, { value: "rounded", label: "Rounded" }, { value: "dots", label: "Dots" },
] as const;
export const EC_LEVELS = [
  { value: "L", label: "L (default)" }, { value: "M", label: "M" }, { value: "Q", label: "Q" }, { value: "H", label: "H" },
] as const;

/** Compact inspector dropdown with one null/option guard and label mapping. */
export function SelectField<T extends string>(props: {
  id: string; label: string; ariaLabel?: string; badge?: ReactNode;
  items: readonly { value: T; label: string }[]; value: T | undefined; onChange: (value: T) => void;
}) {
  return <Field id={props.id} label={props.label} badge={props.badge}>
    <Select items={props.items} value={props.value} onValueChange={(value) => {
      const option = props.items.find((item) => item.value === value);
      if (option) props.onChange(option.value);
    }}>
      <SelectTrigger id={props.id} size="sm" aria-label={props.ariaLabel ?? props.label} className="h-6 w-24 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{props.items.map((o) =>
        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
    </Select>
  </Field>;
}

/** What every section receives: the layer, the one write, and the badge
 *  factory bound to this layer's overridden set. */
export interface Ctx {
  unit: LengthUnit;
  set: (patch: Patch) => void;
  badge: (paths: readonly string[], label: string) => ReactNode;
}

/** A REQUIRED text box: one parseMaster refuses to leave empty (a choice's
 *  value; the layer name box commits on Enter instead, LayerInspector.tsx).
 *  Pushing an emptied box straight at the model threw, App
 *  caught it into the menu-bar alert, and the text sprang back with a banner
 *  that stayed up. The draft lets the box go empty while you retype, commits
 *  every keystroke that has something in it, and falls back to the last good
 *  value when focus leaves. Deleting the row is the way to get rid of it.
 *
 *  Returns the Input props to spread, so no field can adopt half the rule. */
export function useRequiredText(value: string, commit: (v: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    value: draft ?? value,
    "aria-invalid": (draft !== null && !draft.trim()) || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
      if (e.target.value.trim()) commit(e.target.value);
    },
    onBlur: () => setDraft(null),
  };
}

/** A labelled single-line text control, the Field idiom with the input on its
 *  own row (a placeholder or suffix needs the width a right-hand control has
 *  not got). */
export function InputRow(props: {
  id: string; label: string; value: string; hint?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">{props.label}</Label>
      <Input
        id={props.id} className="h-6 text-xs" value={props.value}
        aria-describedby={props.hint ? `${props.id}-hint` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <p id={`${props.id}-hint`} className="text-[11px] text-muted-foreground">{props.hint}</p>}
    </div>
  );
}
