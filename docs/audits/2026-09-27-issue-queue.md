# Issue queue disposition — 2026-09-27

95 open issues were reviewed. This branch implements 91; three already have
separate pull requests, and #283 awaits a physical phone scan before changing
its QR design. These are implementation dispositions, not claims that fixes
have merged or shipped. Version remains 0.1.98; changes are under Unreleased.

The branch is stacked on #358. Keep #337 and #357 as separate changes and
re-run integration checks when landing them; their original CI checks pass.

## Validation

TypeScript, zero-warning ESLint, full Vitest suite, production app build and
release metadata checks pass. The full suite has 1210 passing tests in 110 files. The earlier UI/document batch
also passed all ten Rust tests and the docs production build, including route
checks (valid markdown/image endpoints 200; invalid suffixes 404).

The local browser smoke check covered the divider's arrow-key change, sidebar
collapse/reopen at 768 and 375 pixels, and light/dark appearance at desktop size.
Collapsed sidebar controls are now inert and leave the accessibility tree.
At 375 pixels, opening the desktop sidebar leaves little canvas space; closing
it restores the canvas. There is no mobile-specific layout or visual baseline,
so visual-regression certification is **inconclusive**. Two browser connection
errors appeared in the browser log; the editor interactions completed. This is
not a complete screen-reader or automated accessibility certification.

## Barcode evidence (#284)

The backing-only experiment compared the original art with the same render
without its barcode. Every pixel that differed between those two renders
(including the bar/digit edges and halo) was preserved exactly. Only equal
background pixels inside the barcode backing area became white. No threshold
or bar-width changes were applied. At 600 DPI, ZXing's default decoder gave:

| Label | Original | Background-only replacement | Preserved symbol pixels |
| --- | --- | --- | ---: |
| Blue Agate | No result | 0860009737655 | 162,336 |
| Ball Python | No result | 0850051366156 | 160,850 |
| Lupula | 0860009737617 | 0860009737617 | 160,425 |

