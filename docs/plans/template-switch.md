# Template switch — this label, or the template

Status: **PLAN** (2026-09-06). Branch `feat/template-switch`, stacked on
`feat/label-first-editing` (PR #52). Version 0.1.60.

## What it is

One two-way switch under the master picker: **This label | Template**. It
answers the question the app never asks today — *where does this edit land?*

- **This label** (default) is exactly today: content, position and style land
  in the `.label`, badges say which paths this label overrides.
- **Template** turns the frame the template colour and every edit becomes a
  draft change to the master (or to the version the picker has selected),
  gated by the Save Master review as now. The canvas shows placeholders, the
  inspector shows the fill contract and vocabulary instead of content, layer
  add/remove/reorder and the master verbs appear only here.

Mockup: `.agents/mockups/template-switch.html` (gitignored; also published as
an artifact in the session that drew it).

The same change also adopts a new colour scheme, below. Doing both at once is
deliberate: the switch needs a second accent, and the scheme supplies it.

## Decisions taken

- **Not a discrete fill mode.** Label work includes layer changes (moving a
  line for one beer), so the split is *where the edit lands*, not *what kind
  of edit it is*. Ruled out on 2026-09-06.
- **Supersedes PR #51's "Edit master" toggle.** That branch (`label-owns-edits`)
  built the same idea on a different routing model (`applyDocEdit` with a
  boolean) and also claims 0.1.59. This plan builds on #52's path-based rule
  (`MASTER_PATHS` in `edit.ts`) and adds the mode as a *target* parameter, so
  #51 should be closed once this lands. The user chose this base.
- **The mode is a target, not a second routing table.** `patchLayers` gains
  `target: "label" | "master"` (default `"label"`). In template mode App passes
  `"master"` and the whole patch goes to `patchLayer` (base) or `patchLayerIn`
  (the picked variant) — the same two writers `applyPromotions` already uses.
  The fill-contract split stays for label mode, untouched.
- **Content is hidden in template mode**, not routed. The template has no
  content; it has placeholders, which are in the fill contract. So
  `setContentIn` never needs a target.
- **The canvas resolves with no values and no overrides** in template mode:
  `resolveLayers(master, enabledVariants, {}, {})`. That is what a placeholder
  render *is*; no renderer change.
- **Promotion is removed.** With the switch, "I want the template to have
  this label's tweak" is: flip to Template, make the change. That deletes the
  promote rows and their checkboxes from the review, `applyPromotions`, the
  `target` argument of `masterChanges`, and the variant-tombstone rule for
  clears. The review becomes a read-only list of what Save Master will write,
  with Save and Cancel. It is the biggest deletion available and it closes the
  one path a label edit could reach the master by accident. (2026-09-06)
- **The picker lists only this master and its versions.** Other library
  masters are File → Open Master, which exists. The async resolve, the bench
  preview and Continue leave the sidebar; the picker is a plain Select of the
  base master, its variants, and New Variant. Switching templates is a rare
  file operation and reads as one.
- **One save button, always.** The sidebar footer shows one primary button
  that follows the mode: Save Label (= Save Project) or Save Master. Save As
  and New Variant stay in the menu and the picker.
- **The mode is per tab and not persisted.** A reopened project starts in
  label mode. (`ponytail:` persist when someone asks.)
- **Master verbs are disabled, not hidden, outside template mode.** Save
  Master and Save Master As stay in the menu and palette (the `commands` list
  is read by both) with `disabled` set, so the keyboard and the menu agree.

## The colour scheme

Warm neutrals, six accents, each with a light-mode text equivalent. Replaces
the Linear-indigo palette in `src/index.css`. Same `light-dark()` mechanism.

| Token | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `--background` | `#fafaf7` | `#1b1c18` | page |
| `--card` / `--sidebar` / `--popover` | `#ffffff` | `#22231f` | panels |
| `--foreground` | `#1e1f1a` | `#edede6` | text |
| `--primary` (purple) | `#7058be` | `#ab9df2` | create, edit, finish — Save, Continue, the label-mode accent |
| `--destructive` (pink) | `#e14775` | `#ff6188` | remove, discard |
| `--attention` (orange) | `#e16032` | `#fc9867` | **template mode**: the switch, frame, badges, verbs |
| `--warning` (yellow) | `#cc7a0a` | `#ffd866` | unsaved-template-changes strip, validation warnings |
| `--success` (green) | `#269d69` | `#a9dc76` | confirmations, "current" |
| `--info` (cyan) | `#1c8ca8` | `#78dce8` | override badges, learned choice |

Derived: `--muted`, `--border`, `--input`, `--field`, `--accent` keep their
roles but are re-tinted warm (a grey with a bias toward `#edede6`/`#1e1f1a`,
not the current cool grey). `--ring` = primary. `--switch-on` = primary (the
royal-blue exception goes; purple reads as "on" at full strength). Each accent
also gets a `-soft` tint (`color-mix(in oklab, <accent> 14%, transparent)`)
for the repeated-row-action and tinted-panel rules.

Rules applied: solid fills only for the one primary action on a surface;
repeated row actions soft-tinted with coloured labels; rows and large surfaces
neutral; template mode's frame is a 2px inset ring, not a filled surface;
bright accents never as small text on white (the light column exists for
that). Contrast is checked in Task 1's test.

## Tasks

Test file named first in each task; write it failing, then implement.
`npx tsc --noEmit` and `npm run test` clean before a task is done.

### Phase A — theme (independent of B; A1 first because everything renders in it)

**1. Tokens**
- Files: `src/index.css`
- Test: `tests/theme-contrast.test.ts` *(new)* — parses the `:root` block,
  resolves each `light-dark()` pair, asserts WCAG AA (4.5:1) for every
  foreground/background pair the table above commits to, in both schemes:
  foreground and muted-foreground on background, card and field; each accent
  on background and card; primary-foreground on primary.
- Accept: the test passes for every pair; no component file changes.

**2. Semantic utilities**
- Files: `src/index.css` (`@theme inline` block)
- Test: `tests/theme-contrast.test.ts` *(extend)* — the six accents and their
  `-soft` tints are exposed as `--color-*` so `text-attention`,
  `bg-info-soft` etc. resolve.
- Accept: `grep -c "color-attention\|color-warning\|color-success\|color-info"
  src/index.css` ≥ 8.

**3. Recolour what already has a colour**
- Files: `src/components/LayerInspector.tsx` (Badge), `src/components/LayerList.tsx`
  (Changed chip, Overridden dot), `src/components/MasterSaveReview.tsx`,
  `src/components/MasterPicker.tsx` (error line), `src/App.tsx` (status strip)
- Test: `tests/layerinspector-dom.test.tsx`, `tests/layerlist-dom.test.tsx`
  *(extend)* — override badge carries the `info` class; the remove action
  carries `destructive`; nothing carries `primary` except one action per
  surface.
- Accept: `grep -rn "indigo\|#4169e1\|#5560c8" src` is empty.

### Phase B — the switch (B4 gates B5–B8)

**4. `patchLayers` takes a target**
- Files: `src/model/edit.ts`
- Test: `tests/app-edit-routing.test.ts` *(extend)*
- `patchLayers(doc, entries, target: "label" | "master" = "label")`. With
  `"master"`, every key — contract or not — goes to `patchLayer` when the layer
  is in `master.layers`, else to `patchLayerIn` for the variant that owns it,
  and the label is returned by identity. The existing split is the `"label"`
  branch, unchanged. Also: `moveBy`/drag callers in App pass the target
  through (they already call `patchLayers`).
- Accept: `patchLayers(doc, [["name", { x: 5 }]], "master")` writes
  `master.layers[name].x` and leaves `label.overrides` absent; the same call
  on a variant-added layer writes `variants[v].layers[id].x`; with `"label"`
  every existing routing test passes unchanged.

**5. Mode state and the switch**
- Files: `src/App.tsx` (`const [mode, setMode] = useState<"label"|"template">("label")`,
  passed to `patchLayers`), `src/components/MasterPicker.tsx` (a `Segmented`
  under the Select, `aria-label="Editing"`, values `This label` / `Template`;
  reuse LayerInspector's `Segmented` by lifting it to `components/ui`)
- Test: `tests/masterpicker-dom.test.tsx` *(extend)* — the segmented control
  renders, reflects `mode`, calls `onMode`.
- Accept: clicking Template calls `onMode("template")`; the trigger carries
  `data-mode` so the frame can style off it.

**6. The frame and canvas in template mode**
- Files: `src/App.tsx`
- Test: `tests/app-v3-dom.test.tsx` *(extend)*
- In template mode: the workspace root carries `data-mode="template"` and the
  attention ring; the renderer's `resolveLayers` call passes `{}` for values
  and overrides; the bottom strip reads "Editing template <Lolev / Collab> ·
  N unsaved template changes" (N from `masterChangeList.length`, which is
  already computed when `pendingSave` is set — lift the gate to
  `pendingSave || mode === "template"`).
- Accept: with a label value "Peregrine" on `name`, switching to Template
  makes the canvas text node read the placeholder; switching back restores
  the value. No history entry is made by the switch itself.

**7. The inspector in template mode**
- Files: `src/components/LayerInspector.tsx` (new prop `mode`), `src/App.tsx`
- Test: `tests/layerinspector-dom.test.tsx` *(extend)*
- `mode === "template"`: hide Content; show FillContract / Vocabulary at the
  top (before Position); headings read "Default position" / "Default style";
  badges show the *variant-vs-base* set only (the label set is not this
  mode's concern) in attention colour, labelled "changed".
  `mode === "label"`: hide FillContract and Vocabulary; today's badges, in
  info colour.
- Accept: in template mode `#styleLine-choice-0-value` exists and the content
  field does not; in label mode the reverse.

**8. Verbs and the layer list**
- Files: `src/App.tsx` (`commands`: `master-save`, `master-save-as` gain
  `disabled: mode !== "template"`; the sidebar footer is ONE primary button,
  Save Label or Save Master by mode), `src/components/LayerList.tsx` (`onAdd`,
  `onRemove`, `onReorder` rendered only when `mode === "template"`; the
  Changed filter is label-only)
- Test: `tests/layerlist-dom.test.tsx`, `tests/appmenu.test.ts` *(extend)*
- Accept: in label mode the list has no Add layer row and no Remove item; in
  template mode it has both and the Changed chip is gone. Save Master is
  disabled in the menu in label mode even when `masterDirty`. The footer
  has exactly one button in either mode.

**9. Delete promotion**
- Files: `src/model/edit.ts` (`applyPromotions`, `masterChanges`' `target`
  and its `promote` rows go; `MasterChange.kind` loses `"promote"`),
  `src/components/MasterSaveReview.tsx` (no checkboxes; a read-only list with
  Save / Cancel), `src/App.tsx` (`saveMaster(as)` no longer takes `promote`;
  `masterDirty` no longer counts label overrides)
- Test: `tests/model-master-changes.test.ts`, `tests/mastersave-review-dom.test.tsx`
  *(shrink)* — the promote cases are deleted, not rewritten
- Accept: `grep -rn "promot" src` is empty; the review renders no
  `role="checkbox"`; a label with overrides and a clean master shows Save
  Master disabled.

**10. The picker lists this master only**
- Files: `src/components/MasterPicker.tsx` (drop `library`, `resolve`,
  `onMaster`, the preview and `previewLine`), `src/App.tsx` (the props go; the
  rebind preview moves into `openMasterPicker`'s existing flow, which already
  confirms through a dialog)
- Test: `tests/masterpicker-dom.test.tsx` *(shrink)*
- Accept: the picker renders the master, its variants and New Variant, and
  nothing else; `grep -n "rebindLabel" src/components/MasterPicker.tsx` is
  empty; File → Open Master… still previews the bench counts before
  committing.

### Phase C — release

**11. Version, changelog, docs**
- Files: the five version files (`package.json`, `package-lock.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`),
  `CHANGELOG.md`, `.agents/AGENTS.md` (one line: the contract is master data
  AND the mode is the target), `docs/plans/label-first-editing.md` (cross-link),
  this file's status.
- Test: `node scripts/check-release.mjs`
- Accept: 0.1.60, notes under it, check-release green.

## Parallelism

- A1 → A2 → A3 sequential. B4 → (B5, B7, B9, B10 parallel) → B6 → B8. A and
  B are independent until B7 (which uses the semantic colours), so run A1–A2
  and B4–B5 concurrently. B9 and B10 are deletions and touch different files
  from B5–B7 except App.tsx; run them first so the switch lands on the
  smaller App.

## Risks

- **Losing promotion loses "keep this one-off".** A label tweak that should
  become the default now needs re-doing in Template mode. For a position it is
  one drag; for a vocabulary it is already master data. Acceptable; if it
  bites, a per-badge "Copy to template" is the small way back, not the review.
- **Two accents on one screen.** Purple (primary) and orange (template) both
  appear in template mode: the frame is orange, the one primary action (Save
  Master) is purple. The rule "action colour describes the action, not the
  row" says that is correct; if it reads as a clash, Save Master goes orange
  in template mode and the rule gets a footnote.
- **Placeholders that are empty.** A layer with no placeholder renders nothing
  in template mode and is only findable in the list. Task 6 should fall back
  to the layer name, dimmed, when `placeholder` is blank.
- **Version numbers on stacked PRs.** #50 = 0.1.58, #52 = 0.1.59, this = 0.1.60,
  #51 also claims 0.1.59. Closing #51 resolves it; merging it would not.
