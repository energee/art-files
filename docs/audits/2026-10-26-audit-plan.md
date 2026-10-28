# Label Lab: risk-based application audit plan

- Status: executed on available surfaces; see [audit results, findings and explicit proof gaps](2026-10-26-audit-results.md). This plan itself contains no verification stamp.
- Prepared: 2026-10-26.
- Planning source revision: `d0d1ad513dc15b4a4065b3d41d5f0ba7c00abc11` (package version 0.1.107).
- Scope: Label Lab browser editor, packaged Tauri desktop app, headless generator, print exports, and operator documentation. The `omp` installation is outside scope.
- Change classification: documentation and agent memory only; non-binary-impacting. No version bump, release, or application change is authorized by this plan.

## 1. Objective and acceptance authority

Find reproducible failures that lose work, produce incorrect print files, violate file trust boundaries, or block ordinary operator workflows. Audit behavior first; review implementation quality separately.

Use these authorities in order:

1. Current operator contracts: [workspace](../../docs-site/content/docs/workspace.mdx), [files](../../docs-site/content/docs/(output)/files.mdx), [export](../../docs-site/content/docs/(output)/export.mdx), [masters and labels](../../docs-site/content/docs/(authoring)/masters-and-labels.mdx), and [CLI reference](../../docs-site/content/docs/(reference)/generate.mdx).
2. Domain invariants: work survives save/open cycles; plates stay registered; physical dimensions and encoded payloads are correct; failed operations do not silently replace valid state.
3. Approved reference artifacts and print geometry, following [golden review rules](../goldens.md) and the [existing raster evidence and limitations](../../tests/goldens/README.md).
4. Reproduced operator failures and historical findings in the [ledger](../../.agents/ledger.md). Old status or test results are leads, not current proof.
5. The repository [principles](../../.agents/principles.md) and [conventions](../../.agents/conventions.md). Use WCAG 2.2 AA as the accessibility review target, not as a conformance claim based on automated checks alone.

A conflict between documentation and observed behavior is a finding to resolve, not permission to silently pick the current implementation as the expected result. Do not invent regulatory or printer certification requirements: obtain the printer's actual stock, color-profile and production specifications before claiming production acceptance.

## 2. Execution order and ownership

The audit lead owns the revision/environment record, coverage register, evidence, finding triage, and final release classification. Area reviewers own their scenario results. For a single-reviewer run, the lead performs all roles.

| Wave | Work | Dependency and completion condition |
| --- | --- | --- |
| 0 | Pin revision, contracts, fixtures, environments and performance budgets | Record exact inputs and available surfaces; mark missing native/physical tooling explicitly |
| 1 | Engineering baseline, A work preservation, B print output, D document handling | Run baseline once; reproduce failures and retain evidence before proposing changes |
| 2 | C UPC/QR, E desktop, F editing, G accessibility, H CLI | Reuse pinned inputs and approved geometry; desktop and CLI must be exercised directly |
| 3 | I performance and remaining J engineering review | Measure a fixed workload without competing build/test load; correlate with functional results |
| 4 | Findings review and coverage closure | Account for every scenario, unresolved risk and unavailable surface; do not silently waive gaps |

Independent areas may run concurrently after fixture preparation. Use separate scratch directories and application profiles. Save/quit/recovery tests must not share a running application or storage profile with another reviewer. Run timed performance work separately from other load.

Execution is investigation-only. Fixes require a separate implementation step with failing-before/passing-after proof, appropriate regression coverage, documentation and release stewardship. Do not publish, install an update over an operator's app, or overwrite production documents during the audit.

## 3. Environments, fixtures and evidence setup

### Environment record

For each run, capture the commit, working-tree changes affecting the run, app version, lockfiles, OS/architecture, Node/npm/Rust versions, browser or webview version, screen size, device scale and appearance. Packaged-app evidence must name its artifact/version and source revision when available. An artifact of unknown provenance cannot certify the source revision.

