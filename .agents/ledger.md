# Ledger

Findings and their status, across sessions. Append entries; newest at the bottom.

## Run state

Written by `playbooks/improve.md` at run start and read back by a resumed run. One
block, updated in place — not appended per run.

```
- base branch: <branch the entries below were worktree'd from>
```

## Entry format

```
## <date: ISO YYYY-MM-DD> <finding-slug>
- finding: [<principle>/<severity>] <file:line> — <what>
- status: open | in-progress | done | parked(<gap: context|capability|authority|proof|feedback>)
- attempts: <n>/3
- delta: <before → after evidence, e.g. "dup blocks 14 → 9; tests green">
- ruling: <parked entries only — which gap, what evidence, what would unpark it>
```

`file:line` records where the finding was **seen at audit time**, not where it lives when
someone works it. Earlier passes in the same run move code, so re-locate the finding
before fixing it: a citation that no longer resolves means the entry is a stale pointer,
never that the finding's scope is empty.

## Typed graph and provenance (optional)

Append any of these flat fields inside a finding entry. They are the canonical data
contract; existing untyped entries need no migration. Path, evidence, and learning
lines may repeat.

```
- id: <stable unique ID, using letters, digits, dot, underscore, or hyphen>
- depends-on: none | <ID>, <ID>
- read-path: none | <one repo-relative path; repeat field for more>
- write-path: none | <one repo-relative path; repeat field for more>
- acceptance: <one-sentence observable completion condition>
- observed-at: <commit where the finding was observed>
- attempted-in: <worktree path> @ <branch>
- evidence: <fresh command result or exact diff-review evidence>
- fixed-by: <commit containing the fix>
- verified-by: <verifier identity | same-context fallback> @ <commit verified>
- learning: none | <learnings.md entry or concise learning>
```

For an actionable finding to opt into graph scheduling it records `id`,
`depends-on`, at least one `read-path`, at least one `write-path`, and `acceptance`;
an omitted scheduling field means unknown, never empty, and requires serial fallback.
Use `none` as the sole path-field occurrence to state that a set is known empty; never
mix it with paths. IDs are case-sensitive, unique in the ledger, stable across status
changes, and match `[A-Za-z0-9][A-Za-z0-9._-]*`. Lowercase `none` is reserved for empty lists
and cannot be an ID. Dependency IDs remain comma-separated because their grammar excludes
commas. Each `read-path` and `write-path` contains one atomic path; repeat the field for
additional paths, so commas and spaces are preserved.

Readiness has four rules:

- An `open` or `in-progress` finding is ready only when every ID in `depends-on` is
  present and `done`. A missing ID, a parked dependency, or an open/in-progress
  dependency blocks it; missing IDs are invalid state rather than ordinary blockers.
- Dependency cycles and malformed present fields are invalid state. Stop before fix
  or merge work until `bash <ultraharness>/scripts/ledger-graph.sh <ledger>` reports `OK`.
- Only write/write overlap is a conflict. Reads are provenance and review scope:
  read/read and read/write overlap do not prevent a wave because worktrees isolate fix
  work and every candidate is updated and reverified before its serial merge.
- Write paths are lexical repository-relative paths. The analyzer removes leading
  `./`, repeated `/`, and trailing `/`; rejects absolute paths, `..`, backslashes, and
  wildcards; and treats equality or ancestor/descendant overlap as a conflict. Thus
  `config` conflicts with `config/app.yml`, while `config.yml` does not.

A finding with an `id` is typed history. Before it becomes `done`, it must carry at
least one `evidence` line, a hexadecimal `fixed-by` commit, and `verified-by` in
`<identity> @ <same commit>` form. Old done entries without an ID remain valid: their
absence of these later fields is compatibility history, not proof manufactured after
the fact.

Together the fields are the smallest provenance graph: `finding` names the governing
principle/lens and observation site; `observed-at` pins its time; `depends-on` records
causality; `attempted-in` records isolation; `fixed-by`, `evidence`, and `verified-by`
record implementation and evaluation; `delta` records measured change; `learning`
records what was revealed; and a parked status plus `ruling` records a named blocking
gap. Git history supplies the temporal sequence, so these relationships do not need a
separate event stream.

## Run stop format

Written by any playbook that stops a run early. This is a run record, not a finding:
no status, no attempts, no delta.

```
## <date: ISO YYYY-MM-DD> run-stopped
- stopped: <what stopped the run>
- unblocks: <what would clear it>
```

## Standing rules

- Never delete entries — mark them done or parked instead; the history is the point.
  A closed entry (done, or implemented/fixed on a branch that has merged) whose
  heading date is more than 30 days old moves verbatim to `ledger-archive.md`,
  unless it still lists an open or deferred follow-up or a live entry names its
  `id` in `depends-on`. Open, parked and in-progress entries stay here regardless
  of age.
- Parked requires a written ruling: which gap, what evidence, what would unpark it.
- One failed run never establishes "worker limitation" — retry before concluding
  anything about capability.

---

## 2026-08-25 canvas-preview-swap-phase3
- finding: [user request] canvas preview renderer Phase 3 — the swap, plus 3D-from-canvas pulled forward from Phase 4 (user decision)
- status: done
- attempts: 1/3
- delta: 2D preview renders per keystroke from planLabel+drawPlate (no worker, no debounce; asset assembly split off with asset-only deps); in-place editing = planLabel skip flag, v0.1.16 hide-and-rebuild plumbing deleted; 3D views texture via new drawPlates/sync buildLabelTextures (pdf.js retained only for the dev parity page); DELETED pdf/client.ts, pdf/worker.ts, tests/preview-client.test.ts, App's pdfs/needMask/inputs/built/buildChain machinery, TabsShell dispose; all six Phase-2 carried items landed; final review restored the dropped PREVIEW_RASTER_MAX_EDGE cap (backing store measured 5040px at bleed 0.2, now clamps at 4876). Verified in real Chrome (per-keystroke paint, same-frame edit skip, mask plate, eyes, 3D can from canvas plates, zoom ratchet, bleed repaint, zero worker traffic), parity 2.04-2.48% (max 5%), npm run generate builds all four exports; 260 tests + tsc green; v0.1.19. Commits e552d35..7e262a1 + docs.
- learning: replacing a rendering pipeline must port the old call's guard OPTIONS, not just its happy path — scaleCap's maxEdge half was silently dropped and only the final whole-branch review caught it
- Carried to Phase 4: PSD-on-plan (priority), drag-to-move, dynamic fonts via src/fonts.ts; deferred minors — half-painted plate if drawPlate ever throws mid-walk (unreachable today; offscreen+blit if it matters), shared buildError channel cleared by any successful frame (split per-source state before Phase 4 adds writers), mask plate repaints at split 0 (gate on split>0 if keystroke latency regresses at max zoom), planFrom() helper to dedupe the two planLabel spellings, unit pin on drawPlates scale math (needs DOM stub), barcode-halo test's translate-index scoping invariant, CanView 3D texture failures warn-only (spec amended to record this).

## 2026-09-04 master-as-layers-session-resume
- finding: [user request] Claude session 0bff2b49-40ae-4dac-b567-b62a13afff54 stopped at its session limit during v3 App/backend integration
- status: parked(proof)
- attempts: 1/3
- delta: unfinished App/backend contracts integrated; unified Layers list, rich multiline editors, variant-targeted edits, binding validation, Settings, PDF/PSD/canvas shared placement, legacy CLI conversion and four-format generation completed; version 0.1.43 prepared
- evidence: 765/765 tests across 60 suites, production build (including TypeScript), Cargo check, diff check and 0.1.43 release metadata gate pass; CLI generated all four exports with and without art; App DOM test exercises selection, content edit and undo
- ruling: remaining visual acceptance requires live browser access and Photoshop-rendered old/new PSD rasters; CUA returned no browser available, and ag-psd does not render editable text/vector/effects composites. PDF 600-DPI diff review is complete in tests/goldens/README.md. No release published.
- notes: horizontal/above/baseline binding and variant draw order remain deferred per approved spec; relative below bindings and chains implemented
- re-check 2026-10-11 @ 0bb506c: in-progress → parked(proof). The integration shipped and has been released through 0.1.106; the only remaining item is the Photoshop raster certification, still recorded as pending in tests/goldens/README.md (lines 22-30, 59). Unparks when someone renders the old/new PSDs in Photoshop at 600 DPI and commits the pair.

