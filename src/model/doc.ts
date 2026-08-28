// model/doc.ts — the pure Doc-transition layer: `Doc` (one document's
// undoable state — config, enabled variants, master, and the dormant bench)
// and every pure function that produces a new Doc from an old one. These
// used to live inline in src/App.tsx, accumulated one at a time across five
// tasks (master authoring, variant overrides, layer policy, field
// declarations, and non-destructive rebind) until the test suite importing
// them (tests/design-routing.test.ts, tests/app-layer-doc.test.ts) was
// coupling itself to a ~3000-line React component's whole module graph just
// to reach functions that touch no React and no UI registry. Moved here
// verbatim — this is a MOVE, not a rewrite; App.tsx's `update`/`layerEdit`/
// etc. wrappers still own the side effects (markDirty, setDoc, setEditingTarget)
// and call straight through to these.
//
// Deliberately free of React and of src/elements.ts (the UI element
// registry): a transition that needs a UI-only type takes it as a plain
// parameter instead (see addLayerDoc's `style: unknown`).
import type { LabelConfig } from "@/types";
import type { FieldDecl, LabelFileV2, Master, MasterLayer } from "@/model/types";
import {
  addField, addLayer, addVariant, applyDesignEdit, applyLayerEdit, applyMaterializedLayerEdit,
  composeConfig, configDiff, fieldsAt, getPath, moveLayer, removeField, renameField,
  resetOverride, toggleVariant, valuesFromConfig, type EditTarget,
} from "@/model/document";
import { setPath } from "@/model/resolve";
import { rebind } from "@/model/rebind";

/** The undoable half of one document: the live config, which of its master's
 *  variants are enabled, and the master itself. All three travel together
 *  through history (see useHistory<Doc> in App.tsx) so undoing a variant
 *  toggle restores the FieldList checkboxes in the same step as the config it
 *  produced — and, since Design mode authors the master rather than the label
 *  (see `designEditDoc`), so a design edit's new master and the config it
 *  recomposed undo as ONE step instead of drifting apart.
 *
 *  `dormant` rides in Doc (not just the persisted LabelFileV2) so a LIVE
 *  session's chain of rebinds stays non-destructive too: picking master B
 *  then master A back again, both from the picker, without an intervening
 *  save, still has to restore what B's rebind benched. Absent = nothing
 *  benched (the common case — a document that has never been rebound). */
export type Doc = {
  cfg: LabelConfig; enabledVariants: string[]; master: Master;
  dormant?: LabelFileV2["dormant"];
};

/** The editing target, clamped to something `master` still declares. The
 *  target is UI state outside history while the variant it names rides IN
 *  history, so the two can genuinely disagree: undo past a "New variant…"
 *  drops the variant while the selector still points at it, and opening a
 *  project whose master has no such variant does the same. Without this,
 *  applyDesignEdit would map over `variants`, match nothing, and hand back a
 *  new-but-identical master — past designEditDoc's identity guard — so the
 *  edit would be silently discarded while the tab went dirty. Falling back to
 *  the master keeps the edit; App also resets the selector on open (see
 *  resetDocument) and renders through this, so the UI can't show a variant
 *  the document has lost. */
export function clampTarget(master: Master, target: EditTarget): EditTarget {
  if (target === "master") return "master";
  return master.variants.some((v) => v.id === target.variant) ? target : "master";
}

/** The pure doc transition behind a per-LABEL edit: mutate this document's
 *  own config and nothing else. Exactly what every edit did before Design
 *  mode learned to author masters, and still the whole story in Fill mode.
 *  Exported so the routing has a test (tests/design-routing.test.ts) without
 *  mounting the whole editor. */
export function labelEditDoc(doc: Doc, mutate: (c: LabelConfig) => void): Doc {
  const cfg = structuredClone(doc.cfg);
  mutate(cfg);
  return { ...doc, cfg };
}

/** Recompose `doc.cfg` against `master`, keeping this label's own deviations:
 *  its overrides are diffed off the OLD master's compose and re-applied on
 *  top of the new one, so authoring the master never silently discards them.
 *  The shared tail of every doc transition that changes `master` and needs
 *  `cfg` recomposed in the SAME history entry (designEditDoc, addLayerDoc,
 *  moveLayerDoc, materializedLayerEditDoc, resetOverrideDoc) — extracted so
 *  none of them can drop a field Doc gains later (Task 4b's `dormant` was
 *  once typed by hand into five separate object literals; a sixth field
 *  would land `undefined` in whichever site forgot it, with no compile error
 *  and no failing test). Spreads `doc`, never re-enumerates its fields. */
