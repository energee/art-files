// src/model/skip.ts — pure: what a plan-driven build must OMIT, in one place,
// so the preview and the exported deliverables cannot disagree about it.
//
// Two independent sources say "this layer does not draw": the layers panel's
// per-session eyes (App's hiddenLayers) and the master/variant resolution
// (resolve()'s disabledLayers — a layer the panel disabled on the master, or
// one owned by a variant that is off). Their union is what planLabel's `skip`
// and Assets.hidden take.
//
// It lives here, beside resolve.ts which produces half of it, because it is
// pure model logic and because src/model/ is this codebase's DOM-free
// directory: tests import from it without standing up happy-dom. Deliberately
// typed on plain `string` rather than importing elements.ts's ElementId — the
// pure model never depends on the UI registry (see model/types.ts's
// MasterLayer doc, which re-declares the built-in ids for the same reason),
// and a `has(id: string)` reader satisfies every `has(id: ElementId)` slot it
// is passed into.

/** The union of the layers-panel eyes and the resolution's disabled layers.
 *  ONE spelling, shared by App's preview skip memo and its buildFull export
 *  assets: they used to compute it separately and the export forgot
 *  `disabled`, so a built-in master layer switched off in the panel vanished
 *  from the preview and still PRINTED — a wrong deliverable. Since
 *  `collabEnabled` was deleted from LabelConfig, this set is also the only
 *  thing suppressing the collab block on a non-collab label, which makes the
 *  two agreeing load-bearing rather than tidy.
 *
 *  Both arguments are read-only probes, so a Set of either side's own id type
 *  passes without conversion. Covered by tests/app-layer-doc.test.ts (the
 *  union itself) and tests/pdf-build.test.ts (the export consequence, at the
 *  builder). */
export function buildSkip(
  hidden: { has(id: string): boolean }, disabled: { has(id: string): boolean },
): { has(id: string): boolean } {
  return { has: (id: string) => hidden.has(id) || disabled.has(id) };
}
