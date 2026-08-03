// FileDrop.tsx — drag-and-drop/click file target with image thumbnail and
// inline error. Thumbnails sit on a checkerboard so mask alpha is visible.
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CHECKER =
  "repeating-conic-gradient(#2a2c31 0% 25%, #1a1c1f 0% 50%) 0 0 / 12px 12px";

export function FileDrop(props: {
  label: string;
  accept: string;
  fileName?: string;
  previewUrl?: string;
  error?: string;
  onFile: (f: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="flex-1">
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) props.onFile(f);
        }}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-2 transition-colors",
          over && "border-primary bg-accent",
        )}
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
        <input
          ref={input}
          type="file"
          accept={props.accept}
          hidden
          onChange={(e) => e.target.files?.[0] && props.onFile(e.target.files[0])}
        />
      </div>
      {props.error && <p className="mt-1 text-xs text-destructive">{props.error}</p>}
    </div>
  );
}
