// LayerInspector.tsx — the right-hand inspector for ONE resolved v3 layer
// (spec: docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI"
// and "Relative position"). Sections, top to bottom: header (kind icon,
// inline rename (commits on Enter or blur, Escape cancels, like the Layers
// row's), power and lock icon toggles (no lock on page art), close
// button, a "editing one of N" note on a multi-selection, an off-variant
// note), the parent's content editor (no heading: its caption names it),
// kind-specific geometry/typography, Position (not on page art), Style, and
// expandable template field settings.
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
import { useState, type ReactNode } from "react";
import {
  Barcode, Image, Lock, LockOpen, Power, PowerOff, QrCode, Type, XIcon, type LucideIcon,
} from "lucide-react";
import type { BindingSide, Layer, LayerKind } from "@/model/layers";
import type { OverrideBadges as Overridden } from "@/model/edit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetClose } from "@/components/ui/sheet";
import {
  Badge, type Ctx, type Patch,
} from "./LayerInspectorControls";
import type { LengthUnit } from "@/rulers";
import {
  BarcodeGeometry, ImageGeometry, Position, QrGeometry, StyleSection, TextGeometry,
} from "./LayerInspectorSections";
import { FillContract, Vocabulary } from "./LayerInspectorTemplate";
import { useTranslation } from "@/i18n";

/** One icon per kind — the same four the Layers list rows use, so the
 *  header and the row never disagree about what a kind looks like. */
const KIND_ICONS: Record<LayerKind, LucideIcon> = {
  text: Type, image: Image, barcode: Barcode, qr: QrCode,
};

/** Position's badge path groups, for page art that hides Position but may
 *  still carry an override from before (see `stalePosition`). */
const STALE_POSITION = [
  [["x"], "X"], [["y"], "Y"], [["guideX", "anchor"], "Horizontal guide"],
  [["guideY", "vAnchor"], "Vertical guide"], [["binding"], "Binding"],
] as const;

