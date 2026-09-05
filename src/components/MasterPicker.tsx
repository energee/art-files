// MasterPicker.tsx — the head of the sidebar, above the Layers list: the
// a Select listing known masters (the library index — masters.ts), with
// Open Master and Duplicate actions below it.
// Picking another library master previews the rebind (model/rebindLayers.ts)
// — the counts of what would move to the bench — before committing: the one
// confirmation the spec's no-dialogs rule permits, because a rebind is not a
// single undoable canvas act. "Duplicate as new master…" needs no preview: a
// clone starts out layer-for-layer identical to what it was cloned from, so
// nothing is ever benched by it.
import { useState } from "react";
import { Copy, FolderOpen } from "lucide-react";
import { rebindLabel } from "@/model/rebindLayers";
import type { MasterAssets } from "@/model/files";
import type { LabelFile, Master } from "@/model/layers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** One dropdown row — just enough to render and pick. The full Master is
 *  resolved lazily (see `resolve`), only once something is actually picked,
 *  so opening the menu never has to read every file the library index
 *  knows about. */
export type LibraryEntry = { name: string };

export function MasterPicker(props: {
  /** The master currently bound to this document. */
  master: Master;
  /** The document's label — values, enabled variants, dormant bench — which
   *  is what the preview's rebind runs against. */
  label: LabelFile;
  /** Library listing: every master this machine knows about, id -> name
   *  (masters.ts's masterIndex() plus the shipped master). */
  library: Record<string, LibraryEntry>;
  /** Resolves a library id to its Master (masters.ts's resolveMasterById) —
   *  async, since a library master may live on disk. Null means it could not
   *  be read (moved, deleted, or corrupt). Called with the id alone: a
   *  picker-driven resolve always has the index's own remembered path to
   *  fall back on, unlike resolveMasterById's optional second `hint`
   *  argument, which exists for a DIFFERENT caller — openProject, resolving
   *  a `.label`'s masterHint when the index itself has nothing for that id
   *  yet (e.g. a file received from someone else). */
  resolve: (id: string) => Promise<{ master: Master; assets: MasterAssets } | null>;
  /** Commits a rebind onto `target` — called ONLY after the inline preview's
   *  "Continue" is pressed. The caller re-runs rebind itself against its own
   *  live document snapshot (App.tsx's commitRebind), so this never trusts a
   *  rebind result computed against a possibly-stale `label` prop. The
   *  resolved template assets ride along so the caller adopts them without
   *  a second file read. */
  onMaster: (target: Master, assets: MasterAssets) => void;
  /** File → Open Master…. */
  onOpenMaster: () => void;
  /** Clones the current master under a fresh id with the given name, and
   *  rebinds this document onto the clone. */
  onDuplicate: (name: string) => void;
}): React.JSX.Element {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<
    { target: Master; assets: MasterAssets; dropped: string[]; disabledVariants: string[] } | null
  >(null);
  const [error, setError] = useState("");

  const closeAll = () => {
    setNaming(false);
    setDraft("");
    setPreview(null);
    setResolvingId(null);
    setError("");
  };

  /** Resolve the selected master and preview the rebind before committing. */
  const pickEntry = async (id: string) => {
    if (id === props.master.id) return;
    setError("");
    setResolvingId(id);
    const r = await props.resolve(id);
    setResolvingId(null);
    if (!r) { setError(`Could not open master "${id}".`); return; }
    const { dropped } = rebindLabel(props.label, props.master, r.master);
    setPreview({ target: r.master, assets: r.assets, dropped: dropped.values, disabledVariants: dropped.variants });
  };

  const commit = () => {
    if (!preview) return;
    props.onMaster(preview.target, preview.assets);
    closeAll();
  };

  const closeNaming = () => { setNaming(false); setDraft(""); };
  const commitNaming = () => {
    const name = draft.trim();
    if (!name) { closeNaming(); return; }
    props.onDuplicate(name);
    closeAll();
  };

  return (
    <div className="px-2 py-2">
      <Select value={props.master.id} disabled={resolvingId !== null}
        onValueChange={(id) => { if (id) { closeAll(); void pickEntry(id); } }}>
        <SelectTrigger id="master-picker" aria-label="Master" size="sm" className="w-full">
          <span className="text-muted-foreground">Master:</span>
          <SelectValue>{props.master.name}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!props.library[props.master.id] && (
            <SelectItem value={props.master.id}>{props.master.name}</SelectItem>
          )}
          {Object.entries(props.library).map(([id, entry]) => (
            <SelectItem key={id} value={id}>{entry.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="mt-1 flex gap-1">
        <Button variant="ghost" size="sm" onClick={() => { closeAll(); props.onOpenMaster(); }}>
          <FolderOpen data-icon="inline-start" /> Open Master…
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Duplicate as new master…"
          title="Duplicate as new master…"
          onClick={() => { closeAll(); setNaming(true); setDraft(`${props.master.name} copy`); }}>
          <Copy />
        </Button>
      </div>
      {naming && (
        <Input id="master-picker-duplicate-name" autoFocus value={draft}
          placeholder="Master name" aria-label="New master name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitNaming(); }
            else if (e.key === "Escape") { e.preventDefault(); closeNaming(); }
          }} />
      )}
      {resolvingId && <p role="status" className="mt-1 text-xs text-muted-foreground">Opening master…</p>}
      {error && (
        <p id="master-picker-error" className="mt-1 px-1 text-[11px] text-destructive">{error}</p>
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
