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

## Phase 2 — The phone shell

Branch `feat/phone-shell`, worktree `.agents/worktrees/web-app-pages` (already created, stacked on `build/web-app-pages`, with PR #773's branch `feat/multi-layer-edit` merged in). Line numbers below are as of `188666f4`; re-find each by the quoted code if it has moved.

Binary-impacting (`src/` changes), so Task 2.7 adds `CHANGELOG.md` bullets. `check-release.mjs` runs against the stack parent, `build/web-app-pages`, not `origin/main`. Review Focus 3 and 4 (pinned above to outline task 2.3) are tested in Task 2.5; Review Focus 5 (outline task 2.2) in Task 2.3. Tasks 2.3 to 2.6 all edit `src/App.tsx`: run them one after another, in order. Task 2.2 must land before them. Nothing here runs in the Tauri app, whose window is at least 1024×700 (`src-tauri/tauri.conf.json`), so `phone` is always false there.

Found while planning (these shape the tasks):
- No size helper exists (`matchMedia`, `useIsMobile`, `innerWidth` breakpoints: none in `src/`). The repo's store-hook pattern is `useSyncExternalStore` (`src/theme.ts`, `src/settings.ts`); the new hook follows it.
- happy-dom 21.0.4 evaluates real media queries against its viewport and fires `change` on `window.happyDOM.setViewport()`, but returns **false** for a comma list such as `(max-width: 767px), (max-height: 499px)` at 390×844 (checked this session). Single queries work.
- The browser build has four menus: File, Edit, Layer, View. Help exists only in the native desktop menu (`AppMenu.tsx:680`), so the ☰ holds those four.
- `SIDEBAR_MAX_WIDTH` is 520 (`sidebar.tsx:21`); a stored width above it is already ignored, so Review Focus 5's worst case is 520, not 600.
- Popups (row menu, Add layer, Select, the inspector Sheet) portal at `z-50`; the rulers sit at `z-30` (`Rulers.tsx:333`).
- A drag-reorder's trailing click is swallowed in capture (`LayerList.tsx:471–473`), and the row's own controls stop propagation, so a click that reaches `SidebarContent` is a row pick.

### File structure

| File | Responsibility |
|---|---|
| `src/usePhoneLayout.ts` (create) | `usePhoneLayout()`: `phone` and `narrow` from two `matchMedia` queries |
| `src/components/ui/sidebar.tsx` (modify) | `Sidebar` `overlay` prop: no layout width, no resize handle, a backdrop, width capped |
| `src/components/AppMenu.tsx` (modify) | On a phone, the web menubar folds into one ☰ menu holding the same menus |
| `src/App.tsx` (modify) | Shell: Layers starts closed and closes on pick; header undo/redo; inspector side and pane margin; toolbar wrap and touch sizes |
| `src/index.css` (modify) | `touch:` variant; `--spacing-tap` and `--text-tap` tokens |
| `src/components/ui/*.tsx`, `src/TabsShell.tsx`, other control sites (modify) | Touch sizes, driven by measurement |
| `src/locales/{en,de,es,fr,pt}.ts` (modify) | One key, "Menu" |
| `tests/viewport.ts` (create) | `setViewport(width, height)` for happy-dom suites |
| `tests/phone-layout-dom.test.tsx` (create) | The hook's flags at each size |
| `tests/phone-shell-dom.test.tsx` (create) | The shell's phone behaviour in a real `DocumentEditor` |
| `tests/appmenu-dom.test.tsx` (modify) | The ☰ fold |
| `.agents/ledger.md`, `docs-site/content/docs/workspace.mdx`, `CHANGELOG.md` (modify) | Measurements, docs, release notes |

### Task 2.1: Record the baseline before any change

**Files:**
- Modify: `.agents/ledger.md` (append entry `## 2026-11-12 phone-shell`)
- Create (gitignored, not committed): `.agents/mockups/phone-shell/before-*.png`

**Interfaces:**
- Produces: the measurement procedure below (Task 2.7 repeats it exactly), the baseline numbers in the ledger, and four baseline screenshots.

Planner's call: screenshots live in `.agents/mockups/phone-shell/`, already gitignored and kept across tasks in this worktree; they are evidence, not source.
Planner's call: each desktop screenshot is taken twice, so the baseline's own pixel noise is known before anything is compared against it.

- [ ] **Step 1: Start the dev server**

Run (background): `npm run dev -- --port 5181 --strictPort` (5173 belongs to another session). If 5181 is busy, use the next free port and record it. App URL: `http://localhost:5181/`.

- [ ] **Step 2: The measurement procedure**

Use the chrome-devtools MCP tools (`new_page`, `emulate`, `navigate_page`, `evaluate_script`, `take_screenshot`). Every measurement starts the same way:

1. `emulate` with `colorScheme: "light"` and the viewport for the state: phone `390x844x3,mobile,touch`; desktop `1280x800x1` (no mobile, no touch). Other sizes, when a later task names them, use the same form with `mobile,touch`.
2. `evaluate_script`: `() => { localStorage.clear(); }`, then `navigate_page` to the app URL (reload).
3. Wait for the label to render: `evaluate_script` with

```js
async () => {
  await document.fonts.ready;
  for (let i = 0; i < 100 && document.body.textContent.includes("rendering label"); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 500));
  return !document.body.textContent.includes("rendering label");
}
```

   Expected: `true`.
4. Put the app in the named state with `evaluate_script` (clicks done in script, not by the tool, so no pointer is left hovering):
   - **fresh**: nothing.
   - **selected**: `() => { if (document.querySelector('[data-slot="sidebar"]').dataset.state === "collapsed") document.querySelector('[data-slot="sidebar-trigger"]').click(); document.querySelector('[data-layer-id] [data-slot="sidebar-menu-button"]').click(); }` (the first row of the Layers list), then wait 500ms.
   - **menu**: before Task 2.4, click the `[data-slot="menubar-trigger"]` whose text is `File`; after it, click the ☰ trigger, then the `[data-slot="menubar-sub-trigger"]` whose text is `File`. Wait 300ms.
5. Run the measure script and paste its JSON into the ledger:

```js
() => {
  const shown = (el) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
      && s.visibility !== "hidden" && s.opacity !== "0" && !el.closest("[inert], [aria-hidden=true]");
  };
  const size = (el) => { const r = el?.getBoundingClientRect(); return r ? `${Math.round(r.width)}x${Math.round(r.height)}` : null; };
  const CONTROLS = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=switch], [role=checkbox], [role=combobox], [role=slider]";
  // A control inside a <label> is tapped through the whole label.
  const targets = [...document.querySelectorAll(CONTROLS)].filter(shown).map((el) => {
    const r = (el.closest("label") ?? el).getBoundingClientRect();
    return { px: Math.round(Math.min(r.width, r.height)), what: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 30) || el.outerHTML.slice(0, 60) };
  }).sort((a, b) => a.px - b.px);
  const fonts = [...document.querySelectorAll("input:not([type=hidden]):not([type=range]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]")]
    .filter(shown).map((el) => parseFloat(getComputedStyle(el).fontSize));
  const small = targets.filter((t) => t.px < 44);
  return {
    viewport: `${innerWidth}x${innerHeight}`,
    preview: size(document.querySelector('[data-slot="label-sheet"]')),
    pane: size(document.querySelector('[data-slot="sidebar-inset"] section > div')),
    layers: size(document.querySelector('[data-slot="sidebar-container"]')),
    layersState: document.querySelector('[data-slot="sidebar"]')?.dataset.state,
    inspectorSide: document.querySelector('[data-slot="sheet-content"]')?.dataset.side ?? null,
    pageScroll: `${document.documentElement.scrollWidth}/${document.documentElement.clientWidth}`,
    smallestTarget: targets[0], under44: small.length, under44List: small.slice(0, 15),
    smallestFieldFont: fonts.length ? Math.min(...fonts) : null,
  };
}
```

6. Screenshots: `take_screenshot` of the viewport, PNG, to the path the step names.

- [ ] **Step 3: Measure the phone baseline**

At 390×844 phone: states **fresh**, **selected**, **menu**, one measure each.
Record the numbers as they are. For reference, the spec measured Layers at 256px, the preview at 111×69 and every control under 40px.

- [ ] **Step 4: Take the desktop screenshots**

At 1280×800 desktop: **fresh** to `.agents/mockups/phone-shell/before-fresh.png` and `before-fresh-2.png`; **selected** to `before-selected.png` and `before-selected-2.png` (each pair: two separate runs of the whole procedure). Compare each pair with the script in Task 2.7 Step 3. Expected: 0 differing pixels. If not 0, record the count: it is the noise floor Task 2.7 compares against.

- [ ] **Step 5: Record and commit**

Append to `.agents/ledger.md`, in the format of the `2026-11-12 web-app-base-path` entry: `finding: [user request] phone shell (phone layout plan, Phase 2)`, `status: in-progress`, `attempted-in: .agents/worktrees/web-app-pages @ feat/phone-shell, measured at <git rev-parse --short HEAD>`, `delta: baseline`, then the three JSON results and the screenshot pair results.

```bash
git add .agents/ledger.md
git commit -m "Docs: Record the phone shell baseline measurements"
```

### Task 2.2: `usePhoneLayout()`

**Files:**
- Create: `src/usePhoneLayout.ts`
- Create: `tests/viewport.ts`
- Test: `tests/phone-layout-dom.test.tsx` (create)

**Interfaces:**
- Produces: `export function usePhoneLayout(): { phone: boolean; narrow: boolean }` in `src/usePhoneLayout.ts`. `narrow` is true under 768px wide; `phone` is true under 768px wide or under 500px tall.
- Produces: `export function setViewport(width: number, height: number): void` in `tests/viewport.ts`. Call it inside `act()` when components are mounted. happy-dom's default viewport is 1024×768; suites reset to it in `afterEach`.

Planner's call: two single queries, `(max-width: 767px)` and `(max-height: 499px)`, combined in JS rather than one comma list: happy-dom cannot evaluate the list, and `narrow` needs the width query on its own anyway.
Planner's call: tests drive happy-dom's real `matchMedia` through `setViewport`; no `matchMedia` mock. The file ends `-dom.test.tsx` because it renders React (conventions.md).

- [ ] **Step 1: Write `tests/viewport.ts` and the failing test**

```ts
// tests/viewport.ts — resize happy-dom's window. Its matchMedia lists
// re-evaluate against the new size and fire "change", as a browser's do.
export function setViewport(width: number, height: number): void {
  (window as unknown as { happyDOM: { setViewport(size: { width: number; height: number }): void } })
    .happyDOM.setViewport({ width, height });
}
```

```tsx
// tests/phone-layout-dom.test.tsx — usePhoneLayout's two flags at the sizes the
// spec names (phone layout, phase 2).
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { usePhoneLayout } from "../src/usePhoneLayout";
import { setViewport } from "./viewport";

let seen: { phone: boolean; narrow: boolean };
let root: Root;
const Probe = () => { seen = usePhoneLayout(); return null; };

beforeEach(() => { setViewport(1280, 800); root = createRoot(document.createElement("div")); act(() => root.render(createElement(Probe))); });
afterEach(() => { act(() => root.unmount()); setViewport(1024, 768); });

it.each([
  [390, 844, true, true],    // phone, upright
  [844, 390, true, false],   // phone, sideways: Layers overlays, inspector stays right
  [767, 1024, true, true],
  [768, 1024, false, false], // tablet: desktop layout
  [1280, 800, false, false],
  [1280, 499, true, false],
  [1280, 500, false, false],
])("at %ix%i phone is %s and narrow is %s", (width, height, phone, narrow) => {
  act(() => setViewport(width, height));
  expect(seen).toEqual({ phone, narrow });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/phone-layout-dom.test.tsx`
Expected: FAIL, cannot resolve `../src/usePhoneLayout`.

- [ ] **Step 3: Write `src/usePhoneLayout.ts`**

Module comment: what the two flags mean, the two thresholds and why the sideways phone counts (spec, Phase 2), and that the Tauri window's minimum size keeps both false there. Body:

```ts
const NARROW = "(max-width: 767px)";
const SHORT = "(max-height: 499px)";

/** Whether `query` matches now; re-renders when it starts or stops matching. */
function useMedia(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export function usePhoneLayout(): { phone: boolean; narrow: boolean } {
  const narrow = useMedia(NARROW);
  const short = useMedia(SHORT);
  return { phone: narrow || short, narrow };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/phone-layout-dom.test.tsx`
Expected: PASS (7 tests). Then `npx tsc --noEmit`: clean.

- [ ] **Step 5: Commit**

```bash
git add src/usePhoneLayout.ts tests/viewport.ts tests/phone-layout-dom.test.tsx
git commit -m "Feat: Add usePhoneLayout, which says when the editor is on a phone"
```

### Task 2.3: Layers slides over the preview on a phone

**Files:**
- Modify: `src/components/ui/sidebar.tsx` (`Sidebar`, 150–165)
- Modify: `src/App.tsx` (before 431 `const [sidebarOpen, setSidebarOpen] = useState(true);`; 2466 `<Sidebar>`; the `SidebarContent` `onClick` at 2475–2478)
- Test: `tests/phone-shell-dom.test.tsx` (create)

**Interfaces:**
- Consumes: `usePhoneLayout()` (Task 2.2), `setViewport` (Task 2.2).
- Produces: `function Sidebar({ overlay = false, className, children, ...props }: React.ComponentProps<"div"> & { overlay?: boolean })`. With `overlay`: no `[data-slot="sidebar-gap"]` and no `[data-slot="sidebar-resize-handle"]` are rendered; while open, a `<div data-slot="sidebar-backdrop" aria-hidden="true">` (fixed, `inset-0`, `z-40`, `bg-black/30`) renders before the container and calls `setOpen(false)` on click; the container gains `z-40 max-w-[85vw]`. Without `overlay`, the output is unchanged.
- Produces in `DocumentEditor`: `const { phone, narrow } = usePhoneLayout();` declared once, just before the `sidebarOpen` state, for Tasks 2.4–2.6 to read.

Planner's call: Layers closes from `SidebarContent`'s existing click handler (when `phone` and the target is inside `[data-layer-id]`), not from `onSelect`. `onSelect` also runs on a row's `contextmenu`, which is a long-press on touch; closing there would hide the row menu's anchor (Phase 4). Drag-reorder's trailing click never reaches the handler.
Planner's call: the overlay sits at `z-40`: over the rulers (`z-30`), under everything that portals at `z-50`, so the row menu and Add layer menu still open above it. With a layer selected on an upright phone, the inspector stays on top and Layers shows above it.
Planner's call: Layers keeps its open state when the window crosses the breakpoint; only its first value depends on size (`useState(!phone)`). No effect syncing the two.
Planner's call: Review Focus 5 is tested with a stored 520 (the maximum the provider accepts); its real width is measured in Task 2.7.

- [ ] **Step 1: Write the failing tests**

Mount exactly as `tests/inspector-escape-dom.test.tsx` does (same `vi.mock` lines for `starterLayers`, `PreviewCompare`, `CanView`, `Rulers`, `fonts`; same `DocumentEditor` props), with a `mount(width, height)` that calls `setViewport` before rendering, and an `afterEach` that unmounts, removes the container, runs `localStorage.clear()` and `setViewport(1024, 768)`. Helpers:

```tsx
const sidebar = () => container.querySelector('[data-slot="sidebar"]')!;
const slot = (name: string) => container.querySelector(`[data-slot="${name}"]`);
const rowButton = (id = "barcode") =>
  container.querySelector(`[data-layer-id="${id}"] [data-slot="sidebar-menu-button"]`) as HTMLButtonElement;
const tap = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
const openLayers = () => tap(slot("sidebar-trigger"));
```

```tsx
it("starts with Layers closed on a phone", async () => {
  await mount(390, 844);
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

it("starts with Layers open on a desktop", async () => {
  await mount(1280, 800);
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

it("on a phone, Layers overlays the preview with a backdrop and no resize handle", async () => {
  await mount(390, 844);
  await openLayers();
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
  expect(slot("sidebar-gap")).toBeNull();
  expect(slot("sidebar-resize-handle")).toBeNull();
  expect(slot("sidebar-backdrop")).not.toBeNull();
});

it("tapping a layer on a phone selects it, opens the inspector and closes Layers", async () => {
  await mount(390, 844);
  await openLayers();
  await tap(rowButton());
  expect(rowButton().getAttribute("data-active")).not.toBeNull();
  expect(document.querySelector("#barcode-content")).not.toBeNull();
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
});

it("a long-press (contextmenu) on a row keeps Layers open", async () => {
  await mount(390, 844);
  await openLayers();
  await act(async () => { rowButton().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

it("tapping the backdrop closes Layers", async () => {
  await mount(390, 844);
  await openLayers();
  await tap(slot("sidebar-backdrop"));
  expect(sidebar().getAttribute("data-state")).toBe("collapsed");
  expect(slot("sidebar-backdrop")).toBeNull();
});

it("keeps a desktop's Layers beside the preview, resizable, and open after a pick", async () => {
  await mount(1280, 800);
  expect(slot("sidebar-gap")).not.toBeNull();
  expect(slot("sidebar-resize-handle")).not.toBeNull();
  expect(slot("sidebar-backdrop")).toBeNull();
  await tap(rowButton());
  expect(sidebar().getAttribute("data-state")).toBe("expanded");
});

// Review Focus 5: a width saved on a desktop browser never makes the overlay wider than the phone.
it("caps the overlay at 85% of the screen whatever width was saved", async () => {
  localStorage.setItem("sidebar_width", "520");
  await mount(390, 844);
  await openLayers();
  expect(slot("sidebar-container")!.className).toContain("max-w-[85vw]");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/phone-shell-dom.test.tsx`
Expected: the desktop test passes; every phone test FAILs (Layers starts expanded; no backdrop).

- [ ] **Step 3: Implement**

- `sidebar.tsx`: add `overlay` to `Sidebar` as in Interfaces; read `open` and `setOpen` from `useSidebar()`. One-line comment on `overlay`: what it changes, and that `App.tsx` sets it on a phone.
- `App.tsx`: add the hook call; `useState(true)` → `useState(!phone)`; `<Sidebar overlay={phone}>`; in the `SidebarContent` `onClick`, after the existing deselect check, `if (phone && target instanceof Element && target.closest("[data-layer-id]")) setSidebarOpen(false);` with a one-line comment saying why it is here and not in `onSelect`. Update the "Figma-style three-region shell" comment at 2463 to say Layers overlays on a phone.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/phone-shell-dom.test.tsx tests/sidebar-hotkey-dom.test.tsx tests/inspector-escape-dom.test.tsx`
Expected: PASS. Then `npx tsc --noEmit && npm run lint`: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/sidebar.tsx src/App.tsx tests/phone-shell-dom.test.tsx
git commit -m "Feat: On a phone, Layers slides over the preview and closes when you pick a layer"
```

### Task 2.4: The phone header: ☰, undo and redo

**Files:**
- Modify: `src/components/AppMenu.tsx` (`WebMenu`, 339–352; the lucide import at 12–17)
- Modify: `src/App.tsx` (header, 2507–2531)
- Modify: `src/locales/en.ts`, `de.ts`, `es.ts`, `fr.ts`, `pt.ts` (one key)
- Test: `tests/appmenu-dom.test.tsx` (modify), `tests/phone-shell-dom.test.tsx` (modify)

**Interfaces:**
- Consumes: `usePhoneLayout()` (Task 2.2); `byId(id: string): Command` in `DocumentEditor` (`App.tsx:2243`), with the existing `undo` and `redo` commands (`App.tsx:2187–2188`, each `{ label, disabled, run }`).
- Produces: on a phone, `WebMenu` renders one `Menubar` with one `MenubarMenu` whose `MenubarTrigger` holds `<MenuIcon />` and `<span className="sr-only">{t("Menu")}</span>`, and whose `MenubarContent` (`align="start"`, `className={MENU_ITEMS}`) is `<WebEntries entries={props.menus} … />`. Each top-level menu is a `SubmenuEntry`, so `WebEntries` already renders it as a `MenubarSub` with every row as on the desktop. On a desktop, `WebMenu` is unchanged. No new prop: `WebMenu` calls `usePhoneLayout()` itself.
- Produces: in the header, only when `phone`, after the status span and the hidden file input: `<div className="ml-auto flex items-center gap-1">` holding two `Button`s, `variant="ghost" size="icon-sm" className="size-6"` (the `SidebarTrigger`'s sizing), `aria-label={byId("undo").label}` / `byId("redo").label`, `disabled={…disabled}`, `onClick={…run}`, icons `Undo2` / `Redo2` from `lucide-react` (the menu already uses them).

Planner's call: the ☰ trigger names itself with sr-only text like `SidebarTrigger` does, so the existing `openMenu(container, name)` test helper finds it by text. New key `"Menu"`: en "Menu", de "Menü", es "Menú", fr "Menu", pt "Menu".
Planner's call: the fold follows `phone`, so a sideways phone gets ☰ too; the header has no room for four menus beside the new buttons at 390px tall either way.

- [ ] **Step 1: Write the failing tests**

In `tests/appmenu-dom.test.tsx`: move the event loop in `openMenu` into `async function press(el: HTMLElement)` and have `openMenu` call it (behaviour unchanged). Import `setViewport` from `./viewport`; reset to 1024×768 in an `afterEach`. Then:

```tsx
it("folds File, Edit, Layer and View into one ☰ menu on a phone", async () => {
  const desktop = await renderMenu();
  const titles = [...desktop.container.querySelectorAll("[data-slot=menubar-trigger]")].map((el) => el.textContent);
  expect(titles).toEqual(["File", "Edit", "Layer", "View"]);
  await act(async () => { desktop.root.unmount(); });
  desktop.container.remove();

  setViewport(390, 844);
  const { container, root } = await renderMenu();
  try {
    expect(container.querySelectorAll("[data-slot=menubar-trigger]")).toHaveLength(1);
    await openMenu(container, "Menu");
    const subs = [...document.querySelectorAll("[data-slot=menubar-sub-trigger]")];
    expect(subs.map((el) => el.textContent)).toEqual(titles);
    await press(subs.find((el) => el.textContent === "Edit") as HTMLElement);
    expect(menuItem("Undo")).toBeTruthy();
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
```

If the sub-trigger does not open on `press` in happy-dom, focus it and dispatch `ArrowRight` instead; do not weaken the assertions.

In `tests/phone-shell-dom.test.tsx`:

```tsx
const headerButton = (name: string) => container.querySelector(`header button[aria-label="${name}"]`) as HTMLButtonElement | null;
const power = () => container.querySelector('[data-layer-id="collabLead"] button[aria-label$=": enabled"]') as HTMLButtonElement;

it("gives a phone header Undo and Redo buttons that run the history", async () => {
  await mount(390, 844);
  expect(headerButton("Undo")!.disabled).toBe(true);
  await openLayers();
  await tap(power());
  expect(power().getAttribute("aria-pressed")).toBe("true");
  await tap(headerButton("Undo"));
  expect(power().getAttribute("aria-pressed")).toBe("false");
  await tap(headerButton("Redo"));
  expect(power().getAttribute("aria-pressed")).toBe("true");
});

it("keeps undo and redo out of a desktop header", async () => {
  await mount(1280, 800);
  expect(headerButton("Undo")).toBeNull();
  expect(headerButton("Redo")).toBeNull();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/appmenu-dom.test.tsx tests/phone-shell-dom.test.tsx`
Expected: the ☰ test FAILs (four triggers at 390px); the phone undo test FAILs (no header button); the rest pass.

- [ ] **Step 3: Implement**

`WebMenu` and the header as in Interfaces; the locale key in all five files, placed alphabetically as neighbours are. Comment in `WebMenu`: on a phone the same menus fold under one trigger (spec, The layout, item 3).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/appmenu-dom.test.tsx tests/appmenu-native-checks-dom.test.tsx tests/phone-shell-dom.test.tsx tests/i18n.test.ts`
Expected: PASS. Then `npx tsc --noEmit && npm run lint`: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppMenu.tsx src/App.tsx src/locales tests/appmenu-dom.test.tsx tests/phone-shell-dom.test.tsx
git commit -m "Feat: On a phone, the menus fold under one button and the header gets Undo and Redo"
```

### Task 2.5: The inspector rises from the bottom on an upright phone

**Files:**
- Modify: `src/App.tsx` (pane class, 2545–2548, and its comment 2538–2544; `SheetContent`, 2747 and its `className` at 2759 and the comment at 2755–2758)
- Test: `tests/phone-shell-dom.test.tsx` (modify)

**Interfaces:**
- Consumes: `narrow` from `usePhoneLayout()` (declared in Task 2.3); the header Undo button (Task 2.4).
- Produces: `<SheetContent side={narrow ? "bottom" : "right"} …>`; its `className` gains `data-[side=bottom]:h-[45svh]` (tailwind-merge replaces the base's `data-[side=bottom]:h-auto`) and keeps `overflow-y-auto`. The pane's margin becomes `active && inspected && (narrow ? "mb-[45svh]" : "mr-[300px]")`, so the label re-centres above the sheet the way it re-centres beside it. Everything else on both elements is unchanged.

Planner's call: no JavaScript for the on-screen keyboard (Review Focus 4). The sheet scrolls inside itself, so the browser's own scroll-to-focused-field reaches every field, and `svh` is what the shell already uses. The real-phone check at the checkpoint decides; if Android Chrome hides the focused field, the fix is adding `interactive-widget=resizes-content` to the viewport meta in `index.html` (a native setting, one attribute); if iOS Safari hides it, stop and report.
Planner's call: no CSS clamp for the 150px minimum. At 45svh the preview keeps it at every portrait phone size; Task 2.7 measures 390×844 and 320×568 to prove it.

- [ ] **Step 1: Write the failing tests**

```tsx
const sheet = () => document.querySelector('[data-slot="sheet-content"]')!;
const pane = () => container.querySelector('[data-slot="sidebar-inset"] section > div')!;
const nameBox = () => document.querySelector("#barcode-name") as HTMLInputElement;

it("raises the inspector from the bottom on an upright phone and keeps it right on a sideways one", async () => {
  await mount(390, 844);
  await openLayers();
  await tap(rowButton());
  expect(sheet().getAttribute("data-side")).toBe("bottom");
  expect(sheet().className).toContain("h-[45svh]");
  expect(sheet().className).toContain("overflow-y-auto"); // Review Focus 4: the sheet scrolls to the focused field
  expect(pane().className).toContain("mb-[45svh]");
  expect(pane().className).not.toContain("mr-[300px]");
  await act(async () => setViewport(844, 390));
  expect(sheet().getAttribute("data-side")).toBe("right");
  expect(pane().className).toContain("mr-[300px]");
  expect(pane().className).not.toContain("mb-[45svh]");
});

it("keeps the desktop inspector on the right with the pane's right margin", async () => {
  await mount(1280, 800);
  await tap(rowButton());
  expect(sheet().getAttribute("data-side")).toBe("right");
  expect(pane().className).toContain("mr-[300px]");
});

// Review Focus 3: rotating the phone, or resizing across 768px, mid-edit.
it("keeps the selection, the open inspector, a half-typed field and undo across a layout switch", async () => {
  await mount(1280, 800);
  await tap(power());
  await tap(rowButton());
  const name = nameBox();
  await act(async () => {
    name.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Draft");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (const [width, height, side] of [[390, 844, "bottom"], [844, 390, "right"], [1280, 800, "right"]] as const) {
    await act(async () => setViewport(width, height));
    expect(nameBox()).toBe(name);                 // same element: the inspector did not remount
    expect(name.value).toBe("Draft");
    expect(document.activeElement).toBe(name);
    expect(rowButton().getAttribute("data-active")).not.toBeNull();
    expect(sheet().getAttribute("data-side")).toBe(side);
  }
  await act(async () => setViewport(390, 844));
  await act(async () => { name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  await tap(headerButton("Undo"));
  expect(power().getAttribute("aria-pressed")).toBe("false");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/phone-shell-dom.test.tsx`
Expected: the bottom-sheet test and the layout-switch test FAIL on `data-side` `"right"` at 390×844; the desktop test passes.

- [ ] **Step 3: Implement**

As in Interfaces. Rewrite the pane comment's last sentence to name both margins and both sheet sizes (`mr-[300px]` matches `data-[side=right]:w-[300px]`; `mb-[45svh]` matches `data-[side=bottom]:h-[45svh]`), and the sheet comment at 2725–2730 ("Right inspector") to say it rises from the bottom under 768px wide. Do not wrap the sheet or the pane in anything that exists at one size only: the layout-switch test fails if the inspector remounts.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/phone-shell-dom.test.tsx tests/inspector-escape-dom.test.tsx tests/layerinspector-dom.test.tsx`
Expected: PASS. Then `npx tsc --noEmit && npm run lint`: clean.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx tests/phone-shell-dom.test.tsx
git commit -m "Feat: On an upright phone, the inspector rises from the bottom and the preview re-centres above it"
```

### Task 2.6: Finger-sized controls on touch screens, and a toolbar that wraps

**Files:**
- Modify: `src/index.css` (after the `titlebar` variant at 28; the `@theme inline` block at 138)
- Modify: shared controls: `src/components/ui/button.tsx` (sizes, 28–40), `input.tsx`, `textarea.tsx`, `input-group.tsx`, `select.tsx` (trigger), `toggle.tsx`, `dropdown-menu.tsx` (item 86, sub-trigger 112, checkbox item 158), `menubar.tsx` (trigger 60), `sidebar.tsx` (`sidebarMenuButtonVariants`, 360–380)
- Modify: `src/App.tsx` (`STATUS_CONTROL` 254, `segmentClass` 256, header `SidebarTrigger` 2509 and the Task 2.4 buttons, toolbar 2653, zoom input 2669, Lighting and Curve ranges 2706 and 2716), `src/TabsShell.tsx` (tab strip, 630)
- Modify: any further site the measure script lists (Step 4)
- Test: measured (CSS only; happy-dom does not apply Tailwind)

**Interfaces:**
- Produces in `src/index.css`: `@custom-variant touch (@media (pointer: coarse));` with a comment in the style of the `titlebar` one (applies on phones, tablets and touch laptops, in either layout; the root stays 13px, so sizes are px). In `@theme inline`: `--spacing-tap: 44px;` and `--text-tap: 16px;`, which give `touch:min-h-tap`, `touch:min-w-tap`, `touch:size-tap` and `touch:text-tap`.
- Produces in `src/App.tsx`: the toolbar's class becomes `cn("flex h-8 shrink-0 items-center overflow-x-auto border-t border-border bg-sidebar px-2 touch:h-auto", phone && "flex-wrap")`.

Planner's call: two theme tokens instead of `[44px]` and `[16px]` repeated at every site: one place states each number.
Planner's call: the toolbar wraps only when `phone`. At 1024px with Layers and the inspector open, the toolbar is about 470px wide and may scroll today; wrapping there would change the desktop.
Planner's call: a Switch or Checkbox keeps its look; the `<label>` row around it reaches 44px instead, and the measure script counts the label's box. A bare one with no label grows itself.

- [ ] **Step 1: Add the variant and tokens**

As in Interfaces.

- [ ] **Step 2: Size the shared controls**

Every button size in `button.tsx` gains `touch:min-h-tap`; the `icon*` sizes gain `touch:size-tap`. `Input`, `InputGroup`, `SelectTrigger`, `Toggle`, the dropdown item, sub-trigger and checkbox item, `MenubarTrigger`, and `sidebarMenuButtonVariants`' sizes gain `touch:min-h-tap`. `Input`, `Textarea` and the `InputGroup` control gain `touch:text-tap`. In `App.tsx`: `STATUS_CONTROL` and `segmentClass` gain `touch:min-h-tap`; the zoom input gains `touch:text-tap`; the `SidebarTrigger` and the undo/redo buttons gain `touch:size-tap`; the two range inputs gain `touch:min-h-tap`. The tab strip's `h-9` gains `touch:h-auto`. Do not touch anything without `touch:`.

- [ ] **Step 3: Wrap the toolbar**

As in Interfaces.

- [ ] **Step 4: Measure, fix, repeat**

With the dev server from Task 2.1, at 390×844 phone run the Task 2.1 procedure for **fresh** (then open Layers by script: click `[data-slot="sidebar-trigger"]`), **selected** and **menu**. For each entry in `under44List`, add `touch:min-h-tap` (or `touch:size-tap` for an icon-only control, or `touch:text-tap` for a field under 16px) at that control's own site, then measure again. Repeat until every state reports `under44: 0` and `smallestFieldFont` ≥ 16. Leave alone: the inactive tabs' hover-only close button (Phase 4, by design) and controls that only appear on hover (Phase 4). Record any you leave, and why, for the ledger.

Then check the toolbar: switch to Can view (`[role=group][aria-label="View mode"]` button `Can`) and to Rendered, and in each run `() => { const t = document.querySelector('[data-slot="sidebar-inset"] section > div:last-child'); return [t.scrollWidth, t.clientWidth]; }`. Expected: equal (no scroll), with the Lighting or Curve slider on a second row.

- [ ] **Step 5: Run the checks**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/components src/App.tsx src/TabsShell.tsx
git commit -m "Feat: Controls are finger-sized on touch screens, and the phone toolbar wraps instead of scrolling"
```

### Task 2.7: Measure again, compare the desktop, document

**Files:**
- Modify: `.agents/ledger.md` (the `2026-11-12 phone-shell` entry)
- Modify: `docs-site/content/docs/workspace.mdx` (the `## Layout` list; found with `grep -rln "Layers sidebar\|Inspector" docs-site/content`)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)
- Create (gitignored): `.agents/mockups/phone-shell/after-*.png`

- [ ] **Step 1: Phone measurements**

Run the Task 2.1 procedure on the current HEAD, one measure per row:

| Size and state | Expected |
|---|---|
| 390×844 phone, **fresh** | `layersState` collapsed; `pageScroll` equal; `under44` 0; `smallestFieldFont` ≥ 16 |
| 390×844 phone, **fresh**, then Layers opened by script | `layers` width ≤ 331 (85% of 390) |
| 390×844 phone, **fresh** with `localStorage.setItem("sidebar_width", "520")` set after the clear and before the reload, Layers opened | `layers` width ≤ 331 (Review Focus 5) |
| 390×844 phone, **selected** | `inspectorSide` bottom; `pane` height ≥ 150 and `preview` larger than the baseline's; `layersState` collapsed; `under44` 0 |
| 390×844 phone, **menu** | `under44` 0 |
| 320×568 phone, **selected** | `pane` height ≥ 150 |
| 844×390 phone, **selected** | `inspectorSide` right; `pageScroll` equal; `under44` 0 |
| 820×1180 `mobile,touch`, **selected** | desktop layout (`layersState` expanded, `inspectorSide` right); `under44` 0; `smallestFieldFont` ≥ 16 |

Any row that misses its expectation is a defect in the task that owns it: fix it there (same commit style), then measure again.

- [ ] **Step 2: Desktop screenshots**

At 1280×800 desktop: **fresh** to `after-fresh.png`, **selected** to `after-selected.png`.

- [ ] **Step 3: Compare**

```bash
node -e '
const { PNG } = require("pngjs"); const fs = require("fs");
const dir = ".agents/mockups/phone-shell";
for (const [a, b] of [["before-fresh", "before-fresh-2"], ["before-selected", "before-selected-2"], ["before-fresh", "after-fresh"], ["before-selected", "after-selected"]]) {
  const x = PNG.sync.read(fs.readFileSync(`${dir}/${a}.png`)), y = PNG.sync.read(fs.readFileSync(`${dir}/${b}.png`));
  if (x.width !== y.width || x.height !== y.height) { console.log(a, b, "size differs"); continue; }
  let diff = 0;
  for (let i = 0; i < x.data.length; i += 4) if (x.data.readUInt32BE(i) !== y.data.readUInt32BE(i)) diff++;
  console.log(a, "vs", b, "differing pixels:", diff);
}'
```

Expected: each before/after pair differs by no more than its baseline pair did (0 if the baseline was stable). If more, view both images, find the change, and fix the class that leaked onto the desktop; do not accept a difference.

- [ ] **Step 4: Docs**

In `workspace.mdx`, `## Layout`, one bullet after **Inspector.**: **On a phone.** Layers slides over the preview from the header button and closes when you pick a layer. The menus sit under ☰, and Undo and Redo get their own buttons. Held upright, the inspector opens from the bottom. Controls are finger-sized on any touch screen. (Plain statements, no gesture tips; the browser `Menubar.` bullet stays.) No other page describes the shell's placement (`grep -rn "Right-hand sheet\|header button" docs-site/content` to confirm).

- [ ] **Step 5: CHANGELOG**

Under `## [Unreleased]` → `### Added`, after the existing bullets:

- **Label Lab fits a phone.** On a phone's browser the editor keeps the same Layers list, preview, toolbar and inspector. Layers slides in from the side and closes when you pick a layer, the inspector opens from the bottom with the label above it, the menus sit under one ☰ button, and Undo and Redo get their own buttons.
- **Bigger controls on touch screens.** Buttons, fields and menu rows are at least 44 pixels on phones, tablets and touch laptops, and fields no longer make the page zoom when you tap them.

No version bump.

- [ ] **Step 6: Full checks**

```bash
npx tsc --noEmit && npm run lint && npm test && npx --yes knip@6.38.0 && node scripts/check-release.mjs build/web-app-pages
```

Expected: all pass.

- [ ] **Step 7: Ledger and commit**

Update the `2026-11-12 phone-shell` entry: `status: done`, `measured at <short SHA>`, `delta:` each baseline number → after number (preview size, smallest target, page scroll, field font), the table's results, the four pixel-compare counts, anything left under 44px with its reason, and `release: binary-impacting; two bullets queued under [Unreleased]`. Note what was not measured: a real phone, the on-screen keyboard (Review Focus 4), Safari.

```bash
git add .agents/ledger.md docs-site/content/docs/workspace.mdx CHANGELOG.md
git commit -m "Docs: Describe the phone layout and record its measurements"
```

Do not push.

### Phase 2 checkpoint

Stop. Report: the commits, the before and after numbers, the pixel-compare counts, and anything left under 44px. Ask the user to run the shell on a real phone (`npm run dev -- --host`, over Wi-Fi) and check: Layers opens, picks and closes; ☰ reaches every menu; Undo and Redo; the inspector from the bottom with the preview above it; **typing in an inspector field near the bottom with the on-screen keyboard up keeps that field visible (Review Focus 4)**; rotate mid-edit (Review Focus 3); nothing scrolls sideways. Then ask whether to push and open the PR, and against which base.

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
