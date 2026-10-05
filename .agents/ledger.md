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
- Parked requires a written ruling: which gap, what evidence, what would unpark it.
- One failed run never establishes "worker limitation" — retry before concluding
  anything about capability.

---

## 2026-08-05 lazy-react-renderers
- finding: [KISS/med] src/App.tsx:14 — the initial React bundle eagerly included PDF, fontkit, and PSD renderers while live preview PDF builds still ran on the UI thread
- status: done
- attempts: 1/3
- delta: entry JS 2,613.79 kB / 963.59 kB gzip → 1,128.57 kB / 353.86 kB gzip; preview builds moved to a lazy worker; full PDF and PSD renderers load on export

## 2026-08-05 single-pass-react-mask
- finding: [DRY/low] src/App.tsx:259 — mask upload classified every full-resolution pixel once for validation and again for recoloring
- status: done
- attempts: 1/3
- delta: mask classification passes 2 → 1 and 14.4M-pixel synthetic pass 64 ms → 46 ms; decoded ImageBitmap now closes before ImageData processing; tests 127 → 128 and green

## 2026-08-05 worker-byte-cache
- finding: [KISS/med] src/pdf/client.ts:54 — every debounced preview build structured-cloned the texture/mask preview PNGs (and raster collab logos) into the worker, though they only change on upload
- status: done
- attempts: 1/3
- delta: byte payloads now travel once per upload (ByteRef id protocol, worker-side cache with per-request eviction); per-build message drops from megabytes to the config alone

## 2026-08-05 memo-logo-qr
- finding: [DRY/low] src/pdf/build.ts:463,502 — parseLogo re-ran the svgpath pipeline and qrShapes re-encoded the QR matrix twice per preview build with identical inputs
- status: done
- attempts: 1/3
- delta: parseLogo memoized by (svg, width, maxH); qrShapes last-call memoized by payload; both now run once per distinct input instead of 2×/build

## 2026-08-05 font-subset-benchmark
- finding: [KISS/low] src/pdf/build.ts:551 — hypothesis that subset:true embedding was avoidable preview cost
- status: done
- attempts: 1/3
- delta: none — benchmark shows subset:true is ~3× faster than subset:false (≈8–10 ms vs ≈25 ms per doc save) and 25× smaller; current code already optimal, no change made

## 2026-08-11 tauri-native-save-dialog
- finding: [Fail fast/high] src/App.tsx:1081 — Tauri lacks the browser File System Access API, so Save As silently fell through to a browser download instead of opening a native save dialog
- status: done
- attempts: 1/3
- delta: Tauri Save As dialog calls 0 → native dialog plus scoped file write and remembered Save path; 193 root tests, TypeScript/Vite build, Cargo check, and 0.1.3 release gate pass

## 2026-08-11 label-file-associations
- finding: [user request] src-tauri/tauri.conf.json — no fileAssociations, so Finder could not open .label files in the app; macOS delivers opens as Apple events the shell also ignored
- status: done
- attempts: 1/3
- delta: bundle.fileAssociations registers .label; Rust stores the Opened-event path behind take_opened_file and emits project-file-opened; App.tsx opens it through the existing quiet-retry path and adopts it for Save; fs read scope added. 194 root tests, tsc, cargo check, 0.1.4 release gate pass

## 2026-08-11 collab-off-stack-nudge
- finding: [user request] src/pdf/build.ts:464 — the laurel kept its collab stack nudge after the collab switch was turned off
- status: done
- attempts: 1/3
- delta: logoNudge(cfg) in elements.ts gates the nudge on collabEnabled for draw + hit-test; value stays saved in config; inspector hints "applies while collab is on"; new hittest test covers both states

## 2026-08-18 tauri-native-clipboard-editing
- finding: [user request] src/components/AppMenu.tsx:60 — replacing Tauri's default application menu omitted the native Cut, Copy, Paste, and Select All roles, so macOS did not route their shortcuts to focused fields
- status: done
- attempts: 1/3
- delta: native text-edit roles 0 → 4; 195 scoped root tests, TypeScript/Vite build, Cargo check, diff check, and 0.1.5 release gate pass

## 2026-08-18 simplify-pass
- finding: [user request] /simplify over label-file-associations — AppMenu duplicated the PredefinedMenuItem branch and exported NATIVE_TEXT_EDIT_ITEMS only for a tautological test; App.tsx's LabelSource union pushed the Finder special case into the shared open pipeline
- status: done
- attempts: 1/3
- delta: nativeEntry predefined/separator branches merged; edit roles inlined and APP_MENUS exported so the test pins the real wiring; all open entry points hand { name, bytes } via module-scope fileSource, with getFile moved inside openWithRetry's try so transient read failures still retry; logoNudge hoisted to one logoCy in boxesOf; 195 root tests, tsc pass

