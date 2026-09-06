// LayerInspector.tsx — the right-hand inspector for ONE resolved v3 layer
// (spec: docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI"
// and "Relative position"). Sections, top to bottom: header (kind icon,
// inline rename, enabled/locked), the parent's content editor,
// Position (free coordinates or a binding to another layer's edge, with
// a gap; rotation 0/90), kind-specific Geometry, and Style.
//
// Every control is controlled from `layer` and writes ONLY through
// `onChange` with a minimal DeepPartial<Layer> patch ({ x }, { y: 12 },
// { style: { fill } }); the parent decides whether that lands on the master,
// a variant diff, or a label override, and marks the paths a variant/label
// override wins on in `overridden` so the matching control can show a reset
// badge. Two patches need parent-side care:
//   - a cleared optional field (text `width`, image `h`) emits the key with
//     `undefined`. deepMerge skips undefined, so the parent's write must
//     DELETE the key when it sees one, or the field can never be cleared.
//   - "Unbind" does not emit a patch: the parent computes the bound layer's
//     current resolved top and writes it as `y` (onUnbind), since only the
//     planner knows where the layer above ends.
//
// Replaces StyleProperties.tsx's Inspector, which edited LabelConfig fields
// through elements.ts. Per the spec's Removed section there is no stack
// nudge, no collab slot nudge, no "Make fillable" button and no presets:
// every layer has a position, `below` covers the flow, and every layer is
// fillable. The text/image/code content editor is the parent's (`content`),
// so this file never builds a text editor of its own.
import { useState, type ReactNode } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndVertical, AlignStartVertical, ArrowDownToLine, ArrowUpToLine,
  Barcode, ChevronsUpDown, Heading1, Image, Link2, Link2Off, QrCode, RotateCcw,
  TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart, Type, WholeWord, X,
  type LucideIcon,
} from "lucide-react";
import { bindingOf, guideOf, uppercaseOf } from "@/model/layers";
import type {
  BindingSide, BarcodeLayer, Choice, ImageLayer, Layer, LayerKind, QrLayer, Symbology, TextLayer,
} from "@/model/layers";
import type { OverrideBadges as Overridden } from "@/model/edit";
import type { DeepPartial } from "@/model/merge";
import { cn } from "@/lib/utils";
import type { Anchor } from "@/model/position";
import type { Style } from "@/types";
import { DEFAULT_STROKE_PX } from "@/layout";
import { strokeLayerOf } from "@/strokes";
import { minModuleWarning } from "@/model/fields";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  InputGroup, InputGroupAddon, InputGroupInput, InputGroupText,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ColorField } from "./ColorField";
import { MetallicToggle } from "./MetallicToggle";
import { ScrubField } from "./ScrubField";

type Patch = DeepPartial<Layer>;

/** One icon per kind — the same four the Layers list rows use, so the
 *  header and the row never disagree about what a kind looks like. */
const KIND_ICONS: Record<LayerKind, LucideIcon> = {
  text: Type, image: Image, barcode: Barcode, qr: QrCode,
};

/** Points precision for positions and sizes: the Lolev master authors to
 *  hundredths (24.12, 15.83), so typing keeps that and a drag moves in
 *  halves — fine enough to land a snap, coarse enough to cross the label. */
const PT = { step: 0.01, dragStep: 0.5 } as const;

/** Section heading — the idiom StyleProperties' inspector used, so the new
 *  panel reads in the app's established voice. */
function Heading(props: { children?: ReactNode }) {
  return (
    <h2 className="mb-1.5 mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">
      {props.children}
    </h2>
  );
}

/** A field with its (optional) override badge to the right, so the badge
 *  never widens the field's own row. */
function Row(props: { badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">{props.children}</div>
      {props.badge}
    </div>
  );
}

/** A label on the left, a compact control on the right — the layout every
 *  non-ScrubField row here shares (ScrubField draws its own label). */
