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

Corrected by the Phase 2 fix wave: at Safari's real small viewports (375×553, 320×460) and with the toolbar wrapped in Rendered and Can, 45svh left the preview 111px and 58px. Sheet and section now both read `--bottom-sheet-height: clamp(180px, calc(100svh - 345px), 45svh)` (src/index.css); the ledger's phone-shell entry has the measurements.

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

## Phase 3 — Touch gestures on the canvas

Branch `feat/phone-gestures`, worktree `.agents/worktrees/web-app-pages` (already created, stacked on `feat/phone-shell` at `d074a89d`). Line numbers below are as of `d074a89d`; re-find each by the quoted code if it has moved. Binary-impacting (`src/` changes), so Task 3.7 adds `CHANGELOG.md` bullets; `check-release.mjs` runs against the stack parent, `feat/phone-shell`.

**Order.** Task 3.1 first (the baseline must be measured on unchanged code). Task 3.3 touches only `src/useZoomPan.ts` and its new test, so it may run in parallel with Task 3.2. Tasks 3.4, 3.5 and 3.6 run one after another after both: 3.2, 3.4, 3.5 and 3.6 all edit `src/components/PreviewCompare.tsx`, and 3.2 and 3.4 both edit `src/App.tsx`. Task 3.7 is last. `PreviewCompare.tsx` is 705 lines against the 750-line budget in `tests/module-size.test.ts`; this phase adds about 30.

Found while planning, by running the Task 3.1 probe against `d074a89d` in headless Chrome with CDP touch input at 390×844 (these shape the tasks):
- **Nothing on the canvas works by finger today.** One finger on the pasteboard at 200%: the view does not move, and the browser cancels the pointer (`pointercancel`). Two fingers: the *page* zooms (`visualViewport.scale` 5), the view stays at 100%. A finger drag out of the top ruler: no guide, `pointercancel`. All three are the browser taking the touch because nothing sets `touch-action`.
- **On a small selected layer a finger resizes instead of moving.** "Description" selected at 390×844 is 23×23 px. A finger at its centre lands on the right-middle resize tick: Chrome's touch adjustment aims the `pointerdown` at the nearest tap target (the tick), though the event's `clientX/Y` stay at the finger (logged: target `tick 1,0`, at 48,197, inside the box). The drag grew the layer from 23.3 to 53.2 px wide. A two-finger pinch on it hit ticks `-1,0` and `1,0` and resized it too.
- **Double-tap.** Chrome delivers `dblclick` for a touch double-tap (the 34×201 px Warning layer opened in place). On the small Description layer the same double-tap delivered `dblclick` but aimed it, and both clicks, at the tick, so nothing opened. That is the spec's "does not deliver `dblclick` reliably": Task 3.6 adds the 300 ms two-tap detector, read from raw `pointerup` positions.
- **What already works by finger:** the compare divider (0 → 28, it already sets `touch-none`); a tap on a ruler corner opens Ruler settings; the Can view: one finger orbits, two pinch (100 → 250%) and pan, the page does not zoom. No Can view code changes.
- **Fit.** At 320×568 and 844×390 with a layer selected the label is taller than the pane (pane 320×196, sheet 299×188.6 below a ruler; pane 544×241, sheet 523×329.9). The sheet is `m-auto w-full` with a locked aspect ratio, capped at `PREVIEW_MAX_W` (900): width-driven only. At 1280×800 the sheet is 900 wide (fresh) and 703 wide (selected) in a pane 712 tall, so a height bound is never reached there.
- `canScene`'s `framingDistance` (`src/three/canScene.ts:736–743`) predicts the 2D sheet's height from the same width-only rule, so 100% means one thing in every view; it must follow the new rule.
- `useZoomPan` is called (`src/App.tsx:559–562`) before `previewRef` is declared (`App.tsx:589`).
- `tests/rulers-dom.test.tsx:64` builds a typed `PreviewCompareHandle` literal; it must gain the two new members.
- Precedent for an invisible enlarged hit area: `src/components/ui/switch.tsx` (`touch:after:absolute touch:after:-inset-… touch:after:content-['']`). Task 3.5 reuses it. The `tap` spacing token (44px) and the `touch:` variant exist (`src/index.css:33, 153`). Root font is 13px, so `size-11` is 35.75px, not 44: use `tap`.

Planner's call: the probe is a Node script driving its own headless Chrome over CDP (`Input.dispatchTouchEvent`), not the chrome-devtools MCP tools Phase 2 used: those have no multi-finger input. It uses Node 24's built-in `WebSocket` and `fetch`, so no dependency.
Planner's call: one-finger pan, pinch, guide drags and the divider all need nothing but `touch-action: none` on the pane plus the pan/pinch handlers; `touch-action` applies to everything inside the pane (rulers, sheet, in-place field), so no child gets its own.

### Review Focus

Conditions most likely to bite a real person, each pinned to a test:

1. **A pinch with a layer selected.** The selection and the open inspector must survive, and no undo step may appear. Task 3.4, test "pinching and panning keep the selection and add no undo step".
2. **A finger resting on the canvas while another taps.** The tap must still be a tap (select or deselect), and the view must not move. Task 3.4, test "a resting finger does not turn a tap into a gesture".
3. **A pinch at the zoom limits.** Past 250% or below 100% nothing moves and nobody is told (#726). Task 3.3 (top and bottom of the range, pure) and Task 3.4, test "a pinch below the bottom of the range reaches no listener".
4. **Double-tap on a locked or hidden layer.** Locked text opens in place, as a double-click on it does today; a hidden layer draws nothing and so nothing opens. Task 3.6, tests "a locked text layer opens as its double-click does" and "a hidden layer opens nothing".
5. **Rotating the phone mid-pinch.** The OS cancels one finger and the pane changes size; the other finger keeps panning, clamped to the new pane. Task 3.4, test "a cancelled finger mid-pinch leaves the other panning, inside the pane's new size".

### File structure

| File | Responsibility |
|---|---|
| `src/layout.ts` (modify) | `fitSheetWidth()`: the sheet's fitted width for a pane, both dimensions |
| `src/components/PreviewCompare.tsx` (modify) | Sheet fits height too; handle gains `layerGestureArmed` / `cancelLayerGesture`; a finger inside a layer's box moves it even when aimed at a tick; divider hit area; double-tap |
| `src/App.tsx` (modify) | Zoom layer is the sheet's size container; pane `touch-none` and click-capture; `previewRef` handed to `useZoomPan` |
| `src/three/canScene.ts` (modify) | 3D framing follows `fitSheetWidth` |
| `src/useZoomPan.ts` (modify) | `pinchView()` (pure); finger pan and pinch on the pane |
| `src/components/previewOverlay.ts` (modify) | Resize ticks: 44px outward hit area on touch |
| `src/components/Rulers.tsx` (modify) | Manual guide handles: 44px hit area on touch |
| `tests/fit-sheet-dom.test.tsx` (create) | `fitSheetWidth` values; the sheet's CSS width cap |
| `tests/zoom-pan-pinch.test.ts` (create) | `pinchView` |
| `tests/zoom-pan-touch-dom.test.tsx` (create) | Finger pan and pinch rules in a mounted `DocumentEditor` |
| `tests/preview-touch-dom.test.tsx` (create) | `PreviewCompare` under touch: handle, ticks, double-tap |
| `tests/zoom-pan-render-dom.test.tsx`, `tests/rulers-dom.test.tsx` (modify) | Zoom layer container; handle literal; guide hit areas |
| `.agents/mockups/phone-gestures/probe.mjs` (create, gitignored) | The measuring script |
| `.agents/ledger.md`, `docs-site/content/docs/(authoring)/preview.mdx`, `(authoring)/editing.mdx`, `(reference)/shortcuts.mdx`, `CHANGELOG.md` (modify) | Measurements, docs, release notes |

### Task 3.1: Record the baseline with real touch input

**Files:**
- Create (gitignored, not committed): `.agents/mockups/phone-gestures/probe.mjs`, and its outputs in the same folder
- Modify: `.agents/ledger.md` (append entry `## 2026-11-12 phone-gestures`)

**Interfaces:**
- Produces: `probe.mjs` (Task 3.7 runs it unchanged), the baseline JSON `before.json` and `before-2.json`, and desktop screenshots `before-desktop-{fresh,selected}.png`, `before-2-desktop-{fresh,selected}.png`.

Planner's call: the probe opens a fresh tab per scenario and closes the old one through `/json/close`: an edited document's unsaved-changes prompt otherwise blocks the next navigation (seen while planning).
Planner's call: the whole probe runs twice for the baseline, so run-to-run noise (screenshots and gesture readings) is known before anything is compared.

- [ ] **Step 1: Start the dev server**

Run (background): `npm run dev -- --port 5190 --strictPort` (5173 belongs to another session). If 5190 is busy, use the next free port and record it. Port 9333 must be free for the probe's Chrome (`lsof -iTCP:9333 -sTCP:LISTEN` prints nothing). Google Chrome must be at `/Applications/Google Chrome.app`.

- [ ] **Step 2: Write the probe**

`.agents/mockups/phone-gestures/probe.mjs`, exactly:

```js
// probe.mjs — Phase 3 (touch gestures) measurement: drives a headless Chrome
// over CDP with real touch input (Input.dispatchTouchEvent) at phone sizes and
// real mouse input at 1280x800, and prints one JSON object of readings.
// Usage: node probe.mjs <app url> <out dir> <label>
// Writes <out dir>/<label>-desktop-{fresh,selected}.png and <label>.json.
// PROBE_ONLY=drag,pinch runs just those scenarios (add "desktop" for the mouse part).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, label] = process.argv.slice(2);
if (!url || !out || !label) throw new Error("usage: node probe.mjs <app url> <out dir> <label>");
mkdirSync(out, { recursive: true });
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "probe-"))}`,
  "--no-first-run", "--hide-scrollbars", "--enable-unsafe-swiftshader", "about:blank",
], { stdio: "ignore" });

