# Label-first editing — remove `fillable`, gate the master behind a reviewed save

Status: **PLAN — awaiting approval.** No implementation code yet.

## The problem

Two facts in the current code, which together are the bug:

1. **`fillable` is the only thing routing an edit to the master or the label.**
   `setContent` (`src/App.tsx:674`) sends a fillable layer's content to
   `label.values` and everything else to `master.layers`. Every *design* edit —
   position, size, colour, geometry — goes straight to the master via `patch`
   (`src/App.tsx:649`), with no gate at all.

2. **The label-override machinery exists but has no write path.**
   `setLabelOverride` (`src/model/edit.ts:444`) is implemented and unit-tested,
   `resolveLayers` applies `label.overrides`, and `clearLabelOverride` backs the
   inspector's reset badges — but **nothing in the app calls
   `setLabelOverride`.** Reading and clearing are wired; writing was never
   connected.

The consequence: nudging a layer while filling out a label silently rewrites
the template for every label that will ever use it. "Save Master" is the only
thing between that edit and a permanent change, and it presents no diff.

> **Do not delete `setLabelOverride`.** `docs/audits/2026-09-05.md:35` flags it
> as dead code with no production importer and recommends removing it. That is
> correct about the symptom and wrong about the fix — it is the write path this
> plan connects. Task 1 gives it its importer.

## The model we want

- **Master** sets the template.
- **Variant** sets alternatives to the master.
- **Label** saves fill values, the background, and overrides to master fields.
- **The master never changes implicitly.** Saving `.master` presents every
  change for review first.

Under that rule every property edit is a label override, so `fillable` has
nothing left to decide and is deleted.

## Decisions taken

Three classes of edit, not two:

| Class | Examples | Routes to |
| --- | --- | --- |
| **Structure** | add / remove / reorder / rename a layer, new variant, guides, master name | master |
| **Fill contract** | `placeholder`, `input`, `min`/`max`, `symbology`, `suffix` | master |
| **Everything else** | position, size, style, content | label |

- **Property edits** (position, style, geometry, content) → always a label
  override or a label value. Never the master.
- **Fill-contract edits** declare *what a filler may put in a layer*, so they
  cannot be per-label — a label overriding its own placeholder is meaningless.
  They route to the master like structure does.
- **Structural edits** have no master field to override, so they continue to
  write the master directly. They are surfaced in the Save Master review
  rather than gated per action — no separate "master edit mode".
- **Save Master presents all changes** before writing.

### A master is authored with placeholders, not content

`placeholder` is already a master field on the fill-shaped Lolev layers
(`src/model/lolevLayers.ts:65,77,82` — `"#"`, `"Name"`, `"Style"`), rendered by
`planLayers.ts:78` whenever a layer's lines are blank and read by
`resolveLayers.ts:50` so a blank name still resolves `{name|slug}`. The name
layer ships as `lines: [{ text: "" }]` plus `placeholder: "Name"`.

It has **no UI** — every `placeholder` hit in `LayerInspector.tsx` is an
unrelated prop on a numeric field. Task 10 gives it one. Once it is editable,
authoring a master is structure + placeholders and needs no label content.

## Assumption to confirm (Task 6)

The review dialog is also the **promotion path**: it lists the label's current
overrides alongside the structural edits, and folding one in writes it to
`master.layers` and drops it from `label.overrides`. Without this there is no
way to reposition a layer in the template at all, so some promotion path is
required — this is the cheapest one, since the dialog exists anyway.

If promotion should instead live on the inspector's override badge ("Save this
property to master"), Task 6 changes and Tasks 7–8 are unaffected.

---

## Tasks

Test file named first in each task; write it failing, then implement.
`tsc --noEmit` and `npm run test` must be clean before a task is done.

### Phase A — routing (sequential; A1 gates the rest)

**1. Route property patches to the label**
- Files: `src/App.tsx` (`patch`, `patchMany`)
- Test: `tests/app-edit-routing.test.ts` *(new)*
- `patchMany` writes `setLabelOverride(label, id, p)` instead of
  `patchLayer(master, …)` / `patchLayerIn(master, variant, …)`.
