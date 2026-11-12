// LayerInspector.tsx — the right-hand inspector for ONE resolved v3 layer
// (spec: docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI"
// and "Relative position"). Sections, top to bottom: header (kind icon,
// inline rename (commits on Enter or blur, Escape cancels, like the Layers
// row's), Show (the list's eye), Lock (not on page art) and Remove buttons
// that act on the whole selection, close button, an off-variant note), the
// parent's content editor (no heading: its caption names it), kind-specific
// geometry/typography, Position (not on page art), Style, and expandable
// template field settings.
//
// With several layers selected (`others`) it still shows `layer`, the
// last-picked one, but only the controls the selection shares: the header
// reads "3 layers" in place of the rename box; the content editor, binding
// rows and template field settings (one layer's each) are hidden; and the
// kind section shows only when every selected layer is that kind. The parent
// sends each patch to every selected layer that has the control
// (model/multiEdit.ts). A control the layers differ on gets a mark beside it
// that sets the shown value on all of them.
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
// Those sections are memoized (#715), so this file hands them stable
// callbacks; the header and `content` here still render with every edit.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Barcode, EqualNot, Eye, EyeOff, Image, Lock, LockOpen, QrCode, Trash2, Type, XIcon, type LucideIcon,
} from "lucide-react";
import { isMixed, pickPaths, type Peer } from "@/model/multiEdit";
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
import { useStableCallback } from "@/useStableCallback";

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

