// FileDrop.tsx — react-dropzone drag target with a named Browse action,
// checkerboard thumbnail and inline error text. Its X clears at once,
// with an Undo action or document-undo hint in the emptied well (#426).
import { useRef, useState } from "react";
import { useDropzone, type Accept } from "react-dropzone";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortcutLabel } from "@/keys";
import { cn } from "@/lib/utils";

// The classic light transparency checker, deliberately NOT theme-tinted: a
// dark checker made black art invisible in the dark UI. Light grey + white
// squares keep both black and white artwork visible, whatever the theme.
const CHECKER =
  "repeating-conic-gradient(#c9c9c9 0% 25%, #f2f2f2 0% 50%) 0 0 / 12px 12px";

/** Marks a field drop target. AssetDropOverlay's window listener yields to
 *  any element carrying it — shared so a rename can't break the yield rule. */
export const FILE_DROP_ATTR = "data-file-drop";

export function FileDrop(props: {
  label: string;
  accept: Accept;
  fileName?: string;
  previewUrl?: string;
  onFile: (f: File) => void;
  /** Removes the loaded file. The X only renders while a file is loaded
   *  AND a handler is given, so drops without one look as before. Return an
   *  undo when the clear is NOT in the document history (the texture and
   *  mask slots): the well offers it as an Undo button. Return nothing when
   *  it is, and the note names ⌘Z instead. */
  onClear?: () => (() => void) | void;
}) {
  // The rejection belongs to the file shown when it happened: once another
  // file loads (by the window overlay, Open, or Remove) it no longer applies.
  const [rejection, setRejection] = useState<{ text: string; shown?: string } | null>(null);
  /** The file the X just removed, and the caller's undo if it gave one.
   *  Shown only while the well stays empty: a drop, an Open or an undo that
   *  fills it makes the note moot. */
  const [cleared, setCleared] = useState<{ name: string; undo?: () => void } | null>(null);
  // A file loading AFTER the clear retires the note for good, so a later
  // empty well (an Open without this asset) never revives a stale name and
  // undo. Keyed on the file name changing, not on it being set: the X's own
  // render still shows the old file until the caller's clear lands. State
  // adjusted during render, React's pattern for resetting on a prop change.
  const [shown, setShown] = useState(props.fileName);
  if (shown !== props.fileName) {
    setShown(props.fileName);
    if (props.fileName) setCleared(null);
  }
  /** Set by the X when it offers an Undo: the X unmounts with the file, so
   *  focus moves to the Undo once it mounts instead of falling to <body>. */
  const focusUndo = useRef(false);
  const browseRef = useRef<HTMLButtonElement>(null);
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: props.accept,
    multiple: false,
    noClick: true,
    noKeyboard: true,
    onDrop: (files, rejected) => {
      if (rejected.length) {
        setRejection({
          shown: props.fileName,
          text: rejected.some((f) => f.errors.some((e) => e.code === "too-many-files"))
            ? "Drop one file."
            : `Choose ${Object.values(props.accept).flat().join(" or ")} for ${props.label}.`,
        });
        return;
      }
      setRejection(null);
      if (files[0]) props.onFile(files[0]);
    },
  });
  return (
    <div className="flex-1">
      <div
        {...getRootProps({
          // AssetDropOverlay's window listener yields to marked field targets,
          // so a PNG aimed here is not diverted into its window-wide chooser.
          [FILE_DROP_ATTR]: "",
          className: cn(
            "flex items-center gap-2 rounded-md border border-dashed border-border p-2 transition-colors",
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
            {props.fileName ?? "drop or browse"}
          </div>
        </div>
        <Button
          ref={browseRef}
          data-file-drop-browse
          type="button"
          variant="outline"
          size="xs"
          aria-label={`Browse ${props.label}`}
          onClick={open}
          className="ml-auto shrink-0"
        >
          Browse
        </Button>
        {props.fileName && props.onClear && (
          <Button
            type="button" variant="ghost" size="icon"
            aria-label={`Remove ${props.label}`}
            title="Remove"
            onClick={() => {
              const undo = props.onClear?.() ?? undefined;
              setCleared({ name: props.fileName!, undo });
              // The X goes with the file: keep keyboard focus on Browse.
              if (undo) focusUndo.current = true;
              else browseRef.current?.focus();
            }}
            className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        )}
        <input {...getInputProps({ "aria-label": `Choose ${props.label} file` })} />
      </div>
      {/* Always mounted: a live region announces text added to it, not one
          inserted with its text. */}
      <div role="status">
        {cleared && !props.fileName && (
          <p className="mt-1 text-xs text-muted-foreground">
            Removed {cleared.name}.{" "}
            {cleared.undo ? (
              <Button type="button" size="xs" variant="link" className="h-auto p-0 text-xs"
                ref={(el) => { if (el && focusUndo.current) { focusUndo.current = false; el.focus(); } }}
                onClick={() => {
                  // This button goes with the note: hand focus back to Browse.
                  browseRef.current?.focus();
                  setCleared(null); cleared.undo!();
                }}>
                Undo
              </Button>
            ) : `${shortcutLabel("⌘Z")} brings it back.`}
          </p>
        )}
      </div>
      {rejection && rejection.shown === props.fileName && (
        <p role="alert" className="mt-1 text-xs text-destructive-text">{rejection.text}</p>
      )}
    </div>
  );
}