// One tab per scenario: a fresh tab has no unsaved-changes prompt to block
// navigation, and closing the old one through /json/close skips it.
const http = (path) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: "PUT" });
let ws, target, seq = 0;
const pending = new Map();
async function newTab() {
  if (target) { ws.close(); await http(`/json/close/${target.id}`); }
  target = undefined;
  for (let i = 0; i < 100 && !target; i++) {
    try { target = await (await http("/json/new?about:blank")).json(); } catch { await sleep(100); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  };
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
  pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
  ws.send(JSON.stringify({ id, method, params }));
});
/** Run `fn(...args)` in the page; returns its (awaited) value. */
async function page(fn, ...args) {
  const r = await send("Runtime.evaluate", {
    expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

// ---- in-page helpers (serialised into the page; no closures over Node values)
const READY = async () => {
  for (let i = 0; i < 100 && document.readyState !== "complete"; i++) await new Promise((r) => setTimeout(r, 100));
  await document.fonts.ready;
  for (let i = 0; i < 100 && (!document.querySelector('[data-slot="label-sheet"]') || document.body.textContent.includes("rendering label")); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 500));
  window.__events = { click: 0, dblclick: 0, pointercancel: 0, contextmenu: 0, down: [] };
  const name = (el) => `${el.tagName}${el.dataset?.resizeHandle ? `[tick ${el.dataset.resizeHandle}]` : ""}${el.dataset?.slot ? `[${el.dataset.slot}]` : ""}`;
  document.addEventListener("pointerdown", (e) => { window.__events.down.push(`${e.pointerType}:${name(e.target)}@${Math.round(e.clientX)},${Math.round(e.clientY)}`); }, true);
  for (const type of ["click", "dblclick", "pointercancel", "contextmenu"]) document.addEventListener(type, () => { window.__events[type]++; }, true);
  return !document.body.textContent.includes("rendering label");
};
const READ = () => {
  const pane = document.querySelector('[data-slot="sidebar-inset"] section > div');
  const sheet = document.querySelector('[data-slot="label-sheet"]');
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10);
  };
  const focus = document.activeElement;
  return {
    transform: pane.querySelector('[style*="transform-origin"]').style.transform,
    zoomField: document.querySelector('input[aria-label="Zoom percentage"]').value,
    pageZoom: Math.round(visualViewport.scale * 1000) / 1000,
    pageScroll: [scrollX, scrollY, Math.round(visualViewport.offsetLeft), Math.round(visualViewport.offsetTop)],
    selected: [...document.querySelectorAll("[data-layer-id]")]
      .filter((row) => row.querySelector('[data-slot="sidebar-menu-button"][data-active]'))
      .map((row) => row.dataset.layerId),
    outline: rect(document.querySelector("[data-resize-handle]")?.parentElement),
    pane: rect(pane), sheet: rect(sheet),
    editing: !!sheet?.querySelector('[contenteditable="true"], textarea, input'),
    focus: focus ? `${focus.tagName}${focus.isContentEditable ? "[contenteditable]" : ""}` : null,
    selectionText: String(getSelection()),
    split: document.querySelector('[data-slot="resizable-handle"]')?.getAttribute("aria-valuenow") ?? null,
    guides: document.querySelectorAll('[data-slot="rulers"] [role="button"][data-guide-control]').length,
    popover: !!document.querySelector('[data-slot="popover-content"]'),
    events: { ...window.__events, down: window.__events.down.slice(-4) },
  };
};
/** Pick a layer through its Layers row (opens Layers first if closed). */
const SELECT = async (id) => {
  if (document.querySelector('[data-slot="sidebar"]').dataset.state === "collapsed") {
    document.querySelector('[data-slot="sidebar-trigger"]').click();
    await new Promise((r) => setTimeout(r, 400));
  }
  document.querySelector(`[data-layer-id="${id}"] [data-slot="sidebar-menu-button"]`).click();
  await new Promise((r) => setTimeout(r, 600));
};
/** Screen points the gestures aim at. */
const POINTS = () => {
  const centre = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };
  const pane = document.querySelector('[data-slot="sidebar-inset"] section > div').getBoundingClientRect();
  const sheet = document.querySelector('[data-slot="label-sheet"]').getBoundingClientRect();
  // First point down the pane's centre line that is neither the label nor a ruler.
  let pasteboard = null;
  for (let y = pane.top + 30; y < pane.bottom - 5 && !pasteboard; y += 5) {
    const el = document.elementFromPoint(pane.left + pane.width / 2, y);
    if (el && pane.width && !el.closest('[data-slot="label-sheet"], [data-slot="rulers"]')
      && el.closest('[data-slot="sidebar-inset"] section > div')) pasteboard = [pane.left + pane.width / 2, y];
  }
  return {
    pane: [pane.left + pane.width / 2, pane.top + pane.height / 2],
    paneTopLeft: [pane.left, pane.top],
    sheet: [sheet.left + sheet.width / 2, sheet.top + sheet.height / 2],
    sheetLeft: [sheet.left + 2, sheet.top + sheet.height / 2],
    layer: centre(document.querySelector("[data-resize-handle]")?.parentElement),
    tick: centre(document.querySelector('[data-resize-handle="1,1"]')),
    pasteboard,
  };
};
/** What a finger 14px out diagonally from the bottom-right tick, and one at
 *  (34, 34) inside the pane's top-left corner, would land on. */
const HITS = () => {
  const describe = (el) => el ? `${el.tagName}${el.dataset.resizeHandle ? `[tick ${el.dataset.resizeHandle}]` : ""}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}${el.dataset.slot ? `[${el.dataset.slot}]` : ""}` : null;
  const tick = document.querySelector('[data-resize-handle="1,1"]')?.getBoundingClientRect();
  const pane = document.querySelector('[data-slot="sidebar-inset"] section > div').getBoundingClientRect();
  return {
    tickSize: tick ? [Math.round(tick.width * 10) / 10, Math.round(tick.height * 10) / 10] : null,
    tickPlus14: tick ? describe(document.elementFromPoint(tick.left + tick.width / 2 + 14, tick.top + tick.height / 2 + 14)) : null,
    corner34: describe(document.elementFromPoint(pane.left + 34, pane.top + 34)),
  };
};
const ZOOM_TO = async (pct) => {
  const field = document.querySelector('input[aria-label="Zoom percentage"]');
  field.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, String(pct));
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.blur();
  await new Promise((r) => setTimeout(r, 300));
};
/** Header Undo presses until it disables (phone only; null on a desktop). */
const UNDO_STEPS = async () => {
  const button = () => document.querySelector('header button[aria-label="Undo"]');
  if (!button()) return null;
  let n = 0;
  while (!button().disabled && n < 20) { button().click(); n++; await new Promise((r) => setTimeout(r, 100)); }
  return n;
};
const CAN = async () => {
  [...document.querySelectorAll('[role=group][aria-label="View mode"] button')].find((b) => b.textContent.trim() === "Can").click();
  const scene = () => [...document.querySelectorAll('[data-slot="sidebar-inset"] section > div canvas')]
    .some((c) => !c.closest('[data-slot="label-sheet"]'));
  for (let i = 0; i < 100 && !scene(); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 3000));
  return scene();
};

