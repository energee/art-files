# Choice input — a picker that learns

Status: **PLAN — awaiting approval.** No implementation code yet.

## What it is

A fill widget that offers a list and still takes anything typed. Style is the
case that asked for it: most labels are one of a dozen styles, but the next one
is always allowed to be new. Barcode's symbology is the same shape and already
has a hand-rolled version of it.

## Decisions taken (2026-09-05)

- **A fourth `input` mode, not a fifth `LayerKind`.** `input` is already the
  fill-mode widget hint on a text layer (`layers.ts:118` — `number`, `code`).
  `choice` joins it. Style stays a text layer, so placement, measurement,
  rendering, hit boxes, PDF and PSD export are all untouched: this is a widget
  change, not a layer type. A fifth kind would touch every one of those and
  still draw as text.
- **Titles at both levels.** The layer gets an optional `title` — the caption
  the filler sees above the widget, when the layer's name is not what you want
  to say. Each choice is `{ title?, value }`: the title is what the list shows,
  the value is what the label draws. Title absent = show the value.
- **Custom input is always allowed.** The list suggests; it never constrains.
  Style is plain text today, so every existing master keeps working and no
  label can be locked out of a style nobody thought of.
- **A typed value joins the master's vocabulary.** Fill in a style that is not
  on the list and it is appended to `choices` on the master — the list learns.
  That makes `choices` part of the FILL CONTRACT (`MASTER_PATHS` in
  `edit.ts`), which is the existing rule for "declares what a filler may put
  in a layer": it routes to the master, and the Save Master review lists it
  like any other master change. Nothing reaches the `.master` file until that
  review is confirmed, so the template still never changes implicitly
  (docs/plans/label-first-editing.md).

## The shape

```ts
// model/layers.ts
export interface Choice { title?: string; value: string }

interface LayerBase {
  /** Caption shown above the fill widget. Absent = the layer's name. */
  title?: string;
  …
}
interface TextLayer {
  input?: "number" | "code" | "choice";
  /** `choice` inputs: the offered vocabulary. A filler may always type
   *  something else, and what they type is appended here. */
  choices?: Choice[];
}
```

Fill mode, in the inspector's text field:

```
  Style                        ← layer.title ?? layer.name
  [ Hazy IPA                ▾] ← type to filter, or pick
    IPA
    Hazy IPA (NEIPA)           ← title shown, "Hazy IPA" drawn
    Stout
    ─────────
    Use "Saison"               ← what a typed value offers
```

## Two fill surfaces, one of them unchanged

`TextEditor`'s `PlainField` (`TextEditor.tsx:595`) is the sidebar widget and is
where the picker goes. `PreviewCompare`'s in-place canvas editor
(`PreviewCompare.tsx:835`) stays a plain text box — typing directly on the
artwork is the custom-value path by definition, and a popover over the canvas
during an in-place edit is its own design problem. A value typed there still
joins `choices` through the same model call, so the two surfaces agree.

---

## Tasks

Test file named first in each task; write it failing, then implement.
`npx tsc --noEmit` and `npm run test` clean before a task is done.

### Phase A — model (A1 gates everything)