## 2026-08-24 zoom-aware-preview-raster
- finding: [user request] src/components/PreviewCompare.tsx:97 — the 2D preview always rasterized at 180 DPI and CSS zoom stretched that fixed bitmap, smearing punctuation and fine text-stroke pockets
- status: done
- attempts: 1/3
- delta: fixed 180-DPI backing bitmap → debounced zoom/DPR-aware raster (450 DPI at 250% on 1x displays, capped at 600 DPI / 4876px long edge); art and mask scratch paints are serialized; the 5.8% period changed from a gray-gold smudge in the enlarged baseline crop to a distinct gold dot; 198 tests, tsc, Vite build, Cargo check, and 0.1.8 release gate pass

## 2026-08-24 pdfjs-text-stroke-cavities
- finding: [user request] src/pdf/build.ts:129 — pdf.js's worker-safe path-font renderer left white cavities between the fill and wide text strokes around tiny glyphs even at the 600-DPI preview cap
- status: done
- attempts: 1/3
- delta: true PDF stroke alone → true stroke plus a bounded interior bridge derived from each element's live width; the three 15px-stroked periods render as solid gold dots on black in the exact 180/600-DPI pdf.js pipeline, the 600-DPI Poppler render changed 0 pixels, normal builds remain ~30ms, and 199 tests, tsc, Vite build, Cargo check, and the 0.1.9 release gate pass

## 2026-08-25 canvas-backend-phase2
- finding: [user request] canvas preview renderer Phase 2 — full display list, canvas backend, parity harness, dev toggle
- status: done
- attempts: 1/3
- delta: plan.ts text-only -> full Placed union (paths/image/barcode); pdf/build.ts one plan walk (LEFT seam, drawCollab, strokeOf, dead imports deleted); new src/canvas/draw.ts + tests; parity page (npm run parity, observed 2.04-2.48% diff, threshold 5%); dev toggle localStorage.canvasPreview (DEV only); exports pixel-identical (0 diff px at 200/400dpi); 242 -> 258 tests green; v0.1.18. Carried to Phase 3: silent drawImage skip on missing canvas asset (draw.ts), close-race on ImageBitmap swap (App.tsx dev effect), pin barcode/paths stroke-before-fill in fake-ctx tests, route canvas render errors to buildError, textBaseline/textAlign ownership in drawPlate, box.x! in collabItems.

## 2026-08-25 canvas-preview-swap-phase3
- finding: [user request] canvas preview renderer Phase 3 — the swap, plus 3D-from-canvas pulled forward from Phase 4 (user decision)
- status: done
- attempts: 1/3
- delta: 2D preview renders per keystroke from planLabel+drawPlate (no worker, no debounce; asset assembly split off with asset-only deps); in-place editing = planLabel skip flag, v0.1.16 hide-and-rebuild plumbing deleted; 3D views texture via new drawPlates/sync buildLabelTextures (pdf.js retained only for the dev parity page); DELETED pdf/client.ts, pdf/worker.ts, tests/preview-client.test.ts, App's pdfs/needMask/inputs/built/buildChain machinery, TabsShell dispose; all six Phase-2 carried items landed; final review restored the dropped PREVIEW_RASTER_MAX_EDGE cap (backing store measured 5040px at bleed 0.2, now clamps at 4876). Verified in real Chrome (per-keystroke paint, same-frame edit skip, mask plate, eyes, 3D can from canvas plates, zoom ratchet, bleed repaint, zero worker traffic), parity 2.04-2.48% (max 5%), npm run generate builds all four exports; 260 tests + tsc green; v0.1.19. Commits e552d35..7e262a1 + docs.
- learning: replacing a rendering pipeline must port the old call's guard OPTIONS, not just its happy path — scaleCap's maxEdge half was silently dropped and only the final whole-branch review caught it
- Carried to Phase 4: PSD-on-plan (priority), drag-to-move, dynamic fonts via src/fonts.ts; deferred minors — half-painted plate if drawPlate ever throws mid-walk (unreachable today; offscreen+blit if it matters), shared buildError channel cleared by any successful frame (split per-source state before Phase 4 adds writers), mask plate repaints at split 0 (gate on split>0 if keystroke latency regresses at max zoom), planFrom() helper to dedupe the two planLabel spellings, unit pin on drawPlates scale math (needs DOM stub), barcode-halo test's translate-index scoping invariant, CanView 3D texture failures warn-only (spec amended to record this).