// ---- input
const touch = (type, points) => send("Input.dispatchTouchEvent", {
  type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })),
});
/** Fingers move together in `steps` frames; each path is [x0, y0, x1, y1, id]. */
async function moveFingers(paths, steps = 10) {
  for (let s = 1; s <= steps; s++) {
    await touch("touchMove", paths.map(([x0, y0, x1, y1, id]) => [x0 + (x1 - x0) * s / steps, y0 + (y1 - y0) * s / steps, id]));
    await sleep(16);
  }
}
async function swipe(paths, steps = 10) {
  await touch("touchStart", paths.map(([x0, y0, , , id]) => [x0, y0, id]));
  await sleep(30);
  await moveFingers(paths, steps);
  await touch("touchEnd", []);
  await sleep(400);
}
async function tap([x, y]) { await touch("touchStart", [[x, y, 0]]); await sleep(40); await touch("touchEnd", []); }
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, ...extra });
async function screenshot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, `${label}-${name}.png`), Buffer.from(data, "base64"));
}
async function paneHash() {
  const p = await page(() => { const b = document.querySelector('[data-slot="sidebar-inset"] section > div').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
  const { data } = await send("Page.captureScreenshot", { format: "png", clip: { ...p, scale: 1 } });
  return createHash("sha1").update(data).digest("hex").slice(0, 10);
}

async function open(phone, [width, height] = phone ? [390, 844] : [1280, 800]) {
  await newTab();
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", phone
    ? { width, height, deviceScaleFactor: 3, mobile: true }
    : { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setTouchEmulationEnabled", { enabled: phone, maxTouchPoints: phone ? 5 : 1 });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await send("Page.navigate", { url });
  await sleep(500);
  await page(() => localStorage.clear());
  await send("Page.reload", { ignoreCache: false });
  await sleep(500);
  if (!await page(READY)) throw new Error("label never rendered");
  return page(() => matchMedia("(pointer: coarse)").matches);
}

const result = { label, url, at: new Date().toISOString() };
const phone = {};
const only = process.env.PROBE_ONLY?.split(",");
const run = async (name, body) => {
  if (only && !only.includes(name)) return;
  console.error(`phone: ${name}`);
  try { phone[name] = await body(); } catch (err) { phone[name] = { error: String(err) }; }
};

// ---- phone 390x844, touch
await run("fresh", async () => ({ coarse: await open(true), read: await page(READ), hits: await page(HITS) }));
await run("pan", async () => {
  await open(true);
  await page(ZOOM_TO, 200);
  const before = await page(READ), p = (await page(POINTS)).pasteboard;
  if (!p) return { before, error: "no pasteboard point at 200%" };
  await swipe([[p[0], p[1], p[0] - 60, p[1] - 80, 0]]);
  return { at: p, before, after: await page(READ), undo: await page(UNDO_STEPS) };
});
await run("pinch", async () => {
  await open(true);
  const before = await page(READ), [x, y] = (await page(POINTS)).sheet;
  await swipe([[x - 40, y, x - 100, y, 0], [x + 40, y, x + 100, y, 1]]);
  return { at: [x, y], before, after: await page(READ), undo: await page(UNDO_STEPS) };
});
await run("drag", async () => {
  await open(true);
  await page(SELECT, "description");
  const before = await page(READ), [x, y] = (await page(POINTS)).layer;
  await swipe([[x, y, x + 30, y + 20, 0]]);
  return { at: [x, y], before, after: await page(READ), undo: await page(UNDO_STEPS) };
});
await run("secondFinger", async () => {
  await open(true);
  await page(SELECT, "description");
  const before = await page(READ), pts = await page(POINTS), [x, y] = pts.layer, [sx, sy] = pts.sheet;
  await touch("touchStart", [[x, y, 0]]);
  await moveFingers([[x, y, x + 20, y, 0]], 5);
  const midDrag = await page(READ);
  await touch("touchStart", [[x + 20, y, 0], [sx, sy + 40, 1]]);
  await moveFingers([[x + 20, y, x - 20, y, 0], [sx, sy + 40, sx, sy + 100, 1]], 10);
  await touch("touchEnd", []);
  await sleep(400);
  return { before, midDrag, after: await page(READ), undo: await page(UNDO_STEPS) };
});
await run("liftOne", async () => {
  await open(true);
  const [x, y] = (await page(POINTS)).sheet;
  await touch("touchStart", [[x - 40, y, 0], [x + 40, y, 1]]);
  await moveFingers([[x - 40, y, x - 100, y, 0], [x + 40, y, x + 100, y, 1]]);
  const pinched = await page(READ);
  await touch("touchEnd", [[x + 100, y, 1]]); // CDP: a touchEnd listing a point lifts just that finger
  await moveFingers([[x - 100, y, x - 160, y, 0]]);
  const after = await page(READ);
  await touch("touchEnd", []);
  await sleep(400);
  return { pinched, after, end: await page(READ) };
});
await run("pinchOnLayer", async () => {
  await open(true);
  await page(SELECT, "description");
  const before = await page(READ), [x, y] = (await page(POINTS)).layer;
  await swipe([[x - 10, y, x - 80, y, 0], [x + 10, y, x + 80, y, 1]]);
  return { before, after: await page(READ), undo: await page(UNDO_STEPS) };
});
for (const id of ["description", "warning"]) {
  await run(`doubleTap-${id}`, async () => {
    await open(true);
    await page(SELECT, id);
    const before = await page(READ), p = (await page(POINTS)).layer;
    await tap(p); await sleep(120); await tap(p); await sleep(600);
    return { before, after: await page(READ) };
  });
}
await run("resize", async () => {
  await open(true);
  await page(SELECT, "description");
  const before = await page(READ), hits = await page(HITS), [x, y] = (await page(POINTS)).tick;
  await swipe([[x, y, x + 20, y + 10, 0]]);
  return { hits, before, after: await page(READ), undo: await page(UNDO_STEPS) };
});
await run("guide", async () => {
  await open(true);
  const before = await page(READ), [left, top] = (await page(POINTS)).paneTopLeft;
  await swipe([[left + 150, top + 12, left + 150, top + 132, 0]]);
  return { before, after: await page(READ) };
});
await run("split", async () => {
  await open(true);
  const before = await page(READ), [x, y] = (await page(POINTS)).sheetLeft;
  await swipe([[x, y, x + 100, y, 0]]);
  return { before, after: await page(READ) };
});
await run("corner", async () => {
  await open(true);
  const before = await page(READ), [left, top] = (await page(POINTS)).paneTopLeft;
  await tap([left + 34, top + 34]); await sleep(400);
  return { before, after: await page(READ) };
});
await run("can", async () => {
  await open(true);
  if (!await page(CAN)) return { error: "no 3D canvas" };
  const [x, y] = (await page(POINTS)).pane, h0 = await paneHash(), z0 = (await page(READ)).zoomField;
  await swipe([[x, y, x + 80, y, 0]]);
  const h1 = await paneHash();
  await swipe([[x - 40, y, x - 100, y, 0], [x + 40, y, x + 100, y, 1]]);
  const z1 = (await page(READ)).zoomField, h2 = await paneHash();
  await swipe([[x - 40, y, x, y + 40, 0], [x + 40, y, x + 80, y + 40, 1]]);
  const h3 = await paneHash();
  return { orbitChanged: h0 !== h1, zoom: [z0, z1], pinchChanged: h1 !== h2, panChanged: h2 !== h3, pageZoom: (await page(READ)).pageZoom };
});
await run("fit", async () => {
  const sizes = {};
  for (const size of [[390, 844], [320, 568], [844, 390]]) {
    await open(true, size);
    await page(SELECT, "description");
    const { pane, sheet } = await page(READ);
    // Whole label in view: the sheet's bottom and right edges inside the pane.
    sizes[size.join("x")] = { pane, sheet, whole: sheet[1] + sheet[3] <= pane[1] + pane[3] + 0.5 && sheet[0] + sheet[2] <= pane[0] + pane[2] + 0.5 };
  }
  return sizes;
});
result.phone = phone;

// ---- desktop 1280x800, mouse
const desktop = {};
if (!only || only.includes("desktop")) try {
  desktop.coarse = await open(false);
  await screenshot("desktop-fresh");
  await page(async () => {
    document.querySelector('[data-layer-id] [data-slot="sidebar-menu-button"]').click();
    await new Promise((r) => setTimeout(r, 600));
  });
  await screenshot("desktop-selected");
  await open(false);
  const [x, y] = (await page(POINTS)).pane;
  for (let i = 0; i < 3; i++) { await mouse("mouseWheel", x, y, { deltaX: 0, deltaY: -100 }); await sleep(50); }
  await sleep(300);
  desktop.wheel = await page(READ);
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y, { button: "right", buttons: 2, clickCount: 1 });
  for (let s = 1; s <= 5; s++) await mouse("mouseMoved", x - 12 * s, y - 8 * s, { button: "right", buttons: 2 });
  await mouse("mouseReleased", x - 60, y - 40, { button: "right", buttons: 0, clickCount: 1 });
  await sleep(300);
  desktop.rightDrag = await page(READ);
  await open(false);
  await page(SELECT, "description");
  const [lx, ly] = (await page(POINTS)).layer;
  await mouse("mouseMoved", lx, ly);
  for (const clickCount of [1, 2]) {
    await mouse("mousePressed", lx, ly, { button: "left", buttons: 1, clickCount });
    await mouse("mouseReleased", lx, ly, { button: "left", buttons: 0, clickCount });
  }
  await sleep(600);
  desktop.doubleClick = await page(READ);
} catch (err) { desktop.error = String(err); }
result.desktop = desktop;

writeFileSync(join(out, `${label}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
ws.close();
chrome.kill();
process.exit(0);
```

What each scenario reads: `transform` is the view (the zoom layer's inline transform); `pageZoom` and `pageScroll` say whether the browser zoomed or scrolled the page itself; `outline` is the selected layer's selection box on screen (x, y, w, h); `undo` is how many header Undo presses it took to empty the history after the gesture (phone only); `events.down` names the element each `pointerdown` targeted and where the finger was.

- [ ] **Step 3: Run it twice**

```bash
node .agents/mockups/phone-gestures/probe.mjs http://localhost:5190/ .agents/mockups/phone-gestures before
node .agents/mockups/phone-gestures/probe.mjs http://localhost:5190/ .agents/mockups/phone-gestures before-2
```

Each run takes about six minutes. Expected (measured while planning at `d074a89d`; record the actual numbers, not these):

| Scenario | Expected before |
|---|---|
| `fresh` | `coarse` true; `transform` `translate(0px, 0px) scale(1)`; `corner34` the Ruler settings button |
| `pan` | `before.transform` `translate(-195px, -347.5px) scale(2)`; `after.transform` the same; `pointercancel` 1; `undo` 0 |
| `pinch` | `after.transform` unchanged at scale 1; `after.pageZoom` about 5 (the page zoomed); `undo` 0 |
| `drag` | `events.down` `touch:SPAN[tick 1,0]`; outline 23.3 → about 53 wide, x unchanged (a resize, not a move); `undo` 1 |
| `secondFinger`, `pinchOnLayer` | outline width changed (ticks resized it); `undo` 1 |
| `liftOne` | `pageZoom` about 5; `transform` scale 1 throughout |
| `doubleTap-description` | `dblclick` 1, `editing` false, both downs on a tick |
| `doubleTap-warning` | `editing` true, `focus` `DIV[contenteditable]` |
| `resize` | `tickSize` [6.5, 6.5]; `tickPlus14` `CANVAS`; outline 23.3 → about 45 wide; `undo` 1 |
| `guide` | `guides` 0 → 0; `pointercancel` 1 |
| `split` | `split` "0" → "28" |
| `corner` | `popover` true |
| `can` | `orbitChanged`, `pinchChanged`, `panChanged` true; `zoom` ["100", "250"]; `pageZoom` 1 |
| `fit` | 390x844 `whole` true, sheet [21, 153.2, 369, 232.8]; 320x568 `whole` false; 844x390 `whole` false |
| `desktop` | `coarse` false; `wheel.transform` `translate(-768px, -532.875px) scale(2.5)`; `rightDrag.transform` `translate(-828px, -572.875px) scale(2.5)`; `doubleClick.editing` true |

Compare `before.json` with `before-2.json` scenario by scenario and the two screenshot pairs with the Task 3.7 Step 4 script. Record any difference as the noise floor; Task 3.7 compares against it.

- [ ] **Step 4: Phone layout numbers (Global Constraints)**

Run the Phase 2 Task 2.1 procedure (chrome-devtools MCP) at 390×844 phone for **fresh** and **selected** and keep the JSON: `preview`, `pageScroll`, `under44`, `smallestFieldFont`. Expected as Phase 2 left them: preview 369x233, page 390/390, under44 0, font 16.

- [ ] **Step 5: Record and commit**

Append to `.agents/ledger.md`, in the format of the `2026-11-12 phone-shell` entry: `finding: [user request] canvas touch gestures (phone layout plan, Phase 3)`, `status: in-progress`, `attempted-in: .agents/worktrees/web-app-pages @ feat/phone-gestures, measured at <git rev-parse --short HEAD>`, `delta: baseline`, the probe's one-line command, one `evidence` line per scenario (the readings in the table's columns, from `before.json`), the run-to-run differences, and the Step 4 JSON.

```bash
git add .agents/ledger.md
git commit -m "Docs: Record the canvas touch baseline"
```

### Task 3.2: 100% shows the whole label

**Files:**
- Modify: `src/layout.ts` (after `PREVIEW_MAX_W`, 87–91)
- Modify: `src/components/PreviewCompare.tsx` (the sheet's `style`, 509–518)
- Modify: `src/App.tsx` (the zoom layer's `style`, 2652–2655, and its comment 2644–2648)
- Modify: `src/three/canScene.ts` (`framingDistance` 736–743 and its comment 721–735; the `PREVIEW_MAX_W` import at 15)
- Test: `tests/fit-sheet-dom.test.tsx` (create), `tests/zoom-pan-render-dom.test.tsx` (modify)

**Interfaces:**
- Produces in `src/layout.ts`: `export const fitSheetWidth = (paneW: number, paneH: number): number => Math.min(paneW, PREVIEW_MAX_W, paneH * PAGE.w / PAGE.h);` with a doc comment: the 2D sheet's on-screen width in a pane of that content size, filling the width up to `PREVIEW_MAX_W` unless the pane is too short for the label's height; PreviewCompare states the same rule in CSS, canScene frames to it.
- Produces in `PreviewCompare`: the sheet's `maxWidth` becomes `` `min(${PREVIEW_MAX_W}px, ${(100 * PAGE.w) / PAGE.h}cqh)` ``. Everything else on the sheet is unchanged.
- Produces in `App.tsx`: the zoom layer's style gains `containerType: "size"`, so `cqh` inside it is the zoom layer's content height (the pane less the ruler padding).
- Produces in `canScene.ts`: `const sheetHeight = fitSheetWidth(w, h) * (PAGE.h / PAGE.w);`.

Planner's call: CSS, not a measured width in JS: a container query on the zoom layer keeps the sheet's size out of React, as the view is (#714), and re-fits on every pane resize for free. The zoom layer already carries a transform, which already makes it the containing block that `container-type`'s layout containment would add.
Planner's call: the 3D framing follows the same rule (`fitSheetWidth`), so 100% still frames the label at the 2D sheet's height on a short pane. Without it the Can view at 844×390 would frame the label taller than the pane.
Planner's call: no change to `clampView` or the zoom range: 100% stays "fitted"; only what fitted means changes. At 1280×800 the height bound is never the smaller one (900 and 703 wide against about 688 × 1.585), so the desktop renders identically; Step 5 proves it.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/fit-sheet-dom.test.tsx — 100% shows the whole label: the 2D sheet fits
// the pane's width and height (phone layout, Phase 3), and the 3D framing
// reads the same rule.
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PreviewCompare } from "../src/components/PreviewCompare";
import { fitSheetWidth, PAGE, PREVIEW_MAX_W } from "../src/layout";

it.each([
  [1003, 688, 900],  // desktop 1280x800, fresh: the 900px cap
  [703, 688, 703],   // desktop, layer selected: the width
  [390, 2000, 390],  // a tall pane: the width
])("a %ix%i pane fits a sheet %i wide", (w, h, expected) => {
  expect(fitSheetWidth(w, h)).toBe(expected);
});

it("a short pane fits the label's height", () => {
  expect(fitSheetWidth(299, 163)).toBe(163 * PAGE.w / PAGE.h);
  expect(fitSheetWidth(299, 163)).toBeCloseTo(258.38, 2);
});

it("the sheet states the same rule in CSS, against its container's height", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(createElement(PreviewCompare, {
      canvasRender: null, layers: [], editLayerOf: (l) => l, selected: [], onPick: vi.fn(),
      onEditText: vi.fn(), onEditUppercase: vi.fn(), onEditCommit: vi.fn(),
      onDrag: () => ({ x: null, y: null, dx: 0, dy: 0 }), onDragCancel: vi.fn(), onResize: vi.fn(),
      onEditSession: vi.fn(), cornerRadiusPct: 0, zoom: 1, bleedIn: 0, unit: "in",
    }));
  });
  const sheet = container.querySelector<HTMLElement>('[data-slot="label-sheet"]')!;
  expect(sheet.style.maxWidth).toBe(`min(${PREVIEW_MAX_W}px, ${(100 * PAGE.w) / PAGE.h}cqh)`);
  act(() => { root.unmount(); });
  vi.unstubAllGlobals();
});
```

In `tests/zoom-pan-render-dom.test.tsx`, add:

```tsx
it("the zoom layer is the sheet's size container, so cqh is the pane's height", async () => {
  const { layer } = await mountEditor();
  expect(layer.style.containerType).toBe("size");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/fit-sheet-dom.test.tsx tests/zoom-pan-render-dom.test.tsx`
Expected: FAIL: `fitSheetWidth` is not exported; `maxWidth` is `900px`; `containerType` is `""`.

- [ ] **Step 3: Implement**

As in Interfaces. Comments: PreviewCompare's style comment names `fitSheetWidth` as the same rule and says `cqh` is the zoom layer's height; App's zoom layer comment gains one sentence (it is the sheet's size container, so Fit shows the whole label); canScene's `framingDistance` comment "The 2D sheet is width-driven (it fills the pane up to PREVIEW_MAX_W …)" becomes "The 2D sheet's width is fitSheetWidth: the pane's width up to PREVIEW_MAX_W, less when the pane is too short for the label". Drop `PREVIEW_MAX_W` from canScene's import if nothing else there uses it.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/fit-sheet-dom.test.tsx tests/zoom-pan-render-dom.test.tsx tests/core.test.ts tests/inplace-editor-dom.test.tsx`
Expected: PASS. Then `npx tsc --noEmit && npm run lint`: clean.

- [ ] **Step 5: Measure**

`PROBE_ONLY=fit,desktop node .agents/mockups/phone-gestures/probe.mjs http://localhost:5190/ .agents/mockups/phone-gestures fit`
Expected: `fit` 390x844 sheet [21, 153.2, 369, 232.8] (unchanged), 320x568 and 844x390 `whole` true; `fit-desktop-fresh.png` and `fit-desktop-selected.png` differ from `before-desktop-*.png` by no more than the noise floor (Task 3.7 Step 4 script). If not, stop: the desktop changed.

- [ ] **Step 6: Commit**

```bash
git add src/layout.ts src/components/PreviewCompare.tsx src/App.tsx src/three/canScene.ts tests/fit-sheet-dom.test.tsx tests/zoom-pan-render-dom.test.tsx
git commit -m "Fix: 100% shows the whole label on a short pane"
```

### Task 3.3: Pinch math

**Files:**
- Modify: `src/useZoomPan.ts` (after `zoomAbout`, 57–65; the `View` type at 20–22 stays where it is)
- Test: `tests/zoom-pan-pinch.test.ts` (create)

**Interfaces:**
- Produces: `export const pinchView = (r: DOMRect, v: View, a0: { x: number; y: number }, b0: { x: number; y: number }, a1: { x: number; y: number }, b1: { x: number; y: number }): View` — two fingers moved from `a0`, `b0` to `a1`, `b1` (pane px, from the pane's top-left): zoom by the change in their spread about the old midpoint, follow the midpoint, clamp with `clampZoom` then `clampView`, exactly as the wheel does. Not exported: `View` stays file-local (callers pass object literals).

Body (the algorithm; written as an offset from `v` like `zoomAbout`, so a pinch that moves nothing returns `v`'s numbers exactly):

```ts
export const pinchView = (r: DOMRect, v: View, a0: Point, b0: Point, a1: Point, b1: Point): View => {
  const spread0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const spread1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  // Coincident fingers have no spread to compare: keep the zoom, still follow the midpoint.
  const z = clampZoom(spread0 ? (v.z * spread1) / spread0 : v.z);
  const k = z / v.z;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  return clampView(r, z,
    v.x + (m1.x - m0.x) + (1 - k) * (m0.x - v.x),
    v.y + (m1.y - m0.y) + (1 - k) * (m0.y - v.y));
};
```

with `type Point = { x: number; y: number };` beside `View` (file-local).

- [ ] **Step 1: Write the failing test**

```ts
// tests/zoom-pan-pinch.test.ts — two fingers zoom about their midpoint and
// pan with it, clamped as the wheel is (phone layout, Phase 3).
import { expect, it } from "vitest";
import { pinchView, zoomAbout } from "../src/useZoomPan";

const R = { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect;
const P = (x: number, y: number) => ({ x, y });

it("doubling the spread about a still midpoint zooms 2x about it, as the wheel would", () => {
  const v = { z: 1, x: 0, y: 0 };
  const next = pinchView(R, v, P(300, 300), P(500, 300), P(200, 300), P(600, 300));
  expect(next).toEqual({ z: 2, x: -400, y: -300 });
  expect(next).toEqual(zoomAbout(R, v, 2, 400, 300));
});

it("moving both fingers together pans by the midpoint's move", () => {
  expect(pinchView(R, { z: 2, x: -400, y: -300 }, P(300, 300), P(500, 300), P(320, 310), P(520, 310)))
    .toEqual({ z: 2, x: -380, y: -290 });
});

it("zooms and pans in one move", () => {
  expect(pinchView(R, { z: 1, x: 0, y: 0 }, P(300, 300), P(500, 300), P(250, 350), P(650, 350)))
    .toEqual({ z: 2, x: -350, y: -250 });
});

// Review Focus 3: at the limits nothing moves (so liveView tells nobody, #726).
it("stops at the top of the range without drifting", () => {
  const v = { z: 2.5, x: -600, y: -450 };
  expect(pinchView(R, v, P(300, 300), P(500, 300), P(200, 300), P(600, 300))).toEqual(v);
});

it("stops at the bottom of the range, and a fitted view cannot pan", () => {
  const v = { z: 1, x: 0, y: 0 };
  expect(pinchView(R, v, P(300, 300), P(500, 300), P(350, 300), P(450, 300))).toEqual(v);
  expect(pinchView(R, v, P(300, 300), P(500, 300), P(350, 350), P(550, 350))).toEqual(v);
});

it("treats fingers that start on one spot as a pan, never NaN", () => {
  const v = { z: 2, x: -400, y: -300 };
  expect(pinchView(R, v, P(400, 300), P(400, 300), P(390, 300), P(410, 300))).toEqual(v);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/zoom-pan-pinch.test.ts`
Expected: FAIL, `pinchView` is not exported.

- [ ] **Step 3: Implement**

As above, with a doc comment that says what the four points are and that it clamps as the wheel does. Update the file's header comment: "wheel-to-zoom, right-drag pan" becomes "wheel-to-zoom, right-drag pan, one-finger pan and two-finger pinch".

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/zoom-pan-pinch.test.ts tests/zoom-pan-render-dom.test.tsx`
Expected: PASS (6 + existing). `npx tsc --noEmit`: clean.

- [ ] **Step 5: Commit**

```bash
git add src/useZoomPan.ts tests/zoom-pan-pinch.test.ts
git commit -m "Feat: Add the pinch math for zooming the preview with two fingers"
```

### Task 3.4: Pan with one finger, pinch with two

**Files:**
- Modify: `src/components/PreviewCompare.tsx` (`PreviewCompareHandle` 80–85; `useImperativeHandle` 191–195; the Escape effect 398–411)
- Modify: `src/useZoomPan.ts` (signature 69–73; right-drag pan 175–201; the return 203–206)
- Modify: `src/App.tsx` (move `const previewRef = useRef<PreviewCompareHandle>(null);` from 589 to just before the `useZoomPan` call at 559; pass it; the pane `div` at 2608–2640 and its comment)
- Modify: `tests/rulers-dom.test.tsx` (the handle literal at 64)
- Test: `tests/zoom-pan-touch-dom.test.tsx` (create), `tests/preview-touch-dom.test.tsx` (create)

**Interfaces:**
- Consumes: `pinchView` (Task 3.3), `clampView`, `liveView`.
- Produces on `PreviewCompareHandle`:
  - `layerGestureArmed: () => boolean` — a press is down on a layer (move) or a tick (resize), started or not.
  - `cancelLayerGesture: () => void` — ends that gesture exactly as Escape does: calls `onDragCancel` if it had moved (so App undoes its one step), clears the snap lines and readout, and drops it so later moves do nothing.
  Both come from one `const cancelLayerGesture = useCallback((): boolean => …, [onDragCancel])` that returns whether it undid a started gesture; the Escape effect calls it and, when it returns true, does its `preventDefault()` and `swallowClick.current = true` as today.
- Produces: `useZoomPan(is2d: boolean, previewPane: RefObject<HTMLDivElement | null>, canView: RefObject<CanViewHandle | null>, preview: RefObject<PreviewCompareHandle | null>)`. `onPanStart`, `onPanMove`, `onPanEnd` keep their names and take the `React.PointerEvent<HTMLDivElement>`; the return gains `onPaneClickCapture: (e: React.MouseEvent) => void`.
- Produces in `App.tsx`: the pane `div` gains `touch-none` in its class list and `onClickCapture={onPaneClickCapture}`.

The rules (each is a test below):
- Only `pointerType === "touch"` takes the new path; mouse and pen run today's code unchanged (right button pans, nothing else).
- A finger whose target is inside `[data-slot="rulers"], [contenteditable="true"], input, textarea` is not counted: the rulers' strips and guide handles, and the text being edited, own it. (Resize ticks and the divider stop `pointerdown` propagation, so the pane never sees them.)
- One finger pans, unless `preview.current?.layerGestureArmed()` is true when it lands (the layer drag took it).
- A second finger cancels any layer gesture (`cancelLayerGesture()`), and the two fingers pinch.
- A third finger is ignored until the fingers lift.
- When a finger of a pinch lifts or is cancelled, the other pans.
- Views change only `liveView`; React hears the zoom once, when a finger lifts (`setZoom(liveView.get().z)`, which React drops when unchanged, so a pan never renders). No undo step: the view is not the document.
- The click that follows a finger gesture that moved the view is swallowed in capture, so a pan never deselects (the pane's click) or picks (the sheet's click). A gesture that moved nothing leaves its click alone.

Body for the touch path (the state is the algorithm; place it after the right-drag pan and route to it from the three handlers with `if (e.pointerType === "touch") return onTouch…(e);` as their first line, after `onPanStart`'s reset):

```ts
  // Fingers on the pane (touch only), by pointerId, at their last event: one
  // pans unless the layer drag took it, two pinch, a third is ignored. Each
  // touch is captured to the element it landed on by the browser, and its
  // moves bubble here, so the pane takes no capture of its own.
  const fingers = useRef(new Map<number, Point>());
  const lonePans = useRef(false);
  /** The finger gesture moved the view: swallow the click it ends with. */
  const touchMoved = useRef(false);
  function onTouchDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!is2d || fingers.current.size === 2) return;
    if (e.target instanceof Element && e.target.closest(OWNS_ITS_FINGER)) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.current.size === 1) lonePans.current = !preview.current?.layerGestureArmed();
    else preview.current?.cancelLayerGesture();
  }
  function onTouchMove(e: React.PointerEvent<HTMLDivElement>) {
    const from = fingers.current.get(e.pointerId);
    if (!from) return;
    const to = { x: e.clientX, y: e.clientY };
    const r = e.currentTarget.getBoundingClientRect();
    const v = liveView.get();
    if (fingers.current.size === 2) {
      const other = [...fingers.current].find(([id]) => id !== e.pointerId)![1];
      const local = (p: Point) => ({ x: p.x - r.left, y: p.y - r.top });
      liveView.set(pinchView(r, v, local(from), local(other), local(to), local(other)));
    } else if (lonePans.current) {
      liveView.set(clampView(r, v.z, v.x + to.x - from.x, v.y + to.y - from.y));
    }
    fingers.current.set(e.pointerId, to);
    if (liveView.get() !== v) touchMoved.current = true;
  }
  function onTouchEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!fingers.current.delete(e.pointerId)) return;
    lonePans.current = true; // the finger left after a pinch pans
    setZoom(liveView.get().z);
  }
  function onPaneClickCapture(e: React.MouseEvent) {
    if (!touchMoved.current) return;
    touchMoved.current = false;
    e.stopPropagation();
  }
```

`const OWNS_ITS_FINGER = '[data-slot="rulers"], [contenteditable="true"], input, textarea';` at module level with a one-line comment. `onPanStart` begins with `if (!fingers.current.size) touchMoved.current = false;` so a new gesture (finger or mouse) never inherits an old swallow.

Planner's call: a second finger cancels the layer drag through the Escape path, so the layer returns and no undo step remains, rather than keeping the move. Pinches usually start on the label, which is mostly layers, and the first finger lands a few ms early; keeping its move would nudge a layer on most pinches. (Measured before: a pinch over Description resized it.)
Planner's call: a finger on a resize tick owns the gesture; a second finger does nothing until it lifts. The tick stops propagation, so the pane never saw the first finger and cannot pinch with it.
Planner's call: one finger on bare stock or on a locked layer pans: "pasteboard" is read as anything the move drag does not take, or a zoomed-in label (which fills the pane) could not be panned with one finger at all.
Planner's call: the zoom is published to React when a finger lifts, not after the wheel's 100 ms settle: a lift is the gesture's end, so no timer is needed.

- [ ] **Step 1: Write the failing PreviewCompare tests**

`tests/preview-touch-dom.test.tsx` — mount like `tests/inplace-editor-dom.test.tsx` (`measure`, `planAssets`, `boxOfLayer`; the sheet's rect stubbed to `W` 800 × `H = W * PAGE.h / PAGE.w`; `sheet.setPointerCapture = () => {}`), through `function mount({ layers = ALL, selected = [] }: { layers?: Layer[]; selected?: string[] } = {})` where `const ALL = lolevLayers()`, called in `beforeEach` with no options and again by any test that needs other layers or a selection: it renders into the same root and reassigns the file's `let sheet` (stubbing its rect and `setPointerCapture` each time). It passes `ref: handle` as a prop (`createElement(PreviewCompare, { ...props, ref: handle })`), `onDrag` and `onResize` as `vi.fn(() => ({ x: null, y: null, dx: 0, dy: 0 }))`, `onDragCancel` as `vi.fn()`. Helpers (`centre` always reads `ALL`, so a test can aim at a layer it left out):

```tsx
const centre = (id: string) => {
  const b = boxOfLayer(id, ALL, measure, planAssets)!;
  return { x: ((b.x + b.w / 2) / PAGE.w) * W, y: ((b.y + b.h / 2) / PAGE.h) * H };
};
const fire = (el: Element, type: string, x: number, y: number, pointerType = "touch") => act(() => {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, pointerType, clientX: x, clientY: y }));
});
```

```tsx
it("arms on a finger on an unlocked layer, not on bare stock, and disarms on lift", () => {
  const { x, y } = centre("name");
  fire(sheet, "pointerdown", x, y);
  expect(handle.current!.layerGestureArmed()).toBe(true);
  fire(sheet, "pointerup", x, y);
  expect(handle.current!.layerGestureArmed()).toBe(false);
  fire(sheet, "pointerdown", 1, 1);
  expect(handle.current!.layerGestureArmed()).toBe(false);
});

