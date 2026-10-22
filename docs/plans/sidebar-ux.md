# Sidebar UX pass

Fixes from the 2026-10-22 audit of the left sidebar (`MasterPicker` +
`LayerList`), measured in the running app (dark theme, 256px sidebar).
One PR, branch `feat/sidebar-ux`. Each task starts with its failing test.

## Decisions

| # | Finding | Decision |
|---|---------|----------|
| 1 | Selected row is `rgb(36,37,45)` on `rgb(32,33,41)` (~1.05:1), same as hover | Selected = `bg-sidebar-primary/15`. Hover stays the faint accent. (Follow-up: the left bar and the name's focus ring were dropped on review) |
| 2 | Power is "lit while OFF", so the off rows look the most "on" | Show the state that is the exception: `PowerOff` while the row is off, `Lock` while locked. The normal state (Power, LockOpen) shows only on row hover, focus or selection, the way the "…" menu already does. `aria-pressed` is unchanged |
| 3 | Row switches are 16×16 | 24×24 (WCAG 2.2 target size), icons 14px |
| 4 | Off variant row: dimmed name + struck badge + bright power | Drop the strikethrough. The dimmed row and its `PowerOff` say it; the badge title still says "(off)" |
| 5 | Save Master… always shown (dim pink when disabled); Rename/Delete variant are permanent buttons | Save shows only while `masterDirty`. Rename and Delete move into the picker menu's foot, beside New Variant, as sentinel items like New Variant already is |
| 6 | "Changed" chip takes its own row | Move the chip into the Layers header, between the title and Add layer |
| 7 | "⇧ click for a range · ⌘ click to add" shown whenever something is selected | Remove the line; fold it into the row button's title |
| 8 | Canvas selection never scrolls the row into view | A row that becomes selected calls `scrollIntoView({ block: "nearest" })` |
| 9 | Rename/Remove only behind a hover-only "…" | Rename and Remove become their own row buttons (pencil, trash), shown on hover like the switches; the "…" menu and right-click go. Order: rename, remove, lock, power (power at the right edge) — revised on review |
| 10 | "Text logo" has the image icon | Skip: the icon is by kind, and that layer is an image. Renaming layers is data, not UI |
| 11 | Grab cursor over every name | Default pointer; `grabbing` only while pressed |

## Tasks (sequential: two files, shared tests)

1. **Selection highlight** — `src/components/LayerList.tsx`. Test first in
   `tests/layerlist-dom.test.tsx`: a selected row carries `bg-sidebar-primary/15`
   and the inset bar; an unselected row does not.
2. **Switch icons, size, strikethrough (2, 3, 4)** — `LayerList.tsx`. Tests: an
   off row renders `PowerOff` (`data-state="off"` on the button), a locked row
   shows its lock persistently, controls are `size-6`; update the #440 badge
   test to "no strikethrough".
3. **Header (6, 7)** — `LayerList.tsx`. Tests: the Changed chip sits inside the
   group label; no hint paragraph renders with a selection.
4. **Scroll and right-click (8, 9)** — `LayerList.tsx`. Tests: selecting a row
   calls `scrollIntoView`; `contextmenu` on a row opens Rename/Remove.
5. **Cursor (11)** — `LayerList.tsx`, no test (class swap).
6. **Master picker verbs (5)** — `src/components/MasterPicker.tsx`. Tests in
   `tests/masterpicker-dom.test.tsx`: Save is absent when clean; on a variant
   the menu foot lists Rename/Delete items that call the same handlers; the
   Delete note (#426) still shows.
7. **Docs** — `docs-site/.../layers.mdx`, `variants.mdx`, CHANGELOG
   `[Unreleased]`, `.agents/ledger.md`.

Acceptance: `npx tsc --noEmit`, `npm test`, `npm run lint`, knip, and
`node scripts/check-release.mjs origin/main` pass; checked in the browser in
dark and light.
