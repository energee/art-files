// selection.ts — the pure rules behind multi-select in the Layers list and
// the preview. Kept out of the components so the interesting part (range
// resolution, toggling) is testable without a DOM.
//
// The model is Figma's: an ordered selection plus an anchor. The anchor is
// the last row clicked WITHOUT shift, so a run of shift-clicks all extend
// from the same stable point rather than walking one row at a time. Ids are
// layer ids (model/layers.ts); every layer — the page art included — is an
// ordinary row, so there is no single-select special case any more.

/** Modifier keys as the list/preview report them. `toggle` is ⌘ on macOS,
 *  Ctrl elsewhere — see modsOf, which is where that platform rule lives. */
export interface SelectMods {
  shift?: boolean;
  toggle?: boolean;
}

/** Read a click's modifiers. Every selection surface (the Layers list, the
 *  preview canvas) reads them here, so the ⌘-or-Ctrl rule is stated once and
 *  a new gesture can't mean one thing in the list and another on canvas. */
export const modsOf = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): SelectMods =>
  ({ shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });

export interface Selection {
  /** Selected layers, in click/extension order. Empty = nothing selected. */
  ids: readonly string[];
  /** Where a shift-range extends from; null once the selection is cleared. */
  anchor: string | null;
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null };

/** What a gesture (canvas drag, row reorder) on layer `id` acts on: the whole
 *  selection when `id` is in it, else just that layer — the same rule on
 *  both surfaces. */
export const gestureIds = (selected: readonly string[], id: string): readonly string[] =>
  selected.includes(id) ? selected : [id];

/** Resolve a row click against the current selection. `order` is the
 *  list's row order (front to back) — the order a shift-range is read in, so
 *  a range crosses the rows the way the visible list does. */
export function resolveSelect(
  sel: Selection, id: string, mods: SelectMods, order: readonly string[],
): Selection {
  const only = { ids: [id], anchor: id };

  if (mods.shift && sel.anchor) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(id);
    if (a === -1 || b === -1) return only;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    // Sliced in list order, then reversed for an upward range so the ids
    // read out from the anchor — the direction the user dragged.
    const range = order.slice(lo, hi + 1);
    return { ids: a <= b ? range : range.reverse(), anchor: sel.anchor };
  }

  if (mods.toggle) {
    const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
    // Deselecting the anchor leaves the range with nothing to extend from, so
    // the click's row becomes the anchor either way — unless the toggle emptied
    // the selection, which clears it (a shift-click after that would otherwise
    // extend from an invisible row instead of selecting plainly).
    return { ids, anchor: ids.length ? id : null };
  }

  return only;
}