export function recompose(doc: Doc, master: Master): Doc {
  const values = valuesFromConfig(doc.master, doc.enabledVariants, doc.cfg);
  const overrides = configDiff(
    composeConfig(doc.master, doc.enabledVariants, values, undefined).config, doc.cfg);
  const cfg = composeConfig(
    master, doc.enabledVariants, values,
    Object.keys(overrides).length ? overrides : undefined).config;
  return { ...doc, cfg, master };
}

/** The pure doc transition behind a DESIGN edit: run the same LabelConfig
 *  mutation, but record its diff on the master (or the editing variant)
 *  instead of this label — see applyDesignEdit in model/document.ts. Returns
 *  `doc` itself when the mutation changed nothing (the identity
 *  applyDesignEdit promises) — no history entry, no phantom dirty dot. */
export function designEditDoc(
  doc: Doc, target: EditTarget, mutate: (c: LabelConfig) => void,
): Doc {
  const at = clampTarget(doc.master, target);
  const values = valuesFromConfig(doc.master, doc.enabledVariants, doc.cfg);
  const master = applyDesignEdit(doc.master, at, doc.enabledVariants, values, mutate);
  if (master === doc.master) return doc;
  return recompose(doc, master);
}

/** The pure doc transition behind a layer POLICY edit (rename / enable /
 *  lock) at `target` — see applyLayerEdit. Layer policy is not part of
 *  LabelConfig, so it cannot ride designEditDoc's diff. Returns `doc` itself
 *  when the patch is already what the target stores, so re-picking a layer's
 *  current name or re-clicking a lock into the same state neither dirties the
 *  document nor pushes an undo step. (applyLayerEdit always allocates, so
 *  this guard has to be here, not there — and it compares against the
 *  TARGET's stored value, which for a variant is its layerOverrides entry,
 *  not the resolved row the panel is showing.) */
export function layerEditDoc(
  doc: Doc, target: EditTarget, layerId: string, patch: Partial<MasterLayer>,
): Doc {
  const at = clampTarget(doc.master, target);
  const current: Partial<MasterLayer> | undefined = at === "master"
    ? doc.master.layers.find((l) => l.id === layerId)
    : doc.master.variants.find((v) => v.id === at.variant)?.layerOverrides[layerId];
  const noop = current !== undefined && Object.entries(patch).every(
    ([k, v]) => (current as Record<string, unknown>)[k] === v);
  if (noop) return doc;
  return { ...doc, master: applyLayerEdit(doc.master, at, layerId, patch) };
}

/** The pure doc transition behind Design mode's "Make fillable" (addField):
 *  declare a field at the (clamped) editing target. `doc` itself
 *  (addField's own identity contract) when `decl.path` is already declared
 *  anywhere in the master (model/document.ts's declaredFieldPaths — fix
 *  round 1).
 *
 *  Fix round 1 (Important): re-declaring a field under an id the label's
 *  `dormant` store still remembers (Task 4b's non-destructive bench —
 *  model/rebind.ts) restores its benched value into `cfg` at `decl.path`
 *  and drops it from `dormant` — the mirror of removeFieldDoc's benching
 *  below, and the same "match by id" contract rebind() itself uses. Every
 *  other case carries no LabelConfig diff of its own — unlike
 *  designEditDoc/resetOverrideDoc, cfg needs no recompose there — so this
 *  is otherwise layerEditDoc's shape. Exported for the same reason as its
 *  siblings: testable without mounting the editor. */
export function addFieldDoc(doc: Doc, target: EditTarget, decl: FieldDecl): Doc {
  const at = clampTarget(doc.master, target);
  const master = addField(doc.master, at, decl);
  if (master === doc.master) return doc;
  const benched = doc.dormant?.values[decl.id];
  if (benched === undefined) return { ...doc, master };
  const cfg = structuredClone(doc.cfg);
  setPath(cfg as unknown as Record<string, unknown>, decl.path, benched);
  const { [decl.id]: _restored, ...restValues } = doc.dormant!.values;
  const dormant = Object.keys(restValues).length > 0 || doc.dormant!.variants.length > 0
    ? { values: restValues, variants: doc.dormant!.variants }
    : undefined;
  return { ...doc, cfg, master, dormant };
}

/** The pure doc transition behind Design mode's "Add layer" (addLayer): add
 *  a `kind`-bearing layer at the (clamped) editing target and recompose cfg
 *  in the SAME history entry — same shape as designEditDoc, since adding a
 *  layer changes `config.customLayers` (via resolve()'s materialization)
 *  exactly the way a style edit changes any other config path. addLayer
 *  never returns `master` unchanged (every call mints a fresh layer id), so
 *  unlike designEditDoc there is no identity/no-op case to guard here. */
