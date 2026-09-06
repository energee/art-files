// MasterSaveReview.tsx — the dialog between an edit and the template
// (docs/plans/label-first-editing.md, Task 7). The master never changes
// implicitly: every Save Master shows what it is about to write first.
//
// Two kinds of row, and the difference is the whole point:
//   * STRUCTURAL and fill-contract rows (added / removed / moved / renamed /
//     property) are already in the edited master. They are checked and
//     DISABLED — unchecking one would be an undo, which is Cmd-Z's job, not a
//     save option.
//   * PROMOTE rows are the label's own overrides, offered for folding into the
//     template. Off by default, because a label's nudge is the label's until
//     someone says otherwise. This dialog is the only promotion path — the
//     inspector's override badge resets, it never promotes.
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

/** What the row says happened, in the reviewer's terms rather than the
 *  model's. `from`/`to` are rendered only where a before/after reads as
 *  information — a moved layer's indices would not. */
function rowText(c: MasterChange): string {
  const val = (v: unknown) =>
    v === undefined || v === null ? "—"
      : typeof v === "object" ? JSON.stringify(v) : String(v);
  switch (c.kind) {
    case "added": return "Added to the master";
    case "removed": return "Removed from the master";
    case "moved": return "Reordered";
    case "renamed": return `Renamed from "${String(c.from)}"`;
    default: return `${c.path}: ${val(c.from)} → ${val(c.to)}`;
  }
}

export function MasterSaveReview(props: {
  open: boolean;
  /** edit.ts's masterChanges() for this save. */
  changes: readonly MasterChange[];
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
            : "These changes will be written to the template. Tick a label override to fold it in too."}
        </DialogDescription>
        <div className="max-h-80 overflow-y-auto text-sm">
          {groups.map((g) => (
            <div key={g.rows[0].layerId} className="mt-2 first:mt-0">
              <p className="text-xs font-medium text-muted-foreground">{g.name}</p>
              {g.rows.map((c) => (
                <label key={rowId(c)} className="mt-1 flex items-center gap-2">
                  <Checkbox
                    data-row={rowId(c)}
                    disabled={c.kind !== "promote"}
                    checked={c.kind !== "promote" || ticked.has(rowId(c))}
                    onCheckedChange={() => toggle(rowId(c))} />
                  <span className={c.kind === "promote" ? "" : "text-muted-foreground"}>
                    {rowText(c)}
                  </span>
                </label>
              ))}
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