## 2026-08-25 psd-on-plan-phase4a
- finding: [user request] canvas preview Phase 4a — PSD placement from shared display list
- status: done
- attempts: 1/3
- delta: placement duplicates in psd/build.ts 3 → 0; PSD bytes identical across default+fixture, both plates (PDFs pixel-identical at 200dpi); 260 tests green; v0.1.20

## 2026-08-25 drag-to-move-phase4b
- finding: [user request] canvas preview Phase 4b — drag-to-move for offsetY elements on the 2D preview
- status: done
- attempts: 1/3
- delta: dragTarget() helper + pointer wiring in PreviewCompare/App; logo gated on collabEnabled, collab slots on loaded art; vertical only, no schema change; one undo step per drag, Escape cancels; verified in real Chrome (6/6 checks); 263 tests green; v0.1.21

## 2026-08-25 font-infrastructure-phase4c
- finding: [user request] canvas preview Phase 4c — config-driven font pipeline infrastructure
- status: done
- attempts: 1/3
- delta: config-driven font pipeline (fontCatalog.ts + family-aware fonts.ts gate + cfg.fontFamily optional, absent = poppins); planFrom() deferred minor landed at both planLabel call sites; buildError split ruled unnecessary — no new writers; exports byte/pixel-identical (8/8), parity 4/4 PASS (2.04–2.48%), Chrome regression 4/4; 267 tests green; v0.1.22. Phase 5 backlog: font sourcing — Google Fonts (metadata scan via fonts.google.com/metadata/fonts, static-instanced TTFs via css2 wght requests, local byte cache, fonts embedded in the project file for print reproducibility) + external TTF import (fontkit-extracted PS names, three-face mapping, OS/2 fsType embedding check)

## 2026-08-26 inplace-description-editor
- finding: [user request] src/components/PreviewCompare.tsx:628 — double-clicking the description floated a panel duplicating the sidebar's WYSIWYG field over the artwork; user wants Google-style in-place editing with a compact floating toolbar
- status: done
- attempts: 1/3
- delta: DescriptionEditor's contenteditable machinery extracted into useDescriptionField (per-line paint injectable) + shared DescriptionToolbarButtons; the description now joins the in-place render-skip session (onEditSession) with the rich-lines field positioned over its block at label metrics (9pt/10.8pt leading in cqh, baseline-aligned via half-leading offset) and the Header/Bold/White-ink toggles floating above as a body-portaled pill; the floating panel path serves only the rotated column now; sidebar field unchanged. Verified in real Chrome: in-place alignment matches hit boxes, per-keystroke apply, Enter/Bold/White toggles, click-away commit, Escape cancel, one undo step per session, sidebar regression-free. 267 tests, tsc, Vite build, and the 0.1.23 release gate pass