- Use Node 24 from [`.nvmrc`](../../.nvmrc); record the exact patch. Align Rust baseline checks with the pin in [CI](../../.github/workflows/ci.yml).
- Exercise the browser editor in Chromium and a browser without the File System Access API to cover download fallback.
- Exercise packaged macOS, Windows and Linux apps for platform-specific file, menu and quit paths. Build checks are not native workflow proof. Unavailable platforms remain unverified.
- Cover desktop minimum window size, a typical operator display, browser narrow layouts, light/dark appearance, keyboard-only interaction and a real screen reader. Do not treat browser-only narrow widths as desktop-supported sizes without checking the window configuration.
- Require Poppler for 600-DPI PDF raster review, Ghostscript for the documented CMYK workflow, Photoshop for editable PSD rendering, and physical prints plus scanning devices for printed-code proof. Record tool versions.

### Fixture manifest

Create a manifest in the audit evidence location before execution. For each fixture record its ID, origin, hash, intended values, master/variant, dimensions, asset types, and expected output names and code payloads. Use copies, synthetic labels or approved non-sensitive material only.

| ID | Required fixture |
| --- | --- |
| F1 | Shipped Lolev master, Collab off/on, known text and valid UPC/QR payloads; use the existing golden fixtures for exact golden comparisons |
| F2 | Representative textured/dark label with explicit mask, metallic and white-ink elements, independent stroke plates, and barcode background off/on |
| F3 | Custom master and label with text, rich spans, raster/SVG images, bindings, variants, hidden layers, non-default bleed and PSD resolution |
| F4 | Invalid/truncated label and master archives, invalid fields and glyphs, corrupt assets, and bounded oversized/high-expansion archive cases |
| F5 | Files in spaced/Unicode/dotted paths, same basenames in different folders, moved/missing/replaced masters, and untrusted `masterHint` paths pointing only at harmless sentinel files |
| F6 | Multi-tab dirty session, delayed/failed writes, changed-on-disk originals and recoverable crash state |
| F7 | Deterministic stress labels: record asset dimensions/bytes, layer/tab counts, maximum preview size and repeated-export workload |

Use constrained scratch storage for hostile archives; never exhaust the host to prove a missing bound. Use test-only failure injection for deterministic write/network failures, and pair simulated evidence with at least one real workflow on the relevant surface. Mocks do not certify native behavior.

### Result register

Create `docs/audits/2026-10-26-audit-results.md` when execution begins, not as a fabricated result during planning. Attach evidence under a dedicated audit artifact location; commit only reviewed, non-sensitive artifacts appropriate for the repository.

Record one result per scenario and required environment: ID, revision, fixture hashes, exact steps/command, expected behavior and its authority, actual behavior, outcome, evidence location, and finding ID where applicable. Outcomes are **pass**, **fail**, **blocked** or **not run**. A blocked result names the missing prerequisite and concrete action needed; it never counts as a pass.

## 4. Scenario catalog

Each numbered scenario below needs an individual result. Existing suites are starting points for coverage inspection, not evidence that these scenarios currently pass.

### A. Work preservation — critical

- **A1 Save round trip:** edit text, styling, geometry and embedded assets; Save, close and reopen. Compare content, overrides, variants and assets, not just the visible title. Repeat in separate tabs to verify isolation.
- **A2 In-flight edits:** delay Save, edit again, complete the write and reopen the saved file. Disk must contain the operation's snapshot; newer in-memory edits must remain dirty and independently saveable.
- **A3 Cancel/failure:** cancel first Save and Save As; deny a write or remove its destination. Verify the prior document, save target and dirty state survive, with an actionable error and no false success.
- **A4 Close/quit:** exercise Save/Discard/Cancel across several dirty tabs, including master-only edits, Review Master cancellation and master-save failure. Test window close, menu/shortcut quit and macOS Dock quit separately. Honor documented platform limitations rather than assuming every OS shutdown is interceptable.
- **A5 Recovery:** wait beyond the documented recovery delay, force-quit a disposable session, relaunch and Restore. Also test Discard and dismissing the offer. A restored target may be reused only under the documented unchanged/existing/not-already-open conditions; missing, externally changed or duplicate-open originals must require a destination. Do not demand recovery of the last unpersisted couple of seconds.