- The variant-targeting walk in `patchMany` (`App.tsx:660-668`) moves to the
  master-edit path added in Task 5; the default path no longer needs it.
- Keep the `p.enabled === true` auto-enable of an owning variant — that is a
  label-side effect (`toggleVariant`) and already correct.
- Accept: a position drag on the Lolev name layer leaves `master` deep-equal to
  `lolevMaster()` and puts `{ x }` in `label.overrides.name`.

**2. Route content to the label unconditionally**
- Files: `src/App.tsx` (`setContent`)
- Test: same file as Task 1
- Drop the `layer.fillable` branch; always
  `editLabel(l => setValue(l, layer.id, value))`.
- Accept: editing the warning text (never fillable today) writes
  `label.values.warning` and leaves the master untouched.

**3. Apply values to any layer**
- Files: `src/model/resolveLayers.ts:83`
- Test: `tests/model-resolve-layers.test.ts` *(extend)*
- Remove the `!layers[i].fillable` guard. A value for an id the master lacks
  stays dormant (unchanged); a value for any existing layer applies.
- Accept: `resolveLayers(lolevMaster(), [], { warning: [line("X")] })` fills it.

### Phase B — delete `fillable` (depends on A; B4/B5 parallel)

**4. Remove the flag from the model**
- Files: `src/model/layers.ts:61` (`LayerBase.fillable`),
  `src/model/resolveLayers.ts:101` (`fillableLayers`),
  `src/model/rebindLayers.ts:16-44` (`fillableKinds`)
- Test: `tests/model-rebind-layers.test.ts` *(rewrite the two fillable cases)*
- `rebindLayers` currently benches values the target doesn't declare fillable.
  New rule: bench values whose **id does not exist** in the target master
  (counting variant-added layers), kind-checked as today.
- Verify `parseMaster` tolerates a stale `fillable` key in an existing
  `.master` file — if it rejects unknown keys, strip it on parse rather than
  failing the load. **Check before writing the task's test.**
- Accept: a `.master` written before this change still loads; its values still
  land on the same layers.

**5. Remove the flag from the UI**
- Files: `src/components/LayerInspector.tsx` (the Fillable `Field`),
  `src/components/LayerList.tsx` (row switch, `fillableOnly` filter),
  `src/App.tsx` (`fillableOnly` state and its prop plumbing)
- Test: `tests/layerinspector-dom.test.tsx`, `tests/layerlist-dom.test.tsx`
  *(both have Fillable cases to delete or repoint)*
- Replace the "Fillable only" filter with **"Changed in this label"** — layers
  carrying a `values` entry or an `overrides` entry. That is the question that
  matters once every layer is fillable.
- Accept: no "Fillable" string remains in `src/`; the new filter shows exactly
  the layers this label has touched.

### Phase C — the reviewed master save (depends on A; C6 gates C7/C8)

**6. Itemised master diff**
- Files: `src/model/edit.ts` (new `masterChanges`, beside `masterDiff:473`)
- Test: `tests/model-master-changes.test.ts` *(new)*
- `masterChanges(base, edited, label)` returns a flat list of
  `{ kind: "added" | "removed" | "moved" | "renamed" | "property" | "promote",
     layerId, layerName, path?, from?, to? }`.
- Structural entries come from comparing `base.layers` to `edited.layers`;
  `property` entries from `leafPaths` (`edit.ts:302`) over each layer's diff,
  the same walk the override badges already use; `promote` entries from
  `label.overrides`.
- Pure and synchronous. No React, no formatting — the dialog renders it.
- Accept: renaming a layer and nudging another yields exactly two entries with
  the right paths; an unchanged master yields `[]`.

**7. The review dialog**
- Files: `src/components/MasterSaveReview.tsx` *(new)*, `src/App.tsx`
  (`saveMaster:1279`)
- Test: `tests/mastersave-review-dom.test.tsx` *(new)*
- Grouped by layer, one checkable row per change, structural changes listed
  first and checked-but-disabled (they are already in the master; unchecking
  is a separate undo, not a save option). `promote` rows default **off**.