## 2026-08-26 code-review-fix-wave
- finding: [user request] /code-review over the whole branch — 8 confirmed findings + 3 below-cap, fixed across two coordinated sessions (this one + art-files-47) in one shared worktree
- status: done
- attempts: 1/3
- delta: THIS SESSION — presets.json seed library restored from main (fresh installs got empty presets); TabsShell/App onOpenSettled clears queued open entries when the attempt settles (failed opens were permanently un-retryable, Save-As'd tabs hijacked their old path); PreviewCompare resize guard checks height (bleed change at the raster cap rendered distorted); error strip split into renderError (renderers own it, frames clear it) vs buildError (assembly/export/native, cleared on assembly/export success — frames no longer wipe unrelated failures); CanView texture-rebuild failures routed to the strip (was console.warn only); main.rs launch scan uses args_os (args() panics on non-Unicode argv); drawPlate/drawPlates fontCss now REQUIRED (poppins default bypassed the fonts.ts gate); ctx.letterSpacing feature-detected with per-glyph user-space fallback (pre-17.4 WKWebView ignored it); collabLeftFrame/collabCenterFrame in plan.ts are the one envelope spelling shared with hittest. PEER SESSION (art-files-47) — TabsShell apply() transition helper (OS-open drain race), collab lead-in preview/export divergence (opts.collab), rasterScale derived from PREVIEW_MAX_W with ratchet removed, main.rs is_label_path on the macOS Opened arm + case-class fs glob; peer merged origin/main (69119ad) and bumped v0.1.24. Combined tree: tsc clean, 268/268 tests, cargo check clean, Vite build clean

## 2026-08-26 description-editor-dom-tests
- finding: [user request, deferred from c7ba5f9] the WYSIWYG field's DOM half (seedDom/readLineEl/toggle in src/components/DescriptionEditor.tsx) had no automated coverage — it was verified only by driving a real browser, which is why two data-loss regressions shipped before being caught by hand
- status: done
- attempts: 1/3
- delta: happy-dom added as a devDependency (lighter than jsdom; its Selection/Range is all these need) and scoped with a per-file `// @vitest-environment happy-dom` docblock so the other 270 suites keep the faster node environment; new tests/description-editor-dom.test.ts (15 tests) pins the seedDom<->readLineEl inverse over plain / `_a_` / `**a**` / `**_a_**` / empty / header / multi-line input, both marker-erasure regressions (white base layer, bold line), and the toggle behaviours (collapsed caret unwraps its run, partial selection wraps then unwraps, a full-line selection falls through to the line flag). Toggles are driven through the real hook with React's own createRoot+act — no testing library, since every assertion is on the emitted markdown. seedDom/readLineEl exported for the suite only (no src/ importer). Mutation-checked: reverting each fix fails exactly its test (3 red). 285/285 tests, tsc clean, release gate passes at 0.1.25 (test + devDependency only, not binary-impacting)

## 2026-08-29 builtin-to-generic-layer-migration
- finding: [plan review, REDUCTION mode; over-engineering pass 2026-08-29] the master-variation refactor's endgame — delete built-in runtime branches (plan.ts / elements.ts / hittest.ts / pdf/build.ts / psd/build.ts / ElementId) once every element is a generic layer — is deferred out of v1 and OPPORTUNISTIC: an element migrates only when keeping its branch blocks a user-facing change; some branches may never migrate, and that is fine. v1 ships only user-visible capability (.master as ZIP with template assets, master-ordered draw order, guide wiring for position.ts, generic multiline/wrap/justify text, rotation 0|90 on barcode+text only, Collab-art PSD golden with real partner art)
- status: done
- attempts: 1/3
- notes: any migration goes per element behind its existing byte-identity golden; delete a built-in branch only after that element's parity holds; never one motion. No generic `flow` constraint in the schema — if description/warning/collab migrate, try resolver-computed offsets first and only revisit a constraint then. Draw-order guard: one golden with a custom layer behind a built-in, PDF only (backends share planLabel's ordering). Seam risk: four prior fix rounds (dc492aa, 91f02fb, a368d76, 48ca845) were all master/label ownership-seam bugs — every seam-touching task lands with a doc.ts-level test, not just render goldens. Full v1 scope: the 2026-08-29 amendment block in docs/superpowers/specs/2026-08-27-master-variation-design.md.

- delta: superseded by approved 2026-09-04 master-as-layers design; all runtime renderers and App use generic v3 layers, old placement oracle retained only under tests/legacy. Model/converter/UI/export checks pass; separate PSD visual acceptance remains recorded below.

## 2026-08-29 master-zip-container
- finding: [v1 step 2 of the 2026-08-29 spec amendment] .master was JSON-only and could not carry template art — texture and metallic mask rode in every .label instead, so "new label from master" required re-dropping the same files and cross-business masters were impossible
- status: done
- attempts: 1/3
- delta: masterfile.ts packs/unpacks a .master ZIP (master.json + texture/<name>, mask/<name>, custom/<id>/<name> — the same role dirs .label uses); unpackMaster sniffs '{' for legacy JSON (asset-less) and fails loudly on a corrupt archive or a ZIP without master.json. masters.ts resolveMasterById returns {master, assets} (ResolvedMaster); Save Master packs the loaded texture/mask + master-owned image layers' bytes (masterAssetBundle — variant/label image FIELD values stay label deltas); Open Master, the input fallback, and the library pick adopt master assets under the label-delta rule (adoptMasterAssets: loaded art wins, only empty slots fall back; custom bytes fill only missing ids); openProject falls back per-role to the resolved master's assets. MASTER_TYPES mime json→zip; download mime likewise. New tests/masterfile-zip.test.ts (6) + masters.test.ts updated to the pair shape. 668/668, tsc clean, cargo check clean; v0.1.40 (binary-impacting: save format + open behavior). DEFERRED from step 2, deliberately: legacy defaults.customLayers normalization + deleting resolve()'s reconciliation block — that block is working, golden-guarded seam code (the 4-fix-round zone); normalization gets its own task with doc.ts-level tests rather than riding a container change.

