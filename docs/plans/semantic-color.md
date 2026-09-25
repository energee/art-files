# Semantic colour: every accent means one thing

Status: plan, not implemented. Branch: `enhance/right-sidebar`.

The six accents in `src/index.css` already declare an intent each; this plan
wires those intents into the components and fixes the places that break the
palette's own rule (raw accent never carries text). Colour = scope and
reversibility, never emphasis. Every coloured state keeps a non-colour cue
(verb, shape, text) — the a11y lens applies.

Legend the operator should be able to learn in one session:

| Accent | Means | Non-colour cue |
|---|---|---|
| primary | the one committing action on this surface | button position (last in footer) |
| destructive | removes or discards something | verb: Delete / Discard / Remove |
| attention | this edit escapes the label into the master | verb says "Master"/"Variant" |
| warning | validation or a resolve warning that needs a read | alert text |
| success | settled / current / done | status text |
| info | value came from somewhere else (variant, label override, learned) | dot vs ring shape |

## Tasks

### 1. Fix the vendored variants once (ui/)
The shadcn variants put the raw token on text over a tint — 3.3–3.9:1 in light.
Swap to the `-text` / `-soft` tiers so every consumer inherits the fix:
- `src/components/ui/button.tsx` destructive: `bg-destructive-soft text-destructive-text hover:bg-destructive/20`
- `src/components/ui/alert.tsx` destructive: `text-destructive-text`, description `text-destructive-text`
- `src/components/ui/dropdown-menu.tsx:89`, `menubar.tsx:101`: `data-[variant=destructive]:text-destructive-text` (and the svg rule)
- Then delete the per-call override in `LayerList.tsx:279` — it exists only because the variant was wrong.
Test: extend `tests/theme-contrast.test.ts` with `-text` on `-soft` pairs if not already covered.

### 2. Raw-text violations in components
- `MasterPicker.tsx:216` `text-destructive` → `text-destructive-text`
- `TabsShell.tsx:385` same
- `Rulers.tsx:338` `hover:bg-destructive hover:text-white` → `hover:bg-destructive-soft hover:text-destructive-text` (a hover-only remove affordance is a tinted row action, not a filled button)
Test: `tests/semantic-colour.test.ts` — grep `src/**/*.tsx` for `\btext-(primary|destructive|attention|warning|success|info)\b` outside `ui/` and fail on any hit. ~10 lines, keeps this from eroding.

### 3. attention = the promotion boundary
Only these write the master; nothing else may use attention.
- `MasterSaveReview.tsx:190` confirm button: `variant="attention"` (new Button variant: `bg-attention text-white` light / check dark foreground the way `--primary-foreground` does — add `--attention-foreground` in index.css, contrast-tested)
- `MasterSaveReview.tsx` row kinds: `promote` rows get `text-attention-text` on the "→ master" marker; `removed` stays destructive; `added` neutral
- `MasterPicker.tsx:209` "Save to Master…/Variant…" button: `variant="ghost"` → outline with `text-attention-text` while `masterDirty` (disabled state stays neutral)
- Structural verbs in the Layers list header add menu (`LayerList.tsx:430`) and `MasterPicker` "New Variant" item (`:176`): `text-attention-text` on the item label
- Fix the token comment at `index.css:64`: "template mode" → "edits that escape the label: Save Master, structural verbs". Delete `.agents/mockups/template-switch.html`.

### 4. warning stays narrow
- Keep: `App.tsx` HeaderAlert tone="warning", `LayerInspector.tsx:741` min-module warning.
- Do NOT tint `masterDirty` — under label-first editing every override sets it; an amber strip would be permanent.

### 5. success = current / settled
- `MasterPicker.tsx` Select: the item matching the *current* master/variant gets a `Check` icon in `text-success-text` (icon is the non-colour cue; Select already marks selection so verify it isn't doubled — if base-ui renders its own check, recolour that instead).
- `DesktopUpdater.tsx:244,259` already correct; leave.
- Post-save confirmation, if one is added later, uses `text-success-text` — not part of this pass.

### 6. info stays exactly where it is
- `LayerInspector.tsx:144`, `LayerList.tsx:242,250`: no change. Do not spread info to other meanings.
- Snap indicators on this branch, `PreviewCompare.tsx:71`, use off-palette `bg-sky-400` / `bg-fuchsia-500`. Map: guide snap → `bg-info` (a value derived from elsewhere), layer-edge snap → `bg-primary`. Both raw tokens are legal as fills (≥3:1). Non-colour cue: the readout text the branch already draws.

### 7. primary: one per surface — verify, don't assume
Walk every footer: `TabsShell` dirty-close (Save = primary, Discard = destructive, Cancel = outline — correct), `DesktopUpdater` dialog (Install primary — correct), `MasterSaveReview` (Save Master becomes attention per task 3, so the dialog has zero primaries — acceptable: the committing action *is* the escaping one). Record any surface with two primaries as a finding, don't fix here.

## Order
1 → 2 → 3 (3 depends on the Button variant from 1). 4–7 independent, can parallel.

## Ship
Class-only diff but binary-impacting → version bump + CHANGELOG entry (release-steward). Run `npm test`, `npx tsc --noEmit`, and eyeball light + dark in the app before PR.