Evidence: before/after files and state, saved-file content comparison, dialog sequence and recovery timestamps. Starting suites: `save-races-dom`, `use-project-save-dom`, `close-save-master-dom`, `close-review-sweep-dom`, `recovery-open-dom`, `recovery-dialog-dom`.

### B. Print output — critical

- **B1 Geometry:** export both PDF plates for F1–F3. Verify physical page dimensions, 8 × 5in TrimBox for the shipped master, configured bleed, BleedBox, orientation and matching art/mask placement. Check the Producer version and output names against the documented contract.
- **B2 Ink semantics:** inspect flood-without-mask, uploaded-as-authored masks, white underlays, metallic knockouts, independent strokes and rich-text plate spans. Blue means white ink; white means knockout. Compare art and mask at the same coordinates, including barcode bars/digits/halo and optional solid background.
- **B3 Reference comparison:** run the existing golden/geometry suites, then compare approved reference and candidate PDFs with the same Poppler version at 600 DPI. Review all changed pixels per layer. Do not rebaseline an unexplained mismatch or compare different rasterizer engines.
- **B4 Editable PSDs:** export art/mask PSDs, verify resolution and physical size, open in Photoshop, update text if prompted, and inspect text, style runs, vector shapes, strokes, asset fitting and registration. Render corresponding reference/candidate PSDs in the same Photoshop version at 600 DPI and review PNG diffs. Reading an `ag-psd` layer tree or matching PDF rasters cannot close this gate.
- **B5 Production path:** run the documented Ghostscript CMYK conversion on copies. Inspect neutral black versus colored elements, registration and encoded-symbol readability after conversion. Compare with the actual printer's profile/ink requirements; production approval remains blocked if those specifications or physical proofs are unavailable.

Evidence: original/exported files, hashes, page-box/color inspection, Photoshop version, raster diffs with changed-pixel bounds, and reviewed print proofs. Follow [goldens.md](../goldens.md); do not overwrite historical evidence. Starting suites: `collab-variant-goldens`, `print-geometry-goldens`, `pdf-build`, `mask-plate`, `bleed`, `psd-build`, `psd-collab`.

### C. UPC and QR — critical

- **C1 Digital decode:** decode 600-DPI art exports for shipped and custom supported symbologies, normal/rotated placement, dark texture, and solid barcode background off/on. Compare the full decoded value and QR destination with the manifest, including expanded layer references and name-derived URL behavior. Repeat after CMYK conversion.
- **C2 Validation boundaries:** malformed check digits, invalid characters, invalid values supplied by a master or variant, and invalid expanded references must block export with an actionable error. A blank or disabled barcode follows the documented non-blocking contract. Verify normalization against the operator contract rather than accepting whatever the encoder emits.
- **C3 Physical scanning:** print representative outputs at actual size on representative stock, with white ink where relevant. Record printer, stock, scaling, lighting and scanner/phone models; check exact payloads on a barcode reader and phone QR scanner. Include the previously requested printed Lupula QR case if the label is available. A digital decode alone is not printed scan certification or a formal barcode grade.

Evidence: symbol crops, decoder output, payload comparison, print photographs and scan results. Starting suites: `qr-print-decode`, `barcode-validation`, `barcode`, `ean13`, `code128`, `qr-options`.

### D. Document handling and trust boundaries — high