## 2026-09-05 release-build-performance
- finding: [user request] optimize builds after Windows release 33962816055 took 6m 2s, including 3m 22s in Cargo despite a cache hit
- status: done
- delta: release Rust pinned to 1.98.1 (the compiler in that successful run); superseded PR test runs cancel while main/release jobs remain protected; release jobs emit and upload per-target Cargo timing HTML for 14 days
- experiment: macOS arm64, rustc 1.97.1, existing 0.1.51 source/dist; initial dependency warm-up excluded (274 seconds). Alternating two default release app rebuilds and two with --config profile.release.package.label-lab.opt-level=1, touching src-tauri/src/main.rs before each; cargo build --manifest-path src-tauri/Cargo.toml --release --timings. Default: 71.55/81.96 seconds, 11262192 bytes. Candidate: 103.35/99.34 seconds, 13784848 bytes. Candidate averages 32% slower and is 22% larger; rejected, no profile change retained. Local results are not a Windows speedup claim; no startup comparison needed after rejection.
- evidence: four measured release builds pass; Actionlint 1.7.12 validates both workflows (shellcheck unavailable); YAML parsing, diff check and 0.1.51 release gate pass. No workflow dispatched or release published. Existing sidebar edits preserved.
- deferred: shared frontend build adds artifact transfer/dependency overhead for a small wall-clock saving; revisit if new timings show frontend dominating