it("cancelLayerGesture undoes a drag that moved, once, and stops it", () => {
  const { x, y } = centre("name");
  fire(sheet, "pointerdown", x, y);
  fire(sheet, "pointermove", x + 20, y);
  expect(onDrag).toHaveBeenCalledTimes(1);
  act(() => handle.current!.cancelLayerGesture());
  expect(onDragCancel).toHaveBeenCalledTimes(1);
  fire(sheet, "pointermove", x + 40, y);
  expect(onDrag).toHaveBeenCalledTimes(1);
  expect(handle.current!.layerGestureArmed()).toBe(false);
});

it("cancelling a press that never moved undoes nothing", () => {
  const { x, y } = centre("name");
  fire(sheet, "pointerdown", x, y);
  act(() => handle.current!.cancelLayerGesture());
  expect(onDragCancel).not.toHaveBeenCalled();
  expect(handle.current!.layerGestureArmed()).toBe(false);
});

it("Escape mid-drag still undoes it (the shared path)", () => {
  const { x, y } = centre("name");
  fire(sheet, "pointerdown", x, y, "mouse");
  fire(sheet, "pointermove", x + 20, y, "mouse");
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  expect(onDragCancel).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Write the failing pane tests**

`tests/zoom-pan-touch-dom.test.tsx` — copy `tests/zoom-pan-render-dom.test.tsx`'s mocks, `PANE`, `mountEditor`, `settle` and `run`, with one change: the `PreviewCompare` stand-in also exposes a handle, so the pane's rules are tested without the real hit test (add `import type { PreviewCompareHandle } from "../src/components/PreviewCompare";`):

```tsx
const probe = vi.hoisted(() => ({
  renders: 0, preview: null as PreviewProps | null, actions: [] as Command[], view: null as LiveView | null,
  armed: false, cancel: null as null | (() => void),
}));
vi.mock("../src/components/PreviewCompare", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    SNAP_PT: 6,
    PreviewCompare: (props: PreviewProps & { ref?: import("react").Ref<PreviewCompareHandle> }) => {
      useImperativeHandle(props.ref, () => ({
        showArt() {}, showMask() {}, getPageElement: () => null,
        layerGestureArmed: () => probe.armed, cancelLayerGesture: () => probe.cancel!(),
      }));
      probe.renders++; probe.preview = props; return null;
    },
  };
});
```

`beforeEach`: `probe.armed = false; probe.cancel = vi.fn(() => { probe.armed = false; });`. Helpers:

```tsx
const finger = (el: Element, type: string, id: number, clientX: number, clientY: number) => act(() => {
  el.dispatchEvent(new PointerEvent(type, { pointerType: "touch", pointerId: id, button: 0, clientX, clientY, bubbles: true }));
});
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const viewOf = (layer: HTMLElement) => {
  const m = /translate\((\S+)px, (\S+)px\) scale\((\S+)\)/.exec(layer.style.transform)!;
  return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
};
const pick = (id: string) => act(() => { probe.preview!.onPick(id, {}); });
const undoDisabled = () => probe.actions.find((c) => c.id === "undo")!.disabled;
/** Fitted → 2x: fingers 11 and 12 spread from 200 to 400 apart about (400, 300). */
function pinchTo2x(pane: HTMLElement) {
  finger(pane, "pointerdown", 11, 300, 300);
  finger(pane, "pointerdown", 12, 500, 300);
  finger(pane, "pointermove", 11, 200, 300);
  finger(pane, "pointermove", 12, 600, 300);
}
```

Two Zoom In steps from fitted give `{ z: 1.5625, x: -225, y: -168.75 }` on the 800×600 pane (zoomed about its centre).

```tsx
it("asks the browser for no scrolling or zooming of its own", async () => {
  const { pane } = await mountEditor();
  expect(pane.className).toContain("touch-none");
});

it("one finger on the pasteboard pans, without rendering the editor", async () => {
  const { pane, layer } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  const before = probe.renders;
  finger(pane, "pointerdown", 11, 400, 300);
  finger(pane, "pointermove", 11, 380, 290);
  finger(pane, "pointermove", 11, 370, 280);
  expect(probe.renders - before).toBe(0);
  finger(pane, "pointerup", 11, 370, 280);
  expect(viewOf(layer)).toEqual({ z: 1.5625, x: -255, y: -188.75 });
});

it("two fingers pinch about their midpoint and publish the zoom when one lifts", async () => {
  const { pane, layer, field } = await mountEditor();
  const before = probe.renders;
  pinchTo2x(pane);
  expect(probe.renders - before).toBe(0);
  const v = viewOf(layer);
  expect(v.z).toBeCloseTo(2, 10); expect(v.x).toBeCloseTo(-400, 10); expect(v.y).toBeCloseTo(-300, 10);
  expect(field.value).toBe("200");
  finger(pane, "pointerup", 12, 600, 300);
  expect(probe.preview!.zoom).toBeCloseTo(2, 10);
});

it("the finger left after a pinch pans", async () => {
  const { pane, layer } = await mountEditor();
  pinchTo2x(pane);
  finger(pane, "pointerup", 12, 600, 300);
  finger(pane, "pointermove", 11, 160, 300);
  const v = viewOf(layer);
  expect(v.z).toBeCloseTo(2, 10); expect(v.x).toBeCloseTo(-440, 10); expect(v.y).toBeCloseTo(-300, 10);
});

it("a lone finger the layer drag took does not pan; a second cancels the drag and pinches", async () => {
  const { pane, layer } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  probe.armed = true;
  finger(pane, "pointerdown", 11, 300, 300);
  finger(pane, "pointermove", 11, 320, 300);
  expect(viewOf(layer)).toEqual({ z: 1.5625, x: -225, y: -168.75 });
  finger(pane, "pointerdown", 12, 500, 300);
  expect(probe.cancel).toHaveBeenCalledTimes(1);
  finger(pane, "pointermove", 12, 520, 300);
  expect(viewOf(layer).z).toBeCloseTo((1.5625 * 200) / 180, 10);
});

it("a third finger is ignored", async () => {
  const { pane, layer } = await mountEditor();
  pinchTo2x(pane);
  const at = layer.style.transform;
  finger(pane, "pointerdown", 13, 100, 100);
  finger(pane, "pointermove", 13, 50, 50);
  finger(pane, "pointerup", 13, 50, 50);
  expect(layer.style.transform).toBe(at);
});

it("a finger on a ruler or on the text being edited does not pan", async () => {
  const { pane, layer } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  const rulers = Object.assign(document.createElement("div"), { innerHTML: "<div></div>" });
  rulers.dataset.slot = "rulers";
  const field = document.createElement("div");
  field.setAttribute("contenteditable", "true");
  pane.append(rulers, field);
  for (const el of [rulers.firstElementChild!, field]) {
    finger(el, "pointerdown", 11, 400, 300);
    finger(el, "pointermove", 11, 350, 250);
    finger(el, "pointerup", 11, 350, 250);
  }
  expect(viewOf(layer)).toEqual({ z: 1.5625, x: -225, y: -168.75 });
});

it("a pan's trailing click keeps the selection; a still tap's click deselects", async () => {
  const { pane } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  pick("description");
  finger(pane, "pointerdown", 11, 400, 300);
  finger(pane, "pointermove", 11, 380, 300);
  finger(pane, "pointerup", 11, 380, 300);
  click(pane);
  expect(probe.preview!.selected).toEqual(["description"]);
  finger(pane, "pointerdown", 11, 400, 300);
  finger(pane, "pointerup", 11, 400, 300);
  click(pane);
  expect(probe.preview!.selected).toEqual([]);
});

// Review Focus 1
it("pinching and panning keep the selection and add no undo step", async () => {
  const { pane } = await mountEditor();
  pick("description");
  expect(undoDisabled()).toBe(true);
  pinchTo2x(pane);
  finger(pane, "pointerup", 12, 600, 300);
  finger(pane, "pointermove", 11, 150, 250);
  finger(pane, "pointerup", 11, 150, 250);
  expect(probe.preview!.selected).toEqual(["description"]);
  expect(undoDisabled()).toBe(true);
});

// Review Focus 2
it("a resting finger does not turn a tap into a gesture", async () => {
  const { pane, layer } = await mountEditor();
  pick("description");
  finger(pane, "pointerdown", 11, 100, 100);
  finger(pane, "pointerdown", 12, 500, 300);
  finger(pane, "pointerup", 12, 500, 300);
  click(pane);
  finger(pane, "pointerup", 11, 100, 100);
  expect(viewOf(layer)).toEqual({ z: 1, x: 0, y: 0 });
  expect(probe.preview!.selected).toEqual([]);
});

// Review Focus 3 (the pure limits are in tests/zoom-pan-pinch.test.ts)
it("a pinch below the bottom of the range reaches no listener", async () => {
  const { pane } = await mountEditor();
  let notified = 0;
  const stop = probe.view!.subscribe(() => { notified++; });
  finger(pane, "pointerdown", 11, 300, 300);
  finger(pane, "pointerdown", 12, 500, 300);
  finger(pane, "pointermove", 11, 350, 300);
  stop();
  expect(notified).toBe(0);
});

// Review Focus 5: rotating the phone cancels a finger and resizes the pane.
it("a cancelled finger mid-pinch leaves the other panning, inside the pane's new size", async () => {
  const { pane, layer } = await mountEditor();
  pinchTo2x(pane);
  pane.getBoundingClientRect = () => ({ ...PANE, right: 844, bottom: 241, width: 844, height: 241 }) as DOMRect;
  finger(pane, "pointercancel", 12, 600, 300);
  finger(pane, "pointermove", 11, -800, 300);
  const v = viewOf(layer);
  expect(v.z).toBeCloseTo(2, 10); expect(v.x).toBeCloseTo(-844, 10); expect(v.y).toBeCloseTo(-241, 10);
});

it("a mouse's left drag still does not pan, and fingers leave a 3D view's camera alone", async () => {
  const { pane, layer } = await mountEditor();
  run("zoom-in"); run("zoom-in");
  act(() => {
    pane.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", pointerId: 1, button: 0, clientX: 400, clientY: 300, bubbles: true }));
    pane.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", pointerId: 1, button: 0, clientX: 350, clientY: 250, bubbles: true }));
    pane.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", pointerId: 1, button: 0, clientX: 350, clientY: 250, bubbles: true }));
  });
  expect(viewOf(layer)).toEqual({ z: 1.5625, x: -225, y: -168.75 });
  run("view-can");
  const at = probe.view!.get();
  finger(pane, "pointerdown", 11, 400, 300);
  finger(pane, "pointermove", 11, 300, 200);
  expect(probe.view!.get()).toBe(at);
});
```

The fitted view is `translate(0px, 0px) scale(1)`, which `viewOf` reads as `{ z: 1, x: 0, y: 0 }`. In `tests/rulers-dom.test.tsx:64` add `layerGestureArmed: () => false, cancelLayerGesture() {}` to the handle literal.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/preview-touch-dom.test.tsx tests/zoom-pan-touch-dom.test.tsx`
Expected: FAIL: `layerGestureArmed` is not a function; no `touch-none`; fingers do not move the view. (`tsc` also fails on the rulers literal until Step 4.)

- [ ] **Step 4: Implement**

As in Interfaces and the body above. Comments: the handle members' doc comments as in Interfaces; the Escape effect's comment says it shares `cancelLayerGesture` with a second finger; `useZoomPan`'s right-drag comment gains "Fingers: below"; the pane comment in `App.tsx` replaces "Panning is right-button only, so a left click here is never the tail of a drag" with: a mouse pans with the right button; a finger gesture that moved the view swallows its trailing click (`onPaneClickCapture`), so this click is a tap or a left click, and `touch-none` keeps the browser from scrolling or zooming the page instead.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/preview-touch-dom.test.tsx tests/zoom-pan-touch-dom.test.tsx tests/zoom-pan-render-dom.test.tsx tests/rulers-dom.test.tsx tests/preview-pointercancel-dom.test.tsx tests/gesture-races-dom.test.tsx tests/app-v3-dom.test.tsx`
Expected: PASS. Then `npx tsc --noEmit && npm run lint`: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/PreviewCompare.tsx src/useZoomPan.ts src/App.tsx tests/preview-touch-dom.test.tsx tests/zoom-pan-touch-dom.test.tsx tests/rulers-dom.test.tsx
git commit -m "Feat: Pan the preview with one finger and pinch to zoom with two"
```

### Task 3.5: Finger-sized handles, and a finger inside a small layer moves it

**Files:**
- Modify: `src/components/previewOverlay.ts` (`HANDLES`, 11–22)
- Modify: `src/components/PreviewCompare.tsx` (`onHandleDown` 336–341, `onHandleUp` 353–359, the divider's class at 535)
- Modify: `src/components/Rulers.tsx` (the manual guide handle's class, 403–406)
- Test: `tests/preview-touch-dom.test.tsx` (modify), `tests/rulers-dom.test.tsx` (modify)

**Interfaces:**
- Produces in `previewOverlay.ts`: each unlocked tick's `cls` gains, after the existing classes, `touch:after:absolute touch:after:size-tap touch:after:content-['']` and its outward placement: horizontally `touch:after:right-1` (hx −1), `touch:after:left-1` (hx 1) or `touch:after:left-1/2 touch:after:-translate-x-1/2` (hx 0); vertically `touch:after:bottom-1` (hy −1), `touch:after:top-1` (hy 1) or `touch:after:top-1/2 touch:after:-translate-y-1/2` (hy 0). `clsLocked` is unchanged. The tick is `size-2` (0.5rem), so `right-1`/`left-1` (0.25rem) puts the 44px area's inner edge at the tick's centre: it reaches outward, away from the layer.
- Produces in `PreviewCompare`: a file-local `const insideBox = (e: { clientX: number; clientY: number }, id: string): boolean` — whether the pointer is over layer `id`'s own box (`pagePointOf` against `pageElement.current`, then `hitTestBoxes` with that one box). `onHandleDown` returns early, without `stopPropagation`, when `e.pointerType === "touch" && insideBox(e, id)`, so the press bubbles to the sheet's move drag. `onHandleUp` returns at once when `resize.current` is null (no resize to end), so a move that started on a tick ends at the sheet. The divider gains `touch:w-tap`.
- Produces in `Rulers.tsx`: the manual guide handle gains `touch:w-tap touch:-translate-x-1/2` (vertical) or `touch:h-tap touch:-translate-y-1/2` (horizontal).

Planner's call: on touch the layer's box moves and the ring outside it resizes. Chrome aims a press near a tick at the tick (measured: a finger at a 23px layer's centre resized it), so the tick hands an inside press back by position; the 44px area reaches outward only, or on a small layer it would cover the whole box.
Planner's call: the divider's 44px also covers the label's left 22px at a split of 0 on touch; dragging from there reveals the mask, which is what the divider is for. It has no visible change.
Planner's call: manual guide handles get 44px on touch (they are drag targets); the ruler strips stay 24px, since growing them would grow the rulers or cover the label, and a strip is a band you drag from, so only its height is aimed.
Planner's call: the ruler corner's 44px touch target, which covers 20×20px of the pane past the rulers (a tap there opens Ruler settings, measured), is not in this phase: nothing is lost but a pan starting in that square, and any fix would shrink a target Phase 2 grew on purpose.

- [ ] **Step 1: Write the failing tests**

In `tests/preview-touch-dom.test.tsx` (the tick tests call `mount({ selected: ["name"] })` first; stub `setPointerCapture` on each tick they fire at):

```tsx
const tick = (key: string) => container.querySelector(`[data-resize-handle="${key}"]`)!;

it("a finger the browser aims at a tick but that lands inside the layer moves it", () => {
  const { x, y } = centre("name");
  fire(tick("1,0"), "pointerdown", x, y);
  fire(tick("1,0"), "pointermove", x + 20, y);
  expect(onResize).not.toHaveBeenCalled();
  expect(onDrag).toHaveBeenCalledWith("name", expect.any(Number), 0, true);
  fire(tick("1,0"), "pointerup", x + 20, y);
  expect(handle.current!.layerGestureArmed()).toBe(false);
});

it("a finger on a tick outside the layer resizes it", () => {
  const b = boxOfLayer("name", ALL, measure, planAssets)!;
  const x = ((b.x + b.w) / PAGE.w) * W + 6, y = ((b.y + b.h) / PAGE.h) * H + 6;
  fire(tick("1,1"), "pointerdown", x, y);
  fire(tick("1,1"), "pointermove", x + 20, y + 10);
  expect(onResize).toHaveBeenCalledTimes(1);
  expect(onDrag).not.toHaveBeenCalled();
});

it("a mouse on a tick resizes as before, wherever on the tick it lands", () => {
  const { x, y } = centre("name");
  fire(tick("1,0"), "pointerdown", x, y, "mouse");
  fire(tick("1,0"), "pointermove", x + 20, y, "mouse");
  expect(onResize).toHaveBeenCalledTimes(1);
  expect(onDrag).not.toHaveBeenCalled();
});

it("gives the divider a finger-wide hit area", () => {
  expect(container.querySelector('[data-slot="resizable-handle"]')!.className).toContain("touch:w-tap");
});
```

And a pure block in the same file:

```tsx
import { HANDLES } from "../src/components/previewOverlay";
const handleCls = (key: string) => HANDLES.find((h) => h.key === key)!;

it("resize ticks reach 44px outward on touch and look the same", () => {
  for (const h of HANDLES) {
    expect(h.cls).toContain("absolute size-2 rounded-[1px] border border-sky-400 bg-background");
    expect(h.cls).toContain("touch:after:size-tap");
    expect(h.clsLocked).not.toContain("touch:after");
  }
  expect(handleCls("-1,-1").cls).toContain("touch:after:right-1");
  expect(handleCls("-1,-1").cls).toContain("touch:after:bottom-1");
  expect(handleCls("1,1").cls).toContain("touch:after:left-1");
  expect(handleCls("1,1").cls).toContain("touch:after:top-1");
  expect(handleCls("0,-1").cls).toContain("touch:after:left-1/2 touch:after:-translate-x-1/2");
  expect(handleCls("0,-1").cls).toContain("touch:after:bottom-1");
});
```

In `tests/rulers-dom.test.tsx`:

```tsx
it("gives manual guide handles a finger-wide hit area", () => {
  renderRulers();
  expect(container.querySelector('[aria-label^="Vertical manual guide;"]')!.className).toContain("touch:w-tap");
  expect(container.querySelector('[aria-label^="Horizontal manual guide;"]')!.className).toContain("touch:h-tap");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/preview-touch-dom.test.tsx tests/rulers-dom.test.tsx`
Expected: the inside-the-box finger resizes (`onResize` called); class assertions fail; the outside-tick and mouse tests pass.

- [ ] **Step 3: Implement**

As in Interfaces. Comments: `HANDLES` doc says the tick's touch area is 44px, reaching away from the layer, invisible (`::after`, as `ui/switch.tsx` does); `onHandleDown` says why a finger inside the box is handed back (Chrome aims nearby presses at the tick; the event keeps the finger's position); `onHandleUp` says why it returns when no resize ran.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/preview-touch-dom.test.tsx tests/rulers-dom.test.tsx tests/preview-pointercancel-dom.test.tsx tests/gesture-races-dom.test.tsx tests/app-v3-dom.test.tsx tests/module-size.test.ts`
Expected: PASS. Then `npx tsc --noEmit && npm run lint`: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/previewOverlay.ts src/components/PreviewCompare.tsx src/components/Rulers.tsx tests/preview-touch-dom.test.tsx tests/rulers-dom.test.tsx
git commit -m "Fix: A finger moves a small layer instead of resizing it, and handles get finger-sized reach"
```

### Task 3.6: Double-tap a text layer to edit it

**Files:**
- Modify: `src/components/PreviewCompare.tsx` (after `DRAG_THRESHOLD_PX` at 47–48; `onPointerDown`/`onPointerUp` 361–391; `onDoubleClick` 452–473)
- Test: `tests/preview-touch-dom.test.tsx` (modify)

**Interfaces:**
- Produces: `const DOUBLE_TAP_MS = 300;` (doc comment: two finger taps on the same layer this close open it in place, like a double-click). `function startEditing(e: React.MouseEvent<HTMLDivElement>, id: string): void` — the body of today's `onDoubleClick` after its hit test (the text-kind check, the pill position, `edited.current = false`, `setEditing(id)`); `onDoubleClick` becomes `const id = hitOf(e); if (id) startEditing(e, id);`. `onDoubleClick` also returns at once while a session is open (`if (editing) return;`): on a desktop the click-away has already closed it by then, so nothing changes there; on touch the `dblclick` Chrome sends after a double-tap, aimed at a tick, must not move the new session to another layer. A `lastTap = useRef<{ id: string; at: number } | null>(null)`. In `onPointerUp`, for a real `pointerup` with `pointerType === "touch"`, no open session (`!editing`) and a press that did not become a drag (`!drag.current?.started`), before `drag.current` is cleared:

```ts
    const id = hitOf(e) ?? null;
    const prev = lastTap.current, now = Date.now();
    if (id && prev?.id === id && now - prev.at <= DOUBLE_TAP_MS) { lastTap.current = null; startEditing(e, id); }
    else lastTap.current = id ? { id, at: now } : null;
```

Planner's call: the detector reads raw `pointerup` positions, not `click` or `dblclick`: Chrome delivers `dblclick` on a touch double-tap but aims it, and the clicks, at a resize tick near a small selected layer (measured), so their positions miss the layer. `pointerup` keeps the finger's position. The `dblclick` path stays for the mouse and wherever it already works; a `dblclick` that follows lands on the open field, whose wrapper stops it.
Planner's call: `Date.now()`, so tests step the clock with `vi.spyOn(Date, "now")`.
Planner's call: no taps are counted while a session is open: two taps inside the field place the caret; re-running `startEditing` there would reset `edited` and lose the session's commit.
Planner's call: a locked text layer opens, as `onDoubleClick` opens it today (lock stops moving, not typing).

- [ ] **Step 1: Write the failing tests**

```tsx
const tapAt = (id: string, at: number, pointerType = "touch", on: Element = sheet) => {
  vi.spyOn(Date, "now").mockReturnValue(at);
  const { x, y } = centre(id);
  fire(on, "pointerdown", x, y, pointerType);
  fire(on, "pointerup", x, y, pointerType);
  act(() => { on.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y })); });
};
const editorOf = (name: string) => document.querySelector(`[aria-label="Edit ${name} text"]`);

it("two taps on a text layer within 300ms edit it in place", () => {
  tapAt("name", 1000); tapAt("name", 1300);
  expect(editorOf("name")).not.toBeNull();
});

it("taps 301ms apart, or on two layers, do not", () => {
  tapAt("name", 1000); tapAt("name", 1301);
  expect(editorOf("name")).toBeNull();
  tapAt("volume", 2000); tapAt("name", 2100);
  expect(editorOf("name")).toBeNull();
});

it("two mouse clicks do not; a double-click still does", () => {
  tapAt("name", 1000, "mouse"); tapAt("name", 1100, "mouse");
  expect(editorOf("name")).toBeNull();
  const { x, y } = centre("name");
  act(() => { sheet.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y })); });
  expect(editorOf("name")).not.toBeNull();
});

