// layers.ts — the UI-level layer id space shared by LayersPanel and the
// Inspector. Extends the renderer's ElementId with document-level layers
// (the texture, the mask, and the document Settings) that are selectable in
// the UI but are not elements the renderer styles — they carry file drops
// or document knobs, not Style objects.
import {
  Barcode, Handshake, Hexagon, Image, ImagePlus, QrCode, Scan,
  Settings2, Type, type LucideIcon,
} from "lucide-react";
import { ELEMENTS, type ElementId } from "@/elements";

export type LayerId = ElementId | "background" | "mask" | "settings";

/** The document layers that aren't renderer elements. */
export type DocLayerId = "background" | "mask" | "settings";

/** The one per-layer icon map — the layers panel's rows and the inspector's
 *  header both read it, so the header always shows "this row, expanded". */
// Every text layer shares the one Type ("T") icon — what a row is made of,
// not what it says; the per-layer name already tells them apart.
export const LAYER_ICONS: Record<LayerId, LucideIcon> = {
  name: Type,
  styleLine: Type,
  abv: Type,
  description: Type,
  barcode: Barcode,
  qr: QrCode,
  collabLead: Handshake,
  collabLeft: ImagePlus,
  collabCenter: ImagePlus,
  volume: Type,
  wordmark: Type,
  logo: Hexagon,
  handleAddress: Type,
  warning: Type,
  storeCold: Type,
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
 *  one row with nothing on the label to hide — Exclude, so the type and the
 *  guard below say the same thing by construction. */
export type HideableLayerId = Exclude<LayerId, "settings">;

export function isHideable(id: LayerId): id is HideableLayerId {
  return id !== "settings";
}

const DOC_LAYERS = Object.keys(DOC_LAYER_LABELS) as DocLayerId[];

/** Every group derives both its membership and its order from the registry,
 *  so a regrouped, reordered or added element can't silently vanish from the
 *  panel or drift out of the spec's stacking order. */
const rowsOf = (group: "beer" | "template" | "collab"): LayerId[] =>
  ELEMENTS.filter((e) => e.group === group).map((e) => e.id);

/** The panel's groups, top to bottom. Lives here rather than in LayersPanel
 *  because the row ORDER is also what a shift-click range is resolved
 *  against (see PANEL_ORDER) — the panel and the selection rules have to read
 *  one list, or a range would select rows the user didn't drag over. */
/** The Collab group's display title — a named constant because behavior
 *  hangs off it (LayersPanel puts the collab on/off switch on this group's
 *  header): renaming the group is one edit, not a silently broken match. */
export const COLLAB_GROUP_TITLE = "Collab";

/** One-line purpose per group, shown behind the header's info icon. Keyed by
 *  the display title PANEL_GROUPS uses; a group without an entry (Document)
 *  gets no icon. */
export const GROUP_INFO: Record<string, string> = {
  Beer: "Changes with every release: the beer's name, style, numbers and copy.",
  [COLLAB_GROUP_TITLE]:
    "Partner-brewery block, shown only while the switch is on. Art and styles are kept when it's off.",
  Template: "Set-once brand elements shared by every label.",
};

export const PANEL_GROUPS: [string, LayerId[]][] = [
  // The hideable doc layers (texture, mask) ride along in "Beer": they
  // change per release like the beer elements do, and they carry eyes now —
  // only the unhideable Settings stays under "Document". Still derived from
  // DOC_LAYER_LABELS, so a new doc layer appears without a second edit.
  ["Beer", [...rowsOf("beer"), ...DOC_LAYERS.filter(isHideable)]],
  [COLLAB_GROUP_TITLE, rowsOf("collab")],
  ["Template", rowsOf("template")],
  ["Document", DOC_LAYERS.filter((d) => !isHideable(d))],
];

/** Every row, flattened in panel order — the sequence a shift-range walks,
 *  so a range crosses group boundaries exactly as the visible list does. */
export const PANEL_ORDER: LayerId[] = PANEL_GROUPS.flatMap(([, rows]) => rows);