export function addLayerDoc(
  doc: Doc, target: EditTarget, layer: MasterLayer, style: unknown,
): Doc {
  const at = clampTarget(doc.master, target);
  const master = addLayer(doc.master, at, layer, style);
  return recompose(doc, master);
}

/** The pure doc transition behind the layers panel's custom-row reorder
 *  (moveLayer): move one `kind`-bearing layer within its own list (the
 *  master's `layers`, or the owning variant's) and recompose cfg — the
 *  reorder changes the DRAW ORDER resolve() materializes `customLayers` in,
 *  so it needs the same recompose designEditDoc/addLayerDoc do. `doc` itself
 *  (moveLayer's own identity contract) when the move is a no-op: the layer
 *  isn't `kind`-bearing, or it's already at that end of its custom range. */
export function moveLayerDoc(doc: Doc, layerId: string, delta: -1 | 1): Doc {
  const master = moveLayer(doc.master, layerId, delta);
  if (master === doc.master) return doc;
  return recompose(doc, master);
}

/** The pure doc transition behind a MATERIALIZED custom row's policy edit
 *  made from the LAYERS PANEL (currently just its Lock button) —
 *  applyMaterializedLayerEdit, id-search
 *  based rather than editing-target based. NOT layerEditDoc/layerEdit: those
 *  resolve ownership through the currently CLAMPED editing target, which is
 *  wrong here — a materialized row's owner (the master, or whichever variant
 *  addLayer targeted) is fixed at add time, and can legitimately differ from
 *  whatever the editing-target selector shows while the row is still visible
 *  (its own owning variant just has to be enabled, not selected). Recomposes
 *  cfg in the same history entry, same shape as moveLayerDoc — a lock toggle
 *  changes `MasterLayer.locked`, which resolve()'s materialization stamps
 *  straight onto the CustomLayer it builds. `doc` itself
 *  (applyMaterializedLayerEdit's own identity contract) when the patch is
 *  already what's stored.
 *
 *  The INSPECTOR's own Name/lock/Remove controls do NOT come through here:
 *  they mutate `cfg.customLayers` like every other style control and reach
 *  the same master-side operations through designEditDoc's routing
 *  (model/document.ts's routeCustomLayers). The panel's Lock keeps its own
 *  entry point because it has no LabelConfig mutation to route — it patches
 *  policy directly. */
export function materializedLayerEditDoc(
  doc: Doc, layerId: string, patch: Partial<MasterLayer>,
): Doc {
  const master = applyMaterializedLayerEdit(doc.master, layerId, patch);
  if (master === doc.master) return doc;
  return recompose(doc, master);
}

/** The pure doc transition behind TargetFields' inline rename, offered once
 *  a field is unlocked (see EditingTarget.tsx's TargetFields — "no read-only
 *  fields"). Same no-cfg-recompose shape as addFieldDoc; `doc` itself when
 *  renameField is a no-op (id not declared at this target, or already
 *  called `label`). */
export function renameFieldDoc(doc: Doc, target: EditTarget, fieldId: string, label: string): Doc {
  const at = clampTarget(doc.master, target);
  const master = renameField(doc.master, at, fieldId, label);
  return master === doc.master ? doc : { ...doc, master };
}

/** The pure doc transition behind TargetFields' remove, offered once a field
 *  is unlocked.
 *
 *  Fix round 1 (Important): a filler's already-entered value must not
 *  silently vanish on the next save just because the field declaring it was
 *  removed — `valuesFromConfig` only ever reads what `visibleFieldsOf`
 *  still declares, so an un-benched removal would quietly drop the value
 *  from the saved .label the moment the field is gone (the same class of
 *  loss Task 4b's `dormant` store exists to prevent — model/rebind.ts).
 *  Before removing, the field's CURRENT value is read off `doc.cfg` at its
 *  own path and benched into `doc.dormant.values` under its own id, exactly
 *  where rebind() benches an unmatched value — addFieldDoc above restores it
 *  if a field with the same id is ever declared again. No bench entry when
 *  the field's value isn't a plain FieldValue (string/number/boolean) —
 *  matches valuesFromConfig's own filter, since dormant is typed the same
 *  way LabelFileV2.values is. */
export function removeFieldDoc(doc: Doc, target: EditTarget, fieldId: string): Doc {
  const at = clampTarget(doc.master, target);
  const field = fieldsAt(doc.master, at)?.find((f) => f.id === fieldId);
  const master = removeField(doc.master, at, fieldId);
  if (master === doc.master) return doc;
  const value = field ? getPath(doc.cfg, field.path) : undefined;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    return { ...doc, master };
  const dormant = {
    values: { ...doc.dormant?.values, [fieldId]: value },
    variants: doc.dormant?.variants ?? [],
  };
  return { ...doc, master, dormant };
}

