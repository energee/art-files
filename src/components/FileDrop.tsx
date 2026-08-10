// FileDrop.tsx — drag-and-drop/click file target built on react-dropzone
// (keyboard, focus, and aria handled by the library), with an image
// thumbnail on a checkerboard and inline error text.
import { useDropzone, type Accept } from "react-dropzone";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The classic light transparency checker, deliberately NOT theme-tinted: a
// dark checker made black art invisible in the dark UI. Light grey + white
// squares keep both black and white artwork visible, whatever the theme.
const CHECKER =
  "repeating-conic-gradient(#c9c9c9 0% 25%, #f2f2f2 0% 50%) 0 0 / 12px 12px";

export function FileDrop(props: {
  label: string;
  accept: Accept;
  fileName?: string;
  previewUrl?: string;
  error?: string;
  onFile: (f: File) => void;
  /** Removes the loaded file. The X only renders while a file is loaded
   *  AND a handler is given, so drops without one look as before. */
  onClear?: () => void;
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: props.accept,
    multiple: false,
    onDrop: (files) => files[0] && props.onFile(files[0]),
  });
  return (
    <div className="flex-1">
      <div
        {...getRootProps({
          className: cn(
            "flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isDragActive && "border-primary bg-accent",
          ),
        })}
      >
        {props.previewUrl ? (
          <img
            src={props.previewUrl}
            alt=""
            className="size-9 shrink-0 rounded-sm object-cover"
            style={{ background: CHECKER }}
          />
        ) : (
          <div className="size-9 shrink-0 rounded-sm" style={{ background: CHECKER }} />
        )}
        <div className="min-w-0">
          <div className="text-xs font-medium">{props.label}</div>
          <div className="truncate text-xs text-muted-foreground">
            {props.fileName ?? "drop or click"}
          </div>
        </div>
        {props.fileName && props.onClear && (
          <Button
            type="button" variant="ghost" size="icon"
            aria-label={`Remove ${props.label}`}
            title="Remove"
            // stopPropagation: the whole drop target is a click-to-browse
            // zone; the X must clear, not open the file picker.
            onClick={(e) => { e.stopPropagation(); props.onClear?.(); }}
            className="ml-auto size-5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        )}
        <input {...getInputProps()} />
      </div>
      {props.error && <p className="mt-1 text-xs text-destructive">{props.error}</p>}
    </div>
  );
}
