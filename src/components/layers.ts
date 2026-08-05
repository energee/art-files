// layers.ts — the UI-level layer id space shared by LayersPanel and the
// Inspector. Extends the renderer's ElementId with two document-level layers
// (the texture and the mask) that are selectable in the UI but are not
// elements the renderer styles — they carry file drops, not Style objects.
import type { ElementId } from "@/elements";

export type LayerId = ElementId | "background" | "mask";

export const DOC_LAYER_LABELS: Record<"background" | "mask", string> = {
  background: "Background",
  mask: "Mask",
};

export function isElementId(id: LayerId): id is ElementId {
  return id !== "background" && id !== "mask";
}