- **D1 Invalid input:** open truncated archives, malformed structures, invalid colors/numbers/barcodes, unsupported glyphs and corrupt assets. Verify readable errors and preservation of the current document, tabs and save destination. Check current-format files and documented legacy migrations separately.
- **D2 Resource bounds:** exercise bounded archive inflation, many entries and large assets in a constrained environment. Record rejection behavior, memory and responsiveness; failures must not leave a partially replaced document.
- **D3 Master resolution:** open labels whose master moved, disappeared, changed identity or was replaced at the same path. Verify documented hint/library/picker behavior, rebinding and cache handling; do not silently accept an unrelated master.
- **D4 File containment:** probe relative traversal, absolute untrusted hints, symlink escape and malicious archive entry paths using harmless sentinel files. Observe actual file reads/writes where possible; assert no access outside authorized roots or chosen destinations. A safe-looking error alone is insufficient containment evidence.
- **D5 File routing:** open/drop `.label`, `.master` via supported entry points and PNG/JPEG/WebP/SVG through their documented targets. Verify inspector-target precedence, texture/mask choice, unsupported-file handling and embedded-asset round trips.

Evidence: fixture archive manifests, errors, state snapshots and file-access traces. Starting suites: `failed-open-dom`, `truncated-archive`, `model-files`, `masters`, `missing-master-dom`, `filedrop-dom`, `tauri-capabilities`. Review Tauri capabilities and native file commands alongside UI handling; dependency advisories do not replace this review.

### E. Desktop integration — high

- **E1 Native opens:** cold/warm start by Finder or platform equivalent, command-line paths and repeated opens of canonical/relative/dotted paths. Verify correct tab routing, real path retention, no duplicate document tabs, and useful handling of missing recent files.
- **E2 Save/export dialogs:** verify subsequent Save rewrites the selected file. Paired exports ask once on desktop; an existing sibling mask prompts rather than silently overwriting. Cancel or fail the second save and report the partial result accurately: paired export is not promised to be transactional. Exercise renamed destinations and permission failures.
- **E3 Menu parity:** compare native menu, in-window browser menu and palette names, enabled/check states and shortcuts. Include tab switching, recent-menu rebuilds, appearance, zoom limits and inspector state.
- **E4 Updater:** check no-update, available-update, offline/manual/automatic check failure, download failure, retry and dirty-tab gating. Use an isolated app/profile and controlled endpoint or test harness for destructive installation paths. Never publish a release or alter the public update feed. If real install/restart cannot be safely exercised, report that path as blocked, not proven by mocked tests.

Evidence: per-OS artifact identity, native dialog/menu captures, filesystem outcomes and updater logs. Starting suites: `tabs-os-open-dom`, `tabs-open-recent-dom`, `export-pair-dialog-dom`, `appmenu-native-checks-dom`, `updater-dom`, `updater-windows-dom`. Reuse A4 for quit evidence without duplicating the test.

### F. Editing consistency — high

- **F1 Edit routing:** edit content, position and style in label/template contexts; switch variants, reorder/add/remove layers and save/reopen. Verify changes reach the intended label/master/variant without leaking across tabs or variants.
- **F2 Undo/redo:** mix field sessions, scrubs, nudges, drag cancellation, text edits, image replacement/removal and discrete commands. Verify exact restoration and expected grouping, including the restored image and saved/dirty state.
- **F3 Render parity:** compare canvas art/mask views, PDF and Photoshop output for the same resolved fixture. Check bindings, multiline/rich text, missing glyphs, image fitting, hidden/off-variant layers and stroke behavior. Compare geometry/content, not engine-specific antialiasing.
- **F4 Async transitions:** replace assets or switch tab/variant during rendering/export. An export must retain its starting snapshot, later edits must remain visible, stale completion must not claim current content was saved, and success from one operation must not erase another operation's error.

Evidence: operation sequence, before/undo/redo files or state, exported snapshot and view captures. Starting suites: `model-edit`, `model-resolve-layers`, `history`, `image-asset-undo-dom`, `preview-pointercancel-dom`, `app-v3-dom`, `use-export-dom`, `uncaught-errors-dom`.

### G. Accessibility and operator usability — high

