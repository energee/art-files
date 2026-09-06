// MasterPicker.tsx — the head of the sidebar, above the Layers list: a Select
// listing known masters (the library index — masters.ts), and nothing else.
// Picking another library master previews the rebind (model/rebindLayers.ts)
// — the counts of what would move to the bench — before committing: the one
// confirmation the spec's no-dialogs rule permits, because a rebind is not a
// single undoable canvas act.
//
// It carries no file verbs. Open Master… lives in the File menu, and forking
// the template is File → Save Master As…, which mints a new master id, rebinds
// this document onto it and actually writes the file — the old "Duplicate as
// new master…" did all of that except the writing.
//
// The menu answers one question — WHICH VERSION AM I EDITING — in three
// registers (docs/plans/label-first-editing.md, Task 12):
//   * the current master's variants, listed under it as versions of it.
//     Picking one switches to it, which is what makes Add Layer add into
//     `variants.<id>.layers` instead of the base master. Merely enabling a
//     variant (the chips in LayerList) shows that version; it does not make
//     it the one you are changing.
//   * the other masters in the library, which are a REBIND and go through the
//     bench preview below.
//   * New Variant, an action at the foot.
// Only the middle one resolves a file, so the two sentinels are intercepted
// in onValueChange before any rebind is considered.
import { useState } from "react";
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
  /** The variant being edited, or null for the base master. */
  version: string | null;
  /** Switch the working version. Null is the base master. */
  onVersion: (id: string | null) => void;
  /** Edit → New Variant: adds an empty variant to this master and switches it
   *  on for this label. */
  onNewVariant: () => void;
}): React.JSX.Element {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<
    { target: Master; assets: MasterAssets; dropped: string[]; disabledVariants: string[] } | null
  >(null);
  const [error, setError] = useState("");

  const closeAll = () => {
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

  /** "Lolev" on the base version, "Lolev / Collab" while editing one. */
  const versionName = props.master.variants.find((v) => v.id === props.version)?.name;
  const editing = versionName ? `${props.master.name} / ${versionName}` : props.master.name;
  /** Every OTHER master in the library — this one already heads the menu. */
  const others = Object.entries(props.library).filter(([id]) => id !== props.master.id);

  const commit = () => {
    if (!preview) return;
    props.onMaster(preview.target, preview.assets);
    closeAll();
  };

  return (
    <div className="px-2 py-2">
      <Select
        value={props.version === null ? props.master.id : VERSION + props.version}
        disabled={resolvingId !== null}
        onValueChange={(id) => {
          if (!id) return;
          closeAll();
          if (id === NEW_VARIANT) { props.onNewVariant(); return; }
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
            <SelectItem key={v.id} value={VERSION + v.id} className="pl-7">{v.name}</SelectItem>
          ))}
          {others.length > 0 && <SelectSeparator />}
          {others.map(([id, entry]) => (
            <SelectItem key={id} value={id}>{entry.name}</SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW_VARIANT}>New Variant</SelectItem>
        </SelectContent>
      </Select>
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
