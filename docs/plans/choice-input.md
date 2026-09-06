# Choice input — a picker that learns

Status: **PLAN — awaiting approval.** No implementation code yet.

## What it is

A fill widget that offers a list and still takes anything typed. Style is the
case that asked for it: most labels are one of a dozen styles, but the next one
is always allowed to be new. Barcode's symbology is the same shape and already
has a hand-rolled version of it.

## Where the vocabulary came from

`presets.json`, deleted on 2026-09-04 (aafc163) when presets went away, held
exactly this feature in its raw form:

```json
{ "styles": ["Ultra Hopped Ale", "Hazy India Pale Ale", "Hazy Pale Ale"],
  "barcodes": [{ "name": "Tier 1", "upc": "850051366040" },
               { "name": "Tier 2", "upc": "860009737631" }, … ] }
```

Two lists that had no home once a master became the saved style. `styles` is a
list of plain values; `barcodes` is a list of `{ name, upc }` — a title and a
value, which is where the `{ title?, value }` shape in this plan comes from
rather than from a guess. Tier 1 is what you pick; `850051366040` is what gets
drawn.

## Decisions taken (2026-09-05, revised 2026-09-06)

- **`choices` is not a new input mode — it is a key any fill input may carry.**
  The first cut added `input: "choice"` beside `number` and `code`. The
  barcode half of the request rules that out: a tier picker is a `code` input
  (it still validates against `symbology`) AND a list of options. They are not
  alternatives, so they cannot share one enum. `choices` becomes an
  independent key: present = the fill widget is a picker that also takes
  typing; absent = the widget it is today. `input` keeps deciding validation
  and keyboard, `choices` decides whether there is a list. This is less code
  than the fourth mode, not more, and it is the reason the plan changed.
- **Not a fifth `LayerKind` either.** Style stays a text layer and a barcode
  stays a barcode, so placement, measurement, rendering, hit boxes, PDF and
  PSD export are all untouched: this is a widget change, not a layer type.
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
  input?: "number" | "code";          // unchanged — validation, not widget
  /** The offered vocabulary, for ANY input. Present = the fill widget is a
   *  picker that still takes typing; absent = today's widget. A filler may
   *  always type something else, and what they type is appended here. */
  choices?: Choice[];
}
```

So the two cases in the request are one mechanism:

| Layer | `input` | `choices` | Widget |
| --- | --- | --- | --- |
| Style | absent | the three styles | picker + free text |
| Barcode | `code` | the eight tiers | picker + free text, UPC-validated |

Fill mode, in the inspector's text field:

```
  Style                        ← layer.title ?? layer.name
  [ Hazy Pale Ale           ▾] ← type to filter, or pick
    Ultra Hopped Ale
    Hazy India Pale Ale
    Hazy Pale Ale
    ─────────
    Use "Saison"               ← what a typed value offers

  Barcode                      ← the same widget, code-validated
  [ Tier 1                  ▾]
    Tier 1                     ← title shown, 850051366040 drawn
    Tier 2
    …
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

**1. `choices` in the model**
- Files: `src/model/layers.ts` (`Choice`, `LayerBase.title`,
  `TextLayer.choices`, and `parseMaster`'s validation)
- Test: `tests/model-layers.test.ts` *(extend)*
- `input` is NOT touched. Reject a `choices` entry with a blank/missing
  `value`; allow a missing `title`. An empty `choices` array is the same as
  absent, and normalises to absent on parse.
- Accept: a `.master` with three choices round-trips through
  `serializeMaster`/`parseMaster` unchanged; one with `{ title: "x" }` and no
  value fails to load with a named error; a barcode layer carrying both
  `input: "code"` and `choices` loads.

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

**4. Filling from a list, and learning from it**
- Files: `src/model/edit.ts` (`setContentIn`)
- Test: `tests/model-choice.test.ts` *(extend)*
- `setContentIn` on a layer that HAS `choices` writes the label value as today AND runs
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
- The Input select is unchanged. Below it, for every input: a `Title` row and
  a choices editor — one row per choice (title, value, remove) plus "Add
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

**8. The barcode tier picker**
- Files: none beyond Tasks 1-7 — this task is the PROOF that no barcode-only
  code is needed
- Test: `tests/text-editor-dom.test.ts` *(extend)*
- A `code` layer carrying `choices` gets the picker AND keeps its symbology
  validation: picking Tier 1 fills `850051366040` and the check passes; typing
  a bad UPC still reports the same error it does today, and is not learned
  while it is invalid.
- Accept: no `if (kind === "barcode")` anywhere in the widget. If this task
  needs one, Task 1's design is wrong and the plan should be revised, not
  patched.

**9. Seed both lists from the deleted presets**
- Files: `src/model/lolevLayers.ts`, docs sweep
- Test: `tests/model-lolev.test.ts` *(extend)*
- `styleLine` gets the three styles; the barcode layer gets the eight tiers as
  `{ title: "Tier N", value: upc }` — both verbatim from `presets.json` at
  aafc163^, so nothing is invented and the lists that were lost come back.
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
- The eight tier UPCs are real product codes. They are already public on the
  cans and were already in the repo until aafc163, so restoring them changes
  nothing about their exposure — but they are the one piece of this that is
  business data rather than geometry.
