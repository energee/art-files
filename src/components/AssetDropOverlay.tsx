// AssetDropOverlay.tsx — window-wide drop target for the two document-level
// images (background texture, metallic mask), so neither one requires
// selecting its layer and opening the inspector first.
//
// It only arms itself while a PNG/JPEG is actually being dragged over the
// window. The overlay is visual-only and the window listener yields to a
// marked FileDrop, so the inspector's own targets remain reachable mid-drag.
import * as React from "react";
import { cn } from "@/lib/utils";
import { FILE_DROP_ATTR } from "@/components/FileDrop";

/** MIME types the overlay claims. JPEG and WebP are texture-only — the mask
 *  must be a PNG — so either one dropped on the mask half still lands on the
 *  texture. */
const CLAIMED_TYPES = ["image/png", "image/jpeg", "image/webp"];

type DropKind = "texture" | "mask";

function draggedTypes(dt: DataTransfer | null): string[] {
  return dt ? Array.from(dt.items, (i) => i.type) : [];
}

/** The global chooser's routing rule, pure so both MIME and extension
 *  fallbacks are pinned without manufacturing DOM drag events in tests. */
export function globalAssetKind(
  file: Pick<File, "name" | "type">, clientX: number, viewportWidth: number,
): DropKind | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const png = type === "image/png" || name.endsWith(".png");
  const jpeg = type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg");
  const webp = type === "image/webp" || name.endsWith(".webp");
  if (!png && !jpeg && !webp) return null;
  // Only a PNG can be a mask, so only a PNG reads the drop's side.
  return png && clientX >= viewportWidth / 2 ? "mask" : "texture";
}

/** FileDrop marks its root with this attribute. Drag events bubble to window,
 *  but a field owns the drop whenever it is the pointer's actual target. */
function isFieldDrop(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`[${FILE_DROP_ATTR}]`);
}

export function AssetDropOverlay(props: {
  onTexture: (f: File) => void;
  onMask: (f: File) => void;
}) {
  const [active, setActive] = React.useState(false);
  const [over, setOver] = React.useState<DropKind | null>(null);
  const handlersRef = React.useRef(props);
  handlersRef.current = props;

  React.useEffect(() => {
    const hide = () => {
      setActive(false);
      setOver(null);
    };
    // Without preventDefault on dragover the browser refuses the drop and
    // navigates to the file instead. A field does this for itself, so yielding
    // here preserves react-dropzone's accept/reject behavior. dragover fires
    // as soon as the pointer enters the window and continuously after, so it
    // alone arms the overlay — no dragenter listener needed.
    const onDragOver = (e: DragEvent) => {
      if (isFieldDrop(e.target)) return hide();
      const type = draggedTypes(e.dataTransfer).find((t) => CLAIMED_TYPES.includes(t));
      if (!type) return;
      e.preventDefault();
      setActive(true);
      // Same routing rule as the drop itself, so the highlighted half always
      // matches where the file will land (no name mid-drag; type suffices).
      setOver(globalAssetKind({ name: "", type }, e.clientX, window.innerWidth));
    };
    // relatedTarget is null only when the pointer leaves the window itself,
    // not when it crosses between elements inside it.
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) hide();
    };
    const onDropAnywhere = (e: DragEvent) => {
      const field = isFieldDrop(e.target);
      const file = e.dataTransfer?.files[0];
      const kind = file ? globalAssetKind(file, e.clientX, window.innerWidth) : null;
      hide();
      if (field || !file || !kind) return;
      e.preventDefault();
      if (kind === "mask") handlersRef.current.onMask(file);
      else handlersRef.current.onTexture(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDropAnywhere);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDropAnywhere);
    };
  }, []);

  if (!active) return null;

  const half = (kind: DropKind, label: string, hint: string) => (
    <div
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
    <div aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 flex gap-3 bg-background/85 p-6 backdrop-blur-sm">
      {half("texture", "Background texture", "PNG or JPG")}
      {half("mask", "Metallic mask", "PNG only")}
    </div>
  );
}
