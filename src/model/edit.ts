// src/model/edit.ts — the pure editing operations on the v3 model (spec:
// docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI" and
// "Removed"). Every function returns a new object and never mutates its
// input, so App can keep undo snapshots by reference.
//
// The one routing rule: WHERE AN EDIT LANDS FOLLOWS THE LAYER. A layer a
// variant's diff ADDS (an id master.layers lacks) is edited in that diff; a
// master layer is edited in master.layers. There is no editing-target
// selector. A variant overriding a MASTER layer (Collab moving the logo) is
// the one explicit case, `setLayerIn`. Bindings (`y: { below, gap }`) are
// validated through parseMaster so Design mode can never save a master the
// loader would reject.
//
// This file is the public surface; the operations live in sibling modules by
// family (#433), and callers keep importing from here:
//   editRecords  — the shared patch/entry shapes, Doc, variant-diff helpers
//   editLayers   — ids, layer lifecycle, the Design write path, override
//                  clearing and reset badges, referenced asset ids
//   editGestures — bind/unbind, snapping, the drag and resize patches
//   editVariants — enabled versions; add/remove/rename a variant
//   editLabel    — label values/overrides and the label-first rule
//                  (patchLayers: an inspector edit lands on the label, only
//                  the fill contract on the master)
//   editSave     — dirty check, Untitled restore, Save Master review
export type { Doc } from "./editRecords";
export {
  addLayer, adoptMaster, clearOverride, labelOverriddenPaths, masterAssetIds, mintLayerId,
  moveLayers, overriddenPaths, overrideBadges, patchLayer, patchLayerIn, referencedAssetIds,
  removeLayer, removeLayerIn, setLayer, setLayerIn, unsetLayerKeys, whereLayerLives,
  type OverrideBadges,
} from "./editLayers";
export {
  bindingPatch, moveBy, nearestLine, resizeBy, snapDelta, unbindPatch,
  type ResizeHandle, type SnapTarget,
} from "./editGestures";
export {
  addVariant, removeVariant, removeVariantIn, renameVariant, showVersion, toggleVariant,
} from "./editVariants";
export {
  checkLabelBindings, clearLabelOverride, clearValue, learnChoice, learnValueIn, patchLayers, setContentIn,
  setLabelOverride, setValue,
} from "./editLabel";
export {
  applyPromotions, masterChanges, masterDiff, structureOnlyMaster, type MasterChange,
} from "./editSave";
