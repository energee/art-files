# UX finding: Narrow windows lose the preview when the inspector opens

- Status: confirmed, open; investigation-only PR.
- Priority: [UX/high] (repository rubric).
- Observed revision: `1b0024900e92d56e90b3f212865e15ecb99fd260` (Label Lab 0.1.103).
- Environment: local Vite app, Chrome on macOS, 2026-10-05.
- Source observation: `src/App.tsx:2326`.
- Runtime changes: none.

## Reproduction

1. Run `npm run dev -- --host 127.0.0.1 --port 5173` from the observed revision.
2. Open the app in a fresh Chrome session with the default Lolev master. Keep the Layers sidebar expanded at its default 256px width.
3. Set the browser content viewport to 375 × 812 CSS pixels. This is a window-width test; touch/mobile emulation is not required.
4. Select ABV in Layers. Wait for the inspector transition to finish.
5. Observe that the right inspector occupies x=75 through x=375 and covers the workspace header, including Toggle Sidebar. The label preview disappears entirely.
6. Repeat at 768 × 900: the preview remains visible but the two panels leave roughly 212px of workspace, making the label and its text very small.

## Expected and actual behavior

Expected: selecting a layer retains a usable preview or provides an explicit panel switch and a visible close action. Actual: the narrow window displays a 300px inspector over an expanded 256px Layers panel, leaving no preview. The inspector also has no visible close button. Escape from a non-editing target or clicking empty Layers space can recover, but the interface does not explain these exits.

This blocks seeing the result of edits at the reproduced width. The 768px case is a lesser usability problem, not a total block. This report concerns the local web UI; no native desktop minimum-window-width enforcement was verified.

## Browser evidence

Chrome DOM measurement after selection at 375px:

```json
{"width":375,"inspector":{"x":75,"width":300,"height":812},"labelCanvases":[{"x":258,"width":0,"height":0},{"x":258,"width":0,"height":0}]}
```

A settled screenshot showed only the leftmost 75px of Layers and the inspector; no artboard was visible. The browser viewport override was reset after testing.

## Root cause — confirmed

- `src/components/ui/sidebar.tsx:18` defaults the expanded sidebar to 256px, and its spacer reserves that width at every viewport size (`Sidebar`, around line 149).
- `src/App.tsx:2326` unconditionally adds `mr-[300px]` to the preview whenever a layer is inspected.
- `src/App.tsx:2512` fixes the portal inspector width to 300px. The adjacent SheetContent opts out of its close button at line 2502.
- No coordinated narrow-window panel policy keeps those reserved widths within the viewport. At 375px, 256+300 exceeds the entire window.

## Smallest fix direction and acceptance

Use a narrow-window layout that presents one side panel at a time, retains a visible panel dismissal control, and does not reserve 300px for an overlay inspector. Keep the existing non-modal desktop selection behavior; ordinary outside presses must not erase multi-selection.

Acceptance: at 375 × 812 and 768 × 900, selecting/editing a layer leaves the preview usable or offers an obvious preview/panel switch. Mouse and keyboard users can dismiss the inspector. Repeat at 1440 × 900 to verify desktop layout and multi-selection.

## Where this investigation stops

Reproduced visually and traced through the width reservations; no implementation or automated regression test has been added. Native desktop window sizing, real touch devices, and alternative sidebar widths remain untested.

## Review scope and release classification

This PR records a finding, not a fix. Browser checks covered the default master, layer selection, numeric validation, tab creation/switching, label/mask/can views and smaller-window layouts. No warning/error console entries were captured in the second browser session. There is no visual baseline, automated accessibility certification, native save-dialog check or print-output certification. The first browser automation session stalled on a beforeunload prompt during mobile emulation; the relevant findings were independently reproduced in another Chrome tab using window viewport overrides.

Documentation and agent-memory changes only: non-binary-impacting, no changelog entry or version bump required. No application tests were added or rerun for this report.
