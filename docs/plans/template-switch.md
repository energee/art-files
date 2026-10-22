> Historical plan recovered for existing citations. Current behavior is documented
> in the operator guide; this plan is not a description of today’s UI.

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
- **Promotion stays in the Save Master review.** The mockup's "Keep in
  template" action on the override badge is a second route to the same place
  and is deferred until the dialog proves insufficient.
- **The mode is per tab and not persisted.** A reopened project starts in
  label mode. (`ponytail:` persist when someone asks.)
- **Master verbs are disabled, not hidden, outside template mode.** Save
  Master, Save Master As, New Variant stay in the menu and palette (the
  `commands` list is read by both) with `disabled` set, so the keyboard and
  the menu agree. The sidebar footer is the surface that *moves*: Save Project
  in label mode; New Variant / Save As / Save Master in template mode.

## The colour scheme

> Superseded: the dark neutrals are now cool (violet-tinted) and the accents
> blue-led (blue primary, pink attention). `src/index.css` is the current
> palette; the table below is the original plan.

Warm neutrals, six accents, each with a light-mode text equivalent. Replaces
the Linear-indigo palette in `src/index.css`. Same `light-dark()` mechanism.

| Token | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `--background` | `#fafaf7` | `#1b1c18` | page |
| `--card` / `--sidebar` / `--popover` | `#ffffff` | `#22231f` | panels |
| `--foreground` | `#1e1f1a` | `#edede6` | text |
| `--primary` (purple) | `#6453b3` | `#ab9df2` | create, edit, finish — Save, Continue, the label-mode accent |
| `--destructive` (pink) | `#b52d51` | `#ff6188` | remove, discard |
| `--attention` (orange) | `#99451c` | `#fc9867` | **template mode**: the switch, frame, badges, verbs |
| `--warning` (yellow) | `#755800` | `#ffd866` | unsaved-template-changes strip, validation warnings |
| `--success` (green) | `#426526` | `#a9dc76` | confirmations, "current" |
| `--info` (cyan) | `#236773` | `#78dce8` | override badges, learned choice |

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
- Files: `src/App.tsx` (`commands`: `master-save`, `master-save-as`,
  `variant-new` gain `disabled: mode !== "template"`; the sidebar footer
  renders by mode), `src/components/LayerList.tsx` (`onAdd`, `onRemove`,
  `onReorder` rendered only when `mode === "template"`; the Changed filter is
  label-only)
- Test: `tests/layerlist-dom.test.tsx`, `tests/appmenu.test.ts` *(extend)*
- Accept: in label mode the list has no Add layer row and no Remove item; in
  template mode it has both and the Changed chip is gone. Save Master is
  disabled in the menu in label mode even when `masterDirty`.

### Phase C — release

**9. Version, changelog, docs**
- Files: the five version files (`package.json`, `package-lock.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`),
  `CHANGELOG.md`, `.agents/AGENTS.md` (one line: the contract is master data
  AND the mode is the target), `docs/plans/label-first-editing.md` (cross-link),
  this file's status.
- Test: `node scripts/check-release.mjs`
- Accept: 0.1.60, notes under it, check-release green.

## Parallelism

- A1 → A2 → A3 sequential. B4 → (B5, B7 parallel) → B6 → B8. A and B are
  independent until B7 (which uses the semantic colours), so run A1–A2 and
  B4–B5 concurrently.

## Risks

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
