# App.tsx split — plan

Status: proposed. Branch: a fresh worktree off `main` after PR #65 merges
(`.agents/worktrees/app-split`, branch `refactor/app-split`). Ledger entry:
`app-tsx-split`.

## Why

`src/App.tsx` is 2,452 lines: one `DocumentEditor` component holding 30
`useState`, 15 `useEffect`, 11 `useRef` and every command, file, export,
zoom and keyboard concern of the editor. `eslint-plugin-react-hooks`'s
React Compiler rules (`refs`, `immutability`, `set-state-in-effect`), which
PR #65 left off, report 26 sites in this file and 8 elsewhere. Every one is a
ref read or mutation during render, a value used before declaration, or a
setState inside an effect — the patterns the compiler cannot memoize and the
patterns that produce stale-closure bugs by hand. The file cannot be reviewed
as a unit, and the eight `eslint-disable-next-line react-hooks/exhaustive-deps`
comments inside it are where the deps are already being hidden.

Goal: `App.tsx` under 800 lines, composed from hooks that each own one
concern, and the compiler rules on as errors for `src/hooks/**` and
`src/App.tsx`.

## Ground rules

- Every phase is one PR-sized commit pair: (a) move code verbatim into a hook
  with the same names and behaviour, tests green; (b) fix that hook's compiler
  findings, tests green, turn the compiler rules on for that file in
  `eslint.config.js` overrides. Never combine a move with a behaviour change.
- The behavioural net is the existing DOM suites: `app-v3-dom`,
  `default-master-dom`, `masterpicker-dom`, `mastersave-review-dom`,
  `layerlist-dom`, `layerinspector-dom`, `text-editor-dom`. Where a hook has
  pure logic (zoom math, selection resolution, command tables) it gets its own
  small unit test — not a per-function suite.
- Each hook file opens with a `// useX.ts — purpose` header (conventions.md).
- `tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` after every
  phase. Binary-impacting, so one version bump on the branch (release-steward.md).

## Compiler findings to retire (line numbers at 030003a)

| File | Lines | Rule | Cluster |
|---|---|---|---|
| App.tsx | 454, 456, 485, 497 | refs | history / pristine master mirror refs |
| App.tsx | 580–582, 704, 751 | refs | zoom carried across views, pane rect |
| App.tsx | 844 | refs | activeRef mirror for key listeners |
| App.tsx | 1089, 1392 | immutability | `closeCanvasBitmaps`, `filePath` used before declaration |
| App.tsx | 1136 | set-state-in-effect | preview rebuild effect |
| App.tsx | 1283 | refs | asset preview refs |
| App.tsx | 1550 | immutability | mutating a hook argument in save |
| App.tsx | 2044, 2051, 2073 | refs / immutability | command table reading refs |
| App.tsx | 2311 | refs | JSX reading `carried.current` |
| AppMenu.tsx | 348–351 | refs | `updateRef.current = …` during render |
| AssetDropOverlay.tsx | 51 | refs | ref read in render |
| CharacterHeight.tsx | 15 | set-state-in-effect | measure → setState |
| LayerList.tsx | 198 | static-components | component defined inside render |
| hooks/use-mobile.ts | 14 | set-state-in-effect | shadcn scaffold; use `useSyncExternalStore` |

The "mirror ref" pattern (`xRef.current = x` in render so a once-registered
listener reads live state) is the majority. The replacement is one small
`useLatest(value)` hook that assigns inside `useLayoutEffect`, or
`useEffectEvent` once the project's React exposes it stably.

## Phases

1. **Scaffold + the four small files.** Add `src/hooks/useLatest.ts`. Fix
   `use-mobile.ts` (`useSyncExternalStore`), `CharacterHeight.tsx` (measure in
   `useLayoutEffect` or derive), `LayerList.tsx:198` (hoist the inner
   component), `AssetDropOverlay.tsx:51`, `AppMenu.tsx:348–351` (`useLatest`).
   Turn the compiler rules on for `src/components/**` and `src/hooks/**`.
   Independent of every later phase.
2. **`useZoomPan`** — zoom state, wheel and right-drag handlers, `clampView`,
   `zoomAbout`, the 2D↔3D carried zoom (`carried`, `carriedMode`). Retires
   580–582, 704, 751, 2311. Unit test the pure math.
3. **`useDocumentHistory`** — the history stack, `edit`, undo/redo,
   `resetDocument`, `pristineMaster`, `savedTick`, dirty/edited flags. Retires
   454–497. Covered by `app-v3-dom`'s undo test.
4. **`useSelection`** — selection + anchor, `resolveSelect`, editing layer,
   inspector target. Retires nothing by itself; unblocks 5 and 7.
5. **`useAssets`** — custom images, `srcBytes`, page art, tint cache, preview
   URLs and their revocation, `closeCanvasBitmaps`. Retires 1089, 1136, 1283.
6. **`useExports`** — `saveVia`, `exportPlan`, `buildFull`, `buildPsd`. Pure
   move; the 1-of-2 dialog logic from PR #65 gets a unit test around a fake
   `saveVia`.
7. **`useProjectFiles`** — open/save project and master, `openWithRetry`,
   `projectHandle`, `filePath`, the masterHint resolution, load notes. Retires
   1392, 1550.
8. **`useEditorCommands`** — the `Command[]` table and the two keydown
   effects (⌘ shortcuts, arrow nudge). Retires 844, 2044–2073 via `useLatest`.
9. **Flip the switch.** Compiler rules on for `src/App.tsx`; delete every
   `eslint-disable-next-line react-hooks/exhaustive-deps` that no longer
   fires; remove the "React Compiler rule set is deliberately off" note from
   `eslint.config.js`. Version bump + CHANGELOG ("no operator-visible change").

Phases 2–8 are sequential in that order (each one shrinks the surface the
next one has to read), but 1 can run in parallel with any of them.

## Not in scope

- Splitting the JSX into more components. The render tree is already
  `PreviewCompare` / `LayerList` / `LayerInspector` / `Rulers` / `CanView`;
  what remains in App.tsx after phase 9 is composition, and that is fine.
- Replacing the history stack or the selection model.
- TabsShell.tsx (460 lines, 1 compiler finding, already a shell).
