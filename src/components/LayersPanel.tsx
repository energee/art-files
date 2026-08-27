// LayersPanel.tsx — the Figma-style layer list that fills the left sidebar.
// One "Layers" group, flat, in the master's draw order (see model/panel.ts's
// panelRows — App computes the rows and hands them down as `props.rows`):
// every master layer, a variant-owned one badged with its variant's name and
// dimmed while that variant is off, and any per-label custom layers appended
// at the end. A separate "Document" group holds the UI-level background/mask/
// settings layers (from ./layers, which carry file drops or document knobs
// rather than Styles) — unchanged. Rows select into the same LayerId
// selection the preview's click-to-select uses — multi-select, so a row
// reports the modifier keys and App resolves them (see selection.ts); the
// eye toggles the id in App's session-level hidden set (Assets.hidden — the
// renderer skips the element outright) and is NEVER recorded — unlike a
// master row's name, ENABLE and lock, which are master POLICY and go through
// `onLayerEdit` (App's layerEdit → applyLayerEdit) at the current editing
// target. The eye and the enable control are deliberately different things
// and sit in different columns: the eye hides a layer for this session only,
// the power button is the master's own on/off and stops the layer drawing on
// every label built from that master. Every element row has an eye (hiding
// is a temporary skip, unlike the ink-less styling allowNone forbids); the
// document layers go without for now, except Settings which has neither eye
// nor asset to hide.
import {
  Barcode, ChevronDown, ChevronUp, Eye, EyeOff, Image, Lock, Plus, Power, QrCode, Type,
} from "lucide-react";
import { useState } from "react";
import type { LabelConfig, StyledLine } from "@/types";
import type { MasterLayer } from "@/model/types";
import {
  applyStyle, customElement, elementById, type LabelElement,
} from "@/elements";
import type { PanelRow } from "@/model/panel";
import { cn } from "@/lib/utils";
import { MetallicToggle } from "./MetallicToggle";
import { strokeLayerOf } from "@/strokes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DOC_LAYER_LABELS, DOC_LAYERS, LAYER_ICONS,
  isElementId, isHideable, type HideableLayerId, type LayerId,
} from "./layers";
import { modsOf, type SelectMods } from "@/selection";

/** "Add layer" menu icon per custom layer type — the layers panel's rows
 *  share the fixed elements' icons (Type for every text row), so these are
 *  chosen from the same set: Barcode/QrCode from LAYER_ICONS' own choices,
 *  Type for text, Image for image. */
const ADD_LAYER_TYPES: { type: "text" | "image" | "barcode" | "qr"; label: string; Icon: typeof Type }[] = [
  { type: "text", label: "Text", Icon: Type },
  { type: "image", label: "Image", Icon: Image },
  { type: "barcode", label: "Barcode", Icon: Barcode },
  { type: "qr", label: "QR", Icon: QrCode },
];

/** Tiny color chip for the style summary; "none" renders as a hatch-free
 *  outline so "no ink" is visibly different from black. The border is a
 *  translucent foreground, not the theme border: the chip is the only
 *  signal of the color now (no hex text), and a near-black swatch on the
 *  dark panel would otherwise vanish. */
function Chip({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 shrink-0 rounded-[3px] border border-sidebar-foreground/40 align-middle"
      style={color === "none" ? undefined : { backgroundColor: color }}
    />
  );
}

/** One-line-per-property digest of what's applied to an element: fill+plate
 *  always, stroke/tracking/bold only while they're actually in effect.
 *  Read-only — editing lives in the inspector; this is the at-a-glance view
 *  behind the row's chevron. */
function StyleSummary({ el, cfg }: { el: LabelElement; cfg: LabelConfig }) {
  const s = el.style(cfg);
  const bold = el.hasBold && ((s as StyledLine).bold ?? false);
  const strokeOn = !!s.stroke && s.stroke !== "none";
  const tracking = s.letterSpacing ?? 0;
  // /85, not /70: at 11px this is the densest text in the app, and dimming
  // it further put it under the panel's own contrast floor.
  const line = "flex items-center gap-1.5 text-[11px] text-sidebar-foreground/85";
  return (
    <div className="space-y-1">
      <div className={line}>
        <Chip color={s.fill} />
        <span>{s.fill === "none" ? "No ink" : "Fill"}</span>
        <span className="text-sidebar-foreground/40">·</span>
        <span className="capitalize">{s.layer}</span>
      </div>
      {strokeOn && (
        <div className={line}>
          <Chip color={s.stroke!} />
          <span>Stroke</span>
          {s.strokeWidth !== undefined && (
            <>
              <span className="text-sidebar-foreground/40">·</span>
              <span>{s.strokeWidth}px</span>
            </>
          )}
          <span className="text-sidebar-foreground/40">·</span>
          <span className="capitalize">{strokeLayerOf(s)}</span>
        </div>
      )}
      {tracking !== 0 && (
        <div className={line}>
          <span>Letter Spacing</span>
          <span className="text-sidebar-foreground/40">·</span>
          <span>{tracking}pt</span>
        </div>
      )}
      {bold && <div className={line}>Bold</div>}
    </div>
  );
}

