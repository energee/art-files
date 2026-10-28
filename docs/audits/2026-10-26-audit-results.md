# Label Lab application audit — results

**Disposition: confirmed correctness/accessibility defects; not a clean bill of health or production-print certification.** Investigation completed on available surfaces. All 41 planned scenarios are accounted for below; native, Photoshop, physical-print and other incomplete proof remain explicit.

**2026-10-27 follow-up correction:** AUD-02 / #543's claimed CMYK QR loss was a crop-coordinate error. Ghostscript rotated the page by 90°, and the original-coordinate crop captured label text, not the QR. A transformed crop of the retained converted PDF decodes the exact Labradorite URL. The historical observations below remain the audit record, not current confirmation of conversion-induced decode loss. `tools/to-cmyk.sh` now disables automatic page rotation; a fresh 600-DPI original-coordinate crop decodes the same URL. AUD-01 / #542 remains reproducible and is still subject to the printed-Lupula approval gate.

- Plan: [risk-based audit plan](2026-10-26-audit-plan.md).
- Execution revision: `eac33714bbfbc7df704fb4959d32ab7a0793cb1b`, Label Lab **0.1.108**.
- Planning/preparation began on `d0d1ad513dc15b4a4065b3d41d5f0ba7c00abc11`, 0.1.107. An external checkout update advanced application source before execution; reviewers were notified and execution evidence is attributed to **eac3371**, not the planning revision. The transient ledger conflict was externally resolved; this audit did not resolve it.
- Audit changes: report, retained evidence and agent memory only. No application fixes, new tests, golden updates, version changes, releases or public-updater operations.
- Evidence root: [2026-10-26-evidence](2026-10-26-evidence/). [Index and hashes](2026-10-26-evidence/index.json) identify retained artifacts. Larger generated exports and working material also remain locally under `/tmp/label-lab-audit-2026-10-26/`; temporary paths are not required to read the retained findings.

## 1. Environment and methods

| Surface | Observed environment / scope |
| --- | --- |
| Host | macOS 27.0.1, arm64, 32 GiB, 10 CPU cores |
| JavaScript | Node 24.19.0, npm 11.17.0; clean root and docs `npm ci` completed |
| Browser | Chrome 156.0.0.0; real Vite editor; dedicated audit profiles and local origins; principal viewport 1440 × 1000, DPR 1; layout checks also 1024 × 768, 768 × 900, 375 × 812; DPR 4 for raster-bound check |
| Rust | rustc/cargo 1.99.0; CI-pinned 1.98.1 unavailable locally, not installed during audit |
| Print tools | Poppler 26.02.0, Ghostscript 10.08.0, repository ZXing WASM decoder; Photoshop application version 27.11.0 reachable, but no Photoshop-rendered proof retrieved |
| Native | Source-matched 0.1.108 macOS `.app` built successfully; copied application process launched and was terminated. This is not visual/native-dialog certification. No Windows/Linux runtime available |
| Accessibility | DOM/accessibility-tree inspection and keyboard actions. Native `AXIsProcessTrusted()` returned `false`; a System Events query timed out. No screen-reader speech session or native GUI control proof |

Full environment and lock hashes: [environment.json](2026-10-26-evidence/environment.json), [baseline inspection](2026-10-26-evidence/baseline/inspection.json), [execution lock hashes](2026-10-26-evidence/baseline/lock-hashes.log).

Browser save/error/export probes used **main-world script injection into the real mounted app** with harmless in-memory File System Access handles. Real packing, resolving, UI state and export building ran; the OS write boundary was simulated. These probes do not prove Tauri dialogs, filesystem atomicity or permission enforcement.

Initial automation errors were separated from application findings: `fill` was inappropriate for the rich contenteditable; unscoped selectors could select hidden tabs; browser aliases initially shared one target; isolated-world monkeypatches did not affect the application's main world. Later probes used exclusive profiles, visible elements, actual keyboard input and main-world injection. Tool-generated selector/key/time-out errors are **not** application defects. No failed test suite was rerun merely to confirm its failure.

## 2. Fixtures and retained evidence

