// MasterPicker.tsx — the head of the sidebar, above the Layers list: a Select
// listing known masters (the library index — masters.ts), and nothing else.
// Picking another library master switches at once, with no confirm card: the
// rebind (model/rebindLayers.ts) is one undoable step, and App's header note
// names what it set aside and that ⌘Z restores it — as Delete Variant does.
//
// The file verbs stay in the File menu — Open Master…, and forking the
// template with File → Save Master As…, which mints a new master id, rebinds
// this document onto it and actually writes the file (the old "Duplicate as
// new master…" did all of that except the writing). The ONE exception is
// "Save Master…/Save Variant…" button below, shown only while there is
// something to save: a save writes into whichever version this Select names,
// so the picker is where you can see the target while choosing to write it.
// It runs the File menu's own Save Master (App's requestMasterSave) — the
// same direct write or review, same dirty gate, no second path.
//
// The menu answers one question — WHICH VERSION AM I EDITING — in three
// registers (docs/plans/label-first-editing.md, Task 12):
//   * the current master's variants, listed under it as versions of it.
//     Picking one switches to it, which is what makes a promotion land in
//     `variants.<id>.layers` instead of the base master. The same selection
//     shows that version on this label.
//   * the other masters in the library, which are a REBIND: picking one
//     switches this label onto it at once. A remembered one carries an X at the right of its
//     row that takes it off the library without picking it. The removal is
//     said in plain view under the Select — the file stays where it is — with
//     an Undo, since re-adding it would otherwise mean browsing to the file.
//   * actions at the foot: New Variant, plus Rename Variant… and Delete
//     Variant while a variant is the version (they were permanent buttons
//     under the Select; a red Delete always in reach was the wrong default).
// The first two sit under "Current master" / "Other masters" headings, and
// every master row carries a second line — its file name and the day it was
// last opened, saved or picked here (the index's lastSeen) — because two
// masters can share a name (a fork keeps it until renamed).
// Deleting a variant (Delete Variant in the menu) is one undoable edit, so it
// asks no confirm; the same status line says so, naming ⌘Z, while the master
// is still the one the delete left — not after an undo, another edit to the
// master, or an Open — and until the menu is used again (#426).
// Only the middle one resolves a file, so the sentinels are intercepted in
// onValueChange before any rebind is considered.
import { CornerDownRight, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { shortcutLabel } from "@/keys";
import type { MasterAssets } from "@/model/files";
import type { Master } from "@/model/layers";
import type { MasterIndexEntry } from "@/masters";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { errMsg, shortDate } from "@/lib/utils";
import { recentTitles } from "@/recent";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** The menu's non-library rows (see the header note). No master id can
 *  collide with either — a minted one is always `master-…`. */
const NEW_VARIANT = "__new-variant";
const RENAME_VARIANT = "__rename-variant";
const DELETE_VARIANT = "__delete-variant";
const VERSION = "__version:";

/** One dropdown row — just enough to render and pick. The full Master is
 *  resolved lazily (see `resolve`), only once something is actually picked,
 *  so opening the menu never has to read every file the library index
 *  knows about. */
export type LibraryEntry = { name: string; inLibrary?: boolean; builtIn?: boolean }
  // The index row's file path and lastSeen, for the detail line. `builtIn`
  // marks the shipped master, which may have no file behind it.
  & Partial<Pick<MasterIndexEntry, "path" | "lastSeen">>;

/** Each row's second line, by id: "lolev.master · Used Oct 11, 2026". The
 *  file name gains its folder when two rows share one (recentTitles), so
 *  same-named masters stay apart. No path reads "Built in" for the shipped
 *  master and "No file" for any other. */
export function entryDetails(entries: [string, LibraryEntry][]): Record<string, string> {
  const withPath = entries.filter(([, e]) => e.path);
  const titles = recentTitles(withPath.map(([, e]) => e.path!));
  const file = new Map(withPath.map(([id], i) => [id, titles[i]]));
  return Object.fromEntries(entries.map(([id, e]) => {
    const name = file.get(id) ?? (e.builtIn ? "Built in" : "No file");
    const used = e.lastSeen ? shortDate(e.lastSeen) : "";
    return [id, used ? `${name} · Used ${used}` : name];
  }));
}

/** Name over its detail line, for a master row. The sr-only comma keeps a
 *  screen reader from running the two together. */
function MasterRow({ name, detail }: { name: string; detail: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{name}<span className="sr-only">, </span></span>
      <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
    </span>
  );
}

export function MasterPicker(props: {
  /** The master currently bound to this document. */
  master: Master;
  /** Library listing: every master this machine knows about, id -> name,
   *  file path and lastSeen (masters.ts's masterIndex() plus the shipped
   *  master), for the rows and their detail lines. */
  library: Record<string, LibraryEntry>;
  /** Resolves a library id to its Master (masters.ts's resolveMasterById) —
   *  async, since a library master may live on disk. Null means it could not
   *  be read (moved, deleted, or corrupt); a row whose file is gone with no
   *  remembered copy is dropped from the library then (#428). Called with
   *  the id alone: a
   *  picker-driven resolve always has the index's own remembered path to
   *  fall back on, unlike resolveMasterById's optional second `hint`
   *  argument, which exists for a DIFFERENT caller — openProject, resolving
   *  a `.label`'s masterHint, the exact file that label was saved against,
   *  before the index's path for that id (#405). */
  resolve: (id: string) => Promise<{ master: Master; assets: MasterAssets } | null>;
  /** Commits a rebind onto `target`, as soon as it is picked and resolved.
   *  The caller rebinds its own live document (App.tsx's commitRebind) and
   *  reports what was set aside. The resolved template assets ride along so
   *  the caller adopts them without a second file read. */
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
  /** File → Save Master…, the button under the Select while `templateMoved`:
   *  writes into whichever version the Select names, through the review
   *  when the label has something to promote. */
  onSaveMaster: () => void;
  /** The save button's text — File → Save Master…'s own title ("Save
   *  Master…", or "Save Variant…" on a variant), so the two always match. */
  saveLabel: string;
  /** Whether the master itself changed (App's templateMoved). Label
   *  overrides alone don't show the button: they are this beer's, ⌘S saves
   *  them, and File → Save Master… still offers to promote them. */
  templateMoved: boolean;
  /** Drop a remembered master from this computer's library. The file stays.
   *  Resolves to an undo that puts it back (masters.ts's removeFromLibrary). */
  onForget: (id: string) => Promise<() => Promise<void>>;
}): React.JSX.Element {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  /** onMaster is running (index write, asset decode): a second pick in that
   *  window would rebind the label twice, so the Select is disabled. */
  const [committing, setCommitting] = useState(false);
  /** The last library removal, shown with its Undo until the next one or
   *  until the menu is used again. */
  const [removed, setRemoved] = useState<{ name: string; undo: () => Promise<void> } | null>(null);
  /** The last variant deleted here, named in the status line with its ⌘Z
   *  until the menu is used again. `after` is the master the delete produced
   *  (the first one seen without the variant); the note shows only while that
   *  very master is current, so an undo, a later master edit or an Open —
   *  which resets the history, so ⌘Z could no longer bring it back — all
   *  retire it. A redo returns the same object and shows it again. */
  const [deleted, setDeleted] = useState<{ id: string; name: string; after?: Master } | null>(null);
  // State adjusted during render, React's pattern for reacting to a prop.
  if (deleted && !deleted.after && !props.master.variants.some((v) => v.id === deleted.id))
    setDeleted({ ...deleted, after: props.master });
  /** The variant whose name is being edited inline, or null. */
  const [naming, setNaming] = useState<string | null>(null);

  const closeAll = () => {
    setResolvingId(null);
    setError("");
    setRemoved(null);
    setDeleted(null);
  };

  /** The ids whose removal is running. A ref, not state: two presses in one
   *  tick would both read stale state, and the second removal's empty undo
   *  would replace the real one. A set, so one finishing removal does not
   *  clear another's guard. */
  const forgetting = useRef(new Set<string>());
  /** This picker's trigger. Not getElementById: every open tab keeps its
   *  editor mounted, so the page holds one #master-picker per tab. */
  const triggerRef = useRef<HTMLButtonElement>(null);

  const forget = async (id: string) => {
    if (forgetting.current.has(id)) return;
    forgetting.current.add(id);
    const name = props.library[id]?.name ?? id;
    try {
      const undo = await props.onForget(id);
      setDeleted(null);
      setRemoved({ name, undo });
    } finally {
      forgetting.current.delete(id);
    }
  };

  /** Resolve the selected master and switch to it. ⌘Z undoes the switch
   *  like any other edit, so there is nothing to confirm. */
  const pickEntry = async (id: string) => {
    if (id === props.master.id) return;
    setError("");
    setResolvingId(id);
    const r = await props.resolve(id);
    setResolvingId(null);
    if (!r) { setError(`Could not open master "${props.library[id]?.name ?? id}".`); return; }
    setCommitting(true);
    try {
      await props.onMaster(r.master, r.assets);
      closeAll();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setCommitting(false);
    }
  };

  /** The working version, narrowed once so the variant verbs below need no
   *  non-null assertion in their handlers. */
  const version = props.version;
  /** "Lolev" on the base version, "Lolev / Collab" while editing one. */
  const versionName = props.master.variants.find((v) => v.id === version)?.name;
  const editing = versionName ? `${props.master.name} / ${versionName}` : props.master.name;
  /** Every OTHER master in the library — this one already heads the menu. */
  const others = Object.entries(props.library).filter(([id]) => id !== props.master.id);
  const details = entryDetails([
    [props.master.id, { ...props.library[props.master.id], name: props.master.name }], ...others,
  ]);

  /** Enter or blur on the name field: a trimmed non-empty change lands, an
   *  empty or unchanged one just closes — no undo step, nothing unsaved; the
   *  auto "Variant N" name stands. `id` comes from the render that opened the
   *  field, so there is no null case. */
  const commitName = (id: string, value: string) => {
    const next = value.trim();
    if (next && next !== props.master.variants.find((v) => v.id === id)?.name) props.onRenameVersion(id, next);
    setNaming(null);
  };

  return (
    <div className="px-2 py-2">
      <Select
        value={props.version === null ? props.master.id : VERSION + props.version}
        // Also while a switch commits: a second pick would rebind twice.
        disabled={resolvingId !== null || committing}
        onValueChange={(id) => {
          if (!id) return;
          closeAll();
          if (id === NEW_VARIANT) { setNaming(props.onNewVariant()); return; }
          // Shown only on a variant; never fall through to a rebind.
          if (id === RENAME_VARIANT) { if (version !== null) setNaming(version); return; }
          if (id === DELETE_VARIANT) {
            if (version !== null) {
              setDeleted({ id: version, name: versionName ?? version });
              props.onRemoveVersion(version);
            }
            return;
          }
          if (id.startsWith(VERSION)) { props.onVersion(id.slice(VERSION.length)); return; }
          // The current master's own row means "the base version", not a
          // rebind onto itself.
          if (id === props.master.id) { props.onVersion(null); return; }
          void pickEntry(id);
        }}>
        <SelectTrigger ref={triggerRef} id="master-picker" aria-label="Master" size="sm" className="w-full">
          <span className="text-muted-foreground">Master:</span>
          <SelectValue>{editing}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Current master</SelectLabel>
            <SelectItem value={props.master.id} label={props.master.name}>
              <MasterRow name={props.master.name} detail={details[props.master.id]} />
            </SelectItem>
            {props.master.variants.map((v) => (
              // The icon, not an indent, says "a version OF the row above".
              <SelectItem key={v.id} value={VERSION + v.id}>
                <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{v.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
          {others.length > 0 && (<>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Other masters</SelectLabel>
              {others.map(([id, entry]) => (
                <SelectItem key={id} value={id} label={entry.name}
                  // The ✕ isn't focusable inside the listbox; Delete on the
                  // highlighted row is its keyboard path. A held key is ignored so
                  // it can't sweep through the rows below.
                  aria-keyshortcuts={entry.inLibrary ? "Delete" : undefined}
                  onKeyDown={entry.inLibrary ? (e) => {
                    if (e.key !== "Delete" || e.repeat) return;
                    e.preventDefault(); stop(e); void forget(id);
                  } : undefined}
                  // Remove is the row's own action, not a pick: every event it
                  // fires stops here so the Select never sees a selection.
                  action={entry.inLibrary && (
                    <button type="button" aria-label={`Remove ${entry.name} from the library`}
                      title="Remove from the library (Delete). The file stays where it is."
                      className="pointer-events-auto rounded-sm p-0.5 text-muted-foreground hover:text-destructive-text"
                      onPointerDown={stop} onPointerUp={stop} onMouseUp={stop}
                      onClick={(e) => { stop(e); void forget(id); }}>
                      <X className="size-3.5" aria-hidden />
                    </button>
                  )}>
                  <MasterRow name={entry.name} detail={details[id]} />
                </SelectItem>
              ))}
            </SelectGroup>
          </>)}
          <SelectSeparator />
          <SelectItem value={NEW_VARIANT} className="text-attention-text">New Variant</SelectItem>
          {version !== null && (<>
            <SelectItem value={RENAME_VARIANT}>Rename Variant…</SelectItem>
            <SelectItem value={DELETE_VARIANT} className="text-destructive-text">Delete Variant</SelectItem>
          </>)}
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
      ) : props.templateMoved && (
        <Button type="button" id="variant-save" size="xs" variant="attention"
          className="mt-1" onClick={props.onSaveMaster}>
          {props.saveLabel}
        </Button>
      )}
      {resolvingId && <p role="status" className="mt-1 text-xs text-muted-foreground">Opening master…</p>}
      {/* Always mounted: screen readers announce a change inside a live
          region that already exists, not one inserted with its text. */}
      <div role="status">
        {removed && (
          <p id="master-picker-removed" className="mt-1 px-1 text-[11px] text-muted-foreground">
            Removed “{removed.name}” from the library. The file stays where it is.{" "}
            <Button type="button" size="xs" variant="link" className="h-auto p-0 text-[11px]"
              onClick={() => {
                // This button goes with the note: hand focus back to the picker.
                triggerRef.current?.focus();
                setRemoved(null); void removed.undo();
              }}>
              Undo
            </Button>
          </p>
        )}
        {deleted?.after === props.master && (
          <p id="master-picker-deleted" className="mt-1 px-1 text-[11px] text-muted-foreground">
            Deleted “{deleted.name}”. {shortcutLabel("⌘Z")} brings it back.
          </p>
        )}
      </div>
      {error && (
        <p id="master-picker-error" className="mt-1 px-1 text-[11px] text-destructive-text">{error}</p>
      )}
    </div>
  );
}
