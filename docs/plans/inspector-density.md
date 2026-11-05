# Inspector density and shell pass

Items 2–9 from the 2026-11-03 UX review: measured in the running app at
1440×900 (light theme, Starter master). A text layer's inspector takes
≈800px for ≈20 controls, one per row. Selecting a layer adds a 300px panel,
and the canvas re-zooms (ruler 0 moves from x≈420 to x≈289).
Branch `feat/inspector-density`, worktree `.agents/worktrees/inspector-density`.

## Decisions (user, 2026-11-03)

| # | Item | Decision |
|---|------|----------|
| 2 | Canvas jumps when the inspector opens | The right panel is always present. With nothing selected it shows the page-art drops (Texture, Metallic mask), the same editors the Background and Metallic mask inspectors show. Both rows stay in the layer list |
| 2a | Narrow windows | View → Inspector toggle, saved in view prefs, shortcut **⌥⌘B** (the right-hand twin of ⌘B; ⌥⌘I is the desktop Web Inspector). Below 900px window width, the panel goes back to today's overlay Sheet, open only while a layer is selected. Closes the ledger's 2026-10-05 `ux-narrow-inspector` finding |
| 3 | Duplicate on/off | Remove the inspector header's power AND lock buttons. The header becomes kind icon, name and ×. The `enabled`/`locked` override reset badges stay in the header, shown only when overridden. Add **Hide Layer ⇧⌘H** and **Lock Layer ⇧⌘L** to the Layer menu and ⌘K, acting on the selection (Lock disabled when the selection is all page art) |
| 4 | Row icons | This partly reverses #575's "mockup B". The crossed-out eye and the closed lock always show. The open eye and open lock show only on row hover, keyboard focus or the selected row. The columns stay fixed, so nothing moves |
| 5 | One field per row | Two-column pairs: X/Y, H guide/V guide, Size/Min height, Line/Letter spacing, Heading scale/Wrap width. Align and an Uppercase toggle share one row. Rotation and Bind move into the Position heading's `control` slot. Stroke width sits on the stroke colour row. "Tallest character" and "Characters per inch" become the Min height field's title |
| 6 | Text box 8.5rem for one word | Starts one line tall and grows with its content |
| 7 | Full-width "Bind to layer…" | Becomes an icon button (Link2) in the Position heading. The bound state keeps its rows |
| 8 | Building blocks | One new primitive, `FieldPair`, in `LayerInspectorControls.tsx`, next to `Row`/`Field`. `ScrubField` gets a `compact` flag (the input fills its cell instead of the fixed `w-24`/`w-28`) |
| 9 | App.tsx is 2,848 lines | Pull out three hooks with no behavior change: `useViewPrefs`, `useZoomPan` and `useRenderSource` (see task 3). Target was ≈2,000 lines; landed at 2,606. App.tsx is not added to the 750-line test |
| 10 | Hide rarely changed fields (user, 2026-11-04) | Behind a per-section More: Minimum height (with its readouts), Wrap width, Line spacing, Heading scale, Letter spacing, both guide rows, Bind to layer and Rotation. Visible by default: Text, Font, Size, Align, Uppercase, X, Y, Color, Stroke |
| 11 | Where they live | A chevron button at the right of the Typography and Position headings (`aria-expanded`, label "More Typography options" / "More Position options") expands that section's extra rows. The open/closed state is saved per section in view prefs, not per layer |
| 12 | A hidden field that is overridden | Shows anyway, with its reset badge, while the section is collapsed. "Overridden" means the existing variant/label override set the badges read. A bound layer's Bound to/Side/Gap/Unbind rows always show |
| 13 | Supersedes | Decision 7's Bind icon and decision 5's Rotation in the Position heading: the heading's control slot now holds the chevron, so Bind (icon button) and Rotation share one row inside Position's More. Decision 5's pairs still apply inside More (Wrap width/Heading scale, Line/Letter spacing, H guide/V guide); Size pairs with Align instead of Min height |

## Phases (one stacked PR each; checkpoint with the user after each)

