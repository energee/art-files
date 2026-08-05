// LayersPanel.tsx — the Figma-style layer list that fills the left sidebar.
// Four groups: "This beer" (per-release elements), "Collab" (the lead-in and
// two partner-logo slots), "Template" (set-once brand elements), and
// "Document" (the UI-level background/mask layers from ./layers, which carry
// file drops rather than Styles). Rows select into the
// same LayerId state the preview's click-to-select uses; the eye toggle
// hides an element by writing fill: "none" and restores the shipped default
// fill on re-show. Per the layers-ui spec, rows appear in a curated order
// (Barcode before QR — unlike ELEMENTS order); every element row has an eye
// (hiding is a temporary skip, unlike the ink-less styling allowNone
// forbids), the document layers go without for now.
import {
  AlignLeft,
  Barcode,
  CaseSensitive,
  ChevronDown,
  Eye,
  EyeOff,
  Handshake,
  Hexagon,
  Image,
  ImagePlus,
  MapPin,
  Percent,
  QrCode,
  Scan,
  Snowflake,
  Beaker,
  CaseUpper,
  TriangleAlert,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { LabelConfig, StyledLine } from "@/types";
import { applyStyle, elementById, type ElementId } from "@/elements";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { DOC_LAYER_LABELS, isElementId, type LayerId } from "./layers";

/** Row order is the spec's curated stacking order, not ELEMENTS order —
 *  notably Barcode before QR in "This beer". */
const BEER_ROWS: ElementId[] = [
  "name", "styleLine", "abv", "description", "barcode", "qr",
];
const COLLAB_ROWS: ElementId[] = ["collabLead", "collabLeft", "collabCenter"];
const TEMPLATE_ROWS: ElementId[] = [
  "volume", "wordmark", "logo", "handleAddress", "warning", "storeCold",
];
const DOC_ROWS: LayerId[] = ["background", "mask"];

const ICONS: Record<LayerId, LucideIcon> = {
  name: Type,
  styleLine: CaseSensitive,
  abv: Percent,
  description: AlignLeft,
  barcode: Barcode,
  qr: QrCode,
  collabLead: Handshake,
  collabLeft: ImagePlus,
  collabCenter: ImagePlus,
  volume: Beaker,
  wordmark: CaseUpper,
  logo: Hexagon,
  handleAddress: MapPin,
  warning: TriangleAlert,
  storeCold: Snowflake,
  background: Image,
  mask: Scan,
};

/** The metal-horns icon for the metallic toggles (Ted's pick,
 *  hand-metal-stroke-rounded) — inlined since it isn't in lucide. Exported
 *  for the inspector's Ink group, which uses the same toggle. */
export function HandMetal(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
      <path d="M18.5 11.5V5.75C18.5 4.7835 19.2835 4 20.25 4C21.2165 4 22 4.7835 22 5.75V12.8806C22 14.851 22 15.8362 21.803 16.649C21.1855 19.1965 19.1965 21.1855 16.649 21.803C15.8362 22 14.851 22 12.8806 22C11.7766 22 11.2246 22 10.7086 21.9227C9.11179 21.6833 7.64679 20.8993 6.56186 19.7034C6.21132 19.317 5.90513 18.8577 5.29275 17.9391L2.32229 13.4834C2.11214 13.1682 2 12.7978 2 12.419C2 11.3592 2.85916 10.5 3.91898 10.5H4.05489C4.65476 10.5 5.22468 10.7621 5.61507 11.2176L6.69842 12.4815C7.04487 12.8857 7.2181 13.0878 7.36248 13.1291C7.57238 13.1891 7.79697 13.1061 7.91726 12.9239C8 12.7985 8 12.5324 8 12" />
      <path d="M18.5 10.5V9.75C18.5 8.7835 17.7165 8 16.75 8C15.7835 8 15 8.7835 15 9.75V10.5" />
      <path d="M15 11.5V8.75C15 7.7835 14.2165 7 13.25 7C12.2835 7 11.5 7.7835 11.5 8.75V11" />
      <path d="M11.5 10V3.75C11.5 2.7835 10.7165 2 9.75 2C8.7835 2 8 2.7835 8 3.75V12" />
    </svg>
  );
}

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
  const line = "flex items-center gap-1.5 text-[11px] text-sidebar-foreground/70";
  return (
    <div className="space-y-1">
      <div className={line}>
        <Chip color={s.fill} />
        <span>{s.fill === "none" ? "No ink" : "Fill"}</span>
        <span className="text-sidebar-foreground/40">·</span>
        <span>{s.layer}</span>
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
  hidden: ReadonlySet<ElementId>;
  onToggleHidden: (id: ElementId) => void;
  selected: LayerId | null;
  onSelect: (id: LayerId) => void;
}) {
  const Icon = ICONS[id];
  const el = isElementId(id) ? elementById(id) : null;
  const label = el ? el.label : DOC_LAYER_LABELS[id as "background" | "mask"];
  const hidden = el !== null && hiddenSet.has(el.id);
  // Collab rows are inert on the label while the collab switch is off; they
  // stay selectable so their inspector (which holds the switch) is reachable.
  const collabOff = !cfg.collabEnabled && id.startsWith("collab");

  const toggleEye = (e: React.MouseEvent) => {
    e.stopPropagation(); // the eye must never change the selection
    if (el) onToggleHidden(el.id);
  };

  // Row anatomy, left to right: eye · icon+name (the select target) ·
  // chevron. The eye and chevron are siblings of the menu button, not
  // children, so neither can change the selection. Document rows get a
  // spacer where the eye would sit, keeping the icon column aligned.
  return (
    <Collapsible>
      <SidebarMenuItem>
        <div className="flex items-center">
          {/* Every element row gets an eye — including QR/Barcode, since
              hiding is a session-level skip, not the ink-less styling
              allowNone forbids. Document rows go without, for now. */}
          {el !== null ? (
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
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <SidebarMenuButton
            size="sm"
            isActive={selected === id}
            onClick={() => onSelect(id)}
            className={cn("text-xs", (hidden || collabOff) && "opacity-50")}
          >
            <Icon />
            <span>{label}</span>
          </SidebarMenuButton>
          {/* Metallic toggle: flips the element between the metallic plate
              and plain white ink — the same write as the inspector's Layer
              select, so the two stay in lockstep. Lit while metallic. */}
          {el !== null && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      update((c) => applyStyle(c, el.id, {
                        layer: el.style(cfg).layer === "metallic" ? "white" : "metallic",
                      }));
                    }}
                    aria-label={`${label}: metallic`}
                    aria-pressed={el.style(cfg).layer === "metallic"}
                    className={cn(
                      "grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm hover:text-sidebar-foreground",
                      el.style(cfg).layer === "metallic"
                        ? "text-sidebar-foreground"
                        : "text-sidebar-foreground/70 opacity-40 hover:opacity-100",
                    )}
                  >
                    <HandMetal className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>Metallic</TooltipContent>
            </Tooltip>
          )}
          {/* Applied-styles accordion, element rows only: the document
              layers have no Style stack yet (disabled placeholders live in
              the inspector). A read-only digest — editing stays in the
              inspector. */}
          {el !== null && (
            <CollapsibleTrigger
              aria-label={`${label} styles`}
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
  hidden: ReadonlySet<ElementId>;
  onToggleHidden: (id: ElementId) => void;
  selected: LayerId | null;
  onSelect: (id: LayerId) => void;
}): React.JSX.Element {
  const groups: [string, LayerId[]][] = [
    ["This beer", BEER_ROWS],
    ["Collab", COLLAB_ROWS],
    ["Template", TEMPLATE_ROWS],
    ["Document", DOC_ROWS],
  ];
  return (
    <>
      {groups.map(([title, rows]) => (
        <SidebarGroup key={title}>
          <SidebarGroupLabel>{title}</SidebarGroupLabel>
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