- Confirming applies the checked `promote` rows to `master.layers`, clears
  those entries from `label.overrides`, then proceeds into the existing
  `packMaster` path. Cancelling writes nothing.
- Accept: cancelling leaves master, label and `pristineMaster` untouched;
  confirming with one promote row checked moves exactly that path.

**8. Wire the dialog into both save paths**
- Files: `src/App.tsx` (`saveMaster`, commands `master-save` /
  `master-save-as` at `:1625-1626`)
- Test: `tests/mastersave-review-dom.test.tsx` *(extend)*
- Both Save Master and Save Master As… go through the review. `masterDirty`
  (`App.tsx:424`) keeps gating the menu item, but is now
  `masterChanges(...).length > 0` so structural-only and promote-only states
  both light it.
- Accept: Save Master As… on an unchanged master with two label overrides
  still offers those two as promotable.

### Phase B2 — the fill contract (parallel with C; depends on A)

**10. Make the fill contract editable, and route it to the master**
- Files: `src/components/LayerInspector.tsx` (a "Fill contract" block in
  `TextGeometry` / `BarcodeGeometry`), `src/App.tsx` (`patch`)
- Test: `tests/layerinspector-dom.test.tsx` *(extend)*, `tests/app-edit-routing.test.ts`
  *(extend)*
- Add controls for `placeholder` (text), and surface the existing `input`,
  `min`, `max`, `symbology`, `suffix` fields, which are likewise authored in
  `lolevLayers.ts` and editable nowhere.
- `patch` routes this fixed set of paths to the master rather than to
  `label.overrides`. One exported constant — `MASTER_PATHS` in
  `src/model/edit.ts` — so the routing rule is data, not a condition repeated
  at each call site, and Task 6 can label those rows correctly in the review.
- Accept: editing a placeholder writes `master.layers`, leaves
  `label.overrides` empty, and shows in the save review as a fill-contract
  change; editing the same layer's `x` still writes the label.

### Phase D — docs

**9. Update the docs the change invalidates**
- `src/model/layers.ts` header (lines 1-13 describe `fillable` as the model's
  fill mechanism), `resolveLayers.ts` header, `src/model/rebindLayers.ts:3`,
  `AGENTS.md` if it describes the fill/design split, `CHANGELOG.md`.
- Also correct `docs/audits/2026-09-05.md:35`, which recommends deleting
  `setLabelOverride`.
- Per the repo rule, docs land in the same commit as the code that changes
  them — this task is a sweep for what earlier tasks missed, not a deferred
  pass.

---

## Parallelism

```
A1 → A2 → A3 ─┬─→ B4 → B5 ────────┐
              ├─→ B2:10 ──────────┼─→ D9
              └─→ C6 → C7 → C8 ───┘
```

Three independent tracks once Phase A lands. Task 10 defines `MASTER_PATHS`,
which Task 6 reads to label review rows — if both run in parallel, land 10
first or stub the constant.

## Risks

- **Existing `.label` files** carry values only for layers that were fillable.
  Nothing breaks (Task 3 widens what applies), but a label saved after this
  change may carry values a pre-change build would ignore. `formatVersion`
  stays 3; the shapes are unchanged.
- **`patchMany`'s variant targeting** is the subtlest deletion in Task 1. The
  master-edit path still needs it; moving it rather than dropping it is why
  Task 1 is sequential and first.
- **Group drags** patch every selected layer per pointermove. Overrides are a
  deep-merge per layer, so the coalescing behaviour of `edit(…, coalesce)` must
  be preserved or undo granularity regresses. Covered by Task 1's accept.
- **Master authoring stays possible without label content**, because structure
  and the fill contract both route to the master (Task 10) and the master's
  content is placeholders, not live text. What still accumulates as label
  overrides while authoring is *position and style* — laying out a new master
  means nudging layers, then promoting those nudges through the save review.
  That is the intended flow, but it is the one place authoring costs an extra
  step versus today, and worth watching once it ships.