/** Every section's More rows hidden: the default without view prefs. */
const COLLAPSED: Ctx["more"] = { typography: false, position: false };

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
  /** The header's Remove button: removes the layer and the rest of the
   *  selection. Absent = no button. */
  onRemove?: () => void;
  /** Shows the header's visible close button. It is a SheetClose, so it
   *  needs the parent Sheet (whose close-press clears the selection, as
   *  Escape does) and returns focus on a keyboard close like Escape. */
  showCloseButton?: boolean;
  /** The other selected layers. With any, the sheet shows only the controls
   *  the selection shares (see the file header). Absent = one layer. */
  others?: readonly Peer[];
  /** The name of the switched-OFF variant that adds this layer. Such a layer
   *  does not draw and edits to it are dropped (editLabel's patchLayers), so
   *  the header's power reads off — matching the Layers row — and turning
   *  it on enables the variant. */
  offVariant?: string;
  /** Which sections show their More rows (view prefs, useViewPrefs.ts).
   *  Absent = all collapsed. */
  more?: Ctx["more"];
  /** Toggles a section's More rows; the parent saves it. Absent = no-op. */
  onMore?: Ctx["onMore"];
}) {
  const { layer } = props;
  const { t } = useTranslation();
  // One identity each, so the sections' memo holds, while a call runs this
  // instance's latest closure. App keys the inspector by layer, so these can
  // never reach the next selection's layer, even from a late blur.
  const set = useStableCallback(props.onChange);
  const onReset = useStableCallback(props.onReset);
  const onUnbind = useStableCallback(props.onUnbind);
  const onBind = useStableCallback((to: string, side: BindingSide) => props.onBind?.(to, side));
  const onMore = useStableCallback((section: Parameters<Ctx["onMore"]>[0]) => props.onMore?.(section));
  // App builds new Sets with every edit; only new contents should reach `badge`.
  const overriddenKey = JSON.stringify([
    [...props.overridden.variant], [...props.overridden.label], props.overridden.variantName,
  ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- overriddenKey is props.overridden's contents
  const sets = useMemo(() => props.overridden, [overriddenKey]);
  // The selection as the mixed marks read it, new only when a selected
  // layer changes; null with one layer, so `badge` keeps its identity there.
  const multi = !!props.others?.length;
  const peersKey = multi ? JSON.stringify([layer, props.others]) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- peersKey is layer and props.others by value
  const peers = useMemo(() => (multi ? { layer, others: props.others! } : null), [peersKey]);
  const badge = useCallback((paths: readonly string[], label: string) => (
    <>
      {peers && isMixed(peers.layer, peers.others, paths) && (
        <MixedMark label={label} onMatch={() => set(pickPaths(peers.layer, paths))} />
      )}
      <Badge paths={paths} overridden={sets} label={label} onReset={onReset} />
    </>
  ), [sets, onReset, peers, set]);
  const overridden = useCallback((paths: readonly string[]) =>
    paths.some((p) => sets.variant.has(p) || sets.label.has(p)), [sets]);
  const ctx: Ctx = {
    set, badge, unit: props.unit ?? "pt", overridden,
    more: props.more ?? COLLAPSED, onMore,
  };
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
  const sameKind = !props.others?.some((o) => o.layer.kind !== layer.kind);
  // Page art hides Position, so a position override left on it needs its own reset.
  const stalePosition = page && STALE_POSITION.some(([paths]) => overridden(paths));

  return (
    <div className="space-y-1 px-4 py-3">
      <div className="group/reset flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {multi ? (
          // A name is one layer's: the count stands in, and names the dialog.
          <h2 id={`${layer.id}-name`} className="flex-1 truncate text-xs font-medium">
            {t("{{count}} layer", { count: props.others!.length + 1 })}
          </h2>
        ) : <Input
          // Also names the inspector dialog (App.tsx, #616).
          id={`${layer.id}-name`}
          aria-label={t("Layer name")}
          className="h-7 flex-1 text-xs font-medium"
          value={nameDraft ?? layer.name}
          data-draft={nameDraft !== null ? "" : undefined}
          aria-invalid={(nameDraft !== null && !nameDraft.trim()) || undefined}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            else if (e.key === "Escape") setNameDraft(null);
          }}
        />}
        {/* The selection's actions, with the Layers row's icons: they stay
            reachable with the sidebar hidden (⌘B). Page art has no lock — it
            can't be dragged, so locking it would do nothing. */}
        <Button variant="ghost" size="icon-sm" aria-label={t("Enabled")} aria-pressed={enabled}
          title={enabled ? t("Hide from preview and exports") : t("Show in preview and exports")}
          onClick={() => set({ enabled: !enabled })}>
          {enabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
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
        {props.onRemove && (
          <Button variant="ghost" size="icon-sm" aria-label={t("Remove layer")} title={t("Remove layer")}
            className="hover:text-destructive-text" onClick={props.onRemove}>
            <Trash2 aria-hidden="true" />
          </Button>
        )}
        {props.showCloseButton && (
          <SheetClose render={<Button variant="ghost" size="icon-sm" aria-label={t("Close inspector")} />}>
            <XIcon className="size-4.5" aria-hidden="true" />
          </SheetClose>
        )}
      </div>
      {props.offVariant !== undefined && (
        <p className="text-[11px] text-muted-foreground">
          {t("From {{variant}}. Turn on this variant to edit the layer.", { variant: props.offVariant })}
        </p>
      )}

      {props.content !== undefined && !multi && (
        // No heading: the editor's own caption (Text, Code, Link, Texture…)
        // names it.
        <div className="pt-2">{props.content}</div>
      )}

      {sameKind && layer.kind === "text" && <TextGeometry layer={layer} fontFamily={props.fontFamily} {...ctx} />}
      {sameKind && layer.kind === "image" && <ImageGeometry layer={layer} rasterArt={props.rasterArt} {...ctx} />}
      {sameKind && layer.kind === "barcode" && <BarcodeGeometry layer={layer} {...ctx} />}
      {sameKind && layer.kind === "qr" && <QrGeometry layer={layer} {...ctx} />}

      {/* Page art has no Position: the renderer stretches it over the whole
          page and ignores x/y (planLayers), so the fields would change nothing.
          A position override still left on it keeps its reset badges here. */}
      {stalePosition && (
        <div className="group/reset flex items-center justify-between gap-2 pt-2">
          <p className="text-[11px] text-muted-foreground">{t("Unused position override")}</p>
          <span className="flex items-center">
            {STALE_POSITION.map(([paths, label]) =>
              <Badge key={label} paths={paths} overridden={props.overridden} label={label} onReset={props.onReset} />)}
          </span>
        </div>
      )}
      {!page && <Position layer={layer} layerNames={props.layerNames} onUnbind={onUnbind} onBind={props.onBind && onBind} multi={multi} {...ctx} />}

      {/* Nor ink of its own to colour or stroke — the texture IS the colour
          and the mask IS the plate — so like the old Document layers it
          carries no Style stack. */}
      {!page && <StyleSection layer={layer} rasterArt={props.rasterArt} {...ctx} />}
      {/* A barcode has no `input` to hang a contract off, but its tier list is
          the same vocabulary a style has. */}
      {!multi && (layer.kind === "text" || layer.kind === "barcode") && (
        <details className="mt-7">
          <summary className="cursor-pointer rounded py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("Template field settings")}
          </summary>
          <div className="space-y-3 pt-2">
            {layer.kind === "text" ? <FillContract layer={layer} {...ctx} /> : <Vocabulary layer={layer} {...ctx} />}
          </div>
        </details>
      )}
    </div>
  );
}

/** Beside a control the selected layers differ on (model/multiEdit.ts's
 *  isMixed): a click sets the shown value on all of them. Sits in the badge
 *  slot, so every control gets it without a prop of its own. */
function MixedMark(props: { label: string; onMatch: () => void }) {
  const { t } = useTranslation();
  const title = t("Selected layers differ. Click to set {{label}} on all of them.", { label: t(props.label) });
  return (
    <button
      type="button" data-mixed="" title={title} aria-label={title} onClick={props.onMatch}
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <EqualNot aria-hidden="true" className="size-3" />
    </button>
  );
}