function Field(props: { id?: string; label: string; badge?: ReactNode; children: ReactNode }) {
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
 *  `paths` are checked in order and the first hit is what Reset restores — a
 *  bound y is written as one object but a parent's leaf-path walk may report
 *  it as "y", "y.below" or "y.gap". */
function Badge(props: {
  paths: readonly string[];
  overridden: Overridden;
  label: string;
  onReset: (path: string, source: "variant" | "label") => void;
}) {
  const who = props.overridden.variantName ?? "A variant";
  const marks = ([
    { source: "variant", cls: "bg-current", title: `${who} sets ${props.label} — reset it in the master`,
      aria: `Reset ${props.label} to the master`,
      path: props.paths.find((p) => props.overridden.variant.has(p)) },
    { source: "label", cls: "border border-current", title: `This label sets ${props.label} — reset it to the master`,
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
          className={cn("size-2 shrink-0 rounded-full text-info-text transition-transform hover:scale-125", m.cls)}
          title={m.title}
          aria-label={m.aria}
          onClick={() => props.onReset(m.path!, m.source)}
        />
      ))}
    </span>
  );
}

/** A number that may be ABSENT (text wrap width, image height): blank means
 *  "none"/"auto" and emits `undefined` — see the file header for what the
 *  parent must do with that. Same half-typed guard as ScrubField, same
 *  InputGroup so it sits in the same right-hand column. */