/** A row this panel can draw: either one of `panelRows`' rows (a master or
 *  custom layer, name/badge/inactive already resolved) or a bare document
 *  layer id (Background/Mask/Settings — no panel-row equivalent, so the
 *  Document group builds one inline with a plain lookup name and never
 *  inactive/badged). */
type Row = Pick<PanelRow, "id" | "name">
  & Partial<Pick<PanelRow, "variantName" | "inactive" | "locked" | "enabled" | "materialized">>;

function LayerRow({
  row, cfg, update, hidden: hiddenSet, onToggleHidden, selected, onSelect,
  mode, reorder, onLayerEdit, onMaterializedLayerEdit,
}: {
  row: Row;
  cfg: LabelConfig;
  update: (fn: (c: LabelConfig) => void) => void;
  hidden: ReadonlySet<HideableLayerId>;
  onToggleHidden: (id: HideableLayerId) => void;
  selected: readonly LayerId[];
  onSelect: (id: LayerId, mods: SelectMods) => void;
  /** Design/Fill — reorder chevrons are Design-only, custom rows only. */
  mode: "design" | "fill";
  /** Layer POLICY writes at the current editing target (App's layerEdit →
   *  applyLayerEdit). Present only for a MASTER row in Design mode: a custom
   *  layer's policy lives in `cfg.customLayers` and keeps going through
   *  `update`, and the Document rows have no master layer at all. Absent
   *  means read-only policy — the lock shows as a badge and the name can't
   *  be renamed, which is what Fill mode and the panel's own tests get. */
  onLayerEdit?: (layerId: string, patch: Partial<MasterLayer>) => void;
  /** A MATERIALIZED custom row's policy write (fix round 1: Lock) — App's
   *  materializedLayerEdit → applyMaterializedLayerEdit, id-search based
   *  rather than editing-target based (see that function's doc comment).
   *  Given only alongside `onLayerEdit` (both come from the same Design-mode
   *  gate); a LEGACY custom row (`row.materialized === false`) never uses
   *  this — its lock keeps going through `update`, same as before this
   *  fix. */
  onMaterializedLayerEdit?: (layerId: string, patch: Partial<MasterLayer>) => void;
  /** Front/back position within the custom-layer stack, present only for a
   *  custom row (undefined for master and Document rows, which get no
   *  reorder control at all). */
  reorder?: { atFront: boolean; atBack: boolean; onMove: (delta: -1 | 1) => void };
}) {
  const id = row.id as LayerId;
  const customLayer = cfg.customLayers?.find((l) => l.id === id);
  // Every text layer (fixed or custom) shares the one Type icon; a custom
  // image/barcode/QR layer borrows its matching fixed row's icon rather than
  // adding a second icon table custom rows would have to stay in sync with.
  const Icon = customLayer
    ? customLayer.type === "image" ? LAYER_ICONS.collabLeft
      : customLayer.type === "barcode" ? LAYER_ICONS.barcode
      : customLayer.type === "qr" ? LAYER_ICONS.qr
      : LAYER_ICONS.name
    // Fallback for an id LAYER_ICONS has no entry for — reachable now that a
    // variant can append a Variant.layers row whose id is neither a built-in
    // LayerId nor a `custom-*` layer; rendering `<undefined />` throws, so
    // this can't silently fall through to that.
    : (LAYER_ICONS[id as Exclude<LayerId, `custom-${string}`>] ?? Type);
  const el = isElementId(id)
    ? (customLayer ? customElement(cfg, id as `custom-${string}`) : elementById(id)) : null;
  // The row's own name, not elementById's — a renamed layer (a custom row,
  // or a future master edit) shows what the user or the master call it.
  const label = row.name;
  const hideable = isHideable(id);
  const hidden = hideable && hiddenSet.has(id);
  // The layer does not draw right now — master-disabled, or its owning
  // variant is off. Distinct from `hidden` (a session-level eye toggle):
  // this comes from the master/variant resolution, not the user.
  const inactive = !!row.inactive;
  // The layer's own master-level enable (PanelRow.enabled). Absent on a
  // Document row, which has no master layer behind it — those are always on.
  const enabled = row.enabled ?? true;

  const toggleEye = (e: React.MouseEvent) => {
    stop(e); // the eye must never change the selection
    if (isHideable(id)) onToggleHidden(id);
  };

  // Row anatomy, left to right: eye · icon+name · metallic · chevron. The
  // whole row is the select target (see the wrapper's onClick): it is
  // highlighted end to end, so every part of it has to behave as one thing —
  // a click landing on the gap beside the name, or a ⇧-click that misses the
  // name button by a few px, must still extend the selection rather than do
  // nothing. The three controls each stop propagation, so hiding, restyling
  // or expanding a row still never changes the selection. Document rows have
  // no eye and no spacer — their icons sit flush left, which reads better
  // than a phantom column under controls they don't have.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const isSelected = selected.includes(id);
  // Inline rename, master rows only: double-click the name for an input,
  // Enter/blur commits through onLayerEdit, Esc cancels. A layer's name is
  // master POLICY (MasterLayer.name), not label content — which is exactly
  // why it can't ride `update` the way the metallic toggle does.
  const [renaming, setRenaming] = useState(false);
  const commitRename = (value: string) => {
    const name = value.trim();
    if (name && name !== label) onLayerEdit?.(row.id, { name });
    setRenaming(false);
  };
  return (
    <Collapsible>
      <SidebarMenuItem>
        {/* The highlight sits on the whole row, not just the name button, so
            a selected layer reads as one bar across the eye, the metallic
            toggle and the chevron rather than a lozenge floating between
            them. The button keeps data-active (its own background matches,
            so the two never show a seam). */}
        <div
          onClick={(e) => onSelect(id, modsOf(e))}
          className={cn(
            // Paired with the name button's hover:bg-transparent below: hover
            // lights the whole bar, so a row never shows a half-width
            // highlight under the cursor.
            "flex cursor-pointer items-center rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            isSelected && "bg-sidebar-accent text-sidebar-accent-foreground",
            // A row that isn't drawing right now (master-disabled, or its
            // variant is off) reads as dimmed end to end — not just its name
            // button — so it's clearly "not on this label" at a glance.
            inactive && "opacity-50",
          )}
        >
          {/* Every hideable row gets an eye — including QR/Barcode (hiding
              is a session-level skip, not the ink-less styling allowNone
              forbids) and the texture/mask rows (hiding drops the asset
              from the build). Only Settings goes without. Disabled while
              inactive: there is nothing on the label to hide. */}
          {hideable ? (
            <button
              type="button"
              onClick={toggleEye}
              disabled={inactive}
              aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
              className={cn(
                "grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70 hover:text-sidebar-foreground [&>svg]:size-3.5 disabled:cursor-not-allowed disabled:hover:text-sidebar-foreground/70",
                !hidden && "opacity-40 hover:opacity-100",
              )}
            >
              {hidden ? <EyeOff /> : <Eye />}
            </button>
          ) : null}
          <SidebarMenuButton
            size="sm"
            isActive={isSelected}
            // No onClick of its own: the click bubbles to the row wrapper,
            // which is the one select target. Keyboard still works — Enter
            // on this button fires a click that bubbles the same way — and
            // the button stays the row's focusable, named control.
            // The row wrapper owns the hover and selected backgrounds; the
            // button's own would cover its width only. No focus ring at all
            // (ring-0): asked for deliberately — the selected background is
            // the only state this panel shows, and the ring read as an
            // outline appearing on rows the user hadn't picked. Trade-off:
            // tabbing through the rows is now invisible.
            className={cn("text-xs hover:bg-transparent focus-visible:ring-0", hidden && "opacity-50")}
          >
            <Icon />
            {renaming ? (
              <input
                autoFocus
                defaultValue={label}
                aria-label={`Rename ${label}`}
                onClick={stop}
                onBlur={(e) => commitRename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(e.currentTarget.value);
                  else if (e.key === "Escape") setRenaming(false);
                  // The panel's own shortcuts must not see a typed name.
                  e.stopPropagation();
                }}
                className="min-w-0 flex-1 rounded-sm border border-sidebar-border bg-transparent px-1 text-xs outline-none"
              />
            ) : (
              <span onDoubleClick={() => onLayerEdit && setRenaming(true)}>{label}</span>
            )}
            {/* A variant-owned row's badge — small and muted, after the
                name, so a Collab (or future variant) row still reads as
                itself first. */}
            {row.variantName && (
              <span className="text-[10px] text-sidebar-foreground/50">{row.variantName}</span>
            )}
          </SidebarMenuButton>
          {/* Shared metallic toggle — the same write as the inspector's Ink
              group, so the two stay in lockstep. Lit while metallic;
              disabled while inactive, same reasoning as the eye above. */}
          {el !== null && (
            <span className="contents" onClick={stop}>
              <MetallicToggle
                label={label}
                pressed={el.style(cfg).layer === "metallic"}
                disabled={inactive}
                onPressedChange={(on) =>
                  update((c) => applyStyle(c, el.id, { layer: on ? "metallic" : "white" }))}
              />
            </span>
          )}
          {/* Applied-styles accordion, element rows only — the document
              layers have no styles. A read-only digest; editing stays in
              the inspector. */}
          {/* Master-level enable, master rows only (spec: "each layer
              disable-able"). NOT the eye two columns left: the eye hides a
              layer in THIS session and is never recorded, while this is the
              master's own on/off — disable it here and the layer stops
              drawing on every label built from this master, saved with it.
              Hence the power icon rather than a second eye, and the
              "on every label" wording in both the label and the tooltip. */}
          {!customLayer && onLayerEdit && (
            <button
              type="button"
              onClick={(e) => { stop(e); onLayerEdit(row.id, { enabled: !enabled }); }}
              aria-label={enabled ? `Disable ${label} on every label` : `Enable ${label} on every label`}
              aria-pressed={!enabled}
              title={enabled
                ? `Disable ${label} on every label built from this master (the eye only hides it here)`
                : `Enable ${label} on every label built from this master`}
              className={cn(
                "grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70 hover:text-sidebar-foreground [&>svg]:size-3",
                enabled && "opacity-40 hover:opacity-100",
              )}
            >
              <Power />
            </button>
          )}
          {/* Lock. THREE cases, in order:
              1. A LEGACY custom row (`custom` but not `materialized`) — its
                 identity lives purely in `cfg.customLayers`, a per-label
                 fact, so `locked` stays a direct `update` write into its own
                 cfg entry, same as before Task 5b's fix round 1.
              2. A MATERIALIZED custom row, or a MASTER row — both now carry
                 real MasterLayer policy (Task 5b: `addLayer` gives a
                 materialized row a `layers` entry exactly like a built-in
                 one), so both route through the SAME idiom: interactive
                 while the matching callback is given (Design mode), a
                 read-only badge without it. Materialized rows use
                 onMaterializedLayerEdit (id-search based — see its own doc
                 comment on why not onLayerEdit); master rows use onLayerEdit
                 (editing-target based, unchanged).
              3. Neither callback, but still locked: the read-only badge
                 (Fill mode, or the panel's own tests).
              Lit while locked, same idiom as the eye. (The logo/collab
              slots' own lock still lives in the inspector's StackNudge/
              CollabSlotContent, not the row.) */}
          {customLayer && !row.materialized ? (
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                update((c) => {
                  const l = c.customLayers?.find((x) => x.id === id);
                  if (l) l.locked = !l.locked;
                });
              }}
              aria-label={customLayer.locked ? `Unlock ${label}` : `Lock ${label}`}
              aria-pressed={!!customLayer.locked}
              className={cn(
                "grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70 hover:text-sidebar-foreground [&>svg]:size-3",
                !customLayer.locked && "opacity-40 hover:opacity-100",
              )}
            >
              <Lock />
            </button>
          ) : (customLayer && row.materialized ? onMaterializedLayerEdit : onLayerEdit) ? (
            // A master row, or a materialized custom row, in Design mode:
            // lock is editable now, recorded on the master (or the editing/
            // owning variant) rather than in the config — same idiom as the
            // legacy custom toggle above, different destination.
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                (customLayer && row.materialized ? onMaterializedLayerEdit! : onLayerEdit!)(
                  row.id, { locked: !row.locked });
              }}
              aria-label={row.locked ? `Unlock ${label}` : `Lock ${label}`}
              aria-pressed={!!row.locked}
              className={cn(
                "grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70 hover:text-sidebar-foreground [&>svg]:size-3",
                !row.locked && "opacity-40 hover:opacity-100",
              )}
            >
              <Lock />
            </button>
          ) : row.locked ? (
            <span
              aria-label={`${label} is locked`}
              className="grid size-5 shrink-0 place-items-center text-sidebar-foreground/70 [&>svg]:size-3"
            >
              <Lock />
            </span>
          ) : null}
          {/* Front/back reorder, custom rows only, Design mode only — master
              rows have no control here: their draw order is fixed in
              planLabel, so offering one would be a lie. */}
          {customLayer && mode === "design" && reorder && (
            <span className="flex shrink-0 items-center" onClick={stop}>
              <button
                type="button"
                onClick={() => reorder.onMove(-1)}
                disabled={reorder.atBack}
                aria-label={`Send ${label} backward`}
                className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70 opacity-40 hover:text-sidebar-foreground hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 [&>svg]:size-3"
              >
                <ChevronDown />
              </button>
              <button
                type="button"
                onClick={() => reorder.onMove(1)}
                disabled={reorder.atFront}
                aria-label={`Bring ${label} forward`}
                className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70 opacity-40 hover:text-sidebar-foreground hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 [&>svg]:size-3"
              >
                <ChevronUp />
              </button>
            </span>
          )}
          {el !== null && (
            <CollapsibleTrigger
              aria-label={`${label} styles`}
              onClick={stop}
              className="group/styles grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]/styles:rotate-180" />
            </CollapsibleTrigger>
          )}
        </div>
        {el !== null && (
          <CollapsibleContent>
            <div className="ml-[1.4rem] border-l border-sidebar-border py-1.5 pl-3 pr-1">
              <StyleSummary el={el} cfg={cfg} />
            </div>
          </CollapsibleContent>
        )}
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function LayersPanel(props: {
  cfg: LabelConfig;
  /** Config writes for the per-row metallic toggle. */
  update: (fn: (c: LabelConfig) => void) => void;
  /** Session-level hidden set — lives in App and flows into Assets.hidden. */
  hidden: ReadonlySet<HideableLayerId>;
  onToggleHidden: (id: HideableLayerId) => void;
  /** Every selected layer, in click order — see selection.ts. */
  selected: readonly LayerId[];
  onSelect: (id: LayerId, mods: SelectMods) => void;
  /** Design/Fill — the "Add layer" menu is Design-only (spec: UI); App only
   *  mounts this panel in Design mode already, so this gate is belt-and-
   *  suspenders against the panel ever being reused in Fill. */
  mode: "design" | "fill";
  onAddLayer: (type: "text" | "image" | "barcode" | "qr") => void;
  /** Front/back reorder within `cfg.customLayers` — App's moveCustomLayer,
   *  one undoable splice. Custom rows only; master draw order is fixed. */
  onMoveCustomLayer: (id: string, delta: -1 | 1) => void;
  /** Layer POLICY writes (rename / enable / lock) at the current editing
   *  target — App's layerEdit → applyLayerEdit, recorded on the master or the
   *  editing variant, NOT in the config. Design-only; omitted, master rows'
   *  policy is read-only. The eye is deliberately not routed here: hiding is
   *  session-only and never recorded (see this file's header). */
  onLayerEdit?: (layerId: string, patch: Partial<MasterLayer>) => void;
  /** A MATERIALIZED custom row's policy write (fix round 1: Lock) — App's
   *  materializedLayerEdit → applyMaterializedLayerEdit, id-search based, NOT
   *  editing-target based like onLayerEdit above (see LayerRow's own doc
   *  comment on this prop for why the two can't share one path). A LEGACY
   *  custom row (no MasterLayer backing it) never uses this. */
  onMaterializedLayerEdit?: (layerId: string, patch: Partial<MasterLayer>) => void;
  /** The master's layers flat, in draw order, then any custom layers — see
   *  model/panel.ts's panelRows. App computes this against the live master/
   *  variants/config so the panel never has to re-derive it. */
  rows: PanelRow[];
}): React.JSX.Element {
  const rowProps = {
    cfg: props.cfg, update: props.update, hidden: props.hidden,
    onToggleHidden: props.onToggleHidden, selected: props.selected, onSelect: props.onSelect,
    mode: props.mode,
  };
  // Position within the custom-layer stack alone (not the whole rows list) —
  // reorder is scoped to custom rows, so "at the end" must mean the last
  // custom row, not the last row overall.
  const customIds = props.rows.filter((r) => r.custom).map((r) => r.id);
  const reorderFor = (row: PanelRow) => {
    if (!row.custom) return undefined;
    const i = customIds.indexOf(row.id);
    return {
      atBack: i <= 0,
      atFront: i === customIds.length - 1,
      onMove: (delta: -1 | 1) => props.onMoveCustomLayer(row.id, delta),
    };
  };
  return (
    <>
      {/* The two modifier gestures, said once at the top of the list — but
          only once something is selected: they are only actionable from an
          existing selection (a range needs an anchor), and an empty panel's
          first job is the layer names, not a shortcut legend. */}
      {props.selected.length > 0 && (
        <p className="px-2 pt-2 text-center text-[11px] text-sidebar-foreground/50">
          ⇧ click for a range · ⌘ click to add
        </p>
      )}
      {/* One flat group, in the master's draw order — no more Beer/Collab/
          Template split. A variant-owned row carries its badge and dims
          itself (see LayerRow); custom layers ride along at the end, in
          stored order (panelRows' contract), so "Add layer" belongs on
          THIS group's header now rather than a separate "Custom" one. */}
      <SidebarGroup>
        <SidebarGroupLabel className="justify-between">
          <span>Layers</span>
          {props.mode === "design" && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="Add layer"
                    className="flex items-center gap-0.5 rounded-sm px-1 text-[11px] text-sidebar-foreground/70 hover:text-sidebar-foreground"
                  >
                    <Plus className="size-3" /> Add layer
                  </button>
                }
              />
              <DropdownMenuContent align="end">
                {ADD_LAYER_TYPES.map(({ type, label, Icon }) => (
                  <DropdownMenuItem key={type} onClick={() => props.onAddLayer(type)}>
                    <Icon className="size-3.5" /> {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {props.rows.map((row) => (
              // onLayerEdit for master rows only (row.custom === false). A
              // custom row still reads its display data off `cfg.customLayers`
              // — that's unchanged, and correct: resolve() materializes a
              // MATERIALIZED layer's MasterLayer styling back into that same
              // array (model/resolve.ts), so the row's icon/style-summary
              // logic never had to know the difference. But `row.materialized`
              // (Task 5b fix round 1) DOES split custom rows' policy writes in
              // two: a materialized row (`custom` AND `materialized` —
              // Design mode's "Add layer" put a real MasterLayer entry into
              // `master.layers` or a variant's own `layers`) gets
              // onMaterializedLayerEdit, LayerRow's id-search-based
              // counterpart to onLayerEdit (App's materializedLayerEdit →
              // applyMaterializedLayerEdit — NOT onLayerEdit itself, whose
              // editing-target-based `applyLayerEdit` can silently drop a
              // policy write for a layer owned by a variant that isn't
              // currently selected, or one that lives in a variant's own
              // `layers` rather than `master.layers` at all — see that
              // function's doc comment). A LEGACY custom row (per-label only,
              // no MasterLayer backing it — e.g. a pre-Task-5b .label file's
              // own `customLayers`) gets neither: its policy stays a
              // `update` write into `cfg.customLayers[i]`, exactly as before
              // this task existed. Add layer and reorder (onAddLayer/
              // onMoveCustomLayer above) always land on master.layers proper
              // regardless of this split — only an EXISTING legacy row's own
              // policy still goes the old way.
              <LayerRow key={row.id} row={row} {...rowProps} reorder={reorderFor(row)}
                onLayerEdit={row.custom ? undefined : props.onLayerEdit}
                onMaterializedLayerEdit={props.onMaterializedLayerEdit} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {/* The UI-level document layers — background/mask/settings — carry
          file drops and document knobs rather than a renderer Style, so they
          stay their own group rather than folding into Layers above. */}
      <SidebarGroup>
        <SidebarGroupLabel>Document</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {DOC_LAYERS.map((id) => (
              <LayerRow key={id} row={{ id, name: DOC_LAYER_LABELS[id] }} {...rowProps} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
