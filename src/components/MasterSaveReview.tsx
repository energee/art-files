// MasterSaveReview.tsx — the dialog between an edit and the template
// (docs/plans/label-first-editing.md, Task 7). The master never changes
// implicitly: every Save Master shows what it is about to write first.
//
// Two kinds of row, and the difference is the whole point:
//   * STRUCTURAL and fill-contract rows (added / removed / moved / renamed /
//     property) are already in the edited master. They are checked and
//     DISABLED — unchecking one would be an undo, which is Cmd-Z's job, not a
//     save option.
//   * PROMOTE rows are the label's own deviations — its overrides (design) and
//     its values (content, on the layer's own `lines` / `asset` / `value`
//     path) — offered for folding into the template. Off by default, because
//     a label's nudge is the label's until someone says otherwise. This
//     dialog is the only promotion path — the inspector's override badge
//     resets, it never promotes.
//
// Presentational: it reports which promote rows were ticked and lets the
// caller do the writing (edit.ts's applyPromotions).
import { useMemo, useState } from "react";
import type { MasterChange } from "@/model/edit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle,
} from "@/components/ui/dialog";

/** Stable per-row key, also the `data-row` the tests drive — base-ui mints
 *  its own `id` on a Checkbox, so the row's identity rides on a data
 *  attribute instead. */
const rowId = (c: MasterChange) =>
  `${c.kind}-${c.layerId}${c.path === undefined ? "" : `-${c.path}`}`;

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
 *  is the only thing between a learned value and the template
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

/** What the row says happened, in the reviewer's terms rather than the
 *  model's. Structural rows are a sentence; a property or promote row is a
 *  path and a before/after, set in mono because that is literally what they
 *  are — a key path and its values. */
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
  /** The variant a promotion would be written into, named — undefined for the
   *  base master. Shown because promotion is otherwise invisible: the same
   *  tick writes `master.layers` or `variants.collab.layers` depending on the
   *  version you switched to (Task 12). */
  target?: string;
  onCancel: () => void;
  /** The ticked `promote` rows, in the order they were listed. */
  onConfirm: (promote: MasterChange[]) => void;
}): React.JSX.Element {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

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

  const confirm = () =>
    props.onConfirm(props.changes.filter((c) => c.kind === "promote" && ticked.has(rowId(c))));

  const toggle = (id: string) => setTicked((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Save Master</DialogTitle>
        <DialogDescription>
          {props.changes.length === 0
            ? "Nothing has changed in the master."
            : props.target === undefined
              ? "These changes will be written to the template. Tick a label override to fold it in too."
              : `These changes will be written to the template. Ticked overrides go into the ${props.target} version.`}
        </DialogDescription>
        <div className="max-h-80 overflow-y-auto text-sm">
          {groups.map((g) => (
            <div key={g.rows[0].layerId} className="mt-2 first:mt-0">
              <p className="text-xs font-medium text-muted-foreground">{g.name}</p>
              {g.rows.map((c) => {
                const row = rowId(c);
                return (
                <label key={row} className="mt-1 flex items-center gap-2">
                  <Checkbox
                    data-row={row}
                    disabled={c.kind !== "promote"}
                    checked={c.kind !== "promote" || ticked.has(row)}
                    onCheckedChange={() => toggle(row)} />
                  <span className={c.kind === "promote" ? ""
                    : c.kind === "removed" ? "text-destructive" : "text-muted-foreground"}>
                    {rowText(c)}
                  </span>
                </label>
                );
              })}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={props.onCancel}>Cancel</Button>
          <Button size="sm" onClick={confirm}>Save Master</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