| Fixture | Execution inputs and authority |
| --- | --- |
| F1 | Packed shipped Lolev master, `Audit Labradorite`, ABV `7.2`, UPC-A `850051366224`; [master](2026-10-26-evidence/fixtures/shipped.master), [values](2026-10-26-evidence/fixtures/shipped-values.json). Existing committed Collab off/on golden fixtures were exercised by the full suite |
| F2 | Synthetic dark texture and explicit mask; actual PDF operators inspected. [Plate color observations](2026-10-26-evidence/print/f2-ink-colours.json) |
| F3 | Custom-master clone with 0.125in bleed and custom SVG; generated PDF/PSD metadata inspected. Original manifest: [print manifest](2026-10-26-evidence/print/manifest.json) |
| F4/F5 | Truncated/malformed archives, forged size/inflation, 10,000 ignored ZIP entries, traversal entries, untrusted hint paths, harmless symlink sentinel and spaced/Unicode CLI paths. [Input manifest](2026-10-26-evidence/input/manifest.json), [probe results](2026-10-26-evidence/input/results.json), [hint results](2026-10-26-evidence/input/hint-results.json) |
| F6 | Browser text save/reopen, delayed save, failed/cancelled Save As, recovery restart and export/edit overlap. [Saved bytes decoded](2026-10-26-evidence/ui/save-contents.json), [recovery](2026-10-26-evidence/ui/recovery-live.json), [export snapshot proof](2026-10-26-evidence/ui/export-proof.json) |
| F7 | Deterministic master with **215 total layers**, including 200 additional text layers; 60,266 bytes, SHA-256 `fdf98e0db264c53e86e0a0f4d3019b083f718edbf61c552268742b0038348ef7`. [Master](2026-10-26-evidence/fixtures/stress-200.master), [manifest](2026-10-26-evidence/ui/manifest.json) |

The first F7 draft omitted required per-line fill data and was correctly rejected before the master changed. It was corrected before timing; that fixture-authoring mistake is not a product finding.

## 3. Confirmed findings

### AUD-01 — Default dots QR fails for an ordinary valid name

**[correctness/high] `src/qr.ts:48-58`, `src/planLayers.ts:391-393` — exported default dots QR is not reliably decodable for valid input.**

- Input: F1, payload `https://lolev.beer/beer/audit-labradorite`.
- Actual: generate succeeds; its actual artwork PDF rasterized by Poppler at 600 DPI yields **no QR decode at any of four rotations**.
- Control: same payload and geometry with square QR styling decodes to the exact payload at **all four rotations**. This isolates the failure to the styled output rather than an unsupported payload or a universally broken crop/decoder route.
- Decoder: ZXing WASM, QRCode format, `tryHarder: true`; crop `x=156, y=2262, w=658, h=658` at 600 DPI. [Control observations](2026-10-26-evidence/print/square-qr-decode.json), [dots crop](2026-10-26-evidence/print/qr-long-dots-600.png), [square crop](2026-10-26-evidence/print/qr-long-square-600.png), [actual PDF](2026-10-26-evidence/print/audit-labradorite.pdf).
- Expected: a generated code encodes the intended name-derived URL in usable output. This is a **digital-decoder failure**, not proof that every phone fails or a physical barcode grade.
- Smallest correction direction: establish supported styled geometry/contrast for actual payloads and keep a consumer-visible decode regression. Do not silently change approved QR artwork or treat a payload-specific exception as the fix. The existing printed-Lupula scan gate still applies to a design change.
- Verification: same real PDF/crop/decoder control plus representative physical scans; exact payload equality required.

### AUD-02 — Documented CMYK conversion loses the short reference QR decode

**[correctness/high] `tools/to-cmyk.sh:10-15`, `docs-site/content/docs/(output)/export.mdx:59-65` — the documented printer conversion can turn a decodable generated QR into an undecodable raster.**

- Input: short reference name `Labradorite`, unchanged shipped dots styling.
- Actual: original RGB PDF decodes to `https://lolev.beer/beer/labradorite` at rotation 270°; after the documented Ghostscript conversion, **none of four rotations decodes** at 600 DPI. The conversion exits 0. UPC-A still decodes before and after conversion.
- Evidence: [original PDF](2026-10-26-evidence/print/labradorite.pdf), [converted PDF](2026-10-26-evidence/print/labradorite-cmyk.pdf), [original crop](2026-10-26-evidence/print/qr-short-dots-600.png), [converted crop](2026-10-26-evidence/print/qr-short-dots-cmyk-600.png), [observations](2026-10-26-evidence/print/print-observations.txt).
- Expected: following the printer recipe does not silently lose code readability. The original decoding in only one rotation is already fragile; the audit does not claim the conversion is the only underlying cause.
- Smallest correction direction: review the conversion together with code styling/color and qualify or replace the recipe only after verifying real output. No specific Ghostscript flag is blamed without additional diagnosis.
- Verification: decode original/converted outputs under the same rasterizer and obtain actual printer-profile/stock proof. Digital results alone cannot certify production.