- **G1 Keyboard workflow:** create/open, choose a master, select/edit/reorder a layer, switch variants/views, export and close using only the keyboard. Check logical order, visible focus and absence of traps, including collapsed sidebar and non-modal inspector.
- **G2 Controls and dialogs:** inspect accessible names/roles/values for color and stroke fields, file targets, tabs, numeric inputs, toggles and icon buttons. Check dialog opening/closing focus, focus return, lazy-loading states and keyboard cancellation. Confirm behavior with a real screen reader, not DOM associations alone.
- **G3 Feedback:** invalid-layer selection, export/save progress, partial results and failures must be perceivable without color alone. Check live announcements without duplicates, disappearing unrelated errors or stolen focus.
- **G4 Layout and contrast:** measure light/dark text and control contrast under the applicable WCAG criteria. Exercise browser zoom/reflow, minimum desktop size and narrow browser viewports; record obscured controls, clipping and preview loss. Apply large-text/non-text exceptions explicitly rather than one blanket contrast threshold.

Evidence: keyboard steps, screenshots, accessibility-tree/control measurements and screen-reader observations. Starting suites: `tabstrip-a11y-dom`, `inspector-escape-dom`, `layerlist-dom`, `layerinspector-dom`, `settings-focus-dom`, `theme-contrast`. Revisit historical color-label findings on the audited revision before reopening them.

### H. Headless CLI — medium

- **H1 Contracts:** run the actual `npm run generate` entry point for inspect, single values file, batch, stdin, `--label`, variants, asset overrides, `--set`, PDF-only, PSD-only, all formats and documented legacy arguments. Verify names, payloads, geometry and outputs against equivalent app inputs; account for documented metadata/settings differences.
- **H2 Failure/exit behavior:** check exit 0 on success, 1 for rejected input/job and 2 for invalid argv. Put a bad job late in a batch: validation/read/build failure must happen before the first output write. Test output collisions and a real write failure separately; do not infer atomic rollback of filesystem failures from preflight guarantees.
- **H3 Validation-only:** `--check` must validate every job and write nothing, including when an output directory is supplied. Check missing files, invalid overrides/barcodes and glyph coverage. Then fully generate a corrupt/unsupported image: validation-only does not promise to decode it.
- **H4 Input boundaries:** verify relative paths from the invoking directory, optional field clearing, dormant values and the documented WebP restriction. Unsupported input must fail meaningfully instead of disappearing from output.

Evidence: exact argv/stdin/cwd, stdout/stderr, exit status and before/after output-directory listing. Starting suites: `generate`, `generate-cli`. Direct CLI executions are required in addition to tests.

### I. Performance and resource use — medium

- **I1 Baseline:** on F1 and F7 measure cold/warm startup, edit-to-paint, tab/variant switch, zoom, 3D activation and PDF/PSD export duration. Record workload, hardware, versions, warmup and individual samples; separate browser and native results.
- **I2 Lifecycle:** repeat asset replacement, tab open/close, 3D switching and exports; inspect retained memory and resource cleanup after settling. Record peak and retained memory, preview backing dimensions, long tasks and responsiveness. Distinguish normal caches from unbounded retention.
- **I3 Acceptance:** before measuring, the lead records operator-approved latency/memory limits and a matched reference workload in the result register. Existing explicit preview/resource caps remain hard constraints. Without agreed budgets, report measurements and reference deltas only; do not label an arbitrary time or bundle size acceptable. Any crash, exhausted resource or lost work also enters the relevant functional area.

Evidence: reproducible workload, raw samples and browser/native profiling captures. Starting suites for investigation: `bitmap-cache`, `object-urls-dom`, `canscene-dispose`; passing cleanup tests is not a performance measurement.

### J. Engineering health and supply chain — supporting

- **J1 Reproducibility:** run the commands below on the pinned source, retaining all output and exit statuses. Record unavailable prerequisites separately. Check release metadata without changing versions or publishing.
- **J2 Supply chain:** triage npm runtime and RustSec findings for affected version, reachability, impact and available fix. Record advisory warnings as well as failures. No known advisory does not mean no security defects; D4 and E4 remain separate trust-boundary reviews.
- **J3 Maintainability:** review high-risk paths for hidden failures, duplicated authoritative rules, renderer divergence and unsupported complexity using the repository principles. Preserve real guards. File length or an unreferenced boundary handler alone is not a defect.
- **J4 Documentation:** build the guide, then follow its open/save/export/CLI instructions against actual behavior. Build success cannot establish that instructions or printer claims are true.

