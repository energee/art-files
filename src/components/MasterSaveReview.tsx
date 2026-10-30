// MasterSaveReview.tsx — the dialog between an edit and the template
// (docs/plans/label-first-editing.md, Task 7). It opens only when the label
// has overrides that could be promoted — the one decision a save asks for;
// with none, App's Save Master writes straight away and its Saved toast says
// how many changes went into the file.
//
// Two kinds of row, and the difference is the whole point:
//   * STRUCTURAL and fill-contract rows (added / removed / moved / renamed /
//     property) are already in the edited master. They are plain text, no
//     checkbox — undoing one is ⌘Z's job, not a save option.
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
import { useTranslation } from "@/i18n";
import type { MasterChange } from "@/model/edit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle,
} from "@/components/ui/dialog";

/** Stable per-row key, also the `data-row` the tests drive — base-ui mints
 *  its own `id` on a Checkbox, so the row's identity rides on a data
 *  attribute instead. EVERY discriminator joins in: an override and a fill
 *  value on the same layer share a path ("lines" for text, "asset" for an
 *  image), and without `source` one checkbox drove both rows. */
const rowId = (c: MasterChange) =>
  [c.kind, c.layerId, c.path, c.source].filter((s) => s !== undefined).join("-");

/** An unset value reads as an em dash, not "undefined" — `null` is
 *  setLabelOverride's wire spelling of "unset this key". */
const val = (v: unknown) =>
  v === undefined || v === null ? "—"
    : typeof v === "object" ? JSON.stringify(v) : String(v);

/** What one entry of a list is called: a Choice by its title, else its value,
 *  a text line by its text, a plain string as itself. */
const entryName = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object") return String(v);
  const o = v as { title?: string; value?: unknown; text?: string };
  return String(o.title ?? o.value ?? o.text ?? JSON.stringify(v));
};

/** A list-valued path — a fill vocabulary, a layer's lines — reads as its
 *  count and the ONE entry that came or went, not as its JSON. leafPaths
 *  treats an array as a single leaf, so a vocabulary arrives here whole: eight
 *  tier objects stringified is not something anyone can review, and the review
 *  is the only thing between a learned value and the template
 *  (docs/plans/choice-input.md, Task 7).
 *
 *  One entry swapped for another names both. More than that falls back to the
 *  counts alone: naming two of five changes is worse than naming none, because
 *  it reads as the whole story. */
function listText(from: readonly unknown[], to: readonly unknown[]): string {
  const key = (v: unknown) => JSON.stringify(v);
  const before = from.map(key);
  const after = to.map(key);
  const added = to.filter((v) => !before.includes(key(v)));
  const removed = from.filter((v) => !after.includes(key(v)));
  const counts = `${from.length} → ${to.length}`;
  if (added.length === 1 && removed.length === 0) return `${counts} (+ "${entryName(added[0])}")`;
  if (removed.length === 1 && added.length === 0) return `${counts} (− "${entryName(removed[0])}")`;
  // One entry swapped for another — an edited text line — names both, or the
  // row reads "1 → 1" and says nothing (#130).
  if (removed.length === 1 && added.length === 1)
    return `${counts} ("${entryName(removed[0])}" → "${entryName(added[0])}")`;
  return counts;
}

/** What the row says happened, in the reviewer's terms rather than the
 *  model's. Structural rows are a sentence; a property or promote row is a
 *  path and a before/after, set in mono because that is literally what they
 *  are — a key path and its values. */
function rowText(c: MasterChange, t: (key: string, options?: Record<string, unknown>) => string): React.ReactNode {
  switch (c.kind) {
    case "added": return t("Added to the master");
    case "removed": return t("Removed from the master");
    case "moved": return t("Reordered");
    case "renamed": return t('Renamed from "{{name}}"', { name: String(c.from) });
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
  as?: boolean;
  onCancel: () => void;
  /** The ticked `promote` rows, in the order they were listed. */
  onConfirm: (promote: MasterChange[]) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
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

  // Every promotable row, in list order — what the "all overrides" tick
  // covers. The structural rows are not offered: they are already in the
  // master.
  const promotable = useMemo(
    () => props.changes.filter((c) => c.kind === "promote").map(rowId),
    [props.changes]);
  const allTicked = promotable.length > 0 && promotable.every((id) => ticked.has(id));

  const toggle = (id: string) => setTicked((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>{props.as ? t("Save Master As") : t("Save Master")}</DialogTitle>
        <DialogDescription>
          {props.as
            ? t("Save these changes as a new master. Pick any label overrides you want to include. The original stays as it is.")
            : props.changes.length === 0
            ? t("No changes to save in the master.")
            : props.target === undefined
              ? t("Save these changes to the master. Pick any label overrides you want to keep there too.")
              : t("Save these changes to the master. Selected overrides go into the {{target}} version.", { target: props.target })}
        </DialogDescription>
        {promotable.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              data-row="all"
              checked={allTicked}
              onCheckedChange={() => setTicked(allTicked ? new Set() : new Set(promotable))} />
            <span>{t("Promote all {{count}} override", { count: promotable.length })}</span>
          </label>
        )}
        <div className="max-h-80 overflow-y-auto text-sm">
          {groups.map((g) => (
            <div key={g.rows[0].layerId} className="mt-2 first:mt-0">
              <p className="text-xs font-medium text-muted-foreground">{g.name}</p>
              {g.rows.map((c) => {
                const row = rowId(c);
                return c.kind === "promote" ? (
                  <label key={row} className="mt-1 flex items-center gap-2">
                    <Checkbox data-row={row} checked={ticked.has(row)} onCheckedChange={() => toggle(row)} />
                    <span className="text-attention-text">{rowText(c, t)}</span>
                  </label>
                ) : (
                  <p key={row} data-row={row}
                    className={cn("mt-1", c.kind === "removed" ? "text-destructive-text" : "text-muted-foreground")}>
                    {rowText(c, t)}
                  </p>
                );
              })}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={props.onCancel}>{t("Cancel")}</Button>
          <Button variant="attention" size="sm" onClick={confirm}>{props.as ? t("Save Master As") : t("Save Master")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