export function LayerInspector(props: {
  /** The app's length unit (rulers.ts) for X, Y, gap, width, height, wrap
   *  width, module width and QR size; set from the ruler corner or View →
   *  Units, never here. Absent = points. */
  unit?: LengthUnit;
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
  onChange: (patch: Patch) => void;
  onReset: (path: string, source: "variant" | "label") => void;
  /** Unbind: the parent freezes the resolved coordinates before clearing the binding. */
  onUnbind: () => void; onBind?: (to: string, side: BindingSide) => void;
  /** The kind's content editor (rich text, image drop, code value), built by
   *  the parent and rendered under the header. */
  content?: ReactNode;
  /** The master's typeface, display only. */
  fontFamily?: string;
  /** An image layer holding raster art (PNG/JPEG): it always prints on
   *  white ink, so Style offers no plate toggle, and only raster art offers
   *  Tint raster (an SVG already takes the fill). */
  rasterArt?: boolean;
  /** Shows the header's visible close button. It is a SheetClose, so it
   *  needs the parent Sheet (whose close-press clears the selection, as
   *  Escape does) and returns focus on a keyboard close like Escape. */
  showCloseButton?: boolean;
  /** How many layers are selected. Above one, the header says only this
   *  layer is edited — drag, reorder and delete act on all of them. */
  selectionCount?: number;
  /** The name of the switched-OFF variant that adds this layer. Such a layer
   *  does not draw and edits to it are dropped (editLabel's patchLayers), so
   *  the header's power reads off — matching the Layers row — and turning
   *  it on enables the variant. */
  offVariant?: string;
}) {
  const { layer } = props;
  const { t } = useTranslation();
  const set = props.onChange;
  const badge = (paths: readonly string[], label: string) => (
    <Badge paths={paths} overridden={props.overridden} label={label} onReset={props.onReset} />
  );
  const ctx: Ctx = { set, badge, unit: props.unit ?? "pt" };
  // The name box commits like the Layers row's rename (LayerList's
  // commitRename): on Enter or blur, trimmed, and only when non-empty and
  // changed — one patch, so one undo step. Escape puts the name back. A name
  // is required (parseMaster fails on an empty one), so an emptied box is
  // flagged and leaving it restores the name.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const commitName = () => {
    const next = nameDraft?.trim();
    if (next && next !== layer.name) set({ name: next });
    setNameDraft(null);
  };
  const Icon = KIND_ICONS[layer.kind];
  const page = layer.kind === "image" && (layer.role === "background" || layer.role === "mask");
  const enabled = layer.enabled && props.offVariant === undefined;
  const multi = (props.selectionCount ?? 1) > 1;
  // Page art hides Position, so a position override left on it needs its own reset.
  const stalePosition = page && STALE_POSITION.some(([paths]) =>
    paths.some((p) => props.overridden.variant.has(p) || props.overridden.label.has(p)));

  return (
    <div className="space-y-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          id={`${layer.id}-name`}
          aria-label={t("Layer name")}
          aria-describedby={multi ? `${layer.id}-selection-note` : undefined}
          className="h-7 flex-1 text-xs font-medium"
          value={nameDraft ?? layer.name}
          aria-invalid={(nameDraft !== null && !nameDraft.trim()) || undefined}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            else if (e.key === "Escape") setNameDraft(null);
          }}
        />
        {/* Power and lock as icon toggles, the Layers row's icons: they stay
            reachable with the sidebar hidden (⌘B). Page art has no lock — it
            can't be dragged, so locking it would do nothing. */}
        <Button variant="ghost" size="icon-sm" aria-label={t("Enabled")} aria-pressed={enabled}
          title={enabled ? t("Turn off this layer") : t("Turn on this layer")}
          onClick={() => set({ enabled: !enabled })}>
          {enabled ? <Power aria-hidden="true" /> : <PowerOff aria-hidden="true" />}
        </Button>
        {badge(["enabled"], "Enabled")}
        {!page && <>
          {/* The lock is canvas-only (editGestures): typed X/Y still move it. */}
          <Button variant="ghost" size="icon-sm" aria-label={t("Locked")} aria-pressed={!!layer.locked}
            title={t("Locked on canvas: drag, resize and nudge are off. Typed values still apply.")} onClick={() => set({ locked: !layer.locked })}>
            {layer.locked ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
          </Button>
          {badge(["locked"], "Locked")}
        </>}
        {props.showCloseButton && (
          <SheetClose render={<Button variant="ghost" size="icon-sm" aria-label={t("Close inspector")} />}>
            <XIcon className="size-4.5" aria-hidden="true" />
          </SheetClose>
        )}
      </div>
      {/* Not focusable: the Sheet keeps focus off the panel so Backspace and
          the arrows still delete and nudge the whole selection. */}
      {multi && (
        <p id={`${layer.id}-selection-note`} className="text-[11px] text-muted-foreground">
          {t("Editing {{name}} only ({{count}} selected)", { name: layer.name, count: props.selectionCount })}
        </p>
      )}
      {props.offVariant !== undefined && (
        <p className="text-[11px] text-muted-foreground">
          {t("From {{variant}}. Turn on this variant to edit the layer.", { variant: props.offVariant })}
        </p>
      )}

      {props.content !== undefined && (
        // No heading: the editor's own caption (Text, Code, Link, Texture…)
        // names it.
        <div className="pt-2">{props.content}</div>
      )}

      {layer.kind === "text" && <TextGeometry layer={layer} fontFamily={props.fontFamily} {...ctx} />}
      {layer.kind === "image" && <ImageGeometry layer={layer} rasterArt={props.rasterArt} {...ctx} />}
      {layer.kind === "barcode" && <BarcodeGeometry layer={layer} {...ctx} />}
      {/* A barcode has no `input` to hang a contract off, but its tier list is
          the same vocabulary a style has. */}
      {layer.kind === "qr" && <QrGeometry layer={layer} {...ctx} />}

      {/* Page art has no Position: the renderer stretches it over the whole
          page and ignores x/y (planLayers), so the fields would change nothing.
          A position override still left on it keeps its reset badges here. */}
      {stalePosition && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <p className="text-[11px] text-muted-foreground">{t("Unused position override")}</p>
          <span className="flex items-center">
            {STALE_POSITION.map(([paths, label]) =>
              <Badge key={label} paths={paths} overridden={props.overridden} label={label} onReset={props.onReset} />)}
          </span>
        </div>
      )}
      {!page && <Position layer={layer} layerNames={props.layerNames} onUnbind={props.onUnbind} onBind={props.onBind} {...ctx} />}

      {/* Nor ink of its own to colour or stroke — the texture IS the colour
          and the mask IS the plate — so like the old Document layers it
          carries no Style stack. */}
      {!page && <StyleSection layer={layer} rasterArt={props.rasterArt} {...ctx} />}
      {(layer.kind === "text" || layer.kind === "barcode") && (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer rounded py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("Template field settings")}
          </summary>
          <div className="space-y-3 pt-2">
            {layer.kind === "text" ? <FillContract layer={layer} {...ctx} /> : <>
              <p className="text-xs text-muted-foreground">{t("Set the field label and saved choices in the master.")}</p>
              <Vocabulary layer={layer} {...ctx} />
            </>}
          </div>
        </details>
      )}
    </div>
  );
}