Evidence: command logs, advisory triage, exact source references and walkthrough results. Use the existing test inventory to identify behavioral gaps; do not add tests merely to assert wiring, source text or incidental defaults.

## 5. Baseline and direct-run commands

These are planned commands, not results. From the repository root, in an isolated checkout with the pinned Node version and required native tooling:

```sh
npm ci
npx tsc --noEmit
npm run lint
npm test
npm run build
npx --yes knip@6.38.0
npm audit --omit=dev --audit-level=high
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
node scripts/check-release.mjs origin/main
npm ci --prefix docs-site
npm run types:check --prefix docs-site
npm run build --prefix docs-site
```

Run the Rust dependency audit from `src-tauri/` (requires cargo-audit):

```sh
cargo audit
```

Run cross-platform checks on each target OS as CI does. A local macOS build cannot prove Windows/Linux cfg paths or packaged workflows. An audit of an unmerged branch uses its actual PR base instead of `origin/main` for the release metadata gate. Attribute failures from unrelated existing changes rather than modifying them just to make this audit green.

For real-surface checks, launch these separately, not as part of the sequential baseline:

```sh
npm run dev
npm run desktop:dev
npm run desktop:build
```

Use the resulting disposable packaged app for E; development mode alone is insufficient. Use the actual CLI on manifest fixtures according to the CLI reference. For exact golden digests use the existing test inputs, not arbitrary CLI-generated files with different PDF metadata. For raster comparisons run `scripts/golden-diff.mts` using the procedure in `docs/goldens.md`.

Run each baseline check once and triage its result. Do not rerun a reported failure merely to confirm it. A targeted run after a specific correction or to investigate a distinct cause is new evidence and must be labeled accordingly.

## 6. Findings, verification and completion gates

### Finding record

Use `[principle-or-lens/severity high|med|low] file:line — defect — smallest fix`, following the repository severity anchors. Scenario priority determines audit order; it is not automatically finding severity. High severity includes correctness failures, lost work, unsafe file access or blocked build/test/shipping; distinguish localized inconvenience from system-wide risk.

Each finding must contain:

- Scenario/environment and fixture IDs, source revision and reproducible steps.
- Expected behavior with authority, actual behavior and user consequence.
- Direct evidence and exact source location when traced; label hypotheses as inference.
- Smallest proposed correction, affected callers/surfaces and a concrete verification scenario.
- Status, owner, and any prerequisite that blocks proof or correction.

Append confirmed new findings or status updates to the ledger without duplicating existing entries. Reproduce before fixing. Recheck the changed real surface afterward, and retain a deterministic regression test only when it catches a plausible consumer-visible bug. Never hide an unexplained print mismatch by updating a golden.

### Exit gates

The audit may be reported as **completed with outstanding findings or proof gaps**, but never as an unconditional application pass while they remain:

- Every A1–J4 scenario has an outcome for each applicable environment, with traceable evidence; blocked/not-run coverage stays visible in the final report.
- Baseline results are tied to the tested revision and environment. No inherited green stamps or unexercised platform claims.
- Work-preservation, print correctness, code payloads and containment failures are clearly escalated before release recommendation.
- Photoshop raster parity, physical scan/print approval, unavailable native platforms and real updater install/restart each have explicit proof or a named gap. Historical pending checks are not silently closed.
- Every finding is triaged as confirmed, disproved with evidence, or blocked with a named prerequisite. Fixes, if separately undertaken, have fresh verification on their resulting revision.
- The final report lists scope, environment/fixture manifest, scenario outcomes, severity-ranked findings, residual risks and release recommendation. No numeric coverage percentage substitutes for missing critical evidence.

The audit itself changes no installed binary. Documentation, results and ledger updates need no version bump or Unreleased entry. Any subsequent application fix must pass the [release-steward gate](../../.agents/release-steward.md); publishing or installing a release remains a separate authorized operation.
