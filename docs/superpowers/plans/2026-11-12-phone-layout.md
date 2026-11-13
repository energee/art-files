# Phone Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full Label Lab editor usable on a phone in the browser, with the same interface as the desktop, and publish the web build at `energ.ee/art-files/app/`.

**Architecture:** One component tree placed by size. A `usePhoneLayout()` hook over `matchMedia` tells the existing shell where the Layers sidebar and inspector sheet sit; no phone-only copies of any component. The web build rides in the same GitHub Pages deploy as the update feed, built by one reusable workflow.

**Tech Stack:** React, TypeScript, Tailwind v4, shadcn/ui on Base UI, Vite, vitest, GitHub Actions and Pages.

**Spec:** `docs/superpowers/specs/2026-11-12-phone-layout-design.md`

**Shape of this plan:** five phases, one PR each, a checkpoint with the user after each. **Phase 1 is planned to step level below.** Phases 2–5 are task outlines: their base (PR #773) has not landed and conflicts with `main`, so step-level detail written now would point at code that will move. Each gets its step-level plan at its checkpoint, written against the code as it then stands.

## Global Constraints

- The desktop layout at 1024px and wider, with a mouse, is unchanged. Compare screenshots at 1280×800 before and after every layout PR.
- Tap targets are at least 44px on touch screens (`@media (pointer: coarse)`). Text inputs are at least 16px on touch.
- Phone layout applies under 768px wide or under 500px tall. The inspector moves to the bottom only under 768px wide.
- The root font size stays 13px at every size; touch sizes are given in px.
- Nothing scrolls sideways at page level. The preview stays visible (at least 150px tall) while the inspector is open.
- No phone-only copy of the Layers list, inspector, menu or toolbar. No helper text explaining gestures.
- Layout changes are measured before and after (preview size, smallest tap target, page scroll width at 390×844 touch emulation), recorded in `.agents/ledger.md` with the branch tested.
- A broken web build must never hold back the update feed.
- Merging the Phase 1 PR approves public deployment of the web app at the next release. No release is cut, and no workflow is dispatched, without the user's explicit go-ahead at that time.
- Repo rules: no `git stash`; no Co-Authored-By; commit subjects `Feat:` / `Fix:` / `Docs:` / `Build:`; binary-impacting changes add bullets under `## [Unreleased]` in `CHANGELOG.md` without a version bump; run `npx tsc --noEmit`, `npm run lint`, `npm test`, `npx --yes knip@6.38.0` and `node scripts/check-release.mjs origin/main` before each PR.
- Worktrees live in `.agents/worktrees/<slug>/`; lock each one (`git worktree lock`) while in use. If `node_modules` is a symlink, remove the link and run `npm ci`; never `npm ci` through it.

## Review Focus

Conditions the spec implies that are most likely to bite someone, each pinned to the task that owns the code:

1. **The web build fails during a release.** The update feed must still publish and the run must show failed. Pinned in Task 1.2's test (`continue-on-error` on the download step, `!cancelled()` on the feed job).
2. **An older release's feed is republished.** The app must be built from that tag, not from whatever ref was dispatched. Pinned in Task 1.1's test (tag resolved, validated, checked out before the build).
3. **The phone is rotated, or the window resized across 768px, mid-edit.** Selection, an open text edit and undo history must survive the layout switch. Pinned in Phase 2, task 2.3 (test: flip the `matchMedia` mock while a layer is selected; the same layer stays selected and the inspector stays open).
4. **The on-screen keyboard opens over the bottom inspector.** The field being edited must stay visible. Pinned in Phase 2, task 2.3 (measured on a real phone at the checkpoint).
5. **A sidebar width saved on a desktop browser (`localStorage` `sidebar_width`, up to its maximum) is applied on a phone.** The overlay must never be wider than the screen. Pinned in Phase 2, task 2.2 (test: stored width 600 at a 390px viewport renders an overlay no wider than 85% of the viewport).

---

## Phase 1 — Publish the web build

Branch `build/web-app-pages` from `origin/main`, worktree `.agents/worktrees/web-app-pages`. No product code changes: a trial build this session (`vite build --base=/art-files/app/`) already produced correct paths for scripts, styles, icons and workers, and `src/three/canScene.ts` loads `Can.gltf` and `studio.hdr` through `import.meta.env.BASE_URL`. Output is 9.9MB.

Not binary-impacting (workflows, tests and docs only), so no `CHANGELOG.md` bullet; confirm with `check-release.mjs`.

**Merging this PR does not publish anything. The next release after it merges does, automatically.** Say so in the PR description and at the checkpoint.

### File structure

| File | Responsibility |
|---|---|
| `.github/workflows/web-app.yml` (create) | Reusable workflow: build the web app for one release tag, upload it as artifact `web-app` |
| `.github/workflows/release.yml` (modify) | Call `web-app.yml`; feed job adds the artifact to the site as `app/` |
| `.github/workflows/update-feed.yml` (modify) | Same two changes, in lockstep |
| `tests/web-app-publish.test.ts` (create) | Pins the three workflows' contract by reading their text |
| `README.md`, `docs-site` (modify) | Where the web app lives |

### Task 1.1: Reusable web build workflow

**Files:**
- Create: `.github/workflows/web-app.yml`
- Test: `tests/web-app-publish.test.ts`

**Interfaces:**
- Produces: a `workflow_call` workflow with one input, `tag` (string, optional, default `''`; blank means `label-lab-v<package.json version>` of the calling ref), and one job with id `build` that uploads an artifact named `web-app` whose root is the built `dist/`. The public base path is `/art-files/app/`.

- [ ] **Step 1: Write the failing test**

Follow the existing pattern in `tests/release-notes.test.ts` for reading repo files. Read the workflow as text.

```ts
// tests/web-app-publish.test.ts — the web app's publish contract (spec: phone layout, phase 1).
const read = (name: string) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

describe("web-app.yml", () => {
  const yml = read("web-app.yml");
  it("is reusable and takes an optional tag", () => {
    expect(yml).toMatch(/workflow_call:/);
    expect(yml).toMatch(/tag:/);
  });
  it("accepts only label-lab release tags", () => {
    expect(yml).toContain("^label-lab-v[0-9]+\\.[0-9]+\\.[0-9]+$");
  });
  it("checks out the tag before installing or building", () => {
    const at = (s: string) => { const i = yml.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    expect(at('git checkout "$tag"')).toBeLessThan(at("npm ci"));
    expect(at("npm ci")).toBeLessThan(at("npm run build -- --base=/art-files/app/"));
  });
  it("uploads dist as the web-app artifact", () => {
    expect(yml).toMatch(/name: web-app\b/);
    expect(yml).toMatch(/path: dist\b/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/web-app-publish.test.ts`
Expected: FAIL, `ENOENT … web-app.yml`.

- [ ] **Step 3: Write `.github/workflows/web-app.yml`**

Header comment: what it builds, that the feed workflows call it, and that the feed must survive its failure. One job `build` on `ubuntu-latest`, `permissions: contents: read`. Steps, in order:

1. `actions/checkout@v7` with `persist-credentials: false` (same pin as the other workflows).
2. Resolve and check out the tag, with the input passed through `env` (never interpolated into the script):

```bash
tag="${INPUT_TAG:-label-lab-v$(node -p 'require("./package.json").version')}"
if [[ ! "$tag" =~ ^label-lab-v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Not a label-lab release tag: $tag" >&2
  exit 1
fi
git fetch --depth 1 origin "refs/tags/$tag:refs/tags/$tag"
git checkout "$tag"
```

3. `actions/setup-node@v7` with `node-version-file: .nvmrc` and `cache: npm` (after the checkout of the tag, so the pin is the tag's).
4. `npm ci`
5. `npm run build -- --base=/art-files/app/`
6. `actions/upload-artifact` (the major version already used in `release.yml`) with `name: web-app`, `path: dist`, `if-no-files-found: error`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/web-app-publish.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/web-app.yml tests/web-app-publish.test.ts
git commit -m "Build: Add a reusable workflow that builds the web app for a release tag"
```

### Task 1.2: Publish the app with the update feed, in both workflows

**Files:**
- Modify: `.github/workflows/release.yml` (the comment at 215–227 and the `publish-update-feed` job, 228–284)
- Modify: `.github/workflows/update-feed.yml` (the `publish-update-feed` job)
- Test: `tests/web-app-publish.test.ts`

**Interfaces:**
- Consumes: `web-app.yml`, input `tag`, artifact `web-app` (Task 1.1).
- Produces: the Pages site gains `app/` beside `latest.json`.

- [ ] **Step 1: Add the failing tests**

```ts
describe.each(["release.yml", "update-feed.yml"])("%s", (name) => {
  const yml = read(name);
  it("builds the web app through the reusable workflow", () => {
    expect(yml).toContain("uses: ./.github/workflows/web-app.yml");
  });
  it("still publishes the feed when the web build fails", () => {
    expect(yml).toMatch(/publish-update-feed:[\s\S]*?needs:[^\n]*web-app/);
    expect(yml).toMatch(/publish-update-feed:[\s\S]*?if: \$\{\{ !cancelled\(\)/);
    expect(yml).toMatch(/name: web-app\n\s+path: site\/app/);
    expect(yml).toMatch(/Add the web app[\s\S]{0,200}continue-on-error: true/);
  });
  it("adds the app before the Pages artifact is uploaded", () => {
    expect(yml.indexOf("path: site/app")).toBeLessThan(yml.indexOf("upload-pages-artifact"));
  });
});
it("release.yml no longer calls the repo private", () => {
  expect(read("release.yml")).not.toMatch(/repo is private|unguessable/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/web-app-publish.test.ts`
Expected: the new tests FAIL; Task 1.1's tests still pass.

- [ ] **Step 3: Edit `release.yml`**

- Add a job `web-app` that `uses: ./.github/workflows/web-app.yml`, with `needs: [version, release]` and `if: ${{ !cancelled() && needs.version.outputs.unreleased == 'true' }}` (the tag exists only once a release leg has published), passing no `tag`.
- `publish-update-feed`: `needs: [version, release, web-app]`; its `if` is unchanged.
- After the "Build latest.json" step and before `upload-pages-artifact`, add a step named `Add the web app` using `actions/download-artifact` (the major version that pairs with the upload action) with `name: web-app`, `path: site/app`, and `continue-on-error: true`. Comment it: the feed outranks the web app; a failed build publishes the feed without `app/` and the run shows failed through the `web-app` job.
- Rewrite the job's leading comment: the repo is public; the feed lives on Pages because that is the URL shipped in `src-tauri/tauri.release.conf.json`; the web app is published beside it at `/art-files/app/`. Keep the #106 paragraph.

- [ ] **Step 4: Edit `update-feed.yml` the same way**

- Job `web-app` `uses: ./.github/workflows/web-app.yml` with `tag: ${{ inputs.tag }}`.
- `publish-update-feed`: add `needs: [web-app]` and `if: ${{ !cancelled() }}`; add the same `Add the web app` step in the same position.
- Extend the header comment's "Keep the steps in lockstep with release.yml" line to name the web app step.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/web-app-publish.test.ts`
Expected: PASS (every test in the file).

- [ ] **Step 6: Lint the workflows**

Run: `npx --yes actionlint` if available on the machine, otherwise `gh workflow view web-app.yml` after pushing the branch.
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/release.yml .github/workflows/update-feed.yml tests/web-app-publish.test.ts
git commit -m "Build: Publish the web app beside the update feed on Pages"
```

### Task 1.3: Prove the build works under the base path, and document the URL

**Files:**
- Modify: `README.md`, and the docs-site page that describes installing or opening Label Lab (find it with `grep -rn "Download\|install" docs-site/content`)
- Modify: `.agents/ledger.md`

- [ ] **Step 1: Build and serve at the real base**

```bash
npm run build -- --base=/art-files/app/
npx vite preview --base=/art-files/app/ --port 4173
```

- [ ] **Step 2: Measure in Chrome at `http://localhost:4173/art-files/app/`**

Record in `.agents/ledger.md` (branch, date): the Starter master renders; every network request returns 200 (list any that do not); both workers start (edit a layer's text and export a PDF); the Can view renders (`Can.gltf`, `studio.hdr`, `buffer.bin` all 200); the tab icon loads. Expected: no 404s. If anything fails, stop and report it before changing product code: that would be a new finding the spec does not cover.

- [ ] **Step 3: Document the URL**

One sentence in `README.md` and one in the docs-site page: Label Lab also runs in a browser at `https://energ.ee/art-files/app/`, updated with each release. No other copy.

- [ ] **Step 4: Run the full checks**

```bash
npx tsc --noEmit && npm run lint && npm test && npx --yes knip@6.38.0 && node scripts/check-release.mjs origin/main
```
Expected: all pass. If `check-release.mjs` asks for a changelog bullet, add one under `## [Unreleased]` → `### Added`: "**Label Lab on the web.** The editor is published at energ.ee/art-files/app/ with each release."

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add README.md docs-site .agents/ledger.md
git commit -m "Docs: Say where the web app lives"
git push -u origin build/web-app-pages
gh pr create --base main --title "Build: Publish the web app beside the update feed on Pages" --body "<what, the measured results, and: merging publishes nothing; the next release publishes the app publicly>"
```

### Phase 1 checkpoint

Stop. Report: PR link, CI status, the measured results, and that the app goes public at the next release. Ask the user two things: whether to merge, and whether to publish before the next release by dispatching `update-feed.yml` for the current release tag (that tag predates this PR, so its build is the desktop-only layout; the phone shell arrives with a later release). Do neither without an answer. Open PR #800 fixes a crash in browsers that block storage, so republishing the 0.1.119 feed before that fix ships would publish a web app with a known crash.

---

## Phase 2 — The phone shell (outline)

Base: `main` after #773 lands. Branch `feat/phone-shell`. Record the baseline measurements at 390×844 and the 1280×800 screenshots before the first change.

| Task | Files | Test (written first) | Deliverable |
|---|---|---|---|
| 2.1 Layout hook | Create `src/usePhoneLayout.ts` | `tests/phone-layout.test.ts` | `usePhoneLayout(): { phone: boolean; narrow: boolean }` via `useSyncExternalStore`. `phone` = `(max-width: 767px), (max-height: 499px)`; `narrow` = `(max-width: 767px)`. Tests mock `matchMedia` and assert both flags at 390×844, 844×390, 768×1024, 1280×800, and that a change event re-renders. |
| 2.2 Layers overlay | `src/components/ui/sidebar.tsx`, `src/App.tsx` (shell) | `tests/phone-shell-dom.test.tsx` | `Sidebar` gains `overlay?: boolean`: no layout width, backdrop, no resize rail, width capped at 85% of the viewport. On `phone`: starts closed, closes on layer tap and backdrop tap. Covers Review Focus 5. |
| 2.3 Inspector placement | `src/App.tsx` (sheet and pane margin) | same file | `narrow` → `side="bottom"`, height `45svh`, pane reserves bottom margin instead of `mr-[300px]`; landscape phone keeps `side="right"`. Preview at least 150px tall. Covers Review Focus 3 and 4. |
| 2.4 Header | `src/components/AppMenu.tsx`, `src/App.tsx` (header) | `tests/phone-shell-dom.test.tsx` | On `phone`, the same menu commands render under one ☰ button as submenus; undo and redo buttons call the existing commands. Tests assert every desktop menu command is reachable. |
| 2.5 Touch sizing | `src/index.css` (`@custom-variant touch (@media (pointer: coarse))`), shared controls, toolbar | measured, not unit-tested | 44px targets and 16px inputs on touch; Lighting and Curve sliders wrap to a second row. |
| 2.6 Measure and document | `.agents/ledger.md`, `docs-site`, `CHANGELOG.md` | — | Before/after numbers, 1280×800 screenshots identical, docs page, `[Unreleased]` bullet. |

Order: 2.1 first; 2.2, 2.3 and 2.4 depend on it and all touch `App.tsx`, so run them one after another; 2.5 after them; 2.6 last. Checkpoint: user runs the shell on a real phone via `npm run dev -- --host`.

## Phase 3 — Touch gestures on the canvas (outline)

| Task | Files | Test (written first) | Deliverable |
|---|---|---|---|
| 3.1 Pinch math | `src/useZoomPan.ts` | `tests/zoom-pan-pinch.test.ts` | A pure function that takes the current view and the previous and current positions of two pointers and returns the new view, zooming about their midpoint and clamped like the wheel path. |
| 3.2 Finger pan and pinch wiring | `src/useZoomPan.ts`, `src/App.tsx` (pane handlers) | DOM test with synthetic touch pointer events | One finger on empty pasteboard pans; two fingers pinch; the pane sets `touch-action: none`. Mouse behaviour (wheel, right-drag) unchanged. |
| 3.3 Resize handles | `src/components/previewOverlay.ts` | existing overlay tests extended | 44px hit area on touch without visual growth. |
| 3.4 Double-tap to edit | `src/components/PreviewCompare.tsx` | DOM test | Two taps on the same text layer within 300ms start in-place editing, only if `dblclick` proves unreliable on a real phone (check first). |
| 3.5 Can view | `src/components/CanView.tsx`, `src/three/canScene.ts` | measured on a real phone | Orbit, zoom and pan by touch; fix only what fails. |

## Phase 4 — Touch paths for hover, right-click, double-click and keyboard actions (outline)

Starts with a mockup of multi-select selection mode for the user to approve.

| Task | Files | Test (written first) | Deliverable |
|---|---|---|---|
| 4.1 Hover reveals | `LayerInspectorControls.tsx`, `Rulers.tsx`, `MetallicToggle.tsx` | DOM class assertions | Always visible under `@media (hover: none)`. Inactive tabs' close button is left alone. |
| 4.2 Row menu on touch | `LayerList.tsx` | measured on a real phone, then DOM test | Long-press opens the row menu. If it fights drag-reorder, a ⋯ button on touch opens it instead. |
| 4.3 Rename | `LayerList.tsx` | DOM test | A Rename item in the row menu starts the existing rename. |
| 4.4 Multi-select | `LayerList.tsx`, `App.tsx` (selection) | DOM test | As approved in the mockup. Default proposal: a Select item turns on tap-to-toggle until the selection is cleared. |
| 4.5 Suggestion taps | `TextEditor.tsx:498, 678, 686` | existing TextEditor tests extended with pointer events | `onMouseDown` → `onPointerDown`. |

## Phase 5 — Open, save and export on a phone (outline)

| Task | Files | Test (written first) | Deliverable |
|---|---|---|---|
| 5.1 Open | `src/filePickers.ts`, `src/files.ts`, the inputs in `App.tsx` and `TabsShell.tsx` | unit test of the picker options on touch | `.master` and `.label` can be picked on iOS Safari and Android Chrome; drop `accept` on touch if iOS greys the files out. |
| 5.2 Save and export | `src/assets/io.ts`, `src/useProjectSave.ts` | measured on real phones | Save Label, Save Master, PDF and PSD arrive as downloads. Fix only what fails. |
| 5.3 Tap to choose | `FileDrop.tsx`, `AssetDropOverlay.tsx`, `TabsShell.tsx` | DOM test | Every drop target also opens a file picker on tap. |

Final checkpoint: the spec's done list, end to end, at 390×844 with touch emulation and on a real phone.
