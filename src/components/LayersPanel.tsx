// LayersPanel.tsx — the Figma-style layer list that fills the left sidebar.
// Four groups (from ./layers' PANEL_GROUPS): "Beer" (per-release elements), "Collab" (the lead-in and
// two partner-logo slots), "Template" (set-once brand elements), and
// "Document" (the UI-level background/mask layers from ./layers, which carry
// file drops rather than Styles). Rows select into the
// same LayerId selection the preview's click-to-select uses — multi-select,
// so a row reports the modifier keys and App resolves them (see
// selection.ts); the eye toggles the
// id in App's session-level hidden set (Assets.hidden — the renderer skips
// the element outright). Rows appear in ELEMENTS order, which carries the
// layers-ui spec's stacking (Barcode before QR); every element row has
// an eye (hiding is a temporary skip, unlike the ink-less styling allowNone
// forbids), the document layers go without for now.
import { ChevronDown, Eye, EyeOff, Info } from "lucide-react";
import type { LabelConfig, StyledLine } from "@/types";
import { applyStyle, elementById, type ElementId } from "@/elements";
import { cn } from "@/lib/utils";
import { MetallicToggle } from "./MetallicToggle";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  COLLAB_GROUP_TITLE, DOC_LAYER_LABELS, GROUP_INFO, LAYER_ICONS, PANEL_GROUPS,
  isElementId, isHideable, type HideableLayerId, type LayerId,
} from "./layers";
import { modsOf, type SelectMods } from "@/selection";

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
function StyleSummary({ id, cfg }: { id: ElementId; cfg: LabelConfig }) {
  const el = elementById(id);
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

function LayerRow({
  id, cfg, update, hidden: hiddenSet, onToggleHidden, selected, onSelect,
}: {
  id: LayerId;
  cfg: LabelConfig;
  update: (fn: (c: LabelConfig) => void) => void;
  hidden: ReadonlySet<HideableLayerId>;
  onToggleHidden: (id: HideableLayerId) => void;
  selected: readonly LayerId[];
  onSelect: (id: LayerId, mods: SelectMods) => void;
}) {
  const Icon = LAYER_ICONS[id];
  const el = isElementId(id) ? elementById(id) : null;
  const label = el ? el.label : DOC_LAYER_LABELS[id as keyof typeof DOC_LAYER_LABELS];
  const hideable = isHideable(id);
  const hidden = hideable && hiddenSet.has(id);
  // Collab rows are inert on the label while the collab switch (on the
  // group header above) is off; they stay selectable and editable.
  const collabOff = !cfg.collabEnabled && el?.group === "collab";

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
          )}
        >
          {/* Every hideable row gets an eye — including QR/Barcode (hiding
              is a session-level skip, not the ink-less styling allowNone
              forbids) and the texture/mask rows (hiding drops the asset
              from the build). Only Settings goes without. */}
          {hideable ? (
            <button
              type="button"
              onClick={toggleEye}
              aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
              className={cn(
                "grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70 hover:text-sidebar-foreground [&>svg]:size-3.5",
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
            className={cn(
              "text-xs hover:bg-transparent focus-visible:ring-0",
              (hidden || collabOff) && "opacity-50",
            )}
          >
            <Icon />
            <span>{label}</span>
          </SidebarMenuButton>
          {/* Shared metallic toggle — the same write as the inspector's Ink
              group, so the two stay in lockstep. Lit while metallic. */}
          {el !== null && (
            <span className="contents" onClick={stop}>
              <MetallicToggle
                label={label}
                pressed={el.style(cfg).layer === "metallic"}
                onPressedChange={(on) =>
                  update((c) => applyStyle(c, el.id, { layer: on ? "metallic" : "white" }))}
              />
            </span>
          )}
          {/* Applied-styles accordion, element rows only — the document
              layers have no styles. A read-only digest; editing stays in
              the inspector. */}
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
              <StyleSummary id={el.id} cfg={cfg} />
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
}): React.JSX.Element {
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
      {PANEL_GROUPS.map(([title, rows]) => (
        <SidebarGroup key={title}>
          <SidebarGroupLabel className="justify-between">
            <span className="flex items-center gap-1.5">
              {title}
              {/* The one place the collab block turns on/off — on the group
                  header beside its name, not repeated per layer. Turning it
                  off keeps the uploaded art and slot styles; flipping it
                  back restores the label exactly as it was. */}
              {title === COLLAB_GROUP_TITLE && (
                <Switch
                  aria-label="Collab enabled"
                  checked={props.cfg.collabEnabled}
                  onCheckedChange={(on) =>
                    props.update((c) => { c.collabEnabled = on; })}
                />
              )}
            </span>
            {/* What the group is FOR, one line behind an info icon — the
                registry comments in elements.ts, surfaced. */}
            {GROUP_INFO[title] && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Info
                      className="size-3 text-sidebar-foreground/50"
                      aria-label={`About ${title}`}
                    />
                  }
                />
                <TooltipContent className="max-w-56">{GROUP_INFO[title]}</TooltipContent>
              </Tooltip>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {rows.map((id) => (
                <LayerRow key={id} id={id} {...props} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
