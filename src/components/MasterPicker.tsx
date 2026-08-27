// MasterPicker.tsx — the head of the Design sidebar, above EditingTarget:
// the current master's name, a dropdown listing every master this machine
// knows (the library index — masters.ts), "Open Master…", and "Duplicate as
// new master…" (spec: the preset bar becomes the master picker). Picking
// another library master previews the rebind (model/rebind.ts) — the counts
// of what would move to the bench — before committing: the one confirmation
// the spec's no-dialogs rule permits, because a rebind is not a single
// undoable canvas act (Task 4b brief). "Duplicate as new master…" needs no
// preview: a clone starts out field-for-field identical to what it was
// cloned from, so nothing is ever benched by it.
import { useState } from "react";
import { ChevronDown, Copy, FolderOpen } from "lucide-react";
import { rebind } from "@/model/rebind";
import type { LabelFileV2, Master } from "@/model/types";
import { cn } from "@/lib/utils";

/** One dropdown row — just enough to render and pick. The full Master is
 *  resolved lazily (see `resolve`), only once something is actually picked,
 *  so opening the menu never has to read every file the library index
 *  knows about. */
export type LibraryEntry = { name: string };

export function MasterPicker(props: {
  /** The master currently bound to this document. */
  master: Master;
  /** The document's current values/enabled-variants/dormant, expressed as a
   *  label — what the preview's rebind runs against. Same shape App builds
   *  for its own commit (labelSnapshot in App.tsx). */
  label: LabelFileV2;
  /** Library listing: every master this machine knows about, id -> name
   *  (masters.ts's masterIndex() plus the shipped master). */
  library: Record<string, LibraryEntry>;
  /** Resolves a library id to its Master (masters.ts's resolveMasterById) —
   *  async, since a library master may live on disk. Null means it could not
   *  be read (moved, deleted, or corrupt). */
  resolve: (id: string) => Promise<Master | null>;
  /** Commits a rebind onto `target` — called ONLY after the inline preview's
   *  "Continue" is pressed. The caller re-runs rebind itself against its own
   *  live document snapshot (App.tsx's commitRebind), so this never trusts a
   *  rebind result computed against a possibly-stale `label` prop. */
  onMaster: (target: Master) => void;
  /** File → Open Master…, unchanged from Task 4. */
  onOpenMaster: () => void;
  /** Clones the current master under a fresh id with the given name, and
   *  rebinds this document onto the clone. */
  onDuplicate: (name: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<
    { target: Master; dropped: string[]; disabledVariants: string[] } | null
  >(null);
  const [error, setError] = useState("");

  const closeAll = () => {
    setOpen(false);
    setNaming(false);
    setDraft("");
    setPreview(null);
    setResolvingId(null);
    setError("");
  };

  /** A library row was clicked: resolve it, then compute the rebind preview
   *  — never commits by itself. Picking the already-bound master is a no-op
   *  close, matching EditingTarget's own "picking the current target closes
   *  the menu" feel. */
  const pickEntry = async (id: string) => {
    if (id === props.master.id) { setOpen(false); return; }
    setError("");
    setResolvingId(id);
    const target = await props.resolve(id);
    setResolvingId(null);
    if (!target) { setError(`Could not open master "${id}".`); return; }
    const { dropped, disabledVariants } = rebind(props.label, target);
    setPreview({ target, dropped, disabledVariants });
  };

  const commit = () => {
    if (!preview) return;
    props.onMaster(preview.target);
    closeAll();
  };

  const closeNaming = () => { setNaming(false); setDraft(""); };
  const commitNaming = () => {
    const name = draft.trim();
    if (!name) { closeNaming(); return; }
    props.onDuplicate(name);
    closeAll();
  };

  const item = "flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-default disabled:opacity-60";

  return (
    <div className="border-b border-sidebar-border px-2 py-2">
      <button
        id="master-picker"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closeAll() : setOpen(true))}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <span className="text-sidebar-foreground/60">Master:</span>
        <span className="font-medium">{props.master.name}</span>
        <ChevronDown className="ml-auto size-3.5 shrink-0 opacity-60" />
      </button>

      {error && (
        <p id="master-picker-error" className="mt-1 px-1 text-[11px] text-destructive">{error}</p>
      )}

      {open && !preview && (
        <div role="menu" className="mt-1 rounded-md border border-sidebar-border p-1">
          {Object.entries(props.library).map(([id, entry]) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              disabled={resolvingId === id}
              onClick={() => void pickEntry(id)}
              className={cn(item, id === props.master.id && "bg-sidebar-accent text-sidebar-accent-foreground")}
            >
              {entry.name}{resolvingId === id ? "…" : ""}
            </button>
          ))}
          <button
            type="button" role="menuitem"
            onClick={() => { closeAll(); props.onOpenMaster(); }}
            className={cn(item, "text-sidebar-foreground/70")}
          >
            <FolderOpen className="size-3" />
            Open Master…
          </button>
          {/* Inline creation, same shape as EditingTarget's "New variant…":
              the item swaps itself for a text input — Enter commits, Esc
              cancels (spec: no dialogs). Pre-filled so accepting the default
              needs only Enter. */}
          {naming ? (
            <input
              id="master-picker-duplicate-name"
              autoFocus
              value={draft}
              placeholder="Master name"
              aria-label="New master name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitNaming(); }
                else if (e.key === "Escape") { e.preventDefault(); closeNaming(); }
              }}
              className="mt-0.5 w-full rounded-sm border border-sidebar-border bg-transparent px-2 py-1 text-xs text-sidebar-foreground outline-none"
            />
          ) : (
            <button
              type="button" role="menuitem"
              onClick={() => { setNaming(true); setDraft(`${props.master.name} copy`); }}
              className={cn(item, "text-sidebar-foreground/70")}
            >
              <Copy className="size-3" />
              Duplicate as new master…
            </button>
          )}
        </div>
      )}

      {preview && (
        <div id="master-picker-preview" role="menu"
          className="mt-1 rounded-md border border-sidebar-border p-2 text-xs text-sidebar-foreground">
          <p>{previewLine(preview)}</p>
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button" onClick={closeAll}
              className="rounded-sm px-2 py-1 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent"
            >
              Cancel
            </button>
            <button
              type="button" id="master-picker-continue" onClick={commit}
              className="rounded-sm bg-sidebar-primary px-2 py-1 text-xs text-sidebar-primary-foreground hover:opacity-90"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The preview's confirm line — "3 values and 1 variant move to the bench —
 *  continue?" — with the singular/plural wording handled once here so it
 *  can't drift from the counts driving it. An exact-match rebind (nothing
 *  benched) reads as a plain "switch to" line instead. */
function previewLine(p: { target: Master; dropped: string[]; disabledVariants: string[] }): string {
  const parts: string[] = [];
  if (p.dropped.length)
    parts.push(`${p.dropped.length} value${p.dropped.length === 1 ? "" : "s"}`);
  if (p.disabledVariants.length)
    parts.push(`${p.disabledVariants.length} variant${p.disabledVariants.length === 1 ? "" : "s"}`);
  if (!parts.length) return `Switch to "${p.target.name}" — continue?`;
  return `${parts.join(" and ")} move to the bench — continue?`;
}