it("a double-tap the browser aims at a tick of the selected layer still opens it", () => {
  mount({ selected: ["name"] });
  tapAt("name", 1000, "touch", tick("1,0")); tapAt("name", 1200, "touch", tick("1,0"));
  expect(editorOf("name")).not.toBeNull();
});

// Review Focus 4
it("a locked text layer opens as its double-click does", () => {
  // "warning" is locked in the Lolev fixture
  tapAt("warning", 1000); tapAt("warning", 1200);
  expect(editorOf("warning")).not.toBeNull();
});

it("a hidden layer opens nothing", () => {
  mount({ layers: ALL.filter((l) => l.id !== "name") }); // App passes only the layers that draw
  tapAt("name", 1000); tapAt("name", 1200);
  expect(editorOf("name")).toBeNull();
});

it("a dblclick after a double-tap opened a session leaves it where it is", () => {
  tapAt("name", 1000); tapAt("name", 1200);
  const { x, y } = centre("volume");
  act(() => { sheet.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y })); });
  expect(editorOf("name")).not.toBeNull();
  expect(editorOf("volume")).toBeNull();
});
```

`afterEach`: `vi.restoreAllMocks()`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/preview-touch-dom.test.tsx`
Expected: the double-tap tests and the dblclick-after test FAIL (no editor); the 301ms, mouse and hidden tests pass.