### AUD-03 — Blank barcode blocks export even after the layer is disabled

**[correctness/high] `src/model/resolveLayers.ts:61-76,153-162,174-181` — early stored-value validation defeats the later blank/disabled non-blocking guard.**

- CLI: supplying `"barcode": ""` in a values JSON exits 1 with `barcode: "" is not a valid UPC-A code (12 digits).` [Fixture](2026-10-26-evidence/fixtures/blank-barcode.json), [CLI logs](2026-10-26-evidence/print/logs/blank-values.log).
- Live editor: clear the barcode Code field. The polite status becomes `Export blocked: Barcode: "" is not a valid UPC-A code (12 digits).` Turn **Enabled off**: the switch reports `checked=false`, but the same export-blocking error remains. [Browser observations](2026-10-26-evidence/ui/barcode-blank-live.json), [disabled switch](2026-10-26-evidence/ui/barcode-disabled-observe.json).
- Expected authority: `export.mdx:45` says a blank or switched-off barcode does not block export. The resolver's own later comment/guard states the same rule.
- Cause: `applyValue` calls `validateFor` on a literal stored empty string and records an error before `resolveLayers` reaches its blank/disabled skip. This is a **shared resolver defect**, not CLI coercion alone. A disabled master with no invalid stored override exports successfully, explaining the apparently inconsistent outcomes.
- Smallest correction direction: preserve the intended blank/disabled semantics consistently at the value-validation boundary while still rejecting nonblank enabled invalid codes and invalid expanded references.
- Verification: browser and CLI blank/disabled stored values must not block; enabled invalid literal/reference values must still block, including variants and overrides.

### AUD-04 — Keyboard focus is invisible on an unselected layer name

**[a11y/high] `src/components/LayerList.tsx:231-235` — keyboard users cannot see which unselected layer-name button has focus.**

