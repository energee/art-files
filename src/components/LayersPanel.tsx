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
import { elementById, type ElementId } from "@/elements";
import { cn } from "@/lib/utils";
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

/** Tiny color chip for the style summary; "none" renders as a hatch-free
 *  outline so "no ink" is visibly different from black. */
function Chip({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 shrink-0 rounded-[3px] border border-sidebar-border align-middle"
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
        <span>{s.fill === "none" ? "No ink" : s.fill}</span>
        <span className="text-sidebar-foreground/40">·</span>
        <span>{s.layer}</span>
      </div>
      {strokeOn && (
        <div className={line}>
          <Chip color={s.stroke!} />
          <span>Stroke {s.stroke}</span>
          {s.strokeWidth !== undefined && <span>{s.strokeWidth}px</span>}
        </div>
      )}
      {tracking !== 0 && <div className={line}>Tracking {tracking}pt</div>}
      {bold && <div className={line}>Bold</div>}
    </div>
  );
}

function LayerRow({
  id, cfg, hidden: hiddenSet, onToggleHidden, selected, onSelect,
}: {
  id: LayerId;
  cfg: LabelConfig;
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
