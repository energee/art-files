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
- status: open
- attempts: 0/3
- notes: any migration goes per element behind its existing byte-identity golden; delete a built-in branch only after that element's parity holds; never one motion. No generic `flow` constraint in the schema — if description/warning/collab migrate, try resolver-computed offsets first and only revisit a constraint then. Draw-order guard: one golden with a custom layer behind a built-in, PDF only (backends share planLabel's ordering). Seam risk: four prior fix rounds (dc492aa, 91f02fb, a368d76, 48ca845) were all master/label ownership-seam bugs — every seam-touching task lands with a doc.ts-level test, not just render goldens. Full v1 scope: the 2026-08-29 amendment block in docs/superpowers/specs/2026-08-27-master-variation-design.md.

## 2026-08-28 remove-fill-variant-checkboxes
- finding: [user request] src/components/FieldList.tsx:152 — Fill mode exposed a Collab checkbox the user did not want
- status: done
- attempts: 1/3
- delta: Fill-mode variant controls 1 → 0; FieldList now receives App's already-resolved fields instead of recomputing them from two model props; already-enabled variants still resolve their fields and artwork; 658 tests, tsc, Vite build, Cargo check, and the 0.1.38 release gate pass