**1. `choice` in the model**
- Files: `src/model/layers.ts` (`Choice`, `LayerBase.title`,
  `TextLayer.input`/`choices`, and `parseMaster`'s validation)
- Test: `tests/model-layers.test.ts` *(extend)*
- Reject a `choices` entry with a blank/missing `value`; allow a missing
  `title`. `choices` on a non-`choice` input is tolerated (authoring order),
  the way `min`/`max` already are.
- Accept: a `.master` with `input: "choice"` and three choices round-trips
  through `serializeMaster`/`parseMaster` unchanged; one with `{ title: "x" }`
  and no value fails to load with a named error.

**2. Learning a typed value**
- Files: `src/model/edit.ts` (new `learnChoice`, beside `setContentIn`)
- Test: `tests/model-choice.test.ts` *(new)*
- `learnChoice(master, id, value)` appends `{ value }` to that layer's
  `choices` when no entry already has that `value`, and returns the master
  unchanged when one does. Whitespace-trimmed; a blank value is never learned.
- Accept: learning "Saison" twice yields one entry; learning a value that
  matches an existing choice's `title` but not its `value` still appends.

**3. `choices` and `title` join the fill contract**
- Files: `src/model/edit.ts` (`MASTER_PATHS`)
- Test: `tests/app-edit-routing.test.ts` *(extend)*
- Accept: `patchLayers(doc, [["styleLine", { choices: […] }]])` writes
  `master.layers`, not `label.overrides`; a patch mixing `choices` with `x`
  still splits, master and label each taking their half.

**4. Filling a choice layer, and learning from it**
- Files: `src/model/edit.ts` (`setContentIn`)
- Test: `tests/model-choice.test.ts` *(extend)*
- `setContentIn` on a `choice` layer writes the label value as today AND runs
  `learnChoice` on the master. This is the one content edit that touches the
  master, and it is the fill contract's rule rather than an exception to
  routing: the vocabulary is master data.
- Accept: filling "Saison" leaves `label.values.styleLine` set and appends one
  choice; filling "IPA", already on the list, leaves the master untouched
  (`toBe`-identical, so no needless history entry).

### Phase B — UI (depends on A; B5/B6 parallel)

**5. The picker**
- Files: `src/components/TextEditor.tsx` (a `ChoiceField` beside `PlainField`)
- Test: `tests/text-editor-dom.test.ts` *(extend)*
- A text input with a listbox: typing filters, picking commits the choice's
  `value`, and a value matching nothing offers itself. Caption is
  `layer.title ?? layer.name`. Keyboard: ↑/↓ move, Enter commits, Escape
  closes without committing.
- Accept: picking "Hazy IPA (NEIPA)" calls `onChange` with `Hazy IPA`; typing
  "Saison" and pressing Enter calls it with `Saison`.

**6. Authoring the vocabulary**
- Files: `src/components/LayerInspector.tsx` (the "Fill contract" block)
- Test: `tests/layerinspector-dom.test.tsx` *(extend)*
- `Choice` joins the Input select. When it is chosen: a `Title` row, and a
  choices editor — one row per choice (title, value, remove) plus "Add
  choice". Reordering is out of scope; the list is short and append-only in
  practice.
- Accept: adding a choice emits one `choices` patch carrying the whole array;
  the override badge treats `choices` as one path, as `leafPaths` already
  does for arrays.

### Phase C — the rest (depends on B)

**7. The review reads a vocabulary change plainly**
- Files: `src/components/MasterSaveReview.tsx` (`rowText`)
- Test: `tests/mastersave-review-dom.test.tsx` *(extend)*
- `masterChanges` already emits one `property` row for `choices` (an array is
  one leaf). `rowText` currently JSON-stringifies an array, which for a dozen
  choices is unreadable. Render it as a count plus what changed —
  `choices: 12 → 13 (+ "Saison")`.
- Accept: learning one value shows a row naming that value; an unrelated
  array-valued path still renders as it does today.

**8. Barcode symbology uses the same picker**
- Files: `src/components/LayerInspector.tsx` (`SYMBOLOGIES` block)
- Test: `tests/layerinspector-dom.test.tsx` *(extend)*
- The symbology select is a fixed-vocabulary choice with no custom input —
  the same component with `custom={false}`. Do this ONLY if it comes out
  smaller than the Select it replaces; if it does not, drop the task and say
  so. It is the "similar logic on barcode" from the request, and it is worth
  nothing if it costs lines.

**9. Seed the Lolev style layer**
- Files: `src/model/lolevLayers.ts`, docs sweep
- Test: `tests/model-lolev.test.ts` *(extend)*
- `styleLine` gets `input: "choice"` and the styles Lolev actually brews. Ask
  for the list rather than inventing it.
- Accept: the shipped master still loads, and its golden renders are
  byte-identical (choices change no geometry).

## Risks

- **A one-off style silently proposes a template change.** Fill a typo and it
  is in `choices` until someone notices. Mitigated by the Save Master review
  listing it (Task 7) — but the review is also where it is easy to click
  past. If that bites, the next move is a per-layer "learn" switch in the fill
  contract, defaulting on.
- **`choices` is master data edited during filling**, which is the first time
  a content edit writes the master. It follows the fill-contract rule rather
  than breaking it, but it is worth watching: if a second case like it shows
  up, "the contract is master data" deserves its own note in `.agents/AGENTS.md`.
- Task 8 is speculative until the component exists; Task 9 needs Lolev's real
  style list from you.
