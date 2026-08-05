// LayersPanel.tsx — the Figma-style layer list that fills the left sidebar.
// Three groups: "This beer" (per-release elements), "Template" (set-once
// brand elements), and "Document" (the UI-level background/mask layers from
// ./layers, which carry file drops rather than Styles). Rows select into the
// same LayerId state the preview's click-to-select uses; the eye toggle
// hides an element by writing fill: "none" and restores the shipped default
// fill on re-show. Per the layers-ui spec, rows appear in a curated order
// (Barcode before QR — unlike ELEMENTS order), the codes get no eye at all
// (they must always carry ink, see allowNone in elements.ts), and neither do
// the document layers for now.
import {
  AlignLeft,
  Barcode,
  CaseSensitive,
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
import type { LabelConfig } from "@/types";
import { applyStyle, elementById, type ElementId } from "@/elements";
import { defaultConfig } from "@/defaults";
import { cn } from "@/lib/utils";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { DOC_LAYER_LABELS, isElementId, type LayerId } from "./layers";

type Update = (fn: (c: LabelConfig) => void) => void;

/** Row order is the spec's curated stacking order, not ELEMENTS order —
 *  notably Barcode before QR in "This beer". */
const BEER_ROWS: ElementId[] = [
  "name", "styleLine", "abv", "description", "barcode", "qr",
  "collabLead", "collabLeft", "collabCenter",
];
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

function LayerRow({
  id, cfg, update, selected, onSelect,
}: {
  id: LayerId;
  cfg: LabelConfig;
  update: Update;
  selected: LayerId | null;
  onSelect: (id: LayerId) => void;
}) {
  const Icon = ICONS[id];
  const el = isElementId(id) ? elementById(id) : null;
  const label = el ? el.label : DOC_LAYER_LABELS[id as "background" | "mask"];
  const hidden = el !== null && el.style(cfg).fill === "none";
  // Collab rows are inert on the label while the collab switch is off; they
  // stay selectable so their inspector (which holds the switch) is reachable.
  const collabOff = !cfg.collabEnabled && id.startsWith("collab");

  const toggleEye = (e: React.MouseEvent) => {
    e.stopPropagation(); // the eye must never change the selection
    if (!el) return;
    const fill = hidden
      ? elementById(el.id).style(defaultConfig()).fill // restore shipped default
      : "none";
    update((c) => applyStyle(c, el.id, { fill }));
  };

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        isActive={selected === id}
        onClick={() => onSelect(id)}
        className={cn("text-xs", (hidden || collabOff) && "opacity-50")}
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
      {el?.allowNone && (
        <SidebarMenuAction
          showOnHover={!hidden}
          onClick={toggleEye}
          aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
        >
          {hidden ? <EyeOff /> : <Eye />}
        </SidebarMenuAction>
      )}
    </SidebarMenuItem>
  );
}

export function LayersPanel(props: {
  cfg: LabelConfig;
  update: Update;
  selected: LayerId | null;
  onSelect: (id: LayerId) => void;
}): React.JSX.Element {
  const groups: [string, LayerId[]][] = [
    ["This beer", BEER_ROWS],
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