- [ ] **Step 3: Implement**

As in Interfaces. Update the file's header comment ("double-clicking a text layer edits it IN PLACE" gains "or double-tapping it") and the comment above `onDoubleClick`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/preview-touch-dom.test.tsx tests/inplace-editor-dom.test.tsx tests/preview-empty-text-dom.test.tsx tests/module-size.test.ts`
Expected: PASS. Then `npx tsc --noEmit && npm run lint`: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/PreviewCompare.tsx tests/preview-touch-dom.test.tsx
git commit -m "Feat: Double-tap a text layer to edit it on the label"
```

### Task 3.7: Measure again, check the desktop, document

**Files:**
- Modify: `.agents/ledger.md` (the `2026-11-12 phone-gestures` entry)
- Modify: `docs-site/content/docs/(authoring)/preview.mdx` (`## Zoom and pan`, 18–23), `docs-site/content/docs/(authoring)/editing.mdx` (`## Typing`, 16), `docs-site/content/docs/(reference)/shortcuts.mdx` (Pan and Zoom rows, 58–59)
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

- [ ] **Step 1: Run the probe on the finished branch**

Same dev server, same command: `node .agents/mockups/phone-gestures/probe.mjs http://localhost:5190/ .agents/mockups/phone-gestures after` (`probe.mjs` unchanged since Task 3.1). Expected:

| Scenario | Expected after |
|---|---|
| `pan` | `after.transform` `translate(-255px, -427.5px) scale(2)` (moved exactly −60, −80); `pageZoom` 1; `pointercancel` 0; `undo` 0 |
| `pinch` | `after.zoomField` "250" (spread 80 → 200, capped); `pageZoom` 1; `undo` 0 |
| `drag` | outline w and h unchanged (23.3 × 22.6); x and y moved by 30 and 20, each within 4px (a snap may pull it); `undo` 1 |
| `secondFinger` | `undo` 0 (the drag was undone); `selected` ["description"]; `pageZoom` 1; scale not 1 |
| `liftOne` | `pinched` scale 2.5; `after` the same scale, translate x 60 less than `pinched` (or clamped at −585); `pageZoom` 1 |
| `pinchOnLayer` | `undo` 0; `selected` ["description"]; scale above 1; `pageZoom` 1 |
| `doubleTap-description` | `editing` true; `focus` `DIV[contenteditable]`; `selectionText` "" |
| `doubleTap-warning` | `editing` true; `selectionText` "" |
| `resize` | `tickSize` [6.5, 6.5]; `tickPlus14` `SPAN[tick 1,1]`; outline 20 ± 4 px wider; `undo` 1 |
| `guide` | `guides` 1; `pointercancel` 0 |
| `split` | "28" (± 1) |
| `corner` | unchanged (deferred) |
| `can` | unchanged: all three true, `pageZoom` 1 |
| `fit` | `whole` true at all three sizes; 390x844 sheet [21, 153.2, 369, 232.8] |
| `desktop` | `wheel`, `rightDrag` and `doubleClick` identical to `before.json` (transforms, `editing`, `outline`) |

