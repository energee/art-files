// selection.ts — the pure rules behind multi-select in the layers panel and
// the preview. Kept out of the components so the interesting part (range
// resolution, toggling, mixed-value detection) is testable without a DOM.
//
// The model is Figma's: an ordered selection plus an anchor. The anchor is
// the last row clicked WITHOUT shift, so a run of shift-clicks all extend
// from the same stable point rather than walking one row at a time.
import { isElementId, type LayerId } from "@/components/layers";

/** Modifier keys as the panel/preview report them. `toggle` is ⌘ on macOS,
 *  Ctrl elsewhere — see modsOf, which is where that platform rule lives. */
export interface SelectMods {
  shift?: boolean;
  toggle?: boolean;
}

/** Read a click's modifiers. Every selection surface (the layers panel, the
 *  preview canvas) reads them here, so the ⌘-or-Ctrl rule is stated once and
 *  a new gesture can't mean one thing in the panel and another on canvas. */
export const modsOf = (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): SelectMods =>
  ({ shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });

export interface Selection {
  /** Selected layers, in click/extension order. Empty = nothing selected. */
  ids: readonly LayerId[];
  /** Where a shift-range extends from; null once the selection is cleared. */
  anchor: LayerId | null;
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null };

/** Resolve a row click against the current selection.
 *
 *  `order` is the panel's row order (ELEMENTS order, see PANEL_ORDER) — the
 *  order a shift-range is read in, so a range crosses group boundaries the
 *  way the visible list does.
 *
 *  The document layers (Background, Mask, Settings) are single-select: they
 *  carry file drops and document knobs rather than a Style, so mixing one
 *  into a multi-element style edit would show a panel that can't apply to
 *  its own selection. Any click involving one collapses to just that layer. */
export function resolveSelect(
  sel: Selection, id: LayerId, mods: SelectMods, order: readonly LayerId[],
): Selection {
  const only = { ids: [id], anchor: id };
  if (!isElementId(id)) return only;

  if (mods.shift && sel.anchor && isElementId(sel.anchor)) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(id);
    if (a === -1 || b === -1) return only;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    // Sliced in panel order, then reversed for an upward range so the ids
    // read out from the anchor — the direction the user dragged.
    const range = order.slice(lo, hi + 1).filter(isElementId);
    return { ids: a <= b ? range : range.reverse(), anchor: sel.anchor };
  }

  if (mods.toggle) {
    // A doc layer in the current selection can't be added to; ⌘-clicking an
    // element next to it replaces rather than mixes.
    if (sel.ids.some((x) => !isElementId(x))) return only;
    const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
    // Deselecting the anchor leaves the range with nothing to extend from,
    // so the click's row becomes the anchor either way.
    return { ids, anchor: id };
  }

  return only;
}

/** The one value shared by every element in a multi-selection, or undefined
 *  when they disagree — what the inspector renders blank instead of showing
 *  the first element's value as if it were everyone's. Undefined for an empty
 *  list too: there is no shared value. */
export function sharedValue<T>(values: readonly T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values.every((v) => v === values[0]) ? values[0] : undefined;
}