/** The pure doc transition behind a per-PROPERTY RESET (the inspector's
 *  overridden-property badges, Task 3): drop one dot-path from the editing
 *  variant's overrides (resetOverride), restoring the master's value, with
 *  cfg recomposed in the SAME history entry — the same shape as
 *  designEditDoc above, except the mutation is resetOverride's path deletion
 *  rather than an arbitrary LabelConfig edit, so the label's own deviations
 *  survive the reset exactly as they survive any other design edit. A no-op
 *  for the master target (resetOverride's own no-op — the master overrides
 *  nothing, so no badge ever calls this against it) and returns `doc` itself
 *  when the path wasn't actually overridden, matching designEditDoc's
 *  identity contract (no history entry, no phantom dirty dot). */
export function resetOverrideDoc(doc: Doc, target: EditTarget, path: string): Doc {
  const at = clampTarget(doc.master, target);
  const master = resetOverride(doc.master, at, path);
  if (master === doc.master) return doc;
  return recompose(doc, master);
}

/** The document's current state as a LabelFileV2 (minus `masterHint`, which
 *  only Save fills in) — values/enabledVariants recomposed off the live cfg,
 *  plus whatever `doc.dormant` is still benched. This is "the label" as far
 *  as rebind is concerned: MasterPicker's preview, the picker's commit, File
 *  → Open Master, and Save Project all have to agree on what it is, so it's
 *  computed in exactly one place. */
export function labelSnapshot(doc: Doc): Omit<LabelFileV2, "masterHint"> {
  const values = valuesFromConfig(doc.master, doc.enabledVariants, doc.cfg);
  const overrides = configDiff(
    composeConfig(doc.master, doc.enabledVariants, values, undefined).config, doc.cfg);
  return {
    formatVersion: 2, masterId: doc.master.id, enabledVariants: doc.enabledVariants, values,
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(doc.dormant ? { dormant: doc.dormant } : {}),
  };
}

/** The pure doc transition behind the Editing selector's "New variant…":
 *  mint the variant (addVariant), enable it (a fresh variant you can't see
 *  is useless, so toggleVariant runs immediately), and recompose cfg — all
 *  in ONE returned Doc. Spread from the previous doc, not a bare object
 *  literal, so Doc.dormant (a rebind's bench — Task 4b) survives an edit
 *  that has nothing to do with rebinding; exported/pure, like
 *  designEditDoc/labelEditDoc above, precisely so that survival is pinned
 *  by a test without mounting the whole editor (tests/design-routing.test.ts). */
export function addVariantDoc(doc: Doc, name: string): { doc: Doc; id: string } {
  const { master: withVariant, id } = addVariant(doc.master, name);
  const r = toggleVariant(withVariant, doc.cfg, doc.enabledVariants, id, true);
  return { doc: { ...doc, cfg: r.config, enabledVariants: r.enabled, master: withVariant }, id };
}

/** The pure doc transition behind re-aiming a document at a different
 *  master — File → Open Master, the master picker's "Continue", and
 *  "Duplicate as new master…" all funnel through this (App.tsx's
 *  commitRebind owns the side effects: pristineMaster, setEditingTarget,
 *  setDoc, markDirty, and reporting `notes` through setLoadError). Routes
 *  the live label (labelSnapshot, folding in whatever `doc.dormant` is
 *  already benched) through rebind (model/rebind.ts, non-destructive since
 *  Task 4b) onto the new master's fields, then recomposes `cfg` so the
 *  master swap and the config it produced land in the caller's one history
 *  entry. Whatever the rebind can't match goes onto the new doc's `dormant`
 *  (never dropped); `notes` is the advisory text a lossy rebind reports —
 *  the same slot a lossy compose's warnings use — for the caller to surface. */
export function rebindDoc(doc: Doc, target: Master): { doc: Doc; notes: string[] } {
  const { label: rebound, dropped, disabledVariants } = rebind(labelSnapshot(doc), target);
  const composed = composeConfig(target, rebound.enabledVariants, rebound.values, rebound.overrides);
  const nextDoc: Doc = {
    cfg: composed.config, enabledVariants: rebound.enabledVariants, master: target,
    dormant: rebound.dormant,
  };
  const notes = [...composed.warnings];
  if (dropped.length)
    notes.push(`${dropped.length} value${dropped.length === 1 ? "" : "s"} benched`);
  if (disabledVariants.length)
    notes.push(`${disabledVariants.length} variant${disabledVariants.length === 1 ? "" : "s"} benched`);
  return { doc: nextDoc, notes };
}
