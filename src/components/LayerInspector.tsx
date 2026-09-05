// LayerInspector.tsx — the right-hand inspector for ONE resolved v3 layer
// (spec: docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI"
// and "Relative position"). Sections, top to bottom: header (kind icon,
// inline rename, enabled/locked/fillable), the parent's content editor,
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
// every layer has a position, `below` covers the flow, and fillable is a
// switch. The text/image/code content editor is the parent's (`content`),
// so this file never builds a text editor of its own.
import { useState, type ReactNode } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndVertical, AlignStartVertical, ArrowDownToLine, ArrowUpToLine,
  Barcode, Image, Link2, Link2Off, QrCode, RotateCcw, TextAlignCenter, TextAlignEnd,
  TextAlignJustify, TextAlignStart, Type, WholeWord, type LucideIcon,
} from "lucide-react";
import { bindingOf, guideOf } from "@/model/layers";
import type {
  BindingSide, BarcodeLayer, ImageLayer, Layer, LayerKind, QrLayer, Symbology, TextLayer,
} from "@/model/layers";
import type { DeepPartial } from "@/model/merge";
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

/** The override badge: a small filled dot beside a control whose dotted
 *  path a variant/label override wins on, and a reset for just that path.
 *  `paths` are checked in order and the first overridden one is what Reset
 *  restores — a bound y is written as one object but a parent's leaf-path
 *  walk may report it as "y", "y.below" or "y.gap". Same aria-label idiom as
 *  StyleProperties' OverrideBadge so the two are interchangeable to a user. */
function Badge(props: {
  paths: readonly string[];
  overridden: ReadonlySet<string>;
  label: string;
  onReset: (path: string) => void;
}) {
  const path = props.paths.find((p) => props.overridden.has(p));
  if (!path) return null;
  return (
    <button
      type="button"
      className="size-2 shrink-0 rounded-full bg-primary transition-transform hover:scale-125"
      title={`Reset ${props.label} to the master`}
      aria-label={`Reset ${props.label} to the master`}
      onClick={() => props.onReset(path)}
    />
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
] as const;

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
      <Row badge={badge(["leading"], "Leading")}>
        <ScrubField
          id={`${id}-leading`} label="Leading" unit="×" value={layer.leading ?? 1.2}
          min={0.5} max={4} step={0.01} dragStep={0.05}
          onChange={(leading) => set({ leading })}
        />
      </Row>
      <Row badge={badge(["headerScale"], "Header scale")}>
        <ScrubField
          id={`${id}-header-scale`} label="Header scale" unit="×" value={layer.headerScale ?? 1}
          min={0.5} max={4} step={0.01} dragStep={0.05}
          onChange={(headerScale) => set({ headerScale })}
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
      <SwitchRow
        label="Uppercase" checked={!!layer.uppercase}
        badge={badge(["uppercase"], "Uppercase")}
        onChange={(uppercase) => set({ uppercase })}
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
      {warning && <p className="text-[11px] text-destructive">{warning}</p>}
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
          {/* Clamped both ends by ScrubField: tracking wide enough to overrun
              the label reads as a broken line, not a style. */}
          <Row badge={badge(["style.letterSpacing"], "Letter Spacing")}>
            <ScrubField
              id={`${id}-tracking`} label="Letter Spacing" icon={WholeWord} unit="pt"
              value={style.letterSpacing ?? 0} min={-2} max={20} step={0.01} dragStep={0.1}
              onChange={(letterSpacing) => setStyle({ letterSpacing })}
            />
          </Row>
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
  overridden: Set<string>;
  /** Every edit is one minimal partial patch; the parent decides where it
   *  lands. See the file header for the two patches that need care. */
  onChange: (patch: DeepPartial<Layer>) => void;
  onReset: (path: string) => void;
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
    <div className="space-y-1 p-3">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          id={`${layer.id}-name`}
          aria-label="Layer name"
          className="h-6 flex-1 text-xs font-medium"
          value={nameText ?? layer.name}
          onChange={(e) => {
            const v = e.target.value;
            setNameText(v);
            if (v.trim()) set({ name: v });
          }}
          onBlur={() => setNameText(null)}
        />
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch aria-label="Enabled" checked={layer.enabled}
            onCheckedChange={(on) => set({ enabled: on === true })} />
          Enabled
          {badge(["enabled"], "Enabled")}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch aria-label="Locked" checked={!!layer.locked}
            onCheckedChange={(on) => set({ locked: on === true })} />
          Locked
          {badge(["locked"], "Locked")}
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch aria-label="Fillable" checked={!!layer.fillable}
            onCheckedChange={(on) => set({ fillable: on === true })} />
          Fillable
          {badge(["fillable"], "Fillable")}
        </label>
      </div>

      {props.content !== undefined && (
        <div className="space-y-1.5">
          <Heading>Content</Heading>
          {props.content}
        </div>
      )}

      <Position layer={layer} layerNames={props.layerNames} onUnbind={props.onUnbind} onBind={props.onBind} {...ctx} />

      {layer.kind === "text" && <TextGeometry layer={layer} fontFamily={props.fontFamily} {...ctx} />}
      {layer.kind === "image" && <ImageGeometry layer={layer} {...ctx} />}
      {layer.kind === "barcode" && <BarcodeGeometry layer={layer} {...ctx} />}
      {layer.kind === "qr" && <QrGeometry layer={layer} {...ctx} />}

      {/* The page art has no ink of its own to colour or stroke — the
          texture IS the colour and the mask IS the plate — so like the old
          Document layers it carries no Style stack. */}
      {!page && <StyleSection layer={layer} {...ctx} />}
    </div>
  );
}
