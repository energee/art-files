// AssetDropOverlay.tsx — window-wide drop target for the two document-level
// images (background texture, metallic mask), so neither one requires
// selecting its layer and opening the inspector first.
//
// It only arms itself while a PNG/JPEG is actually being dragged over the
// window, which keeps the inspector's own FileDrop targets (notably the
// collab SVG slots) reachable the rest of the time.
import * as React from "react";
import { cn } from "@/lib/utils";

/** MIME types the overlay claims. JPEG is texture-only — the mask must be a
 *  PNG — so a JPEG dropped on the mask half still lands on the texture. */
const CLAIMED_TYPES = ["image/png", "image/jpeg"];

function draggedTypes(dt: DataTransfer | null): string[] {
  return dt ? Array.from(dt.items, (i) => i.type) : [];
}

export function AssetDropOverlay(props: {
  onTexture: (f: File) => void;
  onMask: (f: File) => void;
}) {
  const [active, setActive] = React.useState(false);
  const [over, setOver] = React.useState<"texture" | "mask" | null>(null);

  React.useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (draggedTypes(e.dataTransfer).some((t) => CLAIMED_TYPES.includes(t)))
        setActive(true);
    };
    // Without preventDefault on dragover the browser refuses the drop and
    // navigates to the file instead.
    const onDragOver = (e: DragEvent) => {
      if (active) e.preventDefault();
    };
    // relatedTarget is null only when the pointer leaves the window itself,
    // not when it crosses between elements inside it.
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setActive(false);
    };
    const onDropAnywhere = (e: DragEvent) => {
      if (active) e.preventDefault();
      setActive(false);
      setOver(null);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDropAnywhere);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDropAnywhere);
    };
  }, [active]);

  if (!active) return null;

  const half = (kind: "texture" | "mask", label: string, hint: string) => (
    <div
      onDragEnter={() => setOver(kind)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setActive(false);
        setOver(null);
        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (kind === "mask" && file.type === "image/png") props.onMask(file);
        else props.onTexture(file);
      }}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border transition-colors",
        over === kind && "border-primary bg-accent",
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex gap-3 bg-background/85 p-6 backdrop-blur-sm">
      {half("texture", "Background texture", "PNG or JPG")}
      {half("mask", "Metallic mask", "PNG only")}
    </div>
  );
}