## 2026-08-29 psd-collab-art
- finding: [user request, v1 step 1 of the 2026-08-29 spec amendment] the exported PSD of a Collab label omitted the partner art entirely — PsdAssets had no collab slots and buildPsd's plan was handed none, which is also why the collab-variant-goldens PSD digests were identical ON and OFF (a vacuous guard, per that file's own comment)
- status: done
- attempts: 1/3
- delta: PsdAssets gains optional collabLeft/collabCenter (PsdCollabArt: svg string, or natural-size RGBA the builder resamples like customImages); buildPsd hands their PlanArt to planLabel and emits a "Collab" group (lead-in type layer + both logo layers) between Left column and Center, matching PDF draw order — svg slots as shape layers with the plan item's fill/stroke, raster slots as resampled pixel layers on the art plate and a MASK_BLUE footprint rect on the mask plate (the custom-raster rule); App.tsx's exportPsd feeds the slots through the same collabAssets() as the PDF export, so disabled-slot nulling and raster tinting apply identically. New tests/psd-collab.test.ts (4 tests) is the real regression guard: both slots land with names/bounds, mask footprints present, no assets → no group (byte identity still pinned by the untouched collab-variant-goldens hashes), left-alone brings the lead-in. Stale vacuity comment in collab-variant-goldens.test.ts updated. 662/662 tests, tsc clean, cargo check clean; v0.1.39 (binary-impacting: PSD export content)

## 2026-08-28 remove-fill-variant-checkboxes
- finding: [user request] src/components/FieldList.tsx:152 — Fill mode exposed a Collab checkbox the user did not want
- status: done
- attempts: 1/3
- delta: Fill-mode variant controls 1 → 0; FieldList now receives App's already-resolved fields instead of recomputing them from two model props; already-enabled variants still resolve their fields and artwork; 658 tests, tsc, Vite build, Cargo check, and the 0.1.38 release gate pass

## 2026-09-04 master-as-layers-session-resume
- finding: [user request] Claude session 0bff2b49-40ae-4dac-b567-b62a13afff54 stopped at its session limit during v3 App/backend integration
- status: in-progress
- attempts: 1/3
- delta: unfinished App/backend contracts integrated; unified Layers list, rich multiline editors, variant-targeted edits, binding validation, Settings, PDF/PSD/canvas shared placement, legacy CLI conversion and four-format generation completed; version 0.1.43 prepared
- evidence: 765/765 tests across 60 suites, production build (including TypeScript), Cargo check, diff check and 0.1.43 release metadata gate pass; CLI generated all four exports with and without art; App DOM test exercises selection, content edit and undo
- ruling: remaining visual acceptance requires live browser access and Photoshop-rendered old/new PSD rasters; CUA returned no browser available, and ag-psd does not render editable text/vector/effects composites. PDF 600-DPI diff review is complete in tests/goldens/README.md. No release published.
- notes: horizontal/above/baseline binding and variant draw order remain deferred per approved spec; relative below bindings and chains implemented

## 2026-09-04 status-bar-update-availability
- finding: [user request] DesktopUpdater discarded available releases on Later, leaving no persistent update entry in the editor view
- status: done
- attempts: 1/3
- delta: quiet launch checks now show an Update available/version button in the active editor's lower bar; clicking opens existing notes/install dialog, Later retains the release, tab changes move the indicator, unmount releases its resource
- evidence: updater parser/DOM and App DOM checks 4/4 pass; production build, Cargo check, diff check and 0.1.44 release metadata gate pass. Live browser verification unavailable in this session; no real update installed or published.

## 2026-09-04 inactive-variant-power-toggle
- finding: [user report] a dimmed Collab lead-in appeared off while its power button toggled the intrinsic enabled=true to false, breaking collabLeft's binding
- status: done
- attempts: 1/3
- delta: row power uses effective visibility; shared App patch path activates the owning variant when enabling its layer, recording both changes in one undo step; binding validation preserved
- evidence: App regression reproduced false effective power state before fix; 76 scoped tests pass after fix, production build, Cargo check, diff check and 0.1.45 release gate pass; no release published

## 2026-09-04 vertical-guide-anchors
- finding: [user request] layers could bind below neighbors or use absolute edges but could not remain anchored to top/bottom margin guides
- status: done
- attempts: 1/3
- delta: guideY top/bottom plus signed y offset feeds shared placement; inspector selects/detaches anchors, bottom text grows upward, drag retains anchor; margin changes now persist with master and reach preview/export planning
- evidence: 770/770 tests, production build, Cargo check, diff check and 0.1.46 release gate pass; regressions cover changing guides, text growth, shared-plan positions, file round-trip and inspector actions; no release published