function BlankableField(props: {
  id: string; label: string; unit: string; placeholder: string;
  value: number | undefined; min: number; max: number; step: number;
  badge?: ReactNode;
  onChange: (v: number | undefined) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Field id={props.id} label={props.label} badge={props.badge}>
      <InputGroup className="h-6 w-24">
        <InputGroupInput
          id={props.id}
          type="number"
          min={props.min}
          max={props.max}
          step={props.step}
          placeholder={props.placeholder}
          className="h-6 text-xs"
          value={text ?? (props.value ?? "")}
          onChange={(e) => {
            const s = e.target.value;
            setText(s);
            if (s === "") { props.onChange(undefined); return; }
            const n = Number(s);
            if (Number.isFinite(n)) props.onChange(Math.min(props.max, Math.max(props.min, n)));
          }}
          onBlur={() => setText(null)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-[10px]">{props.unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}

/** A labelled switch row. The Switch carries the accessible name itself
 *  (aria-label) so the row reads the same to AT whether or not the wrapping
 *  label associates with base-ui's button. */
function SwitchRow(props: {
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
function Segmented<T extends string>(props: {
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

/** One control per axis: picking a guide anchors that edge of the box ON the
 *  guide (offset 0). Empty selection = a legacy layer placed by an absolute
 *  x/y; choosing any guide converts it. */
const H_GUIDES = [
  { value: "left", label: "Anchor to left guide", icon: AlignStartVertical },
  { value: "center", label: "Anchor to center guide", icon: AlignCenterVertical },
  { value: "right", label: "Anchor to right guide", icon: AlignEndVertical },
] as const satisfies readonly { value: Anchor; label: string; icon: LucideIcon }[];

const V_GUIDES = [
  { value: "top", label: "Anchor to top guide", icon: ArrowUpToLine },
  { value: "middle", label: "Anchor to middle guide", icon: AlignCenterHorizontal },
  { value: "bottom", label: "Anchor to bottom guide", icon: ArrowDownToLine },
] as const satisfies readonly { value: NonNullable<Layer["guideY"]>; label: string; icon: LucideIcon }[];

const ALIGNS = [
  { value: "left", label: "Align left", icon: TextAlignStart },
  { value: "center", label: "Align center", icon: TextAlignCenter },
  { value: "right", label: "Align right", icon: TextAlignEnd },
  { value: "justify", label: "Justify", icon: TextAlignJustify },
] as const;

const SYMBOLOGIES: readonly { value: Symbology; label: string }[] = [
  { value: "upc-a", label: "UPC-A" }, { value: "ean-13", label: "EAN-13" }, { value: "code-128", label: "Code 128" },
];

/** What every section receives: the layer, the one write, and the badge
 *  factory bound to this layer's overridden set. */
interface Ctx {
  set: (patch: Patch) => void;
  badge: (paths: readonly string[], label: string) => ReactNode;
}

function Position(props: Ctx & {
  layer: Layer; layerNames: readonly { id: string; name: string }[]; onUnbind: () => void; onBind?: (to: string, side: BindingSide) => void;
}) {
  const { layer, set, badge } = props;
  const id = layer.id;
  const y = layer.y;
  const binding = bindingOf(layer);
  const horizontal = binding?.side === "left" || binding?.side === "right";
  const others = props.layerNames.filter((n) => n.id !== id);
  const nameOf = (lid: string) => props.layerNames.find((n) => n.id === lid)?.name ?? lid;
  return (
    <div className="space-y-1.5">
      <Heading>Position</Heading>
      {!horizontal && <>
      <Row badge={badge(["x"], "X")}>
        <ScrubField
          id={`${id}-x`} label={guideOf(layer.guideX) ? "X offset" : "X"} unit="pt" value={layer.x}
          min={-2000} max={2000} {...PT}
          onChange={(x) => set({ x })}
        />
      </Row>
      <Segmented
        label="Horizontal guide" value={guideOf(layer.guideX)}
        options={H_GUIDES}
        badge={badge(["guideX", "anchor"], "Horizontal guide")}
        onChange={(guideX) => set({ guideX, x: 0, anchor: guideX })}
      />
      </>}
      {(!binding || horizontal) && typeof y === "number" && (
        <>
          <Row badge={badge(["y"], "Y")}>
            <ScrubField
              id={`${id}-y`} label={guideOf(layer.guideY) ? "Y offset" : "Y"} unit="pt" value={y}
              min={-2000} max={2000} {...PT}
              onChange={(v) => set({ y: v })}
            />
          </Row>
          <Segmented
            label="Vertical guide" value={guideOf(layer.guideY)}
            options={V_GUIDES}
            badge={badge(["guideY", "vAnchor"], "Vertical guide")}
            onChange={(guideY) => set({ guideY, y: 0, vAnchor: guideY === "bottom" ? "bottom" : "top" })}
          />
        </>
      )}
      {!binding ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <Button variant="outline" size="xs" className="w-full" disabled={!props.onBind || others.length === 0}>
              <Link2 className="size-3" /> Bind to layer…
            </Button>
          } />
          <DropdownMenuContent align="start">
            {others.map((n) => (
              <DropdownMenuSub key={n.id}>
                <DropdownMenuSubTrigger aria-label={`Bind to ${n.name}`}>{n.name}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(["top", "left", "right", "bottom"] as const).map((side) => (
                    <DropdownMenuItem key={side} aria-label={`Bind to ${side} of ${n.name}`}
                      className="text-xs" onClick={() => props.onBind?.(n.id, side)}>
                      {side[0].toUpperCase() + side.slice(1)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Field label="Bound to" badge={badge(["binding", "y.below", "y"], "Binding")}>
            <span className="flex items-center gap-1 text-xs font-medium">
              <Link2 className="size-3 text-muted-foreground" aria-hidden="true" />{nameOf(binding.to)}
            </span>
          </Field>
          <Field label="Side">
            <select aria-label="Binding side" value={binding.side}
              className="h-6 rounded border border-input bg-background px-1 text-xs"
              onChange={(e) => {
                const side = e.target.value as BindingSide;
                props.onBind?.(binding.to, side);
              }}>
              {(["top", "left", "right", "bottom"] as const).map((side) =>
                <option key={side} value={side}>{side}</option>)}
            </select>
          </Field>
          <Row badge={badge(["binding.gap", "y.gap", "y"], "Gap")}>
            <ScrubField id={`${id}-gap`} label="Gap" unit="pt" value={binding.gap}
              min={-500} max={500} {...PT}
              onChange={(gap) => layer.binding
                ? set({ binding: { ...binding, gap } })
                : set({ y: { below: binding.to, gap } })} />
          </Row>
          <Button variant="outline" size="xs" className="w-full" onClick={props.onUnbind}>
            <Link2Off className="size-3" /> Unbind
          </Button>
        </>
      )}
      {/* Image layers are the one kind no backend rotates: raster art places
          as a bare rect with no transform, so honoring it would mean adding
          one to all three backends. Hide the control rather than ship a
          toggle that silently does nothing. */}
      {layer.kind !== "image" && (
      <Field label="Rotation" badge={badge(["rotation"], "Rotation")}>
        <Toggle
          size="sm" variant="outline"
          pressed={layer.rotation === 90}
          onPressedChange={(on) => set({ rotation: on ? 90 : 0 })}
          aria-label="Rotate 90°"
          title="Rotate 90° counter-clockwise (reads bottom to top)"
          className="h-6 px-2 text-[11px]"
        >
          <RotateCcw className="size-3.5" /> 90°
        </Toggle>
      </Field>
      )}
    </div>
  );
}

function TextGeometry(props: Ctx & { layer: TextLayer; fontFamily?: string }) {
  const { layer, set, badge } = props;
  const id = layer.id;
  return (
    <div className="space-y-1.5">
      <Heading>Type</Heading>
      {/* Display only: the typeface is the master's one font gate, chosen in
          the master picker / Settings, never per layer (dynamic-fonts). */}
      {props.fontFamily && (
        <Field label="Font"><span className="text-xs">{props.fontFamily}</span></Field>
      )}
      <Row badge={badge(["size"], "Size")}>
        <ScrubField
          id={`${id}-size`} label="Size" unit="pt" value={layer.size}
          min={1} max={300} {...PT}
          onChange={(size) => set({ size })}
        />
      </Row>
      <Segmented
        label="Align" value={layer.align} options={ALIGNS}
        badge={badge(["align"], "Align")}
        onChange={(align) => set({ align })}
      />
      <BlankableField
        id={`${id}-width`} label="Wrap width" unit="pt" placeholder="none"
        value={layer.width} min={1} max={2000} step={PT.step}
        badge={badge(["width"], "Wrap width")}
        onChange={(width) => set({ width })}
      />
    </div>
  );
}

/** The FILL CONTRACT — what a filler may put in this text layer. Authored on
 *  the master, never overridden per label (edit.ts's MASTER_PATHS routes these
 *  paths there), which is why it reads as its own section rather than sitting
 *  among the Type controls: editing one changes the template for every label,
 *  and the Save Master review will say so.
 *
 *  Every field here was already honoured by the renderer and the fill widgets
 *  and authored by lolevLayers.ts; none of them had a control until now. */
/** Authoring the fill vocabulary: the caption a filler sees, and the list they
 *  pick from (docs/plans/choice-input.md, Task 6). Both are fill-contract keys,
 *  so `set` routes them to the master like `placeholder` does.
 *
 *  `choices` is emitted as the WHOLE array on every edit — it is one leaf to
 *  leafPaths, so it is one override badge and one row in the Save Master
 *  review, and a per-item patch would have neither. Not text-only: a barcode
 *  carries a `value` rather than an `input`, and its tier list is the same
 *  thing, so this renders for both. */
function Vocabulary(props: Ctx & { layer: Layer }) {
  const { layer, set, badge } = props;
  const id = layer.id;
  const choices = layer.choices ?? [];
  /** Writes the list back, dropping the key entirely once it is empty so
   *  absent and [] stay one state (parseMaster normalises the same way). */
  const put = (next: Choice[]) => set({ choices: next.length ? next : undefined });
  /** A new row must arrive with a VALID value. parseMaster rejects a blank one
   *  ("has a choice with no value") and App drops the whole failed edit, so an
   *  empty row would never survive the round trip to be typed into. Numbered
   *  on collision, like addVariant's ids, so two clicks give two rows. */
  const fresh = (): string => {
    let value = "New choice";
    for (let n = 2; choices.some((c) => c.value === value); n++) value = `New choice ${n}`;
    return value;
  };
  const edit = (i: number, patch: Partial<Choice>) =>
    put(choices.map((c, j) => {
      if (j !== i) return c;
      const merged = { ...c, ...patch };
      // A blanked title is no title, not an empty one.
      if (!merged.title) delete merged.title;
      return merged;
    }));

  return (
    <>
      <Row badge={badge(["title"], "Title")}>
        <InputRow
          id={`${id}-title`} label="Title" value={layer.title ?? ""}
          hint="Caption above the fill field"
          onChange={(v) => set({ title: v || undefined })}
        />
      </Row>
      <Row badge={badge(["choices"], "Choices")}>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Choices</Label>
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                id={`${id}-choice-${i}-title`} className="h-6 w-20 text-xs"
                value={c.title ?? ""} placeholder="Title"
                aria-label={`Choice ${i + 1} title`}
                onChange={(e) => edit(i, { title: e.target.value })} />
              <Input
                id={`${id}-choice-${i}-value`} className="h-6 flex-1 text-xs"
                value={c.value} placeholder="Value"
                aria-label={`Choice ${i + 1} value`}
                onChange={(e) => edit(i, { value: e.target.value })} />
              <button
                type="button" aria-label={`Remove choice ${i + 1}`}
                className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-accent"
                onClick={() => put(choices.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </button>
            </div>
          ))}
          <button
            type="button" aria-label="Add choice"
            className="rounded-sm px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            onClick={() => put([...choices, { value: fresh() }])}>
            + Add choice
          </button>
        </div>
      </Row>
    </>
  );
}

function FillContract(props: Ctx & { layer: TextLayer }) {
  const { layer, set, badge } = props;
  const id = layer.id;
  const numeric = layer.input === "number";
  return (
    <div className="space-y-1.5">
      <Heading>Fill contract</Heading>
      <Row badge={badge(["placeholder"], "Placeholder")}>
        <InputRow
          id={`${id}-placeholder`} label="Placeholder" value={layer.placeholder ?? ""}
          hint="Drawn while the layer is empty"
          onChange={(v) => set({ placeholder: v || undefined })}
        />
      </Row>
      <Field id={`${id}-input`} label="Input" badge={badge(["input"], "Input")}>
        <Select
          value={layer.input ?? "text"}
          onValueChange={(v) => { if (v) set({ input: v === "text" ? undefined : v as TextLayer["input"] }); }}
        >
          <SelectTrigger id={`${id}-input`} size="sm" aria-label="Input" className="h-6 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text" className="text-xs">Rich text</SelectItem>
            <SelectItem value="number" className="text-xs">Number</SelectItem>
            <SelectItem value="code" className="text-xs">Code</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {/* Range only bounds a number input; a code input is bounded by its
          symbology instead. Neither is meaningful for rich text. */}
      {numeric && (
        <>
          <BlankableField
            id={`${id}-min`} label="Minimum" unit="" placeholder="none"
            value={layer.min} min={-1e6} max={1e6} step={0.01}
            badge={badge(["min"], "Minimum")}
            onChange={(min) => set({ min })}
          />
          <BlankableField
            id={`${id}-max`} label="Maximum" unit="" placeholder="none"
            value={layer.max} min={-1e6} max={1e6} step={0.01}
            badge={badge(["max"], "Maximum")}
            onChange={(max) => set({ max })}
          />
        </>
      )}
      {layer.input === "code" && (
        <Field id={`${id}-fill-symbology`} label="Symbology" badge={badge(["symbology"], "Symbology")}>
          <Select
            value={layer.symbology ?? "upc-a"}
            onValueChange={(v) => { if (v) set({ symbology: v as Symbology }); }}
          >
            <SelectTrigger id={`${id}-fill-symbology`} size="sm" aria-label="Symbology" className="h-6 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYMBOLOGIES.map((sym) => (
                <SelectItem key={sym.value} value={sym.value} className="text-xs">{sym.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Vocabulary layer={layer} set={set} badge={badge} />
      {/* Fixed text drawn after the filled value on the same line ("% alc by
          vol"); the filler never edits it. */}
      {layer.input !== undefined && (
        <Row badge={badge(["suffix"], "Suffix")}>
          <InputRow
            id={`${id}-suffix`} label="Suffix" value={layer.suffix ?? ""}
            hint="Drawn after the filled value"
            onChange={(v) => set({ suffix: v || undefined })}
          />
        </Row>
      )}
    </div>
  );
}

/** A labelled single-line text control, the Field idiom with the input on its
 *  own row (a placeholder or suffix needs the width a right-hand control has
 *  not got). */
function InputRow(props: {
  id: string; label: string; value: string; hint?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">{props.label}</Label>
      <Input
        id={props.id} className="h-6 text-xs" value={props.value}
        placeholder={props.hint}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function ImageGeometry(props: Ctx & { layer: ImageLayer }) {
  const { layer, set, badge } = props;
  const id = layer.id;
  const page = layer.role === "background" || layer.role === "mask";
  const fit = (
    <Field id={`${id}-fit`} label="Fit" badge={badge(["fit"], "Fit")}>
      <Select
        value={layer.fit ?? "contain"}
        onValueChange={(v) => { if (v) set({ fit: v as ImageLayer["fit"] }); }}
      >
        <SelectTrigger id={`${id}-fit`} size="sm" aria-label="Fit" className="h-6 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="contain" className="text-xs">Contain</SelectItem>
          <SelectItem value="cover" className="text-xs">Cover</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
  // The page art (texture, metallic mask) covers the whole page: its box is
  // the page and it has no scale or tint to speak of — only how it meets
  // that box.
  if (page) return <div className="space-y-1.5"><Heading>Image</Heading>{fit}</div>;
  return (
    <div className="space-y-1.5">
      <Heading>Image</Heading>
      <Row badge={badge(["w"], "Width")}>
        <ScrubField
          id={`${id}-w`} label="Width" unit="pt" value={layer.w}
          min={1} max={2000} {...PT}
          onChange={(w) => set({ w })}
        />
      </Row>
      <BlankableField
        id={`${id}-h`} label="Height" unit="pt" placeholder="auto"
        value={layer.h} min={1} max={2000} step={PT.step}
        badge={badge(["h"], "Height")}
        onChange={(h) => set({ h })}
      />
      {fit}
      <Row badge={badge(["scale"], "Scale")}>
        <ScrubField
          id={`${id}-scale`} label="Scale" unit="×" value={layer.scale ?? 1}
          min={0.1} max={4} step={0.05} dragStep={0.05}
          onChange={(scale) => set({ scale })}
        />
      </Row>
      {/* Raster only — an SVG already takes the fill. Shown regardless of
          what is loaded so the setting is discoverable before the drop. */}
      <SwitchRow
        label="Tint raster" checked={!!layer.tintRaster}
        badge={badge(["tintRaster"], "Tint raster")}
        onChange={(tintRaster) => set({ tintRaster })}
      />
    </div>
  );
}

function BarcodeGeometry(props: Ctx & { layer: BarcodeLayer }) {
  const { layer, set, badge } = props;
  const id = layer.id;
  const warning = minModuleWarning(layer.symbology, layer.moduleW);
  return (
    <div className="space-y-1.5">
      <Heading>Barcode</Heading>
      <Field id={`${id}-symbology`} label="Symbology" badge={badge(["symbology"], "Symbology")}>
        <Select
          value={layer.symbology}
          onValueChange={(v) => { if (v) set({ symbology: v as Symbology }); }}
        >
          <SelectTrigger id={`${id}-symbology`} size="sm" aria-label="Symbology" className="h-6 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYMBOLOGIES.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {/* min > 0: a typed zero would collapse the symbol to nothing rather
          than reading as "very narrow". */}
      <Row badge={badge(["moduleW"], "Module width")}>
        <ScrubField
          id={`${id}-modulew`} label="Module width" unit="pt" value={layer.moduleW}
          min={0.01} max={10} step={0.01} dragStep={0.05}
          onChange={(moduleW) => set({ moduleW })}
        />
      </Row>
      {warning && <p className="text-[11px] text-warning-text">{warning}</p>}
      <Row badge={badge(["h"], "Height")}>
        <ScrubField
          id={`${id}-h`} label="Height" unit="pt" value={layer.h}
          min={1} max={300} {...PT}
          onChange={(h) => set({ h })}
        />
      </Row>
      <SwitchRow
        label="Show digits" checked={layer.showDigits ?? true}
        badge={badge(["showDigits"], "Show digits")}
        onChange={(showDigits) => set({ showDigits })}
      />
    </div>
  );
}

function QrGeometry(props: Ctx & { layer: QrLayer }) {
  const { layer, set, badge } = props;
  const id = layer.id;
  return (
    <div className="space-y-1.5">
      <Heading>QR</Heading>
      <Row badge={badge(["size"], "Size")}>
        <ScrubField
          id={`${id}-size`} label="Size" unit="pt" value={layer.size}
          min={1} max={300} {...PT}
          onChange={(size) => set({ size })}
        />
      </Row>
      <Field id={`${id}-qr-style`} label="Style" badge={badge(["qrStyle"], "QR style")}>
        <Select
          value={layer.qrStyle}
          onValueChange={(v) => { if (v) set({ qrStyle: v as QrLayer["qrStyle"] }); }}
        >
          <SelectTrigger id={`${id}-qr-style`} size="sm" aria-label="QR style" className="h-6 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="square" className="text-xs">Square</SelectItem>
            <SelectItem value="rounded" className="text-xs">Rounded</SelectItem>
            <SelectItem value="dots" className="text-xs">Dots</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {/* Absent means "M" for a layer — shown as such rather than as a blank
          that would read as L. */}
      <Field id={`${id}-ec`} label="Error correction" badge={badge(["ecLevel"], "Error correction")}>
        <Select
          value={layer.ecLevel ?? "M"}
          onValueChange={(v) => { if (v) set({ ecLevel: v as QrLayer["ecLevel"] }); }}
        >
          <SelectTrigger id={`${id}-ec`} size="sm" aria-label="Error correction" className="h-6 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="L" className="text-xs">L</SelectItem>
            <SelectItem value="M" className="text-xs">M (default)</SelectItem>
            <SelectItem value="Q" className="text-xs">Q</SelectItem>
            <SelectItem value="H" className="text-xs">H</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/** Fill + plate, tracking (text only), and the stroke stack — the same
 *  controls StyleProperties' ElementStyle offered, written as `style.*`
 *  patches. */
function StyleSection(props: Ctx & { layer: Layer }) {
  const { layer, set, badge } = props;
  const id = layer.id;
  const style: Style = layer.style;
  const setStyle = (patch: DeepPartial<Style>) => set({ style: patch });
  const strokeOn = !!style.stroke && style.stroke !== "none";
  const isCode = layer.kind === "barcode" || layer.kind === "qr";
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Heading>Color</Heading>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            {/* "No ink" is only offered where it can't break the layer: a
                code with no fill cannot scan. */}
            <ColorField
              id={`${id}-fill`} value={style.fill} allowNone={!isCode}
              onChange={(fill) => setStyle({ fill })}
            />
          </div>
          {badge(["style.fill"], "Fill")}
          <MetallicToggle
            pressed={style.layer === "metallic"}
            onPressedChange={(on) => setStyle({ layer: on ? "metallic" : "white" })}
            className="size-6 border border-input"
          />
          {badge(["style.layer"], "Plate")}
        </div>
      </div>

      {layer.kind === "text" && (
        <div className="space-y-1">
          <Heading>Typography</Heading>
          {/* Leading and Header scale are TextLayer fields, not Style ones —
              they patch through `set`, not `setStyle`. They live here anyway
              because a reader tuning type reaches for line height and
              tracking together; `size` stays in Type, where it sits with the
              geometry (align, wrap width) that resizes the layer's box. */}
          <Row badge={badge(["leading"], "Leading")}>
            <ScrubField
              id={`${id}-leading`} label="Leading" icon={ChevronsUpDown} unit="×"
              value={layer.leading ?? 1.2} min={0.5} max={4} step={0.01} dragStep={0.05}
              onChange={(leading) => set({ leading })}
            />
          </Row>
          <Row badge={badge(["headerScale"], "Header scale")}>
            <ScrubField
              id={`${id}-header-scale`} label="Header scale" icon={Heading1} unit="×"
              value={layer.headerScale ?? 1} min={0.5} max={4} step={0.01} dragStep={0.05}
              onChange={(headerScale) => set({ headerScale })}
            />
          </Row>
          {/* Clamped both ends by ScrubField: tracking wide enough to overrun
              the label reads as a broken line, not a style. */}
          <Row badge={badge(["style.letterSpacing"], "Letter Spacing")}>
            <ScrubField
              id={`${id}-tracking`} label="Letter Spacing" icon={WholeWord} unit="pt"
              value={style.letterSpacing ?? 0} min={-2} max={20} step={0.01} dragStep={0.1}
              onChange={(letterSpacing) => setStyle({ letterSpacing })}
            />
          </Row>
          {/* A display transform, not an edit: the stored text keeps its
              typed case, which is what lets the QR's {name|slug} still read
              it. Legacy masters author it one level up, hence uppercaseOf. */}
          <SwitchRow
            label="Uppercase" checked={uppercaseOf(layer)}
            badge={badge(["style.uppercase", "uppercase"], "Uppercase")}
            onChange={(uppercase) => setStyle({ uppercase })}
          />
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Heading>Stroke</Heading>
          <span className="flex items-center gap-1.5">
            <Switch
              aria-label="Outer stroke"
              checked={strokeOn}
              // Switching on starts from the useful colour for the kind: a
              // keyline for glyphs and art, the white halo a code needs to
              // scan over the texture.
              onCheckedChange={(on) =>
                setStyle({ stroke: on === true ? (isCode ? "#FFFFFF" : "#000000") : "none" })}
            />
            {badge(["style.stroke"], "Stroke")}
          </span>
        </div>
        {strokeOn && (
          <>
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <ColorField
                  id={`${id}-stroke-color`} value={style.stroke!} allowNone={false}
                  onChange={(stroke) => setStyle({ stroke })}
                />
              </div>
              {badge(["style.stroke"], "Stroke Color")}
              <MetallicToggle
                label="Stroke"
                pressed={strokeLayerOf(style) === "metallic"}
                onPressedChange={(on) => setStyle({ strokeLayer: on ? "metallic" : "white" })}
                className="size-6 border border-input"
              />
              {badge(["style.strokeLayer"], "Stroke Plate")}
            </div>
            {/* 60px cap: wider strokes swallow the letterforms long before
                the geometry breaks. */}
            <Row badge={badge(["style.strokeWidth"], "Stroke Width")}>
              <ScrubField
                id={`${id}-stroke-width`} label="Width" unit="px"
                value={style.strokeWidth ?? DEFAULT_STROKE_PX} min={1} max={60} step={1}
                onChange={(strokeWidth) => setStyle({ strokeWidth })}
              />
            </Row>
          </>
        )}
      </div>
    </div>
  );
}

export function LayerInspector(props: {
  /** The resolved layer being edited. */
  layer: Layer;
  /** Every layer's id and name, for the "Bind to layer…" picker (the layer
   *  itself is filtered out here regardless). */
  layerNames: { id: string; name: string }[];
  /** Dotted paths, relative to the layer ("x", "style.fill", "y.gap"), that
   *  a variant/label override currently wins on → a reset badge beside the
   *  control that writes that path. */
  overridden: Overridden;
  /** Every edit is one minimal partial patch; the parent decides where it
   *  lands. See the file header for the two patches that need care. */
  onChange: (patch: DeepPartial<Layer>) => void;
  onReset: (path: string, source: "variant" | "label") => void;
  /** Unbind: the parent freezes the resolved coordinates before clearing the binding. */
  onUnbind: () => void; onBind?: (to: string, side: BindingSide) => void;
  /** The kind's content editor (rich text, image drop, code value), built by
   *  the parent and rendered under the header. */
  content?: ReactNode;
  /** The master's typeface, display only. */
  fontFamily?: string;
}) {
  const { layer } = props;
  const set = (patch: Patch) => props.onChange(patch);
  const badge = (paths: readonly string[], label: string) => (
    <Badge paths={paths} overridden={props.overridden} label={label} onReset={props.onReset} />
  );
  const ctx: Ctx = { set, badge };
  // Local text so a name being retyped never commits as "" — a layer name
  // is required (parseMaster fails on an empty one).
  const [nameText, setNameText] = useState<string | null>(null);
  const Icon = KIND_ICONS[layer.kind];
  const page = layer.kind === "image" && (layer.role === "background" || layer.role === "mask");

  return (
    <div className="space-y-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          id={`${layer.id}-name`}
          aria-label="Layer name"
          className="h-7 flex-1 text-xs font-medium"
          value={nameText ?? layer.name}
          onChange={(e) => {
            const v = e.target.value;
            setNameText(v);
            if (v.trim()) set({ name: v });
          }}
          onBlur={() => setNameText(null)}
        />
      </div>
      {/* The two policy switches read as ordinary Fields (label left, control
          right) like every other row in the panel — crowded onto one line they
          looked like a toolbar, which they are not. */}
      <div className="space-y-1.5 pt-2">
        <Field id={`${layer.id}-enabled`} label="Enabled" badge={badge(["enabled"], "Enabled")}>
          <Switch id={`${layer.id}-enabled`} aria-label="Enabled" checked={layer.enabled}
            onCheckedChange={(on) => set({ enabled: on === true })} />
        </Field>
        <Field id={`${layer.id}-locked`} label="Locked" badge={badge(["locked"], "Locked")}>
          <Switch id={`${layer.id}-locked`} aria-label="Locked" checked={!!layer.locked}
            onCheckedChange={(on) => set({ locked: on === true })} />
        </Field>
      </div>

      {props.content !== undefined && (
        <div className="space-y-1.5">
          <Heading>Content</Heading>
          {props.content}
        </div>
      )}

      <Position layer={layer} layerNames={props.layerNames} onUnbind={props.onUnbind} onBind={props.onBind} {...ctx} />

      {layer.kind === "text" && <TextGeometry layer={layer} fontFamily={props.fontFamily} {...ctx} />}
      {layer.kind === "text" && <FillContract layer={layer} {...ctx} />}
      {layer.kind === "image" && <ImageGeometry layer={layer} {...ctx} />}
      {layer.kind === "barcode" && <BarcodeGeometry layer={layer} {...ctx} />}
      {/* A barcode has no `input` to hang a contract off, but its tier list is
          the same vocabulary a style has. */}
      {layer.kind === "barcode" && <Vocabulary layer={layer} {...ctx} />}
      {layer.kind === "qr" && <QrGeometry layer={layer} {...ctx} />}

      {/* The page art has no ink of its own to colour or stroke — the
          texture IS the colour and the mask IS the plate — so like the old
          Document layers it carries no Style stack. */}
      {!page && <StyleSection layer={layer} {...ctx} />}
    </div>
  );
}