After the fix, all three exported PDFs decode without image modification.
The shared plan emits a backing on the barcode stroke's plate, followed by the
original bars and digits, across PDF/canvas/PSD. Quiet-zone allowances follow
[GS1's EAN/UPC table](https://ref.gs1.org/standards/genspecs/9.0.0/)
and [Code 128 guidance](https://www.gs1.org/standards/gs1-logistic-label-guideline/1-3).
The existing barcode placement and digit geometry stay unchanged.

The Blue Agate before/after PDF raster diff changes 54,340 pixels, confined to
the backing at x=3786,y=2627,w=850,h=253. Four untextured golden PDF fixtures
have zero changed pixels at 600 DPI; their new explicit paths change byte hashes.
The PSD has a four-knot editable backing shape; Photoshop raster certification
remains pending, as documented in `tests/goldens/README.md`.

Print-code regression tests use the actual exported PDF geometry and local
ZXing WASM at 600 DPI: dots QR and backed UPC, each at 0° and 90°. The barcode
encoding-table tests compare all rows with ZXing's independent reference data.
These software checks do not certify a physically printed label.

## Physical check still needed (#283)

The issue requires checking the printed Lupula label with iOS Camera or a stock
Android scanner before changing its design. That cannot be performed here.
The user was given [the issue](https://github.com/energee/art-files/issues/283)
and [the encoded destination](https://lolev.beer/beer/lupula). The QR design is
unchanged; #283 must remain open pending that result.

## Per-issue disposition

| Issue | Topic | Disposition |
| --- | --- | --- |
| [#244](https://github.com/energee/art-files/issues/244) | ⌘W / ⌘N / ⌘S and other ⌘ shortcuts act on the tab behind an open modal dialog | Existing [PR #337](https://github.com/energee/art-files/pull/337) |
| [#245](https://github.com/energee/art-files/issues/245) | Port the unshipped semantic-colour work (wip/color-intent) onto main | Implemented in this branch |
| [#254](https://github.com/energee/art-files/issues/254) | Unported from #65: paired export dialogs with cancel/partial outcomes; Help → Check for Updates on Windows/Linux | Implemented in this branch |
| [#263](https://github.com/energee/art-files/issues/263) | Edits made while a save is still writing are lost: ⌘S marks them saved, Save Master reverts them | Implemented in this branch |
| [#264](https://github.com/energee/art-files/issues/264) | Selecting a legacy label's own custom layer crashes the editor (Unknown layer); it can't be moved or deleted | Implemented in this branch |
| [#265](https://github.com/energee/art-files/issues/265) | Browser Save: a refused write downloads a copy and marks the tab saved; cancelling Save As forgets the file | Implemented in this branch |
| [#266](https://github.com/energee/art-files/issues/266) | A texture or mask that fails to decode is ignored silently (unhandled rejection, no error shown) | Implemented in this branch |
| [#267](https://github.com/energee/art-files/issues/267) | A .label with a malformed override or value crashes the editor instead of failing the open | Implemented in this branch |
| [#268](https://github.com/energee/art-files/issues/268) | Save Master review says "Nothing has changed in the master" after a margin edit, then saves it anyway | Implemented in this branch |
| [#269](https://github.com/energee/art-files/issues/269) | Re-aiming a label at another master and back reorders its variants (different variant wins, promote target moves) | Implemented in this branch |
| [#270](https://github.com/energee/art-files/issues/270) | CLI --label rejects a .label whose override clears a field (null), which the app opens and exports | Implemented in this branch |
| [#271](https://github.com/energee/art-files/issues/271) | CLI --label fails 'Unknown layer' on values/overrides a switched-off version left on the label | Implemented in this branch |
| [#272](https://github.com/energee/art-files/issues/272) | CLI rejects WebP textures the app accepts, with 'The input is not a PNG file!' naming no file | Implemented in this branch |
| [#273](https://github.com/energee/art-files/issues/273) | Resetting a variant's override shows the layer as "Removed from the master" in the Save Master review | Implemented in this branch |
| [#274](https://github.com/energee/art-files/issues/274) | CLI ignores the Settings bleed/DPI the app exports with; layout.ts says it never calls setBleed | Implemented in this branch |
| [#275](https://github.com/energee/art-files/issues/275) | src-tauri Rust tests never run in CI; ci.yml says release.yml compiles the backend 'on tags' | Implemented in this branch |
| [#276](https://github.com/energee/art-files/issues/276) | package.json: @types/node is undeclared (tsc passes via transitives); bundled ag-psd sits in devDependencies | Implemented in this branch |
| [#278](https://github.com/energee/art-files/issues/278) | Escape-cancelling an in-place text edit restores the text but leaves the tab marked unsaved | Implemented in this branch |
| [#279](https://github.com/energee/art-files/issues/279) | Inspector mm fields clip a value's third decimal (Y reads 106.02 while the layer holds 106.023) | Implemented in this branch |
| [#280](https://github.com/energee/art-files/issues/280) | Docs: Inspector page promises a header close button; the inspector has none | Implemented in this branch |
| [#281](https://github.com/energee/art-files/issues/281) | Docs: Variants guide describes Layers-header chips and stacking that the UI removed in 0.1.60 | Implemented in this branch |
| [#282](https://github.com/energee/art-files/issues/282) | Pasted tab prints as four spaces while the preview shows one; the PDF line shifts and overlaps | Existing [PR #358](https://github.com/energee/art-files/pull/358) |
| [#283](https://github.com/energee/art-files/issues/283) | Shipped QR style doesn't scan on a light texture: quiet zone and light modules show the art | Awaiting physical scan |
| [#284](https://github.com/energee/art-files/issues/284) | UPC-A quiet zone isn't backed: default ZXing binarizer can't read the barcode on textured labels | Implemented in this branch |
| [#285](https://github.com/energee/art-files/issues/285) | With Uppercase on, Bold and White ink can't be turned off on a selected run | Implemented in this branch |
| [#286](https://github.com/energee/art-files/issues/286) | Switching to the 3D view from the menu mid in-place edit drops that layer from the can | Implemented in this branch |
| [#287](https://github.com/energee/art-files/issues/287) | Arrow-key nudges within 500 ms fold into one undo step, and into the drag before them | Implemented in this branch |
| [#288](https://github.com/energee/art-files/issues/288) | Opening a .label or .master inflates every ZIP entry with no size cap (decompression bomb) | Implemented in this branch |
| [#289](https://github.com/energee/art-files/issues/289) | Collapse the platform save/open switch spelled 5 times; the copies already disagree on write errors | Implemented in this branch |
| [#290](https://github.com/energee/art-files/issues/290) | QR 'Error correction' shows 'M (default)', but a QR layer with no ecLevel prints at level L | Implemented in this branch |
| [#291](https://github.com/energee/art-files/issues/291) | ⌘B / Ctrl+B collapses the Layers sidebar even while typing in a text field or behind a dialog | Implemented in this branch |
| [#292](https://github.com/energee/art-files/issues/292) | Updater's Restart Now / Install and Restart discard every unsaved tab without the unsaved-tabs prompt | Implemented in this branch |
| [#293](https://github.com/energee/art-files/issues/293) | Justified text stretches the last line of every paragraph but the final one to full width | Implemented in this branch |
| [#294](https://github.com/energee/art-files/issues/294) | Barcode tests pin only a few encoding-table rows; corrupting UPC digits 7/9 or EAN parity passes all tests | Implemented in this branch |
| [#295](https://github.com/energee/art-files/issues/295) | No test decodes the shipped dots-style QR; the jsQR round trip covers only the square style | Implemented in this branch |
| [#296](https://github.com/energee/art-files/issues/296) | Open-time layer warnings show twice in the header: once as a red 'Note:' error, once in amber | Implemented in this branch |
| [#297](https://github.com/energee/art-files/issues/297) | Escape-cancelling a canvas drag or resize still lets the release click reselect or clear the selection | Implemented in this branch |
| [#298](https://github.com/energee/art-files/issues/298) | Clicking a selection handle without dragging deselects the layer | Implemented in this branch |
| [#299](https://github.com/energee/art-files/issues/299) | Resizing a barcode stores an unrounded moduleW (float noise in the Save Master review) | Implemented in this branch |
| [#300](https://github.com/energee/art-files/issues/300) | Selection resize handles announce as sliders but can't be focused or operated | Implemented in this branch |
| [#301](https://github.com/energee/art-files/issues/301) | Manual guides can't be created or moved by keyboard; arrows on a focused guide nudge the layer | Implemented in this branch |
| [#302](https://github.com/energee/art-files/issues/302) | 3D can view: orbit and pan are pointer-only | Implemented in this branch |
| [#303](https://github.com/energee/art-files/issues/303) | ScrubField: pressing Shift or Alt mid-scrub rescales the whole drag, so the value jumps | Implemented in this branch |
| [#304](https://github.com/energee/art-files/issues/304) | Re-zipped .label/.master can take texture/.DS_Store as the texture (sibling of #100) | Implemented in this branch |
| [#305](https://github.com/energee/art-files/issues/305) | Move v1 layout constants and barcode geometry only the legacy oracle reads out of src (~330 ln) | Implemented in this branch |
| [#306](https://github.com/energee/art-files/issues/306) | Trim sidebar.tsx to the 11 parts used: drop its mobile Sheet branch and 12 dead exports (~350 lines) | Implemented in this branch |
| [#307](https://github.com/energee/art-files/issues/307) | Replace react-resizable-panels (one split handle over two canvases) with a native divider | Implemented in this branch |
| [#308](https://github.com/energee/art-files/issues/308) | Delete 6 dead functions/fields only their own tests reach (bindBelow, unbind, positionFromDrag, …) | Implemented in this branch |
| [#309](https://github.com/energee/art-files/issues/309) | Delete labelfile.ts's superseded packLabel/packLabelV2/unpackLabel (model/files.ts has live twins) | Implemented in this branch |
| [#310](https://github.com/energee/art-files/issues/310) | Use selection.ts's modsOf in LayerList instead of re-declaring SelectMods and the ⌘/Ctrl rule | Implemented in this branch |
| [#311](https://github.com/energee/art-files/issues/311) | Use structuredClone for merge.ts's hand-rolled deep clone; export one isPlain instead of four | Implemented in this branch |
| [#312](https://github.com/energee/art-files/issues/312) | Binding 'Side' is a native <select> listing raw lowercase values (top/left/right/bottom) | Implemented in this branch |
| [#313](https://github.com/energee/art-files/issues/313) | Master picker's rebind confirmation is a role="menu" with no menu items | Implemented in this branch |
| [#314](https://github.com/energee/art-files/issues/314) | Master picker copy leaks internals: 'move to the bench', and a raw master id in the open error | Implemented in this branch |
| [#315](https://github.com/energee/art-files/issues/315) | Colour hex box silently ignores '#fff' and 'ff0000' (no #) and reverts on blur with no message | Implemented in this branch |
| [#316](https://github.com/energee/art-files/issues/316) | Saved colour swatches can only be removed by shift-click; the keyboard cannot remove one | Implemented in this branch |
| [#317](https://github.com/energee/art-files/issues/317) | Updater copy: 'Up-to-date' in the status bar vs 'up to date' in the dialog; signing-key jargon | Implemented in this branch |
| [#318](https://github.com/energee/art-files/issues/318) | A failed update install leaves no way to retry: the dialog offers only Close and the update is dropped | Implemented in this branch |
| [#319](https://github.com/energee/art-files/issues/319) | Layers list: screen readers can't tell which rows are selected, and reorders aren't announced | Implemented in this branch |
| [#320](https://github.com/energee/art-files/issues/320) | Windows/Linux show Mac-only ⌘/⇧ glyphs in the command palette, web menubar and Layers hint | Implemented in this branch |
| [#321](https://github.com/energee/art-files/issues/321) | Stale LayerList/MasterPicker comments, and a Changed-filter tooltip that describes a removed filter | Implemented in this branch |
| [#322](https://github.com/energee/art-files/issues/322) | Delete in the Layers list removes only the focused row of a multi-selection; ⌥↑/↓ and drag move them all | Implemented in this branch |
| [#323](https://github.com/energee/art-files/issues/323) | Image wells silently ignore a rejected drop (a JPEG on the PNG-only mask, or two files at once) | Implemented in this branch |
| [#324](https://github.com/energee/art-files/issues/324) | Save Master As… review is titled and worded as Save Master ('written to the template') | Implemented in this branch |
| [#325](https://github.com/energee/art-files/issues/325) | Window drop overlay: texture hint omits WebP, and a multi-file drag lights up a target the drop then ignores | Implemented in this branch |
| [#326](https://github.com/energee/art-files/issues/326) | golden-diff CLI test ignores spawn errors, so a missing tsx fails as 'expected null to be 1' | Implemented in this branch |
| [#327](https://github.com/energee/art-files/issues/327) | Guide and status-bar tooltip say Settings → Resolution sets the PDFs' DPI; only the PSDs follow it | Implemented in this branch |
| [#328](https://github.com/energee/art-files/issues/328) | generate.mdx's `--inspect` command prints npm's banner before the JSON; piping it to jq fails | Implemented in this branch |
| [#329](https://github.com/energee/art-files/issues/329) | src/index.css and five test names cite docs/plans/template-switch.md, which never landed on main | Implemented in this branch |
| [#330](https://github.com/energee/art-files/issues/330) | Settings page calls Corner radius and Edge softness fractions; the dialog's fields are in inches | Implemented in this branch |
| [#331](https://github.com/energee/art-files/issues/331) | Background layer row uses the generic image icon; guide and code comment promise its own icon | Implemented in this branch |
| [#332](https://github.com/energee/art-files/issues/332) | Keyboard shortcuts page omits ⌥↑ / ⌥↓, the only keyboard way to reorder a layer | Implemented in this branch |
| [#333](https://github.com/energee/art-files/issues/333) | Getting started: the update check isn't GitHub Releases, and Check for Updates… exists only on macOS | Implemented in this branch |
| [#334](https://github.com/energee/art-files/issues/334) | conventions.md cites deleted files and moved lines, so most of its claims are VOID by its own rule | Implemented in this branch |
| [#335](https://github.com/energee/art-files/issues/335) | Guide says a preview rebuild blurs with a 'rendering preview…' note; that only happens on export | Implemented in this branch |
| [#336](https://github.com/energee/art-files/issues/336) | Inspector's Fit control on the background and mask does nothing; page art always cover-fits | Implemented in this branch |
| [#338](https://github.com/energee/art-files/issues/338) | Exported PSDs carry no resolution: a 600 DPI export opens in Photoshop as 72 ppi (67.7 × 42.7 in) | Existing [PR #357](https://github.com/energee/art-files/pull/357) |
| [#339](https://github.com/energee/art-files/issues/339) | to-cmyk.sh turns black text, barcode and QR into 4-colour rich black (C72 M68 Y67 K88, 305% ink) | Implemented in this branch |
| [#340](https://github.com/energee/art-files/issues/340) | Characters the label font lacks (→ ✓ ★ ⅓ №, emoji, CJK) print as .notdef boxes; preview shows them, no warning | Implemented in this branch |
| [#341](https://github.com/energee/art-files/issues/341) | New Variant after deleting one reuses an existing name: the master picker lists two 'Variant 3' rows | Implemented in this branch |
| [#342](https://github.com/energee/art-files/issues/342) | goldens.md re-baseline puts the CLI's PDF digests in the golden test; they never match what the test builds | Implemented in this branch |
| [#343](https://github.com/energee/art-files/issues/343) | README: 'All geometry lives in src/layout.ts' — positions live in each master's layers now | Implemented in this branch |
| [#344](https://github.com/energee/art-files/issues/344) | Docs: Inspector page says a QR has only a size; it also has Style and Error correction | Implemented in this branch |
| [#345](https://github.com/energee/art-files/issues/345) | Docs site: /llms.mdx/docs/<anything> and /og/docs/<anything> answer 200 with the home page, not 404 | Implemented in this branch |
| [#346](https://github.com/energee/art-files/issues/346) | AGENTS.md says its commands were last run at d10cddf, which predates its new Lint and knip lines | Implemented in this branch |
| [#347](https://github.com/energee/art-files/issues/347) | Deleting a layer from the Layers list with Delete drops keyboard focus to the page body | Implemented in this branch |
| [#348](https://github.com/energee/art-files/issues/348) | Replace LayerInspector's six hand-spelled Select blocks with one SelectField (~-38 lines) | Implemented in this branch |
| [#349](https://github.com/energee/art-files/issues/349) | Fold App's buildFull and exportPsd into one export-pair routine (~-15 lines) | Implemented in this branch |
| [#350](https://github.com/energee/art-files/issues/350) | Replace scripts/is-entry.mjs with Node's import.meta.main (after pinning CI Node >= 22.18) | Implemented in this branch |
| [#351](https://github.com/energee/art-files/issues/351) | Delete TextEditor's LINE_CLASSES precompute; tailwind-merge already caches cn() results | Implemented in this branch |
| [#352](https://github.com/energee/art-files/issues/352) | Merge TextEditor's ChoiceField and PlainField shells (same label, suffix, validation, error) | Implemented in this branch |
| [#353](https://github.com/energee/art-files/issues/353) | Delete orphaned duplicate doc blocks in TextEditor (ChoiceBox) and LayerInspector (Vocabulary) | Implemented in this branch |
| [#354](https://github.com/energee/art-files/issues/354) | Inline canScene's rebuildLabelMesh: the label-size scrub it was split out for is gone | Implemented in this branch |
| [#355](https://github.com/energee/art-files/issues/355) | Drop psd/build.ts's gapAfter: it recomputes the word-gap test linesOf already made | Implemented in this branch |
| [#356](https://github.com/energee/art-files/issues/356) | Replace main.rs OpenedFile's Vec + remove(0) with VecDeque::pop_front | Implemented in this branch |