## 2026-09-04 middle-guide-anchor
- finding: [user request] add middle alongside top/bottom guide anchors
- status: done
- attempts: 1/3
- delta: middle anchors a layer's vertical center between its top/bottom margin guides plus signed offset; inspector exposes the option and master parsing preserves it
- evidence: 66 scoped tests, production build, Cargo check, diff check and 0.1.47 release gate pass; tests cover growth, guide movement, round-trip and inspector selection; no release published

## 2026-09-05 horizontal-guide-bindings
- finding: [user request, interpreted in ongoing margin-guide context] bind to top, left, right or bottom
- status: done
- attempts: 1/3
- delta: left/right guideX bindings combine with guideY; horizontal drag adjusts offset, detach preserves position, in-place text uses its resolved box; existing middle anchor retained
- evidence: 113 scoped tests, production build, Cargo check, diff check and 0.1.48 release metadata gate pass; no release published

## 2026-09-05 four-side-layer-bindings
- finding: [user clarification] bind to another layer's top/left/right/bottom, following its growth; the preceding horizontal-guide interpretation did not satisfy this request
- status: done
- attempts: 1/3
- delta: shared measured placement supports four-side bindings and chains; inspector target/side/gap controls, signed drag gaps, axis-preserving side changes/unbind/removal; legacy below files remain compatible and reference/cycle validation stays enforced
- evidence: 792/792 tests pass, including four-side growth/chains, editing, deletion, hit testing and inspector actions; production build and Cargo check pass; binary-impacting 0.1.49 metadata prepared with matching CHANGELOG; no release published; live browser verification unavailable in this environment

## 2026-09-05 updater-current-status
- finding: [user request] lower status bar is blank when the installed release is current
- status: done
- delta: retain successful automatic/manual current results and show Up to date in the active lower status bar, including after dialog dismissal
- evidence: 4 updater tests pass; release metadata and diff checks pass for binary-impacting 0.1.50; matching CHANGELOG entry prepared

## 2026-09-05 sidebar-selection-controls
- finding: [user request] move selection hint below layers, remove master divider, and use shadcn Select
- status: done
- delta: hint follows list; master picker uses existing shadcn Select, Button and Input; Open Master and Duplicate remain below selector; rebind confirmation retained
- evidence: 15 layer-list and 4 master-picker DOM tests pass; TypeScript and 0.1.51 release metadata gate pass; changes local

## 2026-09-05 release-build-performance
- finding: [user request] optimize builds after Windows release 33962816055 took 6m 2s, including 3m 22s in Cargo despite a cache hit
- status: done
- delta: release Rust pinned to 1.98.1 (the compiler in that successful run); superseded PR test runs cancel while main/release jobs remain protected; release jobs emit and upload per-target Cargo timing HTML for 14 days
- experiment: macOS arm64, rustc 1.97.1, existing 0.1.51 source/dist; initial dependency warm-up excluded (274 seconds). Alternating two default release app rebuilds and two with --config profile.release.package.label-lab.opt-level=1, touching src-tauri/src/main.rs before each; cargo build --manifest-path src-tauri/Cargo.toml --release --timings. Default: 71.55/81.96 seconds, 11262192 bytes. Candidate: 103.35/99.34 seconds, 13784848 bytes. Candidate averages 32% slower and is 22% larger; rejected, no profile change retained. Local results are not a Windows speedup claim; no startup comparison needed after rejection.
- evidence: four measured release builds pass; Actionlint 1.7.12 validates both workflows (shellcheck unavailable); YAML parsing, diff check and 0.1.51 release gate pass. No workflow dispatched or release published. Existing sidebar edits preserved.
- deferred: shared frontend build adds artifact transfer/dependency overhead for a small wall-clock saving; revisit if new timings show frontend dominating

## 2026-09-05 draggable-layer-order
- finding: [user request] replace per-row up/down buttons with drag reordering
- status: done
- delta: pointer dragging on layer names, 5px threshold, insertion line, cancellation and click suppression; one undoable App edit per drop; Alt+Up/Down retained and bounded by layer ownership; variant-added layers remain in their owning variant
- evidence: 75 focused tests pass, including multi-row drop, cancelled/out-of-owner drops and keyboard controls; production build, diff check and 0.1.51 release gate pass; changes local, no live browser verification available

