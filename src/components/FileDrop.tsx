// FileDrop.tsx — drag-and-drop/click file target built on react-dropzone
// (keyboard, focus, and aria handled by the library), with an image
// thumbnail on a checkerboard and inline error text.
import { useDropzone, type Accept } from "react-dropzone";
import { cn } from "@/lib/utils";

const CHECKER =
  "repeating-conic-gradient(#2a2c31 0% 25%, #1a1c1f 0% 50%) 0 0 / 12px 12px";

export function FileDrop(props: {
  label: string;
  accept: Accept;
  fileName?: string;
  previewUrl?: string;
  error?: string;
  onFile: (f: File) => void;
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
        <input {...getInputProps()} />
      </div>
      {props.error && <p className="mt-1 text-xs text-destructive">{props.error}</p>}
    </div>
  );
}
