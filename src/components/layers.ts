// layers.ts — the UI-level layer id space shared by LayersPanel and the
// Inspector. Extends the renderer's ElementId with document-level layers
// (the texture, the mask, and the document Settings) that are selectable in
// the UI but are not elements the renderer styles — they carry file drops
// or document knobs, not Style objects.
import {
  AlignLeft, Barcode, Beaker, CaseSensitive, CaseUpper, Handshake, Hexagon,
  Image, ImagePlus, MapPin, Percent, QrCode, Scan, Snowflake, TriangleAlert,
  Settings2, Type, type LucideIcon,
} from "lucide-react";
import { ELEMENTS, type ElementId } from "@/elements";

export type LayerId = ElementId | "background" | "mask" | "settings";

/** The document layers that aren't renderer elements. */
export type DocLayerId = "background" | "mask" | "settings";

/** The one per-layer icon map — the layers panel's rows and the inspector's
 *  header both read it, so the header always shows "this row, expanded". */
export const LAYER_ICONS: Record<LayerId, LucideIcon> = {
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
  settings: Settings2,
};

export const DOC_LAYER_LABELS: Record<DocLayerId, string> = {
  background: "Background",
  mask: "Mask",
  settings: "Settings",
};

export function isElementId(id: LayerId): id is ElementId {
  return !(id in DOC_LAYER_LABELS);
}

/** Layers the panel's eye can hide: every renderer element plus the texture
 *  and mask (hiding those drops the asset from the build). Settings is the
 *  one row with nothing on the label to hide. */
export type HideableLayerId = ElementId | "background" | "mask";

export function isHideable(id: LayerId): id is HideableLayerId {
  return id !== "settings";
}

/** Every group derives both its membership and its order from the registry,
 *  so a regrouped, reordered or added element can't silently vanish from the
 *  panel or drift out of the spec's stacking order. */
const rowsOf = (group: "beer" | "template" | "collab"): LayerId[] =>
  ELEMENTS.filter((e) => e.group === group).map((e) => e.id);

/** The panel's groups, top to bottom. Lives here rather than in LayersPanel
 *  because the row ORDER is also what a shift-click range is resolved
 *  against (see PANEL_ORDER) — the panel and the selection rules have to read
 *  one list, or a range would select rows the user didn't drag over. */
export const PANEL_GROUPS: [string, LayerId[]][] = [
  // The texture and mask ride along in "Beer": they change per release like
  // the beer elements do, and they carry eyes now — only Settings stays
  // under "Document".
  ["Beer", [...rowsOf("beer"), "background", "mask"]],
  ["Collab", rowsOf("collab")],
  ["Template", rowsOf("template")],
  ["Document", ["settings"]],
];

/** Every row, flattened in panel order — the sequence a shift-range walks,
 *  so a range crosses group boundaries exactly as the visible list does. */
export const PANEL_ORDER: LayerId[] = PANEL_GROUPS.flatMap(([, rows]) => rows);