## 2026-09-05 native-desktop-files
- finding: [Fail fast/high] src/masters.ts:40, src/App.tsx:1114,1441,1720 — custom masters cannot resolve on desktop; masterHint reads are uncontained; export prompts twice; the platform save is spelled three times
- status: done
- attempts: 1/3
- id: native-desktop-files
- depends-on: none
- read-path: src/files.ts
- read-path: src/masters.ts
- read-path: src/App.tsx
- read-path: src-tauri/src/main.rs
- read-path: src-tauri/capabilities/default.json
- write-path: src/files.ts
- write-path: src/masters.ts
- write-path: src/App.tsx
- write-path: src/model/fields.ts
- write-path: src/model
- write-path: src-tauri/src/main.rs
- write-path: src-tauri/capabilities/default.json
- write-path: tests
- acceptance: a .label whose masterHint escapes both roots opens to a named error plus a picker with no fs read; Export PDFs asks once and writes both plates or nothing; Open Master remembers a real path on desktop
- observed-at: 35bac01
- evidence: re-checked 2026-10-11 on 802d645. masterHint reads go through hintTrusted (src/masters.ts:254, added 739a778 #249); an untrusted hint is never read and missingMasterChoice names it "which was not read" with Locate/Use current (ace61a5 #376). Open Master uses the native dialog and keeps target.path (openMasterPicker, 74ec29c #59). Platform save is one saveThrough in src/files.ts (2325374 #359). Export pairs ask once on desktop, mask written beside the art file (802d645 #505)
- delta: all four parts closed. "Both plates or nothing" was superseded: a cancelled or failed second file reports the partial save by design (2026-09-27 issue-queue-export-and-cleanup, #359), not rolled back
- fixed-by: 802d645
- verified-by: same-context fallback @ 802d645

## 2026-09-05 masters-library-list
- finding: [KISS/med] src/masters.ts:20 — localStorage index is a single point of failure; a Rust list_masters over the library folder retires it and drives New Label from Master
- status: open
- attempts: 0/3
- id: masters-library-list
- depends-on: native-desktop-files
- read-path: src/masters.ts
- write-path: src/masters.ts
- write-path: src-tauri/src/main.rs
- acceptance: a .master copied into the library folder appears in New Label from Master with no registration step
- re-check 2026-10-11 @ 0bb506c: still open. src/masters.ts is still the localStorage row index (one key per master since #408); no list_masters command in src-tauri/src. #507 only memoised libraryEntries() reads

## 2026-09-05 updater-failure-tests
- finding: [tests/med] src/components/DesktopUpdater.tsx:142-145,203-211 — check() and downloadAndInstall() rejections untested
- status: done
- attempts: 1/3
- id: updater-failure-tests
- depends-on: none
- read-path: src/components/DesktopUpdater.tsx
- write-path: tests
- acceptance: DOM tests assert the silent-log path and the "Could not install the update" reopen
- re-check 2026-10-11 @ 0bb506c: still open, half done. tests/updater-dom.test.tsx covers a rejected downloadAndInstall ("Could not install", Update failed, Try again; #359) and a rejected manual check(). The automatic-check silent path (DesktopUpdater.tsx:164 console.error, checkRequest 0) has no test: no updater test spies on console
- delta (2026-10-21, branch test/updater-failures): tests/updater-dom.test.tsx adds "logs a failed automatic check without opening the dialog or marking the status bar" (rejected check() at checkRequest 0 → console.error "Automatic update check failed: offline", no dialog, empty status bar; fails when the log is dropped or the dialog opens), and the #318 test now asserts the reopened dialog holds "Could not install the update: offline" after a rejected downloadAndInstall(). Tests only; no source bug found
- evidence: npx tsc --noEmit, npm run lint, npx vitest run --testTimeout=180000 and node scripts/check-release.mjs origin/main green on test/updater-failures
- release: non-binary-impacting (tests and agent memory); no release queued

## 2026-09-05 legacy-oracle-deletion
- finding: [YAGNI/med] tests/legacy/plan.ts:1 — 1,220-line pre-v3 layout oracle and 8 suites
- status: parked(context)
- attempts: 0/3
- ruling: still the pixel-parity check for plan.ts; unparks when master-as-layers (2026-09-04 spec) replaces plan.ts, at which point the parity suites snapshot to golden data and tests/legacy goes
- delta (2026-10-08, branch fix/435): knip hits under tests/legacy 3 → 0; tests/legacy 7 files → 5 (+README). Deleted check-margins.mts (manual re-solve script; live positions are the master's) and hittest.ts with its self-testing suite tests/hittest.test.ts (no src counterpart; live hit-testing is covered by hittest-layers.test.ts); un-exported SHIPPED and the knip cascade (LOGO_ASPECT, collabLeftFrame, collabCenterFrame, customBarcodeBox). elements.ts stays only because elements/custom-layers/tracking suites test it against itself (README says so). tsc, lint and the 14 tests/legacy-importing suites green

## 2026-09-05 eslint-react-hooks
- finding: [evidence/high] package.json — no ESLint; 12 eslint-disable comments unverified
- status: open
- attempts: 0/3
- id: eslint-react-hooks
- depends-on: none
- read-path: package.json
- write-path: package.json
- write-path: .github/workflows/ci.yml
- acceptance: `npm run lint` passes in CI with react-hooks and jsx-a11y enabled
- re-check 2026-10-11 @ 0bb506c: still open, half done. ESLint with react-hooks rules-of-hooks/exhaustive-deps runs in CI (`npm run lint`, ci.yml:27; added 0606d97 #252). jsx-a11y is not a dependency and not in eslint.config.js

## 2026-09-05 vision-items
- finding: [UX/low] five delight items, each under 30 minutes: Reveal in Finder after export; drop a .master onto the window to register it; Recent Masters submenu; greyed Export explains itself via one shared gate and a tooltip; non-destructive dismissable warning alert (top-ten #10)
- status: open
- attempts: 0/3
- depends-on: native-desktop-files
- re-check 2026-10-11 @ 0bb506c: still open. Partly met: the blocked-export reason is a button that selects the invalid layer and PDF exports say "(rendering…)" (c66934b #507); Open Recent covers .label only (45c726e #506), not masters. No reveal-in-Finder, no .master drop handling (TabsShell/FileDrop), no dismissable warning alert found

## 2026-09-07 cli-generate

- status: implemented in feat/cli-generate (PR #58)
- delta: `scripts/generate-lib.ts` (DOM-free argv/inspect/coerce/build, kept under scripts/ so it is not a desktop bundle input) with `scripts/generate.ts` as the fs wrapper; `.master` + values JSON (single job or batch, `--variant/--asset/--set/--format/--label`, `--inspect`), legacy argv retained; title/export-name rule and PAGE_ART_ID moved into src/model so app and CLI name exports identically
- review follow-ups: page art on a master without that role layer is an error; a batch is validated, read and built whole before the first write; job overrides are type-checked per field against the target layer; FormatSet and the values/label source are closed unions
- evidence: 1015 tests pass (41 in tests/generate.test.ts incl. --label, --set, exit 2, tint, new-form page art, legacy config + collab, half-write, mistyped override); tsc clean; goldens unchanged; 0.1.64 release metadata gate passes. No release published.
- open: no non-default font-family test — the catalog ships only Poppins; add one when a second family lands

## 2026-09-25 v1-model-deleted
- finding: [YAGNI/med] src/model/document.ts, resolve.ts, lolev.ts, masterfile.ts — dead v1 authoring model kept alive by six test suites (audit 2026-09-05 #6, #7, #10); re-applied from stale PR #65 (005ce9b) onto current main
- status: done
- attempts: 1/3
- delta: document.ts/resolve.ts/masterfile.ts (919 lines) and 4 suites (653 lines) deleted; getPath/setPath → private in edit.ts (their one caller, beside deletePath), configDiff → convert.ts, v1 fixture → tests/fixtures/lolevV1.ts; kept (unlike #65) the v1 parseMaster validation tests (merged into model-types.test.ts) and the v3 shipped-vocabulary tests (model-lolev), both still live; model/fields.ts, merge.ts, types.ts, labelfile.ts stay (live importers)
- fixed-by: chore/65-retire-dead

## 2026-09-25 parity-harness-retired
- finding: [YAGNI/med] parity.html, src/dev/parity.ts, src/pdf/render.ts, rasterWorker.ts, pdfjs-dist (audit 2026-09-05 lines 27, 146) — dev-only parity page and the golden-diff pdf.js fallback; re-applied from #65 (24e05b5, 709892b)
- status: done
- attempts: 1/3
- delta: parity page + pdf.js raster path deleted; pdfjs-dist removed from dependencies (package-lock -278 lines); golden-diff requires pdftoppm (ci.yml installs poppler-utils; a missing binary is the script's own "install poppler" error, no probe spawn); strokecap page kept; pnpm-lock.yaml still lists pdfjs-dist (left to the pnpm-lock hygiene work)
- fixed-by: chore/65-retire-dead
- note: the pnpm-lock.yaml clause above is stale; see 2026-10-08 issue-437-ledger-archive

## 2026-09-27 issue-queue-339
- finding: [correctness/high] #339 — neutral PDF vectors converted to four-colour black
- status: done
- attempts: 1/3
- delta: neutral art fills/strokes use DeviceGray; coloured vectors and raster assets retain their existing colour handling
- evidence: 1177 tests pass with NODE_OPTIONS=--no-experimental-webstorage (Node 26 otherwise shadows happy-dom localStorage); TypeScript, zero-warning lint and release gate pass; Ghostscript 10.08 preserves DeviceGray black and converts gold to coloured CMYK; both 600-DPI art golden diffs have zero changed pixels
- release: binary-impacting; queued under Unreleased, no release published

## 2026-09-27 issue-queue-document-safety
- finding: [correctness/high] #263–#273, #287, #288, #290, #299, #304, #311, #341 — save races, malformed input and inconsistent model/CLI handling
- status: done
- attempts: 1/3
- delta: snapshot-aware saves; stable cancelled/failed save targets; decode errors surfaced; preflight before document replacement; editable label-only layers; complete master review; variant-order round trips; bounded archive inflation; optional CLI clears and dormant values; useful WebP error; independent nudges; precise barcode resize; unique variant names; actual QR default; shared plain-object test and native cloning
- evidence: 1195 tests pass; TypeScript, zero-warning lint and release metadata checks pass; focused DOM regressions retain the prior document and save target after each malformed open
- release: binary-impacting; queued under Unreleased, no release published

## 2026-09-27 issue-queue-ui-and-docs
- finding: #274–#276, #278–#281, #285–#286, #291–#293, #296–#298, #300–#303, #310, #312–#336, #342–#347, #350–#356 — keyboard/input correctness, updater safety, stale docs and redundant helpers
- status: done
- attempts: 1/3
- delta: restored cancelled text state; paragraph-aware justification; keyboard guide/can/swatch controls; stable scrub modifiers; selected-layer removal; platform hints; updater dirty gates and retry; readable rebind/Save As/drop errors; one plain-line field; shared PSD spacing decision; native file FIFO and CLI entry detection; Rust CI and declared Node/runtime dependencies; operator docs match current behavior; route suffix guards; recovered historical plan; corrected agent evidence
- evidence: 1209 tests across 106 suites pass (four workers to avoid machine-contention timeouts); TypeScript, zero-warning lint and release gate pass; all 10 Rust tests pass; docs production build passes; valid markdown/image endpoints return 200 and invalid suffixes 404
- release: binary-impacting; notes queued under Unreleased; version unchanged; no release published

## 2026-09-27 issue-queue-export-and-cleanup
- finding: #245, #254, #284, #289, #294–#295, #305–#309, #340, #348–#349 — export consistency, barcode backing, missing font coverage, semantic colour and redundant runtime code
- status: implemented; review branch fix/issue-queue
- attempts: 1/3
- delta: shared file routing and paired-export cancellation/partial outcomes; Windows/Linux Help updater; font-coverage errors before export; continuous barcode backing through the shared plan; independent full barcode tables and 600-DPI dots-QR/UPC decode tests; semantic colour port with ruler-click tests; native keyboard divider; legacy oracle moved under tests; unused sidebar/font/model/container code removed
- evidence: 1210 tests across 110 suites pass; TypeScript, zero-warning lint, production app build and release checks against main and stack parent pass. Windows download/edit race and renamed export destinations are covered. All three real labels' UPCs decode after the backing fix. Background-only experiment preserved every symbol pixel and rescued both textured cases. Four PDF golden raster diffs are empty; real Blue Agate changes stay inside the barcode backing.
- browser: local light/dark smoke, keyboard divider, narrow sidebar toggle; collapsed controls are inert. No baseline for visual-regression certification; Photoshop raster certification remains pending.
- remaining: #283 requires the printed Lupula phone scan before QR design changes. #244, #282, #338 already have green PRs #337, #358, #357. Full 95-issue disposition: docs/audits/2026-09-27-issue-queue.md.
- release: binary-impacting; notes queued under Unreleased, version remains 0.1.98. No merge or release performed.

## 2026-09-28 barcode-stroke-only
- finding: the barcode quiet-zone plate paints a solid rectangle the stroke halo already covers between the bars and around the digits
- status: done
- attempts: 1/3
- delta: the plate is a barcode switch, Solid background, off unless turned on. Preview, PDF and PSD paint the stroke halo either way, and the plate when the switch is on. The layer box still reserves the quiet zone.
- evidence: 600 DPI collab diffs are 0 px on bare stock (plate matched the page). Over a dark field the rectangle is gone and the white follows the bars and digit groups. Branch fix/barcode-stroke-only.
- release: binary-impacting; queued under Unreleased; version unchanged; no release published.

## 2026-09-28 barcode-mask-matches-stroke
- finding: the barcode mask strokes em-box pills around digit groups, so white ink hangs past the glyph halo (22% extra ink at 144 DPI on UPC 850051366040, 8.5 pt below the digits; the art ink was entirely inside the mask)
- status: done
- attempts: 1/3
- delta: preview, PDF and PSD mask plates paint the same bars and digit glyphs as the art stroke, in plate colours
- evidence: 1278 tests pass; tsc and eslint clean; release check against origin/fix/barcode-stroke-only passes. At 144 DPI, UPC 850051366040 and the rotated template go from 9220 / 6945 extra mask pixels to 0 either way. Shipped mask PDF flood diffs are 0 px at 600 DPI because the flood is the same blue. Art PDF and art PSD hashes unchanged.
- release: binary-impacting; queued under Unreleased; version unchanged; no release published.

## 2026-09-28 label-follows-replaced-master
- finding: [fail-fast/high] src/masters.ts — a label whose masterId no longer matches the file at its path (Save Master As over the same path) resolved the old IndexedDB bytes instead of the file
- status: done
- attempts: 1/3
- delta: label open follows the file and rebinds; a by-id library lookup returns null, drops that cache entry, and removes the stale index row. The Master menu's Remove drops a chosen library row and its remembered bytes; the file stays. tests/masters.test.ts and tests/masterpicker-dom.test.tsx cover both.
- release: binary-impacting; queued under Unreleased on fix/label-follows-master-file; version unchanged; no release published.


## 2026-10-05 ux-narrow-inspector
- finding: [UX/high] src/App.tsx:2326 — Narrow windows lose the preview when the inspector opens
- status: done
- attempts: 1/3
- observed-at: 1b0024900e92d56e90b3f212865e15ecb99fd260
- evidence: Chrome browser reproduction and DOM/accessibility measurements; full steps and source trace in docs/audits/2026-10-05-ux-narrow-inspector.md
- delta: investigation complete; runtime unchanged, fix remains open
- release: non-binary-impacting documentation and agent memory only; no release queued
- evidence: git diff --cached --check and node scripts/check-release.mjs origin/main passed on audit/ux-narrow-inspector documentation diff based on 1b00249; no application suite run
- re-check 2026-10-11 @ 0bb506c: still open. src/App.tsx:2276 still adds mr-[300px] whenever a layer is inspected and SheetContent stays fixed at w-[300px] (:2470); no narrow-window policy added
- delta (2026-10-21, branch fix/inspector-close-button): the fix is the close button. LayerInspector's header row gains a visible ✕ (aria-label "Close inspector", a SheetClose rendering a focusable Button) whose close-press clears the selection, as a bare Escape does, and returns focus on a keyboard close like Escape (review round: it first called clearSelection directly, which dropped focus to <body>); the Sheet stays non-modal and outside presses still keep a multi-selection. tests/inspector-escape-dom.test.tsx adds the close-button, keyboard focus-return and outside-press cases (red before the button, and before the SheetClose, existed). The narrow-window layout (375 × 812, 768 × 900) is closed as browser-only: the desktop window's minWidth is 1024 (src-tauri/tauri.conf.json), so the installed app never reaches those widths; no narrow-window panel policy was added
- evidence: npx tsc --noEmit, npm run lint, npx vitest run --testTimeout=180000 and node scripts/check-release.mjs origin/main green on fix/inspector-close-button

## 2026-10-05 ux-color-labels
- finding: [a11y/high] src/components/ColorField.tsx:164 — Fill and stroke hex fields have no accessible names
- status: done
- attempts: 1/3
- observed-at: 1b0024900e92d56e90b3f212865e15ecb99fd260
- evidence: Chrome browser reproduction and DOM/accessibility measurements; full steps and source trace in docs/audits/2026-10-05-ux-color-labels.md
- delta: investigation complete; runtime unchanged, fix remains open
- release: non-binary-impacting documentation and agent memory only; no release queued
- evidence: git diff --cached --check and node scripts/check-release.mjs origin/main passed on audit/ux-color-labels documentation diff based on 1b00249; no application suite run
- re-check 2026-10-11 @ 0bb506c: still open. ColorField's hex Input (ColorField.tsx:160) has an id but no aria-label, and LayerInspectorSections.tsx:351/386 label the groups with an h2 Heading, not a <label htmlFor>
- re-check 2026-10-26 @ eac33714bbfbc7df704fb4959d32ab7a0793cb1b: confirmed in real Chrome inspector; unnamed fill/stroke textboxes and two generic Pick color buttons remain. AUD-05 in docs/audits/2026-10-26-audit-results.md; retained accessibility observation under 2026-10-26-evidence/ui/. Existing finding remains open, not duplicated.
- follow-up 2026-10-27 @ eac33714 + uncommitted audit fixes: #546 corrected in the existing finding, not duplicated. Required ColorField context names Fill color / Stroke color and contextual picker/no-ink actions; inspector and direct component test callers migrated. Real Chrome ABV inspector exposes both distinct input and picker names; actual screen-reader speech remains unverified. Full suite 1668/1668, tsc/lint/build/knip pass; binary-impacting, Unreleased note queued.

## 2026-10-05 ux-decimal-input
- finding: [UX/low] src/components/TextEditor.tsx:731 — ABV decimals conflict with native input validation and stepping
- status: done
- attempts: 0/3
- observed-at: 1b0024900e92d56e90b3f212865e15ecb99fd260
- evidence: Chrome browser reproduction and DOM/accessibility measurements; full steps and source trace in docs/audits/2026-10-05-ux-decimal-input.md
- delta: investigation complete; runtime unchanged, fix remains open
- release: non-binary-impacting documentation and agent memory only; no release queued
- evidence: git diff --cached --check and node scripts/check-release.mjs origin/main passed on audit/ux-decimal-input documentation diff based on 1b00249; no application suite run
- re-check 2026-10-11 @ 0bb506c: still open. TextEditor.tsx:731 still renders type="number" with no step; #509 tightened validateField to plain decimals but the native step grid is unchanged
- fix 2026-10-13 on fix/ux-canvas-field-validation: PlainLineField's number box sets step="any" (UX audit #17); tests/text-editor-dom.test.ts asserts it

## 2026-10-08 issue-419-webstorage
- finding: [maint/med] #419 — Node 26 reportedly needs NODE_OPTIONS=--no-experimental-webstorage for `npm test` (2026-09-27 issue-queue-339 evidence)
- status: done
- attempts: 1/3
- delta: no flag added. Vitest 5 (#362) adds `localStorage`/`sessionStorage` to populateGlobal's override keys (Vitest 2 skipped keys Node already defined), so happy-dom's Storage replaces Node's native global, so the 2026-09-27 note is stale; tests/webstorage-dom.test.ts now fails if the native global ever wins again
- evidence: on fix/419 based on 361a4f9, full suite 114 files / 1290 tests pass on Node 26.8.2 with NODE_OPTIONS unset; new test passes on Node 24.19.0 and 26.8.2; tsc and zero-warning lint pass
- release: non-binary-impacting (tests and agent memory only); no release queued

## 2026-10-08 issue-410-lazy-dialogs
- finding: [perf/med] #410 — Settings, the Save Master review and the ⌘K palette (with cmdk) shipped in the entry chunk
- status: done
- attempts: 1/3
- delta: the three surfaces load on first open (PR #468). Entry chunk 892.6 kB → 764.1 kB at first measure; eager JS total about -60 kB. Review fixes: while a dialog's chunk loads, a hidden dialog-content placeholder (LazyDialog.tsx) keeps dialogOpen() true so keys stay off the tab (#244); a blocked first ⌘K no longer fetches the palette; a failed load names the way out (reload), and one DialogLoadFailed replaces two copies
- evidence: on fix/410, npx tsc --noEmit and npm run lint (zero warnings) clean; 20 related vitest files / 105 tests pass (app-v3-dom hit a 5 s timeout once under parallel load, then 27/27 passed alone); new tests/commandmenu-loading-dom.test.tsx fails on the pre-fix CommandMenu
- release: binary-impacting; CHANGELOG [Unreleased] / Changed bullet present

## 2026-10-08 issue-438-strokecap-tools
- finding: [maint/low] #438 — dev-only strokecap.html sat in the repo root beside index.html
- status: done
- attempts: 1/3
- delta: page moved to tools/strokecap.html (PR #482); npm run strokecap opens /tools/strokecap.html; README Develop names it; tests/dev-pages.test.ts guards the script path and the page's module script. Review fixes: test resolves paths from __dirname, regex accepts --open with or without the leading slash
- evidence: on fix/438 based on b40a2c2, npx vitest run tests/dev-pages.test.ts passes (2 tests); npx tsc --noEmit and npm run lint (zero warnings) clean; node scripts/check-release.mjs origin/main passes
- release: non-binary-impacting in effect (dev page, tests, docs); package.json script change counts as a build input, so the CHANGELOG [Unreleased] / Changed bullet is present

## 2026-10-08 issue-437-ledger-archive
- finding: [KISS/low] #437 — .agents/ledger.md had grown to 595 lines, mostly entries closed more than a month ago, and the parity-harness-retired delta still pointed at "pnpm-lock hygiene work" that is finished
- status: done
- attempts: 1/3
- delta: 41 closed entries dated before 2026-09-08 moved verbatim to .agents/ledger-archive.md (canvas-preview-swap-phase3, release-build-performance and cli-generate kept: they still list deferred or open follow-ups); ledger 595 → 345 lines; archiving rule added under Standing rules. Correction to parity-harness-retired: pnpm-lock.yaml was deleted from the repo in 41c10f2 (#247) and is gitignored since 67bb1c7 (#449), so nothing still lists pdfjs-dist and no pnpm-lock work remains
- evidence: on fix/437 based on 860b4be, every line of the old ledger appears in ledger.md or ledger-archive.md (sorted comm diff empty); no tests or scripts read the ledger
- release: non-binary-impacting (agent memory only); no release queued

## 2026-10-08 issue-423-node-pin
- finding: [maint/med] #423 — ci.yml ran Node 24 while release.yml and release-metadata.yml ran lts/*, so a new LTS could build a release on a Node major CI never tested
- status: done
- attempts: 1/3
- delta: `.nvmrc` (24) is the one pin; every setup-node step uses `node-version-file: .nvmrc` (PR #474). tests/node-version-pin.test.ts fails if a workflow names its own node-version or `.nvmrc` falls below engines `>=24.2.0`. Left as-is: the two publish-update-feed jobs only run `node -p` to read package.json's version on the runner's Node; `.nvmrc` pins the major, not the patch
- evidence: on fix/423, npx vitest run tests/node-version-pin.test.ts (6 passed), npx tsc --noEmit and npm run lint (zero warnings) clean, node scripts/check-release.mjs origin/main passed
- release: non-binary-impacting (CI config, tests, docs and agent memory); no release queued

## 2026-10-09 issue-433-module-split
- finding: [maint/low] #433 — six modules over 750 lines (production-readiness audit, 2026-10-08)
- status: in-progress
- attempts: 1/3
- delta: PR #490 splits three of them with no behavior change: model/edit.ts 1247 → 43 (editRecords, editLayers, editGestures, editVariants, editLabel, editSave), LayerInspector.tsx 1045 → 160 (Controls, Sections, Template), PreviewCompare.tsx 977 → 744 (previewOverlay.ts, InPlaceRichField.tsx). edit.ts's runtime export list is unchanged. tests/module-size.test.ts holds each split module and its parts at or under 750 lines. Still open: src/three/canScene.ts (848), src/psd/build.ts (811), src/components/TextEditor.tsx (780)
- evidence: on fix/433, npx tsc --noEmit and npm run lint clean, npm run build OK, related vitest files green (see PR #490)
- re-check 2026-10-11 @ 0bb506c: still in-progress. PR #490 merged as 94cb40b. Remaining three still over 750: src/three/canScene.ts 848, src/psd/build.ts 802 (811 → 802 after b37a27d #501), src/components/TextEditor.tsx 780
- release: binary-impacting (app source moved, no visible change); CHANGELOG [Unreleased] / Changed bullet present

## 2026-10-11 updater-download-timeout
- finding: [correctness/med] src/components/DesktopUpdater.tsx — update downloads had a 120 s whole-transfer timeout, so links slower than ~0.8 Mbps never finished
- status: done
- delta: one DOWNLOAD_TIMEOUT_MS = 15 min for download and downloadAndInstall; check() keeps 15 s; both updater DOM suites assert 900_000
- evidence: merged as 5c671b5 (#499)

## 2026-10-11 errmsg-everywhere
- finding: [consistency/low] AppMenu, DesktopUpdater, CanView, PreviewCompare, CharacterHeight, LazyDialog, TabsShell, MasterPicker, psd/worker — String(err) put a stray "Error:" prefix on user-visible messages
- status: done
- delta: every site outside App routes through errMsg; tests/errmsg.test.ts added
- evidence: merged as 53a3050 (#498)

## 2026-10-11 history-keyed-fold
- finding: [correctness/med] src/history.ts — an unkeyed edit within 500 ms of a keyed field session folded into that field's undo step
- status: done
- delta: an unkeyed edit after a keyed session opens its own step; plain scrub coalescing unchanged; tests/history.test.ts mounts useHistory
- evidence: merged as 1065c10 (#500)

## 2026-10-11 inactive-row-ink
- finding: [a11y/med] #440 src/components/LayerList.tsx — opacity-50 on inactive rows stacked onto the variant badge (2.15:1 light, 2.90:1 dark)
- status: done
- delta: inactive rows use text-muted-foreground (5.70:1 / 7.09:1 on the sidebar, 4.66:1 / 6.83:1 on the accent); hover/active accent ink overridden while inactive
- evidence: merged as ada3af5 (#497)

## 2026-10-11 export-error-scope
- finding: [correctness/med] #473 src/useExport.ts — a successful export cleared the shared buildError slot, wiping unrelated asset, master and menu errors
- status: done
- delta: success clears only the export's own last message (lastExportError ref); tests/use-export-dom.test.tsx is the hook's first coverage
- evidence: merged as 9af2082 (#504)

## 2026-10-11 desktop-quit-open-paths
- finding: [correctness/med] src-tauri/src/terminate.rs, main.rs — a hung webview cancelled every Dock quit forever; relative or dotted argv paths opened duplicate tabs
- status: done
- delta: a second terminate within 5 s quits (pure terminate_reply, unit-tested); opened paths canonicalised with dunce; non-macOS quit comment and workspace docs corrected (Windows logout skips the unsaved prompt)
- evidence: merged as dcf911f (#502)

## 2026-10-11 renderer-shared-plate-rules
- finding: [DRY/low] src/pdf/build.ts, canvas/draw.ts, psd/build.ts — pageDrawsOn, barcode digit start x and plate ink choice spelled per renderer
- status: done
- delta: pageDrawsOn exported once from planLayers.ts; digitStartX in plan.ts; local ink() helpers; L.WHITE_HEX replaces hardcoded #FFFFFF; PSD item loop exhaustive; no output change (goldens untouched)
- evidence: merged as b37a27d (#501)

## 2026-10-11 ci-hardening
- finding: [evidence/med] .github/workflows — no vite build or cargo fmt in CI; the macOS-only rust job never compiled the non-macOS cfg code; docs-site unbuilt in CI
- status: done
- delta: npm cache, npm run build, cargo fmt --check, rust-cross job (ubuntu + windows cargo check), docs.yml, persist-credentials false on release legs; cargo fmt applied; rust-version 1.77.2 → 1.90; tests/setup.ts sets IS_REACT_ACT_ENVIRONMENT once (54 copies removed)
- evidence: merged as 99e8964 (#503)

## 2026-10-11 export-pair-one-dialog
- finding: [UX/med] src/useExport.ts — Export PDFs/PSDs opened two native save dialogs on desktop
- status: done
- delta: the mask is written beside the chosen art file as <stem>-mask.<ext>; an existing file there falls back to its own dialog (nativePathExists); capability globs add *-mask.pdf/psd write and exists. Closes the last part of native-desktop-files
- evidence: merged as 802d645 (#505)

## 2026-10-11 app-ux-commands
- finding: [UX/med] src/App.tsx — no zoom or layer commands, blocked-export reason not actionable, libraryEntries() scanned localStorage on every render
- status: done
- delta: View → Zoom In/Out/Fit (⌘= ⌘- ⌘0) on every menu surface; palette Add/Remove Layer and a gated Delete key; blocked note is a button that selects the invalid layer (red dot in Layers, polite status); PDF exports read "(rendering…)"; a no-bench master switch commits directly; library read memoised on a refresh tick; raster images hide the Metallic toggle
- evidence: merged as c66934b (#507)

## 2026-10-11 zoom-command-leftovers
- finding: [UX/low] src/App.tsx:529 — 3D zoom steps from the rounded camZoomPct, so rapid presses can drift about 1%; Zoom In/Out menu items stay enabled at the clamp limits
- status: open
- attempts: 0/3
- observed-at: 0bb506c
- evidence: review leftover from #507 (c66934b)

## 2026-10-11 open-recent
- finding: [UX/med] desktop had no File → Open Recent for .label files
- status: done
- delta: src/recent.ts keeps the last ten paths in localStorage; TabsShell records on open and Save As; native submenu with Clear Menu; a missing file shows the open error and drops off; fs:allow-exists added on the .label/.master globs
- evidence: merged as 45c726e (#506)

## 2026-10-11 open-recent-menu-symbols
- finding: [UX/low] src/components/AppMenu.tsx:495 — set_menu_symbols is not re-applied after the Open Recent submenu rebuilds, so rebuilt rows can lose their SF Symbols
- status: open
- attempts: 0/3
- observed-at: 0bb506c
- evidence: review leftover from #506 (45c726e)

## 2026-10-11 print-preflight
- finding: [print/med] src/pdf/build.ts, src/textheight.ts, scripts/generate-lib.ts — PDFs declared no TrimBox/BleedBox, unprintable characters surfaced only at export, and the CLI had no dry run
- status: done
- delta: TrimBox (die inset by bleed) and BleedBox on both plates, Producer "Label Lab <version>"; inspector warns on missing glyphs; `generate --check` runs pass 1 for every job and writes nothing. 600-DPI golden diffs 0 px on all four plates; PSDs byte-identical
- evidence: merged as 3701179 (#508)

## 2026-10-11 print-preflight-leftovers
- finding: [correctness/low] src/textheight.ts, scripts/generate-lib.ts:122-147 — U+FFFF is the one codepoint where fontkit and pdf-lib disagree on a missing glyph; `generate --check` reads a lone positional after the master path as the values file
- status: open
- attempts: 0/3
- observed-at: 0bb506c
- evidence: review leftovers from #508 (3701179)

## 2026-10-11 label-file-validation
- finding: [fail-fast/high] src/model/layers.ts, files.ts, fields.ts — colours, numbers and UPCs in .label/.master files were only shape-checked (#fff printed blue in the PDF, gold printed black, 1e1 passed as a number, spaced UPCs encoded garbage)
- status: done
- delta: fill/stroke must be 3- or 6-digit hex or none (3-digit widened on read), plates white|metallic, numbers plain decimals, UPC spaces/hyphens stripped and the check-digit message names the expected digit; bad dormant values dropped instead of refusing the label
- evidence: merged as 6f3f799 (#509)

## 2026-10-11 number-message-clarity
- finding: [UX/low] src/model/fields.ts:27 — "Expected a number." does not explain why inputs like `1e1` or `0x10` are refused
- status: open
- attempts: 0/3
- observed-at: 0bb506c
- evidence: review leftover from #509 (6f3f799)

## 2026-10-11 issue-511-asset-assembly-clears-errors
- finding: [correctness/med] #511 src/App.tsx:1056 — the asset assembly effect calls setBuildError("") on success, clearing unrelated header errors (export failure, refused master); the same shared-slot bug #504 fixed for exports
- status: open
- attempts: 0/3
- observed-at: 0bb506c

## 2026-10-11 release-0.1.106
- finding: [release] cut 0.1.106 from [Unreleased] after the 2026-10-11 merges
- status: done
- delta: version set in package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json; check-release against origin/main and label-lab-v0.1.105 passed
- evidence: merged as 0bb506c (#510)

## 2026-10-13 ux-menu-naming
- finding: [UX/med] UX audit items 6, 7, 8, 19, 20, 21 — Project vs Label and Save Master vs Save to Master… naming; ⌘K palette and View menu name commands differently; layer commands in no menu; Appearance only in Settings; Layers sidebar toggle in no menu or palette; New tab tooltip shows ⌘N on every platform
- status: in-review
- delta: Open/Save/Save As Label…, LABEL_DESC "Label"; Save Master… (live: reads Save Variant… on a variant, shared with the picker button); palette grouped from APP_MENUS with leading checks and old wording as keywords; Layer menu; View → Layers (controlled SidebarProvider, ⌘B display-only, no native accelerator); View → Appearance submenu backed by a shared useTheme store; platform-correct New tab title
- observed-at: 892a272
- evidence: branch fix/ux-menu-naming; tsc, lint, knip clean; full vitest at load ~64 gave only 5s timeouts, those files rerun with --testTimeout=120000

## 2026-10-22 sidebar-ux
- finding: [UX/high] src/components/LayerList.tsx, MasterPicker.tsx — sidebar audit: selected row ~1.05:1 on the sidebar (same as hover); power lit while OFF; 16px row switches; struck variant badge; permanent Save/Rename/Delete under the picker; Changed chip and multi-select hint each on their own line; canvas selection never scrolled the row into view; Rename/Remove only behind a hover "…"; grab cursor over names
- status: in-review
- delta: plan docs/plans/sidebar-ux.md; selected = sidebar-primary/15 (no edge bar, no name focus ring); PowerOff/Lock shown as exceptions, Power/LockOpen on hover; size-6 controls; no strikethrough; Rename/Delete Variant as picker sentinels, Save only while masterDirty; Changed in the group label; hint folded into the row title; scrollIntoView nearest; follow-up: "…" menu replaced by Pencil/Trash2 buttons on the selected row only + Base UI ContextMenu (Rename/Remove at the pointer) on every row (Rename / Lock|Unlock / Remove); lock button only while locked (click unlocks), so hover shows power only; power ink = on (off PowerOff muted even on hover, on/selected Power full ink, selected-row opacity-40 branch removed); lock title says click to unlock and focus moves to power after unlocking
- evidence: branch feat/sidebar-ux; layerlist + masterpicker DOM tests 78/78 after review fixes (/code-review xhigh: 16 findings, 11 fixed), tsc and lint clean; full vitest 1655 pass, 3 fail only from the worktree lacking node_modules/.bin/tsx (generate-cli, golden-diff); browser-checked dark and light on localhost:5197

## 2026-10-26 risk-based-audit-plan
- finding: [user request] create an application audit plan from the recommended ten-area risk matrix
- status: done
- attempts: 1/3
- observed-at: d0d1ad513dc15b4a4065b3d41d5f0ba7c00abc11
- delta: docs/audits/2026-10-26-audit-plan.md defines 41 scenarios across work preservation, print output, UPC/QR, document handling, desktop integration, editing consistency, accessibility, CLI, performance and engineering health; includes execution waves, acceptance authorities, fixture/environment manifests, evidence requirements and explicit physical/native proof gaps
- evidence: planning document validated against the working tree based on d0d1ad5: 41 unique sequential scenario IDs across ten areas, 14 resolving local links, three shell blocks passing bash -n and every referenced npm run script present in its package.json. Audit commands and application tests were not executed; no application pass is claimed.
- evidence: release handoff check `node scripts/check-release.mjs origin/main` failed because this checkout is version 0.1.107 while origin/main is 0.1.108. No release metadata was changed for this documentation-only task; the version mismatch remains outside this plan's scope.
- release: non-binary-impacting (audit plan and agent memory only); no Unreleased entry, version bump or release operation

## 2026-10-26 application-audit-execution
- finding: [user request] execute the ten-area, 41-scenario risk-based application audit
- status: done
- attempts: 1/3
- observed-at: eac33714bbfbc7df704fb4959d32ab7a0793cb1b
- delta: docs/audits/2026-10-26-audit-results.md accounts for all 41 scenarios, seven confirmed findings (including the existing color-label finding), runtime/browser/CLI/print evidence, baseline failures and explicit native/Photoshop/physical proof gaps; no application fix applied
- evidence: real browser save/reopen, delayed-save snapshot and failed/cancelled Save As, recovery reload/restore/discard, text undo/redo, export/edit snapshot, image routing, accessibility/layout and 215-layer resource probes; actual CLI mode/error matrix, 600-DPI QR controls and CMYK conversion; macOS source-matched package build/process launch; 183 retained artifacts indexed with hashes
- evidence: Node 24.19.0, macOS arm64; tsc/lint/build/knip/npm runtime audit/docs checks pass; Rust fmt/check and 13 tests pass on 1.99.0 (CI pin 1.98.1 unverified); cargo audit exits 0 with six warnings; npm test fails 32/1658 (11 timeouts, 21 assertion/type failures), not rerun. Report validation checks all 41 scenario rows exactly once and 57 resolving local links.
- evidence: execution-revision release metadata gate passes for 0.1.108; earlier planning-revision 0.1.107 mismatch is historical, not the current result. External source transition during preparation recorded in report; no audit edits to application source.
- ruling: completed investigation with outstanding defects/proof gaps, not a clean application/production-print certification. Native AX trust false; Windows/Linux runtime, signed updater install, Photoshop rendered parity, physical print/scans, screen-reader speech and agreed performance budgets remain unverified.
- release: non-binary-impacting (audit documents/evidence and agent memory only); no Unreleased entry, version bump, release publication or public-feed change

## 2026-10-26 audit-dots-qr-payload
- finding: [correctness/high] src/qr.ts:48-58, src/planLayers.ts:391-393 — ordinary name-derived default dots QR does not decode from the actual 600-DPI PDF in any rotation; square styling with the same payload/geometry decodes in all four rotations
- status: parked(authority)
- attempts: 1/3
- observed-at: eac33714bbfbc7df704fb4959d32ab7a0793cb1b
- evidence: AUD-01; payload https://lolev.beer/beer/audit-labradorite; retained source PDF, dots/square crops, crop coordinates and ZXing decoder observations in docs/audits/2026-10-26-evidence/print/
- acceptance: intended payload decodes from supported styled exports and representative physical stock; preserve the existing printed-Lupula approval gate before changing the approved artwork
- follow-up 2026-10-27 @ eac33714: independent retained-crop ZXing smoke reconfirms dots 0/4 vs square 4/4 exact payloads. No QR artwork changed. Styling/keyline topology is implicated by the matched control, not a payload encoding defect.
- ruling: printed-Lupula iOS Camera and stock Android approval/proof is absent; obtain that gate before altering approved geometry, polarity, backing, quiet zone or default style. Physical scans remain unverified.

## 2026-10-26 audit-cmyk-qr-decode
- finding: [correctness/high] tools/to-cmyk.sh:10-15 — documented Ghostscript conversion exits 0 but loses the previously available short-reference QR decode at all four rotations
- status: done
- attempts: 1/3
- observed-at: eac33714bbfbc7df704fb4959d32ab7a0793cb1b
- evidence: AUD-02; RGB Labradorite reference decodes at rotation 270 degrees, converted copy nowhere; UPC survives. Original/converted PDFs and 600-DPI crops retained in docs/audits/2026-10-26-evidence/print/. No physical scan certificate claimed.
- acceptance: documented printer conversion preserves exact code payloads on matched digital/physical proofs; investigate styling/color and conversion together rather than assuming one flag is the cause
- correction 2026-10-27: #543 decode-loss claim disproved. Retained CMYK Page rot 90 vs RGB 0; original crop sampled text. Correct transformed crop x=156,y=156 at 600 DPI decodes the exact Labradorite URL in one rotation. tools/to-cmyk.sh now passes -dAutoRotatePages=/None; fresh conversion retains 585.12×369.12pt, rotation 0, and original-position crop x=156,y=2262 decodes at 270°. No QR design change; digital fragility remains #542. Historical artifacts untouched; audit report carries explicit erratum.

## 2026-10-26 audit-blank-disabled-barcode
- finding: [correctness/high] src/model/resolveLayers.ts:61-76,153-162,174-181 — stored empty barcode fails applyValue before the later blank/disabled guard, blocking CLI and live editor export even after the layer is disabled
- status: done
- attempts: 1/3
- observed-at: eac33714bbfbc7df704fb4959d32ab7a0793cb1b
- evidence: AUD-03; values JSON barcode empty exits 1; actual browser blank Code reports export blocked, Enabled checked=false retains that error. Retained CLI and browser observations under docs/audits/2026-10-26-evidence/. This is a shared resolver defect, not CLI coercion alone.
- acceptance: blank/disabled stored barcode values follow the documented non-blocking rule while enabled invalid literals and expanded references still block export
- follow-up 2026-10-27 @ eac33714 + uncommitted audit fixes: applyValue validates only enabled, nonblank literal barcodes; shape validation and enabled invalid-code fallback remain. CLI blank fixture --check failed exit 1 before, passes after and generates both PDFs; disabled garbage override also passes. Chrome blank/off has no export block; enabled 12345 blocks, disabling clears the error. Deterministic tests cover whitespace, disabled values, variant/override enablement and invalid expanded refs. Full suite 1668/1668, tsc/lint/build/knip/release gate pass; binary-impacting Unreleased note, no version bump.

## 2026-10-26 audit-layer-focus-invisible
- finding: [a11y/high] src/components/LayerList.tsx:231-235 — unselected layer-name button has no visible keyboard focus indication
- status: done
- attempts: 1/3
- observed-at: eac33714bbfbc7df704fb4959d32ab7a0793cb1b
- evidence: AUD-04; actual Style button focus-visible=true, aria-pressed=false, outline none, 0px ring/shadows and transparent row; screenshot and computed measurements retained. Enter and keyboard reorder work; activation failure is not alleged.
- acceptance: keyboard focus is identifiable before activation on selected/unselected names in both themes; resolve conflict with prior sidebar no-name-focus-ring design without silently changing it in this investigation
- follow-up 2026-10-27 @ eac33714 + uncommitted audit fixes: inherited keyboard-only sidebar ring restored; selected-row tint unchanged. docs/plans/sidebar-ux.md explicitly supersedes the earlier no-name-ring decision because focus and selection serve different purposes. Real Tab/Shift+Tab and Enter show unselected/selected focus; light ring rgb(37,99,235), dark rgb(96,165,250), 2px shadow. Both themes visually inspected. Removed obsolete class-only styling test rather than re-pinning it.

## 2026-10-26 audit-file-target-semantics
- finding: [a11y/med] src/components/FileDrop.tsx:74-83,95-99,121 — click-to-browse drop well is a focusable presentation/generic node; nested file input is only named file upload, without slot context
- status: done
- attempts: 1/3
- observed-at: eac33714bbfbc7df704fb4959d32ab7a0793cb1b
- evidence: AUD-06; mounted Metallic mask root DOM and Chrome accessibility tree retained at docs/audits/2026-10-26-evidence/ui/file-target-aria.txt. Keyboard handlers exist; missing semantics/context is the finding.
- acceptance: empty/loaded texture, mask and custom-image selection actions expose meaningful contextual names and roles without nested interactive-control conflicts
- follow-up 2026-10-27 @ eac33714 + uncommitted audit fixes: passive drop target plus sibling Browse/Remove buttons, contextual file input name, retained drop routing. Chrome empty/loaded Texture, Metallic mask and custom Image expose Browse <slot>; Remove mask/texture focuses Undo and Undo returns to Browse; custom image removal returns to Browse with document-undo hint. DOM regressions cover slot names, sibling controls, drop routing and removal focus. Native chooser and screen-reader speech remain unverified.

## 2026-10-26 audit-default-suite-red
- finding: [evidence/high] package.json:16, tests/save-races-dom.test.tsx and seven other suites — default npm test exits 1, leaving no green full-suite evidence for the audited environment
- status: done
- attempts: 1/3
- observed-at: eac33714bbfbc7df704fb4959d32ab7a0793cb1b
- evidence: AUD-07; 150/158 files and 1626/1658 tests pass; 32 fail (11 timeouts, 21 assertion/type diagnostics). Full compressed log and classification retained in docs/audits/2026-10-26-evidence/baseline/. Functional audit work was concurrent; resource contention/cascading failures are hypotheses, not established causes.
- acceptance: diagnose the earliest failed transition/timeout under controlled resources and provide explicitly new evidence for any correction; do not infer 32 independent product defects or suppress checks to manufacture a pass
- follow-up 2026-10-27 @ eac33714 + uncommitted audit fixes: retained diagnostics inspected before experiment. Earliest completed failed suite included generate's 5.817s legacy export; save-races timeouts precede the missing-DOM cascade. Audited Vitest default concurrent ceiling was 9 on 10 CPUs (158 workers spawned is cumulative, not simultaneous). maxWorkers:4 preserves isolation and 5s timeout. Controlled 1-worker four-suite experiment passes 140/140; final default npm test passes 158 files / 1668 tests in 26.71s without concurrent build/print/browser work. Original resource contention/cascade causality remains a supported hypothesis, not a proven independent product bug. Happy-dom teardown AbortError diagnostics remain visible, not suppressed.
- correction 2026-10-27 @ eac33714 + branch fix/audit-2026-10-26: maxWorkers:4 dropped. With the default ceiling (--maxWorkers=9) at load average ~10 the full suite passes 158 files / 1668 tests in 19.3s (vs 32.1s capped), so the cap is not needed for green and the audit's red run is attributed to its own concurrent build/print/browser work. No config change ships for #548.
- integration evidence: an intermediate new-code run exposed missing ColorField labels in direct test callers and a config-test closing-delimiter error introduced during agent cleanup; both corrected before final green run. Final targeted six suites 156/156, tsc, lint, production build, knip and release metadata gate pass. Docs typecheck passes; docs build compiled/generated 48 pages but exited 1 on Next.js SecurityFatalError upgrade gate. No dependency upgrade or gate bypass attempted.

## 2026-10-27 native-macos-pass
- finding: [user request] run the audit's blocked native macOS scenarios (A4, A5, D3, D4, E1, E2, E3) now that AX trust is granted
- status: done
- attempts: 1/3
- observed-at: d320002f (branch fix/audit-2026-10-26), macOS 27.0.1 arm64, 0.1.108 built with identifier com.labellab.audit / productName "Label Lab Audit" so its IndexedDB, master index and cache never touch the installed app
- evidence: E1 pass — Apple-event open of a .label gives one tab; reopening via dotted and relative paths focuses it, no duplicate. E2 pass — Cmd+S rewrites the bound file without a dialog; paired Export PDFs asks once and writes art + -mask beside it; re-export: macOS Replace for the art, existing mask is not overwritten, a second dialog opens on dirty-edit-mask, Cancel leaves the mask untouched and the status note names what was saved and what was cancelled. A4 pass — Cmd+W, Cmd+Q, the window close button and an AppleScript quit (Dock's terminate:) each show Save/Discard/Cancel; Cancel keeps tab and app. A5 pass — kill -9 after >2 s dirty, relaunch offers "Recover unsaved work?"; Restore returns the dirty tab and Cmd+S writes back to the unchanged original without a dialog. D3 pass — "./x.master" hint beside the label resolves; master moved away opens from the library cache; unknown id shows the different-master dialog (Use / Locate / Cancel). D4 — a .label symlink to a valid label stored outside (.bin) never opened (cold or warm) while a regular copy opened; no read observed, but LaunchServices may resolve the link before the app sees it, so plugin-fs scope enforcement itself is still unproven. #546 names (Fill color / Stroke color) confirmed in the native build.
- observations (low): Settings… sits in Edit with no Cmd+, (macOS puts it in the app menu); quit reuses the "Close “<tab>”?" title; cancelling the different-master dialog leaves an empty Untitled tab (by design per TabsShell pending comment); a symlinked .label that doesn't resolve to a .label does nothing with no message.
- blocked: the macOS 27 out-of-process save panel ignores synthetic clicks and drops AX references after Go to Folder, so Save As to a typed destination was not driven (Return/Escape do reach it). Windows/Linux, signed updater, Photoshop, print and screen-reader proof unchanged.
- release: non-binary-impacting (ledger only)

## 2026-10-27 signing-397
- finding: [security/medium] #397 — release builds are ad-hoc signed on macOS and unsigned on Windows
- status: done (PR open, unmerged; inert until credentials exist)
- attempts: 1/3
- observed-at: branch fix/397-signing on 9c9866f8
- delta: release.yml exports the six APPLE_* secrets to GITHUB_ENV only when APPLE_CERTIFICATE is set (all-or-none, fail-fast); tauri then signs with the Developer ID and notarizes. Windows: AZURE_TRUSTED_SIGNING_ENDPOINT/_ACCOUNT/_PROFILE repo vars make configure-updater.mjs add bundle.windows.signCommand (artifact-signing-cli 0.12.0, the renamed successor of the deprecated trusted-signing-cli, version-pinned because it runs beside the updater key; installed only when configured), AZURE_CLIENT_ID/SECRET/TENANT_ID secrets reach tauri-action.
- evidence: tests/configure-updater.test.ts (unset, all-set, half-set); Apple gate script run locally under /bin/bash 3.2 for none/partial/full; npm test 159 files / 1671 tests, tsc, lint, knip, check-release pass. Not verified: a real signed/notarized build (no credentials), YAML not linted (actionlint unavailable). Provider choice (Trusted Signing vs an OV/EV cert) is the user's.
- release: binary-impacting per check-release (packaged config input); [Unreleased] bullet queued
