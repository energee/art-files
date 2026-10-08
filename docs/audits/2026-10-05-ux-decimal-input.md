# UX finding: ABV decimals conflict with native input validation and stepping

- Status: confirmed, open; investigation-only PR.
- Priority: [UX/low] (repository rubric).
- Observed revision: `1b0024900e92d56e90b3f212865e15ecb99fd260` (Label Lab 0.1.103).
- Environment: local Vite app, Chrome on macOS, 2026-10-05.
- Source observation: `src/components/TextEditor.tsx:731`.
- Runtime changes: none.

## Reproduction

1. Start the local app at the observed revision with `npm run dev` and open it in a fresh Chrome session.
2. Select ABV in the default Lolev master.
3. Enter `5.8` in Content → Text, then press Tab.
4. Inspect the number input validity: `validity.stepMismatch` is true even though the app accepts and renders `5.8` and shows no field error.
5. Focus that field and press Arrow Up once. The value becomes `6`, losing the fractional portion rather than incrementing consistently at decimal precision.
6. Control check: enter `25` and press Tab. The app correctly reports “Must be at most 20.” Correct it to `5.8`; the app error disappears but native stepMismatch persists.

## Expected and actual behavior

Expected: fractional ABV values accepted by the application are also valid to the native control. If the field offers arrow-key stepping, its increment should be deliberate and appropriate for decimal values.

Actual: `5.8` is accepted by the application's numeric validator but invalid to the native HTML number input. Arrow Up rounds it to `6` through the browser's integer step grid. This is a low-severity inconsistency; direct typing still works, and saving/exporting a valid decimal was not shown to fail. No claim is made that a submit action is blocked.

## Browser evidence

After entering `5.8` and blurring:

```json
{"value":"5.8","step":"","stepMismatch":true,"invalid":null,"message":"Please enter a valid value. The two nearest valid values are 5 and 6."}
```

After Arrow Up:

```json
{"value":"6","stepMismatch":false}
```

The message is Chrome's `validationMessage` property, not an app-rendered error toast. An earlier accessibility snapshot also marked the decimal spinbutton invalid; no persistent visible red-border claim is made.

## Root cause — confirmed

- `src/components/TextEditor.tsx:720` implements PlainLineField. At line 731 it renders `type="number"` for numeric text layers, passes min/max, and omits step.
- `src/model/fields.ts:18` accepts decimal numbers and applies only numeric/range checks; it imposes no integer-only rule.
- The generic Input wrapper forwards these props. Consequently the browser's default integer stepping disagrees with the model's accepted values.
- `src/App.tsx:2119` passes the selected text layer's input/min/max into TextEditor; TextEditor routes numeric layers without choices into this shared plain field. The scope therefore includes other numeric text layers using that path, not just ABV. Vocabulary-backed ChoiceBox controls are a different path.

## Smallest fix direction and acceptance

Align the native step constraint with the model's numeric contract in PlainLineField. `step="any"` is the minimal decimal-validity direction; if arrow stepping is retained, explicitly choose and verify its increment rather than depending on the default integer grid. Do not change the validator to reject existing fractional label values.

Acceptance: `5.8` has no native stepMismatch, min/max error feedback still works, and the chosen arrow-key behavior preserves the declared precision. Cover the real shared numeric field with one focused regression check.

## Where this investigation stops

Reproduced in Chrome and traced through TextEditor/Input/model validation. No fix or automated test has been added. Safari/Tauri stepping behavior, other numeric layers, and saved-file/export round trips were not tested.

## Review scope and release classification

This PR records a finding, not a fix. Browser checks covered the default master, layer selection, numeric validation, tab creation/switching, label/mask/can views and smaller-window layouts. No warning/error console entries were captured in the second browser session. There is no visual baseline, automated accessibility certification, native save-dialog check or print-output certification. The first browser automation session stalled on a beforeunload prompt during mobile emulation; the relevant findings were independently reproduced in another Chrome tab using window viewport overrides.

Documentation and agent-memory changes only: non-binary-impacting, no changelog entry or version bump required. No application tests were added or rerun for this report.
