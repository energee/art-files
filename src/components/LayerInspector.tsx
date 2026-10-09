// LayerInspector.tsx — the right-hand inspector for ONE resolved v3 layer
// (spec: docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI"
// and "Relative position"). Sections, top to bottom: header (kind icon,
// inline rename, enabled/locked), the parent's content editor,
// kind-specific geometry/typography, Position, Style, and expandable
// template field settings.
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
//
// The sections live in sibling files by family (#433): shared controls, unit
// conversion and the override Badge in LayerInspectorControls.tsx; Position,
// per-kind geometry and Style in LayerInspectorSections.tsx; the template
// field settings (fill contract, vocabulary) in LayerInspectorTemplate.tsx.
import type { ReactNode } from "react";
import { Barcode, Image, QrCode, Type, type LucideIcon } from "lucide-react";
import type { BindingSide, Layer, LayerKind } from "@/model/layers";
import type { OverrideBadges as Overridden } from "@/model/edit";
import type { DeepPartial } from "@/model/merge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Badge, Field, Heading, useRequiredText, type Ctx, type DimensionUnit, type Patch,
} from "./LayerInspectorControls";
import {
  BarcodeGeometry, ImageGeometry, Position, QrGeometry, StyleSection, TextGeometry,
} from "./LayerInspectorSections";
import { FillContract, Vocabulary } from "./LayerInspectorTemplate";

/** One icon per kind — the same four the Layers list rows use, so the
 *  header and the row never disagree about what a kind looks like. */
const KIND_ICONS: Record<LayerKind, LucideIcon> = {
  text: Type, image: Image, barcode: Barcode, qr: QrCode,
};

export function LayerInspector(props: {
  unit?: DimensionUnit;
  onUnitChange?: (unit: DimensionUnit) => void;
  /** The resolved layer being edited. */
  layer: Layer;
  /** Every layer's id and name, for the "Bind to layer…" picker (the layer
   *  itself is filtered out here regardless). */
  layerNames: { id: string; name: string }[];
  /** Dotted paths, relative to the layer ("x", "style.fill", "binding"), that
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
  const ctx: Ctx = { set, badge, unit: props.unit ?? "pt" };
  // A layer name is required (parseMaster fails on an empty one), so it is
  // typed through the same guard as a choice's value.
  const nameProps = useRequiredText(layer.name, (v) => set({ name: v }));
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
          {...nameProps}
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

      {props.onUnitChange && <Field label="Dimensions">
        <ToggleGroup aria-label="Dimension units" variant="outline" size="sm" spacing={0}
          value={[ctx.unit]} onValueChange={(values) => {
            const unit = values[0];
            if (unit === "mm" || unit === "pt") props.onUnitChange?.(unit);
          }}>
          <ToggleGroupItem value="mm" aria-label="Millimeters" className="h-6 px-2 text-xs">mm</ToggleGroupItem>
          <ToggleGroupItem value="pt" aria-label="Points" className="h-6 px-2 text-xs">pt</ToggleGroupItem>
        </ToggleGroup>
      </Field>}

      {props.content !== undefined && (
        <div className="space-y-1.5">
          <Heading>Content</Heading>
          {props.content}
        </div>
      )}

      {layer.kind === "text" && <TextGeometry layer={layer} fontFamily={props.fontFamily} {...ctx} />}
      {layer.kind === "image" && <ImageGeometry layer={layer} {...ctx} />}
      {layer.kind === "barcode" && <BarcodeGeometry layer={layer} {...ctx} />}
      {/* A barcode has no `input` to hang a contract off, but its tier list is
          the same vocabulary a style has. */}
      {layer.kind === "qr" && <QrGeometry layer={layer} {...ctx} />}

      {/* The page art has no ink of its own to colour or stroke — the
          texture IS the colour and the mask IS the plate — so like the old
          Document layers it carries no Style stack. */}
      <Position layer={layer} layerNames={props.layerNames} onUnbind={props.onUnbind} onBind={props.onBind} {...ctx} />

      {!page && <StyleSection layer={layer} {...ctx} />}
      {(layer.kind === "text" || layer.kind === "barcode") && (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer rounded py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Template field settings
          </summary>
          <div className="space-y-3 pt-2">
            {layer.kind === "text" ? <FillContract layer={layer} {...ctx} /> : <>
              <p className="text-xs text-muted-foreground">Set the field label and saved choices in the master.</p>
              <Vocabulary layer={layer} {...ctx} />
            </>}
          </div>
        </details>
      )}
    </div>
  );
}
