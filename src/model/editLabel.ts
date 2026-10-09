// src/model/editLabel.ts — edit.ts's label family: a label's values and
// overrides, and THE ROUTING RULE (patchLayers) that sends a property edit to
// the label and only the fill contract to the master. checkLabelBindings is
// the label-side twin of parseMaster's binding check.
import type { LabelFile, LayerValue, Master } from "./layers";
import { validateBindings } from "./layers";
import { deepMerge, type DeepPartial } from "./merge";
import { resolveLayers } from "./resolveLayers";
import { validateFor } from "../barcode";
import { fieldRefs } from "./format";
import { without, type Doc, type Entry, type LayerPatch } from "./editRecords";
import { clearEntry, isLabelOnly, patchLayer } from "./editLayers";
import { enableBeneathVersion } from "./editVariants";

// --- Label ------------------------------------------------------------------

export function setValue(label: LabelFile, id: string, value: LayerValue): LabelFile {
  return { ...label, values: { ...label.values, [id]: structuredClone(value) } };
}

export function clearValue(label: LabelFile, id: string): LabelFile {
  return { ...label, values: without(label.values, id) };
}

/** A label-level deviation from the resolved master (the .label `overrides`).
 *
 *  An own-property `undefined` in `patch` is stored as `null`, the wire
 *  spelling of "unset this key" (LayerInspector emits `{ width: undefined }`
 *  to clear a wrap width). It cannot stay `undefined`: deepMerge skips
 *  undefined, and JSON drops it, so the clear would be lost either at resolve
 *  time or on save. resolveLayers deletes null-valued paths after merging —
 *  see applyDiff there. This mirrors patchLayer's clear rule for the master. */
export function setLabelOverride(label: LabelFile, id: string, patch: LayerPatch): LabelFile {
  const overrides = label.overrides ?? {};
  const p = patch as Record<string, unknown>;
  const withNulls = Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, v === undefined ? null : v]),
  ) as DeepPartial<Entry>;
  return { ...label, overrides: { ...overrides, [id]: deepMerge(overrides[id] ?? {}, withNulls) } };
}

/** The FILL CONTRACT: the keys that declare what a filler may put in a layer.
 *  They cannot be per-label — a label overriding its own placeholder or its
 *  own allowed range is meaningless — so they are authored on the master like
 *  structure is, and the Save Master review lists them as such. Everything
 *  else about a layer is the label's to override.
 *
 *  `choices` and `title` are here for the same reason: the vocabulary a filler
 *  picks from, and the caption it is picked under, describe the slot rather
 *  than one label's answer to it (docs/plans/choice-input.md). */
const MASTER_PATHS: ReadonlySet<string> =
  new Set(["placeholder", "input", "min", "max", "symbology", "suffix",
    "choices", "title"]);

/** THE ROUTING RULE (docs/plans/label-first-editing.md): a property edit is a
 *  LABEL override, never a master edit — except the fill contract above. The
 *  master is the template and otherwise changes only through a reviewed save,
 *  so a patch does not write `master.layers`, not even for a layer a variant
 *  added: the label overrides that the same way it overrides a master layer
 *  (resolveLayers applies variants first, then the label).
 *
 *  A patch carrying both — the inspector never emits one, but a caller may —
 *  is SPLIT, each half taking its own path, rather than sent whole to either.
 *
 *  Several entries in one call so a group drag is one undo step.
 *
 *  The one master-side effect kept: switching a layer ON that only exists
 *  while some variant is enabled also enables that variant. That is a label
 *  edit (`enableBeneathVersion`), not a master one — without it the patch
 *  would set `enabled` on a layer that still does not resolve. It enables
 *  BENEATH the working version so the promote target does not move under
 *  the user.
 *
 *  A design patch on a layer this document does NOT resolve — one only a
 *  disabled variant adds, which the list still shows as a row — is dropped.
 *  Writing it would store an override resolveLayers can only warn about
 *  ("Label overrides unknown layer …") while changing nothing on the canvas.
 *  Dropping it makes the click an honest no-op: no edit, no history entry,
 *  no warning. The fill contract still routes to the master, since those
 *  fields live in the master file whether the variant is on or not.
 *
 *  Bindings are NOT checked here — see checkLabelBindings (#93). */
