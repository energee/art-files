// layers.ts — the UI-level layer id space shared by LayersPanel and the
// Inspector. Extends the renderer's ElementId with two document-level layers
// (the texture and the mask) that are selectable in the UI but are not
// elements the renderer styles — they carry file drops, not Style objects.
import {
  AlignLeft, Barcode, Beaker, CaseSensitive, CaseUpper, Handshake, Hexagon,
  Image, ImagePlus, MapPin, Percent, QrCode, Scan, Snowflake, TriangleAlert,
  Type, type LucideIcon,
} from "lucide-react";
import type { ElementId } from "@/elements";

export type LayerId = ElementId | "background" | "mask";

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
};

export const DOC_LAYER_LABELS: Record<"background" | "mask", string> = {
  background: "Background",
  mask: "Mask",
};

export function isElementId(id: LayerId): id is ElementId {
  return id !== "background" && id !== "mask";
}