- **A — refactor, no behavior change:** tasks 1–3. PR on `main`.
- **B — inspector density:** tasks 4–9 and 16–18. On `main` (A merged as #674), branch `feat/inspector-simplify` in `.agents/worktrees/inspector-density`.
- **C — shell:** tasks 10–13. Stacked on B.
- **D — docs and final validation:** tasks 14–15. In C's PR.

## Tasks

Validation for every task: `npx tsc --noEmit`, then the named test with
`npx vitest run <file>`, then `npm run lint`. Every task that adds a UI
string adds its key to every `src/locales/*` file. The locale test fails on
a missing English key, and knip fails on a dead one.

### Phase A (sequential: all three edit `src/App.tsx`)

1. **`useViewPrefs`**: new `src/useViewPrefs.ts`, holding `ViewPrefs`,
   `loadViewPrefs` and the rulers/unit/guides/lightDeg state plus their
   localStorage write, moved out of `src/App.tsx:203-225,689-698`.
   Types: `ViewPrefs`, `LengthUnit`. Test first: `tests/view-prefs.test.ts`
   (defaults, rejecting a mangled entry, round-tripping each field).
   Accepted when `tests/view-state-dom.test.tsx` and the full suite stay green,
   unchanged. Deps: none.
2. **`useZoomPan`**: new `src/useZoomPan.ts`, holding zoom, zoomDraft,
   camZoomPct, panning and the pan handlers (`App.tsx:563-690`).
   Types: `{ z, x, y }`, `ViewMode`. Test first: `tests/zoom-pan.test.ts`
   (step clamp `ZOOM_STEP_CAP`, factor 1.25, fit). Accepted when the existing
   zoom tests pass unchanged. Deps: 1.
3. **`useRenderSource`** (done as this, not `usePageAssets`): new
   `src/useRenderSource.ts`, holding decodedAssets, bitmaps, assetsFailed and
   the debounced assembly, passed `pageArt`/`planAssets` as callbacks the way
   `useExport` already is. texture, mask and customImages stay in App.tsx:
   history, saves and the unmount guard write them, so moving them would mean
   passing their setters back out. Test first: `tests/render-source-dom.test.tsx`
   (ready after the debounce, a failure sets assetsFailed and the owned toast,
   a background tab drops its source). Accepted when `asset-*`,
   `image-asset-undo-dom` and the full suite pass unchanged. Deps: 2.
   Result: App.tsx 2,848 → 2,606 lines, not the ≈2,000 estimated.

### Phase B

4. **`FieldPair` + compact `ScrubField`**: `src/components/LayerInspectorControls.tsx`
   and `src/components/ScrubField.tsx`. Types: `FieldPair(props: { children: [ReactNode, ReactNode] })`
   and `ScrubField` `compact?: boolean`. Test first: add a `FieldPair` case to
   `tests/layerinspector-dom.test.tsx`: two fields render in one grid row,
   and each label stays tied to its input (`getByLabelText`). Deps: none
   (can run in parallel with A).
5. **Position, compact**: `LayerInspectorSections.tsx` `Position`. X/Y and
   their guides in pairs. Rotation and Bind go in the `Heading` `control`
   slot; Bind is an icon button labelled "Bind to layer…" (aria-label).
   Test first in `tests/layerinspector-dom.test.tsx`: the Bind trigger is
   reachable by name and opens the same menu, Rotate 90° still toggles, and a
   bound layer still shows Bound to/Side/Gap/Unbind. Deps: 4.
6. **Typography, compact**: `TextGeometry` and `src/components/CharacterHeight.tsx`.
   Pairs as in decision 5. Uppercase becomes a `Toggle` beside Align.
   CharacterHeight's two `<p>` readouts move into the Min height title.
   Test first: `tests/characterheight-dom.test.tsx` (the readout is in the
   title, with no visible `<p>`) and `tests/inspector-uppercase-dom.test.tsx`
   (the toggle has `aria-pressed` and writes `style.uppercase`). Deps: 5.
7. **Style, compact**: `StyleSection`, stroke width on the colour row.
   Test first in `tests/layerinspector-dom.test.tsx`: the Stroke Width field
   is labelled and its override badge still resets. Deps: 6.
8. **Header trim**: `src/components/LayerInspector.tsx`, removing power and
   lock and keeping the `enabled`/`locked` badges. Update the file-header
   comment. Test first in `tests/layerinspector-dom.test.tsx`: there is no
   "Enabled"/"Locked" button, and an overridden `enabled` still shows its
   reset badge. Deps: 7 (same test file).
9. **Text box auto-size**: `src/components/TextEditor.tsx:754`, replacing
   `min-h-[8.5rem]` with a one-line minimum and letting the box grow.
   Test first in `tests/text-editor-dom.test.ts`: the editor has no fixed
   8.5rem minimum. Check the render in a screenshot. Deps: none.

16. **More disclosure**: `Heading` in `LayerInspectorControls.tsx` gains
    `more?: { open: boolean; onToggle: () => void; label: string }`, rendering
    a ChevronDown button with `aria-expanded`. `Ctx` gains
    `more: { typography: boolean; position: boolean }`, `onMore(section)` and
    `overridden(paths): boolean` (the same set `badge` reads, so a section
    shows a hidden row when `open || overridden([...])`). `useViewPrefs.ts`
    persists `moreTypography`/`morePosition` (default false). New locale keys
    in every `src/locales/*`. Test first: `tests/view-prefs.test.ts` (both
    flags default false and round-trip) and `tests/inspector-more-dom.test.tsx`
    (collapsed hides Wrap width and Horizontal guide; the chevron shows them
    and reports `aria-expanded`; an overridden Letter spacing shows while
    collapsed, with its badge). Deps: 4.
17. **Typography and Position use More**: `LayerInspectorSections.tsx`.
    Typography: Font; Size/Align pair; Uppercase; then under More Min height,
    Wrap width/Heading scale, Line/Letter spacing. Position: X/Y pair; under
    More the guide pair and one row with Rotation 90° and the Bind icon
    button (aria-label "Bind to layer…"). Test first: extend
    `tests/inspector-more-dom.test.tsx` (a rotated layer's toggle is under
    More; a bound layer's Unbind shows collapsed). Existing
    `tests/layerinspector-dom.test.tsx` cases that reach hidden fields expand
    first. Deps: 5, 6, 16.
18. **Docs**: `docs-site/content/docs/(authoring)/inspector.mdx` describes
    More and which fields sit there; `CHANGELOG.md` `[Unreleased]`. Deps: 17.

### Phase C

10. **Row icons, exceptions only**: `src/components/LayerList.tsx:338-370`.
    The open eye and open lock get
    `opacity-0 group-hover/menu-item:opacity-100 focus-visible:opacity-100`
    unless the row is selected. The columns stay. Update the file-header
    comment (lines 10-13). Test first in `tests/layerlist-dom.test.tsx`: an
    unselected shown/unlocked row's controls have the hidden class, a
    hidden/locked row's don't, and a selected row's don't. Deps: none.
11. **Hide/Lock Layer commands**: `src/components/AppMenu.tsx` (Layer
    submenu) and App.tsx's command table. Test first in
    `tests/app-ux-commands-dom.test.tsx`: ⇧⌘H toggles `enabled` on the
    selection (one undo step), ⇧⌘L toggles `locked`, and both are disabled
    with nothing selected. Also add `tests/appmenu.test.ts` rows for the menu
    items. Deps: 3 (App.tsx).
12. **Persistent inspector panel**: `src/App.tsx:2585-2841`. At ≥900px,
    an `<aside aria-label="Inspector">` sits in the flex row (no portal,
    and the `mr-[300px]` margin goes). Below 900px, it keeps today's Sheet.
    With nothing selected the aside shows the page-art editors via
    `contentFor`. Escape-to-deselect moves from the Sheet's `onOpenChange`
    to App's key listener, with the same `defaultPrevented`/typing guards.
    Test first: `tests/inspector-escape-dom.test.tsx` (Escape still deselects
    and is still ignored while typing) and new `tests/inspector-panel-dom.test.tsx`
    (the panel exists with no selection and shows the Texture drop, the
    preview pane's width doesn't change on select, and at 800px the Sheet
    opens only with a selection). Deps: 11.
13. **View → Inspector toggle**: `AppMenu.tsx`, `useViewPrefs.ts`
    (`showInspector`, ⌥⌘B). Test first: `tests/view-prefs.test.ts`
    (persists) and `tests/appmenu.test.ts` (check state). Deps: 12, 1.

### Phase D

14. **Docs**: `docs-site/content/docs/(authoring)/inspector.mdx`,
    `layers.mdx`, `workspace.mdx` and `(reference)/shortcuts.mdx`
    (⇧⌘H, ⇧⌘L, ⌥⌘B). Also the `CHANGELOG.md` `[Unreleased]` bullets, and
    `.agents/ledger.md`: close `ux-narrow-inspector` and add this pass. Retake
    the inspector screenshots the guide uses. Deps: 13.
15. **Final validation**: `npm test`, `npx tsc --noEmit`, `npm run lint`,
    `npm run build`, `npx knip@6.38.0` and `node scripts/check-release.mjs origin/main`.
    Then measure-first screenshots at 1440×900 and 800×700, showing the
    inspector fits without scrolling for Name and Warning and the canvas
    doesn't move on select. Deps: 14.

## Parallelism

A runs sequentially (1→2→3). Tasks 4, 9 and 10 have no dependencies and
can run alongside A. 5→6→7→8 run sequentially (same files). 11→12→13 run
sequentially after 3.

16 can run alongside 5–6 (different files apart from its test); 17 runs after
6 and 16, then 7→8 continue; 18 closes Phase B.

## Risks

- Task 12 swaps the Sheet's focus handling (initialFocus off, keyboard
  finalFocus, dialog name #616) for a plain region. The aside needs no focus
  trap, but the narrow-width Sheet keeps those props. Covered by
  `inspector-escape-dom`.
- Fitting both fields of a pair in a 268px row: each compact cell is about
  122px after its badge slot. Check that "4.0633 in" fits; if it doesn't,
  drop the unit addon to the label side.