A row that misses is a defect in the task that owns it: fix it there (same commit style) and run the probe again. If `doubleTap-*` shows a non-empty `selectionText` (the trailing `dblclick` selected a word), fix it in Task 3.6's code by collapsing the selection to the end in a sheet `onDoubleClickCapture` that runs only when the double-tap opened the session within the last 300 ms, with a test, and measure again.

- [ ] **Step 2: Phone layout numbers**

The Phase 2 Task 2.1 procedure at 390×844 for **fresh** and **selected**, as in Task 3.1 Step 4. Expected: identical to the baseline.

- [ ] **Step 3: Desktop mouse behaviour**

The probe's `desktop` block is the mouse check: wheel zoom, right-drag pan and double-click edit, each a measured reading compared with `before.json`. Expected: equal.

- [ ] **Step 4: Compare the desktop screenshots**

```bash
node -e '
const { PNG } = require("pngjs"); const fs = require("fs");
const dir = ".agents/mockups/phone-gestures";
for (const [a, b] of [["before-desktop-fresh", "before-2-desktop-fresh"], ["before-desktop-selected", "before-2-desktop-selected"],
                      ["before-desktop-fresh", "after-desktop-fresh"], ["before-desktop-selected", "after-desktop-selected"]]) {
  const x = PNG.sync.read(fs.readFileSync(`${dir}/${a}.png`)), y = PNG.sync.read(fs.readFileSync(`${dir}/${b}.png`));
  if (x.width !== y.width || x.height !== y.height) { console.log(a, b, "size differs"); continue; }
  let diff = 0;
  for (let i = 0; i < x.data.length; i += 4) if (x.data.readUInt32BE(i) !== y.data.readUInt32BE(i)) diff++;
  console.log(a, "vs", b, "differing pixels:", diff);
}'
```

Expected: each before/after pair differs by no more than its before/before-2 pair. If more, view both images, find the change and fix the class or style that reached the desktop; do not accept a difference.

- [ ] **Step 5: Docs**

- `preview.mdx`, `## Zoom and pan`: after the right-button bullet, add: "- On a touch screen, drag with one finger where there is no layer to pan, and pinch with two fingers to zoom. One finger on a layer moves it, as the mouse does." Change "Type a figure. `100` fits the view" to "Type a figure. `100` fits the whole label in the pane".
- `editing.mdx`, `## Typing`: "Double-click a text layer on the preview" becomes "Double-click (or double-tap) a text layer on the preview".
- `shortcuts.mdx`: the Pan row's right column becomes "Right-button drag, or one finger"; the Zoom row's "Scroll or pinch. Type a % in the status bar" stays.
- No other page describes canvas gestures (`grep -rn -i "pinch\|right-button\|double-click a text" docs-site/content` to confirm).

- [ ] **Step 6: CHANGELOG**

Under `## [Unreleased]` → `### Added`, after the existing bullets:

- **Pan and zoom the label with your fingers.** On a phone or tablet, drag with one finger to move around the label and pinch with two to zoom. The page no longer zooms instead.
- **Double-tap to type on the label.** Double-tapping a text layer edits it in place, as a double-click does.

Under `### Fixed`, first:

- **100% shows the whole label.** In a short window, or on a phone held sideways, the bottom of the label was cut off at 100% until you zoomed or panned.
- **A finger moves a small layer.** Dragging a small selected layer with a finger resized it instead of moving it. The resize handles now take a touch just outside the layer, with room for a finger, and guides and the Label/Mask divider can be dragged by finger too.

No version bump.

- [ ] **Step 7: Full checks**

```bash
npx tsc --noEmit && npm run lint && npm test && npx --yes knip@6.38.0 && node scripts/check-release.mjs feat/phone-shell
(cd docs-site && npm run types:check && npm run build)
```

Expected: all pass.

- [ ] **Step 8: Ledger and commit**

Update the `2026-11-12 phone-gestures` entry: `status: done`, `measured at <short SHA>`, `delta:` each scenario's before → after reading, the Step 2 phone numbers, the four pixel-compare counts, the desktop mouse readings, `release: binary-impacting; four bullets queued under [Unreleased]`, and `not measured (needs a real phone)`: iOS Safari's double-tap (whether `pointerup` arrives for both taps, and whether the page zooms on double-tap despite `touch-none`), Android Chrome with a real finger's touch radius (larger than the probe's 4px, so more presses are aimed at ticks), the ruler strips at 24px under a finger, rotating mid-pinch, and the Can view by finger on a real GPU.

```bash
git add .agents/ledger.md docs-site/content/docs CHANGELOG.md
git commit -m "Docs: Describe the canvas touch gestures and record their measurements"
```

Do not push.

### Phase 3 checkpoint

Stop. Report: the commits, the before and after readings, the pixel-compare counts, and the deferred ruler corner. Ask the user to try on a real phone (`npm run dev -- --host`, over Wi-Fi): pan with one finger, pinch, rest one finger and tap with another, drag a small layer, resize from just outside it, double-tap a text layer, drag out a guide, slide the divider, rotate mid-pinch, orbit and pinch the Can view. Then ask whether to push and open the PR, and against which base.

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