## 2026-09-05 editor-performance
- finding: [user request] execute all three identified editor optimizations and track before/after
- status: done
- delta: layer drag updates only when target/edge/distance changes; decoded assets are independent of guide coordinates, and guide positions update immediately; preview draw/selection/hit/drag/double-click consume one measured scene; existing display-list callers retain planLayers compatibility
- measurement: happy-dom React Profiler, 100 individually flushed pointer moves over the same drop position: 100 commits before, 1 after (sample elapsed 916.75ms before, 28.46ms after; elapsed values are environment-sensitive, commit count is the regression gate). Five settled margin edits: 5 asset assemblies before, 0 after; same drawAssets object retained and guide coordinates change before the debounce interval. No real bitmap decode timing or desktop FPS claimed.
- layout benchmark: npx tsx scripts/benchmark-layout.ts; real Poppins metrics, resolved Lolev layers, 10 warm-ups, 5 alternating batches of 100 preview+selection updates, separate vs shared layout. Isolated run before ms: 640.76,640.49,629.87,580.66,606.07; after: 442.17,394.27,391.78,351.06,357.76. Median 629.87 -> 391.78ms (37.8% less); font measurements 26700 -> 17400 per batch (34.8% fewer). Script and the separate-layout helpers (hitBoxesLayers, hitTestLayers, boxesForLayers, dragTargetLayers) were removed once the shared scene was adopted; re-create from git history to re-measure. These are headless CPU measurements, not interactive raster/GPU frame rates.
- evidence: 796 full-suite tests and production build pass, including existing PDF/PSD regressions; final focused checks cover reused hit testing, shared boxes, skipped layers, live guide coordinates and asset reuse; 0.1.52 binary-impacting release metadata prepared; no release published

## 2026-09-05 native-desktop-files
- finding: [Fail fast/high] src/masters.ts:40, src/App.tsx:1114,1441,1720 — custom masters cannot resolve on desktop; masterHint reads are uncontained; export prompts twice; the platform save is spelled three times
- status: open
- attempts: 0/3
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

## 2026-09-05 restrictive-csp
- finding: [security/med] src-tauri/tauri.conf.json:28 — app.security.csp is null
- status: open
- attempts: 0/3
- id: restrictive-csp
- depends-on: native-desktop-files
- read-path: src-tauri/tauri.conf.json
- write-path: src-tauri/tauri.conf.json
- acceptance: preview, workers and updater work under a CSP allowing self, blob:, worker-src blob:, ipc:

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

## 2026-09-05 updater-failure-tests
- finding: [tests/med] src/components/DesktopUpdater.tsx:142-145,203-211 — check() and downloadAndInstall() rejections untested
- status: open
- attempts: 0/3
- id: updater-failure-tests
- depends-on: none
- read-path: src/components/DesktopUpdater.tsx
- write-path: tests
- acceptance: DOM tests assert the silent-log path and the "Could not install the update" reopen

## 2026-09-05 legacy-oracle-deletion
- finding: [YAGNI/med] tests/legacy/plan.ts:1 — 1,220-line pre-v3 layout oracle and 8 suites
- status: parked(context)
- attempts: 0/3
- ruling: still the pixel-parity check for plan.ts; unparks when master-as-layers (2026-09-04 spec) replaces plan.ts

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

