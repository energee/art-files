// MasterPicker.tsx — the head of the sidebar, above the Layers list: a Select
// listing known masters (the library index — masters.ts), and nothing else.
// Picking another library master previews the rebind (model/rebindLayers.ts)
// — the counts of what would move to the bench — before committing: the one
// confirmation the spec's no-dialogs rule permits, because a rebind is not a
// single undoable canvas act.
//
// The file verbs stay in the File menu — Open Master…, and forking the
// template with File → Save Master As…, which mints a new master id, rebinds
// this document onto it and actually writes the file (the old "Duplicate as
// new master…" did all of that except the writing). The ONE exception is
// "Save to Master…/Variant…" below: a save writes into whichever version this
// Select names, so the picker is where you can see the target while choosing
// to write it. It runs the File menu's own `master-save` command — same
// review dialog, same dirty gate, no second path.
//
// The menu answers one question — WHICH VERSION AM I EDITING — in three
// registers (docs/plans/label-first-editing.md, Task 12):
//   * the current master's variants, listed under it as versions of it.
//     Picking one switches to it, which is what makes a promotion land in
//     `variants.<id>.layers` instead of the base master. The same selection
//     shows that version on this label.
//   * the other masters in the library, which are a REBIND and go through the
//     bench preview below.
//   * New Variant, an action at the foot.
// Only the middle one resolves a file, so the two sentinels are intercepted
// in onValueChange before any rebind is considered.
import { CornerDownRight } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { rebindLabel } from "@/model/rebindLayers";
import type { MasterAssets } from "@/model/files";
import type { LabelFile, Master } from "@/model/layers";
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** The menu's non-library rows (see the header note). No master id can
 *  collide with either — a minted one is always `master-…`. */
const NEW_VARIANT = "__new-variant";
const VERSION = "__version:";

/** One dropdown row — just enough to render and pick. The full Master is
 *  resolved lazily (see `resolve`), only once something is actually picked,
 *  so opening the menu never has to read every file the library index
 *  knows about. */