- In the real editor, focus the unselected Style name using keyboard modality and move the pointer away.
- Actual computed state: `:focus-visible=true`, `aria-pressed=false`, outline style `none`, all ring/shadow widths 0px, transparent button and parent background. [Measurements](2026-10-26-evidence/ui/keyboard-focus.json), [screenshot](2026-10-26-evidence/ui/layer-keyboard-focus.png).
- Source explicitly applies `focus-visible:ring-0` and describes hiding the focus mark until Enter selects the row. Selection is not a substitute for identifying the next keyboard target.
- Enter still selects; Alt+ArrowUp produced `Style moved forward.` The finding is **focus visibility**, not an invented activation failure.
- Smallest correction direction: retain the chosen row-selection styling but restore a visible keyboard-only focus indication. This conflicts with the prior sidebar design's explicit no-name-focus-ring choice and needs that accessibility tradeoff resolved, not silently rewritten during this audit.
- Verification: Tab/Shift+Tab across selected and unselected names in both appearances; focused target visibly identifiable before activation. Reference target: [WCAG focus visible](https://www.w3.org/TR/WCAG22/#focus-visible); no overall conformance claim.

### AUD-05 — Fill/stroke fields remain unnamed (existing open finding)

**[a11y/high] `src/components/ColorField.tsx:150-164`, `src/components/LayerInspectorSections.tsx:352-359,387-409` — two hex fields have no accessible name and both picker buttons are called only “Pick color.”**

- Select ABV and inspect its enabled outer stroke. Accessibility output contains two unnamed textboxes, values `#F3CD80` and `#000000`; DOM inspection shows no associated labels, `aria-label` or `aria-labelledby` for the hex inputs.
- [Accessibility observation](2026-10-26-evidence/ui/inspector-observe.json), [screenshot](2026-10-26-evidence/ui/inspector-dark.png). The existing [2026-10-05 report](2026-10-05-ux-color-labels.md) and ledger entry already track this issue; this audit **reconfirms**, rather than duplicates, it.
- Smallest correction direction: associate distinct fill/stroke labels with both inputs and contextual picker names. Verify actual inspector callers with keyboard and assistive technology; an element id alone is not a label.

### AUD-06 — File picker target is a generic focus stop, not a named action

**[a11y/med] `src/components/FileDrop.tsx:74-83,95-99,121` — the focusable click-to-browse well does not expose its action and context as a named control.**

- Actual mounted Metallic mask well: `<div role="presentation" tabindex="0" data-file-drop>`. When focused, Chrome exposes a generic active container with static child text and a nested file input named only `file upload`.
- [Accessibility tree](2026-10-26-evidence/ui/file-target-aria.txt) shows the generic active target; the input does not distinguish Texture, Metallic mask or a custom image slot. This is not an allegation that keyboard handlers are absent: react-dropzone supplies them.
- Smallest correction direction: expose a labeled file-selection action tied to the slot, retaining the separate Remove action and drop handling without creating nested interactive buttons. Check both empty and loaded states.

### AUD-07 — Default full regression run is red

**[evidence/high] `package.json:16`, `tests/save-races-dom.test.tsx` and seven other suites — the standard test command does not currently provide green release evidence on the audited environment.**

- `npm test`, unmodified defaults, exits 1: **150 passed / 8 failed files; 1,626 passed / 32 failed tests**, 1,658 total.
- Saved diagnostics classify **11 timeout failures and 21 assertion/type failures**. The latter include missing status/preview elements and later null controls in the save-races suite; this audit has not proven whether they are independent defects, contamination after earlier timeouts, or another cause.
- Full compressed log: [test.log.gz](2026-10-26-evidence/baseline/test.log.gz); [failure classification](2026-10-26-evidence/baseline/failure-classification.json). No suite was rerun to erase or confirm this result.
- The run occurred while other functional audit work was active. Resource contention is a possible contributor, **not an established root cause**. Do not report this as 32 consumer-visible bugs or claim output nondeterminism from a test that only timed out.
- Smallest next investigation: identify the earliest timeout/failed transition and isolate its cause on controlled resources; any changed harness/configuration needs explicitly new evidence. Do not suppress assertions or blindly raise every timeout to manufacture a pass.

## 4. Scenario register

**Status applies to the specified evidence, not to every platform.** “Blocked” rows include the successful portions, then name the missing proof. “Not run” is not a pass. All Windows/Linux native scenarios remain blocked by unavailable target environments; macOS UI paths remain blocked by absent accessibility trust. The plan's operator contracts remain the expected authority unless a finding above identifies a disagreement.

| ID | Outcome on exercised surface | Evidence and remaining proof |
| --- | --- | --- |
| A1 | Blocked — partial browser pass | Typed `Audit Aurora`, saved 300-byte `.label` through an in-memory handle, reopened the exact bytes into another tab and observed the same Name. Full style/geometry/asset round trip and native destinations not run; no native pass |
| A2 | Pass — browser write-boundary simulation; native blocked | Actual captured ZIP contains `Aurora12`; edit during delayed write becomes `After Snapshot`; completion retains `Close After Snapshot (unsaved changes)`. [Snapshot](2026-10-26-evidence/ui/snapshot-save.json), [decoded bytes](2026-10-26-evidence/ui/save-contents.json) |
| A3 | Pass — browser write-boundary simulation; native blocked | Cancelled/failed Save As retain content and dirty state. `Audit EIO` is surfaced. Subsequent Save uses original `audit-snapshot.label`, does not invoke a fourth picker and clears dirty only after success. [State](2026-10-26-evidence/ui/save-cancel-failure.json). Native failures and first-save cancellation not driven |
| A4 | Blocked — partial browser pass | Dirty-close dialog offers Cancel/Discard/Save; Cancel preserves the tab. Multi-tab/master-review sweep and native window/menu/Dock quit not directly run |
| A5 | Pass — browser restart simulation; native hard-crash proof blocked | Actual IndexedDB snapshot `recovered-aurora.label` survives reload; Escape dismisses offer without deletion, next reload offers again, Restore returns dirty `Recovered Aurora` on cached custom master; later Discard removes snapshots. [Restore](2026-10-26-evidence/ui/recovery-live.json), [discard](2026-10-26-evidence/ui/recovery-discard.json). Rebind module covers unchanged/missing/changed/duplicate paths; not a forced OS crash or native mtime proof |
| B1 | Pass — direct CLI/PDF metadata | F1 art/mask 585.12 × 369.12pt; trim 576 × 360pt (8 × 5in), configured bleed and Producer correct. F3 non-default bleed 594 × 378pt, trim 576 × 360pt. See print observations |
| B2 | Blocked — PDF/operator subset passed | Real F2 art/mask embed page XObjects; art contains intended near-black/gold/white, mask blue/white. Golden mask suites passed. Full per-span/stroke visual registration and production plate approval not certified |
| B3 | Pass — committed golden fixtures and repeat raster comparison | Full-run Collab off/on byte-identity goldens and print-geometry goldens passed. Same-engine regenerated F1 art/mask pairs each have 0 changed pixels at 600 DPI. No independent custom-label approved reference or Photoshop parity is claimed |
| B4 | Blocked | PSD metadata/layer inspection passed (4876 × 3076, 600 PPI). Photoshop version reachable; safe scripted opens failed `-1728` / `-43`; OS open returned 0 without a rendered export. Need actual reference/candidate Photoshop rasters |
| B5 | Fail; production certification blocked | AUD-02. Ghostscript exits 0, UPC survives, QR decode does not. Need actual printer profiles, stock and proofs |
| C1 | Fail | AUD-01/AUD-02; square control succeeds. UPC-A decoded as `0850051366224` (decoder's leading-zero EAN representation) before/after conversion. No all-symbology/all-stock certification |
| C2 | Fail | AUD-03. Malformed UPC, missing glyph and invalid expanded-reference input rejected correctly in other direct cases. Initial expanded-reference suspicion disproved because the first fixture supplied a valid overriding UPC; equivalent no-override case exits 1 |
| C3 | Blocked | No physical printer, representative stock, phone/barcode scanner or Lupula print scan. Digital decoding cannot close this gate |
| D1 | Blocked — parser and limited live-open pass | Truncated/malformed files reject readably; mounted editor refused missing masterId and corrupt PNG without replacing the current master identity. Edited fills/save-target preservation, all glyph/legacy migration paths and native UI combinations not exhaustively driven |
| D2 | Pass — bounded archive probes | Oversized declared entry and forged inflation reject; 10,000 ignored entries retain only `label.json` and remain responsive. Lack of entry-count/compressed-input caps is a hardening observation, not proven denial of service |
| D3 | Blocked — browser cache subset observed | Custom master survives browser recovery via cache. Moved/missing/replaced native masters and actual disk/cache ordering not exercised; source inspection alone is not a pass |
| D4 | Blocked — pure/archive subset passed | Untrusted absolute/traversal hints refused and malicious archive entries omitted without host extraction. Node sentinel symlink follows an outside file, but actual Tauri/plugin-fs scope behavior remains unverified; no confirmed native escape finding |
| D5 | Blocked — mounted PNG routes passed | Uploaded PNG lands in Background; synthetic window right-half PNG drop lands in Metallic mask; right-half drop on Background's actual field changes Background and preserves prior mask. [Live route evidence](2026-10-26-evidence/ui/routing-live.json). JPEG/WebP routing was direct pure-function evidence only; real native/SVG/all-format round trips not run |
| E1 | Blocked — source-matched macOS process launch passed | Built current 0.1.108 `.app`, launched copied app process; no Finder/warm/canonical-path tab proof or visual app certification. Windows/Linux unavailable |
| E2 | Blocked | Native dialog, overwrite/rename/permission/partial-pair workflow not controllable with absent AX trust. Browser simulated-save proof is A2/A3, not native proof |
| E3 | Blocked — browser menu subset passed | Browser File/Edit/Layer/View, appearance submenu, view choices, keyboard selection and layer movement observed. Native menu/palette parity and all limit/check-state combinations not certified |
| E4 | Blocked | Existing updater suites passed in baseline, but no controlled signed endpoint/current signed artifact for real install/restart; local build lacks updater key and disables updates. No public feed or operator installation altered |
| F1 | Blocked — browser label subset passed | Real label text updates title; new tab isolation and layer reorder observed; saved/reopened text retained. Full variant/template promotion and style/position routing matrix not run |
| F2 | Blocked — real text undo/redo and module subset passed | Document Undo returns `Undo Smoke` to Untitled; Redo restores it. [Live result](2026-10-26-evidence/ui/undo-live.json). Module history transition passed; image replacement, scrubs and cancellation combinations not exhaustively exercised live |
| F3 | Blocked | Canvas and PDF paths exercised; golden/geometry/PSD-tree suites passed. No complete canvas/PDF/Photoshop edited-fixture parity proof; Photoshop gate remains open |
| F4 | Pass — browser export/edit overlap; remaining transitions unverified | Begin real artwork PDF export at `Undo Smoke`, delay injected write, edit to `While Exporting`, finish. Captured PDF title/text remain Undo Smoke; current name remains newer; saved-confirmation status empty. [Proof](2026-10-26-evidence/ui/export-proof.json). Not full asset/tab/variant race certification |
| G1 | Fail | AUD-04. Keyboard text editing, inspector close focus return, layer activation/reorder work, but unselected layer-name focus is invisible |
| G2 | Fail | AUD-05/AUD-06. Existing color inputs unnamed; file well generic/uncontextualized. Close-inspector focus return and decimal `5.8` with `step=any` observed; no real speech session |
| G3 | Pass — observed browser feedback; speech blocked | ABV 25 produces precise max-20 message and polite export-blocked status; corrected 5.8 is valid. Export/edit overlap withholds stale saved announcement. Announcement timing with a screen reader not verified |
| G4 | Blocked — sampled contrast/layout evidence | Sampled light text minimum 5.17:1; muted light text 5.70:1, dark samples 6.86:1/7.30:1. 1024px inspector leaves 465px-wide preview; 768px leaves 209px; at 375px with sidebar+inspector preview is 0px. This last case is browser-only (desktop minWidth 1024), not a new native failure or standalone WCAG conclusion. Full zoom/reflow/non-text contrast and speech review not complete |
| H1 | Pass — direct documented CLI matrix | Inspect, values, batch, stdin, label, variants/assets, set, PDF-only, PSD-only, default/all and legacy forms generated expected named outputs. [Logs](2026-10-26-evidence/print/logs/) |
| H2 | Pass — direct exit/output boundaries | Success 0; invalid jobs 1; invalid argv 2. Bad late batch writes nothing; duplicate names rejected; regular file used as outDir fails mkdir/EEXIST with exit 1. No atomic filesystem rollback promise inferred |
| H3 | Pass — direct validation/decode boundary | Valid check writes nothing even with outDir; missing files/invalid inputs fail. Corrupt PNG passes check but full build fails `The input is not a PNG file!`, matching documented non-decoding preflight |
| H4 | Pass — exercised cases, subject to C2 defect | Spaced/Unicode relative cwd, optional width clearing, dormant label values and meaningful WebP rejection observed. Blank barcode defect is AUD-03 |
| I1 | Blocked acceptance — measurements recorded | Stress edit-to-next-frame and view-attachment samples below; not full first-painted-asset, native, large-raster or export-throughput benchmarking |
| I2 | Blocked long-term acceptance — short lifecycle measured | Six view transitions show canvas detach/reattach and non-monotonic JS heap. Raster ceiling observed. No forced-GC retained-memory/VRAM proof, long-session or many-tab stress certification |
| I3 | Blocked | No operator-approved latency/memory budgets or matched reference baseline; report measurements only, not arbitrary performance pass/fail |
| J1 | Fail | AUD-07; other baseline/build checks passed. Source-matched package built. Rust 1.99 results do not prove CI-pinned 1.98.1; cross-platform runtime absent |
| J2 | Pass — configured advisory policy, warnings retained | npm runtime audit reports 0 vulnerabilities; cargo audit exits 0 with six allowed warnings. No assertion of vulnerability absence outside those databases/graphs |
| J3 | Pass — scoped review only | Reviewed high-risk input/resolution/save/render paths, retained guards, found shared blank-barcode precedence defect. No additional proven maintainability/security defect; no whole-repository security certification |
| J4 | Fail — workflow/document disagreements | Docs typecheck/build and CLI walkthrough passed, but blank-barcode promise and CMYK printer recipe disagree with runtime findings. Complete native operator walkthrough remains blocked |

### Performance measurements (not acceptance limits)

Timing window excluded new audit build/export work. These are local development-editor samples, not packaged-release benchmarks. The edit probe measures input event to the next animation frame after the application's text painting; it is not Web Vitals INP or an OS display latency measurement. View timings end after canvas attachment and two frames, not confirmed completion of every texture/asset load.

| Metric | Observations |
| --- | --- |
| Reload document milestones | DOMContentLoaded 212.0ms; load 212.7ms. A recovery offer was present; not a clean first-use readiness metric |
| 215-layer edit samples | 184.9, 74.5, 90.2, 66.1, 64.3, 62.2, 60.7ms |
| View sequence | Rendered 547.9ms; Can 1347.6ms; Label 197.5ms; Rendered 181.0ms; Can 197.4ms; Label 277.2ms |
| JS heap during view sequence | Approximately 103–189 MB, non-monotonic. JS heap excludes native/VRAM allocations; no leak conclusion |
| Hard guard | Enter 10000% zoom → displayed 250%; DPR 4 preview canvas **4876 × 3076**, within the declared long-edge cap |

Raw samples: [startup](2026-10-26-evidence/ui/performance-start.json), [editing](2026-10-26-evidence/ui/stress-edit-samples.json), [views](2026-10-26-evidence/ui/view-performance.json), [cap](2026-10-26-evidence/ui/raster-cap.json).

## 5. Engineering baseline and supply chain

All commands below ran on execution revision eac3371. [Command statuses](2026-10-26-evidence/baseline/verification.json) retain timings/cwd; [logs](2026-10-26-evidence/baseline/logs/) retain complete diagnostics except the full test log, which is separately compressed.

| Command | Result |
| --- | --- |
| Root and docs `npm ci` | Passed; npm warned esbuild/fsevents install scripts were pending approval; no scripts/config approval changed. Actual subsequent builds worked |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed, zero-warning policy |
| `npm test` | Failed: 32/1658 tests, 8/158 files; AUD-07 |
| `npm run build` | Passed; Vite large-chunk warnings retained |
| `npx --yes knip@6.38.0` | Passed |
| `npm audit --omit=dev --audit-level=high` | Passed; 0 runtime vulnerabilities reported |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Passed |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Passed; 13 tests, Rust 1.99.0 |
| `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` | Passed on macOS; Rust 1.99.0, not Windows/Linux target execution |
| `cargo audit` in src-tauri | Passed with six warnings below |
| Docs `types:check` / `build` | Passed; 48 static pages generated. Next metadataBase fallback warning retained |
| `npm run desktop:build -- --bundles app` | Passed; current macOS adhoc-signed .app, no notarization credentials. [Actual build output](2026-10-26-evidence/state/native-build.log) |
| `node scripts/check-release.mjs origin/main` | Passed for **execution version 0.1.108**, no binary-impacting changes detected |

The earlier **planning-revision** release check failed because 0.1.107 was older than origin/main's 0.1.108. The later check is fresh evidence after the external revision change, not an unexplained rerun of the same failing state.

Cargo-audit warnings: `proc-macro-error 1.0.4` (RUSTSEC-2024-0370), `zbus_names 4.3.4` (RUSTSEC-2026-0371), `zvariant 5.15.0` (RUSTSEC-2026-0370), `zvariant_derive 5.15.0` (RUSTSEC-2026-0372), `glib 0.18.5` unsoundness (RUSTSEC-2024-0429), and `tokio 1.53.1` unsoundness (RUSTSEC-2026-0386). Dependency-tree paths were inspected, including non-macOS GTK/single-instance paths and local Tauri/updater paths. Affected API use was not dynamically established; no application exploit is claimed. Preserve upstream advisory triage rather than describing exit 0 as “no security risk.”

## 6. Disproved suspicions, residual risks and handoff

- **Disproved expanded-reference bypass:** the initial CLI fixture supplied a valid barcode value, overriding the invalid master reference. The equivalent effective-reference case correctly rejects with exit 1. It is not a finding; [correction/effective-case logs](2026-10-26-evidence/print/logs/).
- **Unproven native symlink risk:** lexical hint containment plus a Node filesystem symlink demonstration does not prove a Tauri read escape. Need a harmless sentinel read through the actual source-matched plugin-fs boundary, with access tracing. No security vulnerability entry was opened from this hypothesis.
- **Hardening only:** no archive compressed-input/entry-count cap was observed, but the bounded 10,000-entry probe remained responsive. No demonstrated denial of service, and no proposal to remove existing inflation limits.
- **Known browser narrow layout:** the 375px zero-preview observation does not invalidate desktop's 1024px minimum; do not reopen the old desktop finding as if that minimum did not exist.
- **Native proof:** macOS app build/process launch is now observed, but native dialogs, Finder/menu/Dock actions, capability/symlink enforcement and native recovery remain blocked by absent accessibility control/direct observation. Windows/Linux need their actual target environments. [Native access evidence](2026-10-26-evidence/state/native-automation.json).
- **Print proof:** Photoshop reference/candidate rendered rasters, actual printer profiles/ink requirements, representative stock and physical UPC/QR scans remain required. Photoshop being installed is not successful rendering proof; digital decoding is not a print certificate.
- **Updater proof:** safe signed artifacts and a controlled endpoint/profile are required before installation/restart can be exercised; no release/public-feed mutation is authorized.
- **Performance/accessibility proof:** operator budgets, matched performance reference, long-session/native memory work, broader zoom/reflow and actual screen-reader observations remain outstanding.

**Recommended next work:** investigate AUD-01/AUD-02 with the retained QR controls and physical scan gate; fix the shared AUD-03 validation precedence with browser/CLI behavioral proof; restore/label accessible controls; diagnose the default regression-run failure before relying on it as a release gate. Any fixes are separate work, not applied by this audit.

**Release stewardship:** this audit is non-binary-impacting; no Unreleased bullet or version bump is required. Do not recommend a new release on the strength of these audit documents alone. Wrong-output fixes, once implemented and verified, warrant prompt release consideration under the repository steward policy; publishing remains the user's separate decision.

## 7. Follow-up — 2026-10-27

Source: `eac33714` plus uncommitted follow-up changes; Node 24.19.0, npm 11.17.0, Poppler 26.02.0, Ghostscript 10.08.0. Existing audit documents, ledger changes and retained artifacts were preserved. Current issues #542–#548 were all open; no overlapping fix PR was listed.

| Issue | Disposition and fresh evidence |
| --- | --- |
| [#544](https://github.com/energee/art-files/issues/544) | Fixed shared resolver precedence: blank/whitespace and disabled stored literal codes bypass barcode-content validation, but shape validation and enabled nonblank literal/reference validation remain. Actual blank CLI fixture failed exit 1 before; after correction `--check` passes and both PDF plates generate. Disabled garbage override passes. Real Chrome enabled `12345` blocks, disabling clears the error; blank/off does not block. Regression cases cover variants and overrides. |
| [#542](https://github.com/energee/art-files/issues/542) | Still reproducible: retained dots crop decodes nowhere, square control decodes exact Audit Labradorite URL in all four rotations. No approved QR design changed. Parked on existing printed-Lupula iOS Camera + stock Android approval/proof before artwork changes. |
| [#543](https://github.com/energee/art-files/issues/543) | Decode-loss claim disproved: retained converted PDF has rotation 90°, and its correct crop at `(156,156,658,658)` at 600 DPI decodes the Labradorite URL. Original-coordinate crop sampled text. Script now uses `-dAutoRotatePages=/None`; fresh conversion retains rotation 0 and 585.12×369.12pt, and original-position `(156,2262,658,658)` crop decodes at 270°. This does not resolve dots fragility or certify stock/profile output. |
| [#545](https://github.com/energee/art-files/issues/545) | Restored keyboard-only name ring without changing selected-row tint. Explicitly supersedes the no-name-ring choice in the sidebar plan. Real Tab/Shift+Tab, selected/unselected states and Enter exercised; light/dark screenshots show a visible 2px blue ring. Removed the obsolete class-only styling assertion instead of re-pinning it. |
| [#546](https://github.com/energee/art-files/issues/546) | Fixed existing `ux-color-labels`: required caller context names Fill color / Stroke color inputs and Pick fill color / Pick stroke color buttons. Real ABV inspector names verified; all direct component callers migrated. |
| [#547](https://github.com/energee/art-files/issues/547) | Passive drop well with separate named Browse and Remove buttons, contextual file-input names, no nested buttons. Real empty/loaded Texture, Metallic mask and custom Image input routes exercised. Texture/mask removal focuses Undo; Undo returns to Browse. Custom Image removal returns to Browse with document-undo hint. |
| [#548](https://github.com/energee/art-files/issues/548) | Retained logs inspected first. A timed-out legacy generation case and save-races timeouts precede later missing-DOM failures; no basis for 32 independent product bugs. Cap concurrent files at 4 rather than the audited 9-worker default; keep isolation and 5s timeout. Controlled four-suite one-worker experiment passes 140 tests. Corrected default `npm test` passes all 158 files / 1668 tests in 26.71s. Historical contention/cascade cause remains a hypothesis, not retrospectively proven. |

Verification: targeted six suites pass 156 tests; `tsc --noEmit`, zero-warning lint, production build, knip 6.38.0 and release metadata check pass. Committed print goldens were not changed. Default test output still contains happy-dom teardown AbortError diagnostics; none were suppressed. An intermediate integration run caught missing labels in direct ColorField test callers and a config-test delimiter error introduced during cleanup; these were corrected before the final green run.

Docs typecheck passes. Docs production build compiled and generated 48 pages, then exited 1 with Next.js `SecurityFatalError` recommending a security upgrade. This is not a documentation build pass; no dependency upgrade or bypass was attempted. Existing metadataBase and app chunk-size warnings remain.

Release stewardship: application changes are binary-impacting; two user-facing Fixed bullets queued under Unreleased. No version bump, commit, PR, merge, release, tag, public-feed change or operator-app installation performed. Recommend a patch release after review of the barcode/accessibility fixes; the unresolved QR design/physical-scan risk must remain explicit. Screen-reader speech, native choosers, physical stock/scans, Photoshop parity and other original cross-platform/native proof gaps remain unverified.
