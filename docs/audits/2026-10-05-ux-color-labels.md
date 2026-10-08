# UX finding: Fill and stroke hex fields have no accessible names

- Status: confirmed, open; investigation-only PR.
- Priority: [a11y/high] (repository rubric).
- Observed revision: `1b0024900e92d56e90b3f212865e15ecb99fd260` (Label Lab 0.1.103).
- Environment: local Vite app, Chrome on macOS, 2026-10-05.
- Source observation: `src/components/ColorField.tsx:164`.
- Runtime changes: none.

## Reproduction

1. Start the local app at the observed revision using `npm run dev` and open it in Chrome with a fresh session.
2. Use the default Lolev master and select ABV in Layers.
3. Scroll the inspector to Color and Stroke. Keep Outer stroke enabled (the default).
4. Inspect the accessibility tree or tab through the two hex text inputs. The fill field contains `#F3CD80`; the stroke field contains `#000000`.
5. Observe that both inputs are exposed as unnamed textboxes. Both swatch buttons are named only “Pick color,” without distinguishing fill from stroke.

## Expected and actual behavior

Expected: controls expose distinct names such as “Fill color” and “Stroke color.” Actual: users of assistive technology encounter text fields with values but no accessible names, and two identically named picker buttons. Visual headings do not associate a label with either field.

This blocks reliable identification of the two controls without relying on visual placement. The issue was confirmed from Chrome accessibility output and DOM associations; an actual screen-reader speech session was not run, and this is not a WCAG conformance claim.

## Browser evidence

Accessibility snapshots contained `textbox value="#F3CD80"` and `textbox value="#000000"` with no name. DOM inspection returned:

```json
[
  {"id":"abv-fill","labels":[],"ariaLabel":null,"ariaLabelledby":null},
  {"id":"abv-stroke-color","labels":[],"ariaLabel":null,"ariaLabelledby":null}
]
```

## Root cause — confirmed

- `src/components/ColorField.tsx:164` renders Input with an id and value but no accessible name.
- The component supports an external label via its id, but its only production callers in `src/components/LayerInspector.tsx:865` and `:901` supply no associated label.
- StyleSection renders Color and Stroke as headings, not `label htmlFor` elements or referenced `aria-labelledby` targets.
- `src/components/ui/input.tsx` forwards input props; it does not manufacture a label. The picker Button inside ColorField hardcodes `aria-label="Pick color"` for both uses.

The caller search covered all `ColorField` references under `src`; both current production uses are affected. This is a shared component/caller contract gap.

## Smallest fix direction and acceptance

Associate distinct labels with the hex inputs and give the picker buttons corresponding contextual names. Reuse the existing Color/Stroke headings through `aria-labelledby`, or add explicit label props; avoid guessing names from generated ids. Preserve existing no-ink, hex normalization, swatch and metallic controls.

Acceptance: Chrome accessibility output reports distinct, nonempty names for both hex inputs and pickers. A keyboard user can focus and edit each one. Add one focused DOM check that exercises the actual inspector callers, including the enabled stroke case.

## Where this investigation stops

Reproduced and traced to both callers and the shared wrapper. No runtime fix or regression test has been added. Screen-reader speech behavior, contrast and broader accessibility conformance remain outside the tested scope.

## Review scope and release classification

This PR records a finding, not a fix. Browser checks covered the default master, layer selection, numeric validation, tab creation/switching, label/mask/can views and smaller-window layouts. No warning/error console entries were captured in the second browser session. There is no visual baseline, automated accessibility certification, native save-dialog check or print-output certification. The first browser automation session stalled on a beforeunload prompt during mobile emulation; the relevant findings were independently reproduced in another Chrome tab using window viewport overrides.

Documentation and agent-memory changes only: non-binary-impacting, no changelog entry or version bump required. No application tests were added or rerun for this report.