export function patchLayers(doc: Doc, entries: [string, LayerPatch][]): Doc {
  const masterIds = new Set(doc.master.layers.map((l) => l.id));
  /** Every layer id this document RESOLVES: the master's, plus those the
   *  enabled variants add. Built once per call — patchLayers runs per
   *  pointermove of a drag, and only the rare `enabled: true` branch below
   *  can widen it (by switching a variant on), which re-reads it there. */
  const resolvable = (label: LabelFile) => {
    const ids = new Set(masterIds);
    for (const v of doc.master.variants)
      if (label.enabledVariants.includes(v.id)) for (const k of Object.keys(v.layers)) ids.add(k);
    for (const [id, patch] of Object.entries(label.overrides ?? {})) if (patch.kind) ids.add(id);
    return ids;
  };
  let resolves = resolvable(doc.label);
  return entries.reduce((d, [id, patch]) => {
    const keys = Object.keys(patch);
    const labelOnly = isLabelOnly(d.master, d.label, id);
    const contract = keys.filter((k) => !labelOnly && MASTER_PATHS.has(k));
    const rest = keys.filter((k) => labelOnly || !MASTER_PATHS.has(k));
    const pick = (ks: string[]) =>
      Object.fromEntries(ks.map((k) => [k, (patch as Record<string, unknown>)[k]])) as LayerPatch;

    const master = contract.length ? patchLayer(d.master, id, pick(contract)) : d.master;
    let label = d.label;
    if (patch.enabled === true && !masterIds.has(id)) {
      const owner = d.master.variants.find((v) => id in v.layers);
      if (owner && !label.enabledVariants.includes(owner.id)) {
        label = enableBeneathVersion(label, owner.id);
        resolves = resolvable(label);
      }
    }
    if (rest.length && resolves.has(id)) label = setLabelOverride(label, id, pick(rest));
    return master === d.master && label === d.label ? d : { master, label };
  }, doc);
}

/** Returns `doc` unchanged, or THROWS when its label's resolved layers break
 *  a binding — an enabled layer bound to a disabled or missing one, or a
 *  cycle. The label-side twin of parseMaster's check (the same
 *  validateBindings), run by App's `edit` on every edit — the label can
 *  reshape the graph (a patch, an override reset, a version switch) where
 *  parseMaster never looks. Without it placeLayers throws on preview and
 *  export (issue #93).
 *
 *  Patch functions such as patchLayers do not check bindings themselves: a
 *  patch may switch off a layer another is bound to, and only the whole
 *  edit's result is judged, so switching a layer off together with its
 *  dependents is allowed.
 *
 *  Given `prev` (the doc the edit started from), the check is skipped when
 *  nothing that shapes the binding graph changed — the master's layers and
 *  variants and the label's enabledVariants and overrides are all the same
 *  objects. Values-only edits (typing) then skip a full resolveLayers per
 *  keystroke; `prev` was already checked when it was written. */
export function checkLabelBindings(doc: Doc, prev?: Doc): Doc {
  if (prev
    && doc.master.layers === prev.master.layers && doc.master.variants === prev.master.variants
    && doc.label.enabledVariants === prev.label.enabledVariants && doc.label.overrides === prev.label.overrides)
    return doc;
  const { layers } = resolveLayers(doc.master, doc.label.enabledVariants, {}, doc.label.overrides, { keepDisabled: true });
  validateBindings(layers, "label", (msg) => { throw new Error(`Can't apply this edit: ${msg}`); });
  return doc;
}

/** The text a LayerValue draws: a plain string as itself, styled runs joined,
 *  since the vocabulary stores what appears on the label, not how it is set. */
const drawnText = (value: LayerValue): string =>
  typeof value === "string" ? value : value.map((r) => r.text).join("");

/** Teaches a layer's fill vocabulary a value it does not already offer
 *  (docs/plans/choice-input.md). Returns the master UNCHANGED — by identity,
 *  so callers make no history entry — when the value is blank, already
 *  offered, the layer does not exist, or it is a literal barcode code that
 *  fails its symbology's validator.
 *
 *  Matching is on `value`, what the label draws, never on a choice's `title`:
 *  typing the words that happen to be a title means a different value than the
 *  one that title stands for. */
export function learnChoice(master: Master, id: string, text: string): Master {
  const value = text.trim();
  const layer = master.layers.find((l) => l.id === id);
  if (!value || !layer || layer.choices?.some((c) => c.value === value)) return master;
  // Never learn a literal barcode that cannot encode (#94); templates are
  // judged after expansion, by resolveLayers.
  if (layer.kind === "barcode" && !fieldRefs(value).length
    && !validateFor(layer.symbology, value).ok) return master;
  return patchLayer(master, id, { choices: [...(layer.choices ?? []), { value }] });
}

/** A layer's CONTENT — this beer's name, this collab's logo, this label's
 *  barcode. Always a label value, for ANY layer: the `fillable` flag that
 *  used to gate this is gone, so every content-bearing layer is fillable.
 *
 *  The one thing it also writes is the MASTER's vocabulary, when the layer has
 *  one: a value nobody authored joins `choices`, so the next label opens with
 *  it offered. That is the fill contract's rule (MASTER_PATHS above) rather
 *  than an exception to routing — the vocabulary declares what a filler may
 *  put in a layer, which is master data — and the Save Master review is what
 *  stands between it and the file. */
export function setContentIn(doc: Doc, id: string, value: LayerValue): Doc {
  return {
    master: doc.master.layers.some((l) => l.id === id && l.choices)
      ? learnChoice(doc.master, id, drawnText(value)) : doc.master,
    label: setValue(doc.label, id, value),
  };
}

/** Drops a label override (whole entry or one dotted path); the `overrides`
 *  key itself goes once nothing is left, so a clean label has none. */
export function clearLabelOverride(label: LabelFile, id: string, path?: string): LabelFile {
  const overrides = clearEntry(label.overrides ?? {}, id, path);
  const { overrides: _o, ...rest } = label;
  return Object.keys(overrides).length === 0 ? rest : { ...rest, overrides };
}