## 2026-09-05 vision-items
- finding: [UX/low] five delight items, each under 30 minutes: Reveal in Finder after export; drop a .master onto the window to register it; Recent Masters submenu; greyed Export explains itself via one shared gate and a tooltip; non-destructive dismissable warning alert (top-ten #10)
- status: open
- attempts: 0/3
- depends-on: native-desktop-files

## 2026-09-06 right-sidebar-ux
- finding: [UX/low] src/components/LayerInspector.tsx — typography split across sections, template authoring interrupts appearance edits, hints disappear when filled, reset targets only 8px
- status: done
- delta: unified typography before position; template fields retained under a native disclosure at the bottom; sentence-case headings, persistent associated hints, and 24px reset targets; all model patches and controls retained
- evidence: 45 inspector DOM tests and production build pass; browser screenshot reviewed and mouse expansion/Enter collapse verified; binary-impacting 0.1.61 metadata and CHANGELOG heading validated; no release published
- notes: UX assessment follows grouping, recognition and progressive disclosure principles (https://www.nngroup.com/articles/ten-usability-heuristics/); no user study or measured task-time improvement claimed

## 2026-09-06 numeric-display-precision
- finding: [user report] ScrubField rendered raw imported floating-point precision in text sizes
- status: done
- delta: shared numeric display rounds to the existing step precision; viewing does not write geometry, and typing drafts remain unchanged
- evidence: imported 15.829999923706056 displays 15.83 without onChange; 46 inspector tests, production build, diff and 0.1.61 release metadata checks pass; changelog folded into this branch's version

## 2026-09-06 inspector-millimeters
- finding: [user request] offer millimeters for position and dimensions while retaining point typography
- status: done
- delta: mm/pt selector retained across layer selection; mm defaults with 0.01 display/edit precision, converted back to the existing point geometry; optional dimension clearing and validation bounds retained; font size/tracking remain pt
- evidence: 52 focused inspector/App checks and production build pass; browser confirms mm dimensional labels and pt font size; binary-impacting change folded into 0.1.61 CHANGELOG, synchronized release gate and diff check pass; no release published

## 2026-09-06 printed-character-height
- finding: [user request] font points do not report the actual printed heights of letters/numerals
- status: done
- delta: editable minimum height plus tallest-character readout from export font glyph outlines and the shared text plan; heading/face/case/placeholder/suffix handling retained; size adjustments round upward and keep 1–300pt bounds; punctuation and decorative strokes excluded; lazy font loading with inline failure/empty states
- evidence: 958 full-suite tests and production build pass; release metadata gate for binary-impacting 0.1.61 and diff check pass. Browser verified user's Info selection at 8.13pt, min 2.00mm, max 2.11mm; existing 15px design stroke explains an additional 1.27mm visible envelope. No user data modified during inspection, no release published.
- notes: measurement helper, not a TTB certification; checking type size does not validate content, contrast, character density, or physical printer scaling

## 2026-09-06 per-layer-font-control

- finding: [user request] warning typography needs a narrower font without changing the rest of the label
- status: implemented in enhance/right-sidebar
- delta: per-text-layer Default/Poppins/Barlow Condensed selector; bundled regular/semibold/bold faces and public OFL license; family-aware measurement, canvas/in-place editing, PDF embedding and PSD type names; existing override/reset persistence; unknown persisted families rejected
- evidence: 964 tests pass; focused 53 selector/export/persistence checks pass after final selector display correction; production build passes, with the existing large-chunk advisory. Binary-impacting 0.1.61, CHANGELOG heading and synchronized release metadata pass. Browser control disconnected and native computer-use permission was unavailable, so live visual inspection of this addition could not be completed. No user label data changed, no release published.

## 2026-09-06 wysiwyg-uppercase

- status: implemented in enhance/right-sidebar
- delta: uppercase toggle in the on-canvas rich-text toolbar uses the existing style.uppercase setting and joins the same undo/cancel session as text edits; original text case retained; floating toolbar clamp expanded for its fourth toggle
- evidence: 39 focused text-editor/App tests pass, including reversible uppercase display without content mutation; production build and binary-impacting 0.1.61 release gate pass (CHANGELOG updated). Live visual inspection remains unavailable due to computer-use access. No release published.

## 2026-09-06 sidebar-uppercase-followup

- status: fixed in enhance/right-sidebar
- root cause: uppercase was wired only to the floating canvas toolbar, not the sidebar TextEditor used for the warning
- delta: connect the shared uppercase control to the sidebar layer patch; keep that toolbar visible before focus
- evidence: 40 focused editor/App tests pass, including the unfocused warning field; production build, diff check and binary-impacting 0.1.61 release gate pass; CHANGELOG updated. No release published.

## 2026-09-06 characters-per-inch

- status: implemented in enhance/right-sidebar
- delta: print-size CPI readout beside character heights, using the highest line-average count divided by occupied run width; excludes whitespace from character count but retains its width and justified gaps; supports rotated text, font/size/case/spacing/wrap changes
- scope: explicitly labeled estimate/highest line average, not a sliding one-inch maximum or compliance verdict. TTB 16.22 defines letters, numbers and marks but retrieved guidance did not establish an averaging protocol.
- evidence: 9 focused real-font/geometry/DOM tests pass, including half-inch count, justified gaps, rotation, densest line, inverse size scaling and invalid widths; production build, diff and binary-impacting 0.1.61 release gate pass. No release published.

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


## 2026-10-05 ux-decimal-input
- finding: [UX/low] src/components/TextEditor.tsx:731 — ABV decimals conflict with native input validation and stepping
- status: open
- attempts: 0/3
- observed-at: 1b0024900e92d56e90b3f212865e15ecb99fd260
- evidence: Chrome browser reproduction and DOM/accessibility measurements; full steps and source trace in docs/audits/2026-10-05-ux-decimal-input.md
- delta: investigation complete; runtime unchanged, fix remains open
- release: non-binary-impacting documentation and agent memory only; no release queued
- evidence: git diff --cached --check and node scripts/check-release.mjs origin/main passed on audit/ux-decimal-input documentation diff based on 1b00249; no application suite run