export type LibraryEntry = { name: string; inLibrary?: boolean };

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
  onMaster: (target: Master, assets: MasterAssets) => void | Promise<void>;
  /** The variant being edited, or null for the base master. */
  version: string | null;
  /** Switch the working version. Null is the base master. */
  onVersion: (id: string | null) => void;
  /** Edit → New Variant: adds an empty variant to this master, switches it
   *  on for this label, and returns its id so the inline name field can open
   *  on it — the one moment a fresh variant is worth naming. */
  onNewVariant: () => string;
  /** Commits the inline rename of a variant (trimmed, non-empty). */
  onRenameVersion: (id: string, name: string) => void;
  /** Deletes a variant from the master. Undoable, so no confirm. */
  onRemoveVersion: (id: string) => void;
  /** File → Save Master, next to the version's own verbs: opens the review
   *  that writes into whichever version the Select names. */
  onSaveMaster: () => void;
  /** Whether a save would have anything to write (App's masterDirty). */
  masterDirty: boolean;
  /** Drop a remembered master from this computer's library. The file stays. */
  onForget: (id: string) => void;
}): React.JSX.Element {
  const previewId = useId();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<
    { target: Master; assets: MasterAssets; dropped: string[]; disabledVariants: string[] } | null
  >(null);
  const [error, setError] = useState("");
  /** Continue is running onMaster (index write, asset decode): a second press
   *  in that window would rebind the label twice. */
  const [committing, setCommitting] = useState(false);
  /** The variant whose name is being edited inline, or null. */
  const [naming, setNaming] = useState<string | null>(null);
  /** The library row chosen for a rebind, kept so Remove can drop it whether
   *  or not the file opened. */
  const [pickedId, setPickedId] = useState<string | null>(null);

  const closeAll = () => {
    setPreview(null);
    setResolvingId(null);
    setError("");
    setPickedId(null);
  };

  /** Resolve the selected master and preview the rebind before committing. */
  const pickEntry = async (id: string) => {
    if (id === props.master.id) return;
    setError("");
    setPickedId(id);
    setResolvingId(id);
    const r = await props.resolve(id);
    setResolvingId(null);
    if (!r) { setError(`Could not open master "${props.library[id]?.name ?? id}".`); return; }
    const { dropped } = rebindLabel(props.label, props.master, r.master);
    setPreview({ target: r.master, assets: r.assets, dropped: dropped.values, disabledVariants: dropped.variants });
  };

  /** The working version, narrowed once so the verb buttons below need no
   *  non-null assertion in their handlers. */
  const version = props.version;
  /** "Lolev" on the base version, "Lolev / Collab" while editing one. */
  const versionName = props.master.variants.find((v) => v.id === version)?.name;
  const editing = versionName ? `${props.master.name} / ${versionName}` : props.master.name;
  /** Every OTHER master in the library — this one already heads the menu. */
  const others = Object.entries(props.library).filter(([id]) => id !== props.master.id);

  /** Enter or blur on the name field: a trimmed non-empty change lands, an
   *  empty one just closes — the auto "Variant N" name stands. `id` comes
   *  from the render that opened the field, so there is no null case. */
  const commitName = (id: string, value: string) => {
    const next = value.trim();
    if (next) props.onRenameVersion(id, next);
    setNaming(null);
  };

  const canForget = !!pickedId && !!props.library[pickedId]?.inLibrary;
  const forgetLabel = pickedId ? `Remove ${props.library[pickedId]?.name ?? "master"} from the library` : "Remove from library";
  const forget = () => {
    if (pickedId) props.onForget(pickedId);
    closeAll();
  };

  const commit = async () => {
    if (!preview || committing) return;
    setCommitting(true);
    try {
      await props.onMaster(preview.target, preview.assets);
      closeAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="px-2 py-2">
      <Select
        value={props.version === null ? props.master.id : VERSION + props.version}
        disabled={resolvingId !== null}
        onValueChange={(id) => {
          if (!id) return;
          closeAll();
          if (id === NEW_VARIANT) { setNaming(props.onNewVariant()); return; }
          if (id.startsWith(VERSION)) { props.onVersion(id.slice(VERSION.length)); return; }
          // The current master's own row means "the base version", not a
          // rebind onto itself.
          if (id === props.master.id) { props.onVersion(null); return; }
          void pickEntry(id);
        }}>
        <SelectTrigger id="master-picker" aria-label="Master" size="sm" className="w-full">
          <span className="text-muted-foreground">Master:</span>
          <SelectValue>{editing}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={props.master.id}>{props.master.name}</SelectItem>
          {props.master.variants.map((v) => (
            // The icon, not an indent, says "a version OF the row above".
            <SelectItem key={v.id} value={VERSION + v.id}>
              <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {v.name}
            </SelectItem>
          ))}
          {others.length > 0 && <SelectSeparator />}
          {others.map(([id, entry]) => (
            <SelectItem key={id} value={id}>{entry.name}</SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW_VARIANT} className="text-attention-text">New Variant</SelectItem>
        </SelectContent>
      </Select>
      {naming !== null ? (
        <input
          autoFocus
          aria-label="Variant name"
          className="mt-1 w-full rounded-sm border border-sidebar-border bg-transparent px-2 py-1 text-xs"
          defaultValue={props.master.variants.find((v) => v.id === naming)?.name ?? ""}
          onBlur={(e) => commitName(naming, e.target.value)}
          onKeyDown={(e) => {
            // Keystrokes here are the field's alone — the sidebar's own
            // shortcuts must not see them.
            e.stopPropagation();
            if (e.key === "Enter") commitName(naming, e.currentTarget.value);
            if (e.key === "Escape") setNaming(null);
          }}
        />
      ) : (
        <div className="mt-1 flex gap-1.5">
          {version !== null && (
            <>
              <Button type="button" id="variant-rename" size="xs" variant="ghost"
                onClick={() => setNaming(version)}>
                Rename
              </Button>
              <Button type="button" id="variant-remove" size="xs" variant="destructive"
                onClick={() => props.onRemoveVersion(version)}>
                Delete
              </Button>
            </>
          )}
          <Button type="button" id="variant-save" size="xs" variant="attention"
            disabled={!props.masterDirty} onClick={props.onSaveMaster}>
            Save to {version === null ? "Master" : "Variant"}…
          </Button>
        </div>
      )}
      {resolvingId && <p role="status" className="mt-1 text-xs text-muted-foreground">Opening master…</p>}
      {error && (
        <div className="mt-1 px-1">
          <p id="master-picker-error" className="text-[11px] text-destructive-text">{error}</p>
          {canForget && !preview && (
            <Button type="button" id="master-picker-forget" size="xs" variant="outline" className="mt-1.5 w-full"
              aria-label={forgetLabel} title="The file stays where it is." onClick={forget}>
              Remove from library
            </Button>
          )}
        </div>
      )}

      {preview && (
        <div id="master-picker-preview" role="group" aria-labelledby={previewId}
          className="mt-1 rounded-md border border-sidebar-border p-2 text-xs text-sidebar-foreground">
          <p id={previewId}>{previewLine(preview)}</p>
          <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
            {canForget && (
              <Button type="button" id="master-picker-forget" size="xs" variant="ghost"
                className="mr-auto px-1.5 text-muted-foreground hover:text-destructive-text"
                aria-label={forgetLabel} title="The file stays where it is." onClick={forget}>
                Remove from library
              </Button>
            )}
            <div className="flex gap-1.5">
              <Button
                type="button" onClick={closeAll} variant="outline" size="xs"
              >
                Cancel
              </Button>
              <Button
                type="button" id="master-picker-continue" disabled={committing} onClick={() => { void commit(); }} size="xs"
              >
                Continue
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function previewLine(p: { target: Master; dropped: string[]; disabledVariants: string[] }): string {
  const parts: string[] = [];
  if (p.dropped.length)
    parts.push(`${p.dropped.length} filled field${p.dropped.length === 1 ? "" : "s"}`);
  if (p.disabledVariants.length)
    parts.push(`${p.disabledVariants.length} variant${p.disabledVariants.length === 1 ? "" : "s"}`);
  if (!parts.length) return `Switch to "${p.target.name}" — continue?`;
  return `Switching to "${p.target.name}" hides ${parts.join(" and ")} that it cannot display. Their contents are kept if you switch back. Continue?`;
}
