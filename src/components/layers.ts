// layers.ts — the UI-level layer id space shared by LayersPanel and the
// Inspector. Extends the renderer's ElementId with document-level layers
// (the texture, the mask, and the document Settings) that are selectable in
// the UI but are not elements the renderer styles — they carry file drops
// or document knobs, not Style objects.
import {
  Barcode, Handshake, Hexagon, Image, ImagePlus, QrCode, Scan,
  Settings, Type, type LucideIcon,
} from "lucide-react";
import type { ElementId } from "@/elements";

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
  settings: Settings,
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

/** The document layers, in display order — the Document group's fixed row
 *  list now that Beer/Collab/Template are gone (the panel's other rows come
 *  from the master, see model/panel.ts's panelRows). */
export const DOC_LAYERS: DocLayerId[] = Object.keys(DOC_LAYER_LABELS) as DocLayerId[];
