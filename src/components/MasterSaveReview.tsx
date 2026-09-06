// MasterSaveReview.tsx — the dialog between an edit and the template
// (docs/plans/label-first-editing.md, Task 7). The master never changes
// implicitly: every Save Master shows what it is about to write first.
//
// A read-only list of the structural and fill-contract rows (added / removed
// / moved / renamed / property) already sitting in the edited master, plus
// Save / Cancel. (2026-09-06: this used to also list the label's own
// overrides, offered as ticked-off checkboxes to fold into the template —
// removed by docs/plans/template-switch.md, which makes "put this label's
// tweak in the template" a mode switch instead. See
// docs/plans/label-first-editing.md's Tasks 6/7 for the history.)
import { useMemo } from "react";
import type { MasterChange } from "@/model/edit";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle,
} from "@/components/ui/dialog";

/** An unset value reads as an em dash, not "undefined" — `null` is
 *  setLabelOverride's wire spelling of "unset this key". */
const val = (v: unknown) =>
  v === undefined || v === null ? "—"
    : typeof v === "object" ? JSON.stringify(v) : String(v);

/** What one entry of a list is called: a Choice by its title, else its value,
 *  a plain string as itself. */
const entryName = (v: unknown): string =>
  typeof v === "string" ? v
    : v && typeof v === "object"
      ? String((v as { title?: string; value?: unknown }).title
        ?? (v as { value?: unknown }).value ?? JSON.stringify(v))
      : String(v);

/** A list-valued path — a fill vocabulary, a layer's lines — reads as its
 *  count and the ONE entry that came or went, not as its JSON. leafPaths
 *  treats an array as a single leaf, so a vocabulary arrives here whole: eight
 *  tier objects stringified is not something anyone can review, and the review
 *  is the only thing standing between a learned value and the template
 *  (docs/plans/choice-input.md, Task 7).
 *
 *  More than one difference falls back to the counts alone: naming two of five
 *  changes is worse than naming none, because it reads as the whole story. */
function listText(from: readonly unknown[], to: readonly unknown[]): string {
  const key = (v: unknown) => JSON.stringify(v);
  const before = from.map(key);
  const after = to.map(key);
  const added = to.filter((v) => !before.includes(key(v)));
  const removed = from.filter((v) => !after.includes(key(v)));
  const counts = `${from.length} → ${to.length}`;
  if (added.length === 1 && removed.length === 0) return `${counts} (+ "${entryName(added[0])}")`;
  if (removed.length === 1 && added.length === 0) return `${counts} (− "${entryName(removed[0])}")`;
  return counts;
}

/** What the row says happened: structural rows are a sentence; a property
 *  row is a path and a before/after, set in mono because that is literally
 *  what they are — a key path and its values. */
function rowText(c: MasterChange): React.ReactNode {
  switch (c.kind) {
    case "added": return "Added to the master";
    case "removed": return "Removed from the master";
    case "moved": return "Reordered";
    case "renamed": return `Renamed from "${String(c.from)}"`;
    default: return (
      <>
        <span className="font-mono text-[11.5px]">{c.path}</span>
        {": "}
        {Array.isArray(c.from) || Array.isArray(c.to) ? (
          <span className="font-mono text-[11.5px] tabular-nums">
            {listText(Array.isArray(c.from) ? c.from : [], Array.isArray(c.to) ? c.to : [])}
          </span>
        ) : (
          <>
            <span className="font-mono text-[11.5px] tabular-nums">{val(c.from)}</span>
            <span className="px-0.5 text-muted-foreground"> → </span>
            <span className="font-mono text-[11.5px] tabular-nums">{val(c.to)}</span>
          </>
        )}
      </>
    );
  }
}

export function MasterSaveReview(props: {
  open: boolean;
  /** edit.ts's masterChanges() for this save. */
  changes: readonly MasterChange[];
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  // Layer order as `changes` first mentions each layer, so the dialog reads in
  // the same order masterChanges walked the master.
  const groups = useMemo(() => {
    const by = new Map<string, { name: string; rows: MasterChange[] }>();
    for (const c of props.changes) {
      const g = by.get(c.layerId) ?? { name: c.layerName, rows: [] };
      g.rows.push(c);
      by.set(c.layerId, g);
    }
    return [...by.values()];
  }, [props.changes]);

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Save Master</DialogTitle>
        <DialogDescription>
          {props.changes.length === 0
            ? "Nothing has changed in the master."
            : "These changes will be written to the template."}
        </DialogDescription>
        <div className="max-h-80 overflow-y-auto text-sm">
          {groups.map((g) => (
            <div key={g.rows[0].layerId} className="mt-2 first:mt-0">
              <p className="text-xs font-medium text-muted-foreground">{g.name}</p>
              {g.rows.map((c) => {
                const row = `${c.kind}-${c.layerId}${c.path === undefined ? "" : `-${c.path}`}`;
                return (
                <p key={row} className="mt-1 flex items-center gap-2">
                  <span className={c.kind === "removed" ? "text-destructive-text" : "text-muted-foreground"}>
                    {rowText(c)}
                  </span>
                </p>
                );
              })}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={props.onCancel}>Cancel</Button>
          <Button size="sm" onClick={props.onConfirm}>Save Master</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
