# Canvas Preview Renderer — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the canvas-preview-renderer effort: move the PSD builder onto the shared display list (byte-identical exports), add drag-to-move for the position-adjustable elements, and make the label font config-driven through the `fonts.ts` gate.

**Architecture:** Three independent sub-phases, each separately shippable with its own version + changelog. 4a: `psd/build.ts` keeps authoring *editable* Photoshop layers (type layers, style runs, effects) but reads every placement it currently re-derives — centered-text x, the laurel's nudged origin, barcode geometry — from `planLabel` consumed with the same PDFFont measure the PDF backend uses. 4b: dragging on the 2D preview writes the *existing* persisted position knobs (`logo.offsetY`, `collabLeft.offsetY`, `collabCenter.offsetY`) through the same undo-coalescing path the in-place editor uses; no stored-format change. 4c: font *infrastructure* only — a Node-safe font catalog (`fontCatalog.ts`, poppins its sole entry) becomes the single source for family ids, labels, PostScript names, and file basenames; `fonts.ts` stays the one DOM gate, now family-aware; `cfg.fontFamily` (optional, absent = poppins) drives every renderer. Font *sourcing* (Google Fonts browse/download + external TTF import) is Phase 5, separately specced.

**Tech Stack:** TypeScript, React, vitest (node env — pure-logic tests only, DOM verified in real Chrome), pdf-lib + fontkit (metrics), ag-psd, Vite.

**Spec:** `docs/superpowers/specs/2026-08-25-canvas-preview-renderer-design.md` (Phase 4 = "Follow-ons"). The 3D-from-canvas follow-on already landed in Phase 3.

## Global Constraints

- Worktree: `/Users/tedslesinski/Repos/art-files/.claude/worktrees/update-dialog`, branch `fix/code-review-findings`. Verify with `pwd` + `git branch --show-current` before any edit. Never bare `git stash`; never kill processes by name pattern (another session's vite runs on :5173).
- Every sub-phase ends green: `npx tsc --noEmit` and `npx vitest run` (currently 260 tests).
- Release steward (`.agents/release-steward.md`): each binary-impacting sub-phase carries a synchronized version bump across SIX files — `npm version <X> --no-git-tag-version` (package.json + package-lock.json's two root entries), hand-edit `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `label-lab` entry), `src-tauri/tauri.conf.json` — then `node scripts/check-release.mjs origin/main` must pass, plus a `CHANGELOG.md` entry. Versions: 4a = 0.1.20, 4b = 0.1.21, 4c = 0.1.22.
- Do not merge or push without explicit user approval.
- 4a's hard gate: exported PSDs (art AND mask plates, default config AND the marker-heavy fixture) must be **byte-identical** before vs. after.
- After 4c (the only sub-phase touching the on-screen renderer's text path): run `npm run parity` — all rows must PASS at the 5% threshold (last observed 2.04–2.48%; expect similar for Poppins since geometry is unchanged).
- Documentation is part of each commit: stale module comments updated in the same change; new files carry a module-level comment.
- `.agents/ledger.md`: append one entry per sub-phase when it completes (format at the top of that file).
- Deferred minors from the Phase-3 ledger entry, dispositioned here: **planFrom() helper** — landed in 4c (both `planLabel` call sites are touched there). **Shared buildError split** — NOT needed: 4b and 4c add no new writers to the channel (drag mutates cfg and reuses the existing render effect; a font-load failure surfaces through the existing measure-loading error path). **Mask repaint at split 0, drawPlates unit pin, half-painted-plate robustness, barcode-halo translate-index pin** — not intersected by this work; they stay deferred in the ledger.

---

## Sub-phase 4a — PSD onto the plan (v0.1.20)

The last placement duplicate. `psd/build.ts` re-derives three things `planLabel` already computes with the same pdf-lib metrics: (1) `centered()` — the x of each centered text layer; (2) the laurel's nudged origin (`logoCy` + the `svgToPaths` offsets); (3) barcode geometry (`barcodeGeometry`, digit `yStart`s, `barcodeFootprint`, `barcodeStrokePt`). Deliberately **kept local** (each with a comment saying why): the QR's circle beziers (`qrShapes` — the plan's merged `qrPath` string is per-pixel-equivalent but not the node-editable circle geometry the PSD promises), `wrapWarning` (shared code already, and the layer needs the wrapped *strings*, which the plan's per-word justified runs don't carry), and every style/leading/justification decision (Photoshop lays those out itself — that's the point of type layers).

### Task 1: Byte-identity baseline

**Files:**
- Create: `<scratchpad>/phase4a/fixture-config.json` (scratch only, never committed)
- Create: `<scratchpad>/phase4a/before/` output directory

**Interfaces:**
- Produces: baseline PSD bytes that Task 3 compares against with `cmp`.

- [ ] **Step 1: Verify context**

Run: `pwd && git branch --show-current && git status --short`
Expected: the worktree path above, `fix/code-review-findings`, clean tree.

- [ ] **Step 2: Write the marker-heavy fixture config**

Start from the app's defaults and override the fields that exercise the PSD's styled paths. Generate it (adjust nothing else):

```bash
npx tsx -e '
import { defaultConfig } from "./src/defaults";
const c = defaultConfig();
c.description = "# HOPS UP FRONT\nA **bold** line\n_white ink line_\nplain line";
c.nameStyle.letterSpacing = 2;
c.nameStyle.stroke = "#112233"; c.nameStyle.strokeWidth = 12;
c.styleLine.bold = true;
c.storeCold.bold = true;
c.descStyle.stroke = "#445566"; c.descStyle.strokeLayer = "metallic";
c.barcodeStroke = "#ffffff"; c.barcodeStrokeWidth = 20;
c.qrStroke = "#ffffff"; c.qrStrokeWidth = 18;
c.logo.offsetY = 10; c.collabEnabled = true;  // engages logoNudge
console.log(JSON.stringify({ version: 1, ...c }, null, 2));
' > "$SCRATCH/phase4a/fixture-config.json"
```

(`$SCRATCH` = the session scratchpad directory; create `phase4a/before` and `phase4a/after` under it first. If `parseConfigFile` rejects the fixture in the next step, fix the fixture, not the parser.)

- [ ] **Step 3: Snapshot baseline exports**

Run `npm run generate` twice into `before/` (check `scripts/generate.ts`'s usage line for exact argv; texture/mask can be `none`):

```bash
npm run generate -- none none "$SCRATCH/phase4a/before/default"
npm run generate -- none none "$SCRATCH/phase4a/before/fixture" "$SCRATCH/phase4a/fixture-config.json"
ls -la "$SCRATCH/phase4a/before"/*
```

Expected: PDF and PSD outputs for both plates in each directory. Note the exact PSD filenames — Task 3 diffs them. If `generate` does not emit a mask-mode PSD, add a temporary scratch script that calls `buildPsd(cfg, assets, "mask")` directly and write those bytes beside the generated ones (both before and after, same script).

### Task 2: Consume the plan in `psd/build.ts`

**Files:**
- Modify: `src/psd/build.ts`
- Test: `tests/psd-build.test.ts` (must stay green unmodified; add nothing yet)

**Interfaces:**
- Consumes: `planLabel(cfg, m, { assets })`, `PlacedText`, `PlacedPaths`, `PlacedBarcode` from `src/plan.ts` (already exported). The measure adapter mirrors `src/pdf/build.ts:270-271`.
- Produces: same `buildPsd(cfg, assets, mode)` signature; byte-identical output.

- [ ] **Step 1: Build the plan once in `buildLayers`**

At the top of `buildLayers` (thread it from `buildPsd`, which owns `f`):

```ts
const pdfMeasure: MeasureFace = (t, size, face) =>
  (face === "bold" ? f.bold : face === "semibold" ? f.semibold : f.regular)
    .widthOfTextAtSize(t, size);
// Text + laurel + barcode placement, from the same display list every other
// backend consumes. The PSD draws no collab art, so no collab assets go in —
// the plan simply plans none.
const plan = planLabel(cfg, pdfMeasure, { assets: { logoSvg: assets.logoSvg } });
```

Add a small lookup — the min-x of an element's planned runs is exactly what `centered()` computed (both subtract half the tracked runs-width from the same cx, with the same PDFFont measure):

```ts
const planned = <K extends Placed["kind"]>(id: string, kind: K) =>
  plan.filter((p): p is Extract<Placed, { kind: K }> => p.kind === kind && p.id === id);
const textX = (id: ElementId) => Math.min(...planned(id, "text").map((r) => r.x));
```

- [ ] **Step 2: Replace the placement duplicates**

- `Wordmark` / `Beer name` / `Style line` layers: `x: textX("wordmark")` (etc.) replaces the `centered(...)` calls; delete the now-unused `centered` helper and its comment block (its reasoning moves to a one-line pointer at `textX`).
- Logo layer: take the plan's item — `const logoItem = planned("logo", "paths")[0];` — and build `logoPaths` as `logoItem.paths.flatMap((d) => svgToPaths(d, logoItem.x, logoItem.y))`. Delete the local `parseLogo`/`logoCy` derivation (and the `logoNudge` import if now unused). Note: the plan computes the identical `parseLogo(svg, L.LOGO.w)` and `L.LOGO.cx - w/2` / `logoCy - h/2` offsets, so bytes cannot move.
- Barcode (in `codeLayers`, thread `plan` in): `const bc = planned("barcode", "barcode")[0] as PlacedBarcode;` then use `bc.geo` for bars, `bc.digits[i].y` as each digit group's `yStart` (delete the re-derived `geo.bottom - d.center * geo.mod + measure(d.text)/2` expression), `bc.S` for the halo width, and `bc.footprint` for the mask-mode footprint (it is `barcodeFootprint(geo, 0, measure)` by construction). Delete the local `barcodeGeometry` / `barcodeStrokePt` / `barcodeFootprint` calls and imports.
- Leave the QR on `qrShapes` and the warning on `wrapWarning` — add the one-line "kept local because…" comments described in the sub-phase intro.
- Update the module-level comment: the PSD now takes placement from `plan.ts` like every other backend.

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit && npx vitest run tests/psd-build.test.ts`
Expected: clean, all PSD tests pass untouched.

- [ ] **Step 4: Commit**

```bash
git add src/psd/build.ts
git commit -m "refactor: psd/build.ts takes placement from the shared display list"
```

### Task 3: Byte-identity gate + release chores

**Files:**
- Modify: `CHANGELOG.md`, `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `.agents/ledger.md`

- [ ] **Step 1: Regenerate and compare**

```bash
npm run generate -- none none "$SCRATCH/phase4a/after/default"
npm run generate -- none none "$SCRATCH/phase4a/after/fixture" "$SCRATCH/phase4a/fixture-config.json"
for f in $(cd "$SCRATCH/phase4a/before" && find . -name '*.psd'); do
  cmp "$SCRATCH/phase4a/before/$f" "$SCRATCH/phase4a/after/$f" && echo "IDENTICAL: $f"
done
```

Expected: `IDENTICAL` for every PSD (and run the same `cmp` over the PDFs — they must be untouched too). ANY byte difference = stop, diagnose with `readPsd` on both files, fix the refactor (never the baseline).

- [ ] **Step 2: Full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 260 tests green.

- [ ] **Step 3: Version 0.1.20 + changelog + ledger**

`npm version 0.1.20 --no-git-tag-version`; hand-edit the three `src-tauri` files to `0.1.20`; add a CHANGELOG entry ("PSD builder now places from the shared display list; exports byte-identical"); `node scripts/check-release.mjs origin/main` must pass. Append the 4a ledger entry to `.agents/ledger.md` (status done, delta = "placement duplicates in psd/build.ts 3 → 0; PSD bytes identical across default+fixture, both plates; 260 tests green").

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: bump version to 0.1.20 and record the PSD-on-plan changelog"
```

**CHECKPOINT: report scope remaining and pause for user review before 4b.**

---

## Sub-phase 4b — Drag-to-move on the 2D preview (v0.1.21)

Scope ruling (from the brainstorm): drag moves only the elements that already carry a persisted position knob — `logo.offsetY` (only meaningful while `collabEnabled`, per `logoNudge`), `collabLeft.offsetY`, `collabCenter.offsetY` — vertically, by writing that existing field. No schema change; every backend and the hit-tester already honor `offsetY`, so boxes, exports, and the preview move together for free. Free-dragging text elements is out of scope by design: `types.ts`'s `Positioned` comment records that text is baseline-positioned deliberately.

### Task 4: Pure drag-target helper

**Files:**
- Modify: `src/elements.ts`
- Test: `tests/elements.test.ts`

**Interfaces:**
- Produces: `dragTarget(cfg: LabelConfig, slots: CollabSlots, id: ElementId): { get(): number; set(c: LabelConfig, v: number): void } | null` — null means "not draggable right now". `set` mutates the passed (already-cloned) config, matching how App's `update(fn)` works.

- [ ] **Step 1: Write the failing tests** (append to `tests/elements.test.ts`)

```ts
import { dragTarget } from "../src/elements";

describe("dragTarget", () => {
  it("logo drags only while collab is on (offsetY is ignored otherwise)", () => {
    const cfg = defaultConfig();
    const slots = { left: false, center: false };
    cfg.collabEnabled = false;
    expect(dragTarget(cfg, slots, "logo")).toBeNull();
    cfg.collabEnabled = true;
    const t = dragTarget(cfg, slots, "logo")!;
    expect(t.get()).toBe(cfg.logo.offsetY ?? 0);
    const next = structuredClone(cfg);
    t.set(next, 12.5);
    expect(next.logo.offsetY).toBe(12.5);
  });

  it("collab slots drag only when their art is loaded", () => {
    const cfg = defaultConfig();
    cfg.collabEnabled = true;
    expect(dragTarget(cfg, { left: false, center: false }, "collabLeft")).toBeNull();
    const t = dragTarget(cfg, { left: true, center: false }, "collabLeft")!;
    const next = structuredClone(cfg);
    t.set(next, -3);
    expect(next.collabLeft.offsetY).toBe(-3);
  });

  it("everything else is not draggable", () => {
    const cfg = defaultConfig();
    cfg.collabEnabled = true;
    for (const id of ["name", "description", "barcode", "qr", "warning"] as const)
      expect(dragTarget(cfg, { left: true, center: true }, id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/elements.test.ts` → FAIL (`dragTarget` not exported).

- [ ] **Step 3: Implement in `src/elements.ts`**

```ts
/** Drag-to-move targets: the elements whose vertical position is a persisted
 *  config knob (see types.ts's Positioned). Null = not draggable right now —
 *  the laurel's offsetY only applies while collab is on (logoNudge's gate),
 *  and an empty collab slot draws nothing to drag. Horizontal position is
 *  not a knob anywhere, so dragging is vertical by construction. */
export function dragTarget(
  cfg: LabelConfig, slots: CollabSlots, id: ElementId,
): { get(): number; set(c: LabelConfig, v: number): void } | null {
  if (id === "logo" && cfg.collabEnabled)
    return { get: () => cfg.logo.offsetY ?? 0, set: (c, v) => { c.logo.offsetY = v; } };
  if (id === "collabLeft" && cfg.collabEnabled && slots.left)
    return { get: () => cfg.collabLeft.offsetY ?? 0, set: (c, v) => { c.collabLeft.offsetY = v; } };
  if (id === "collabCenter" && cfg.collabEnabled && slots.center)
    return { get: () => cfg.collabCenter.offsetY ?? 0, set: (c, v) => { c.collabCenter.offsetY = v; } };
  return null;
}
```

(Import `CollabSlots` as a type from `./plan` — same import hittest uses.)

- [ ] **Step 4: Tests pass** — `npx vitest run tests/elements.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/elements.ts tests/elements.test.ts && git commit -m "feat: dragTarget names the offsetY-draggable elements"`

### Task 5: Pointer wiring in PreviewCompare + App

**Files:**
- Modify: `src/components/PreviewCompare.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `dragTarget` (Task 4); App's `update(fn, coalesce)` (`src/App.tsx:696`) and the edit-session undo pattern (`src/App.tsx:1616-1626`).
- Produces: two new PreviewCompare props — `onNudge(id: ElementId, offsetY: number, first: boolean): void` and `onNudgeCancel(): void`.

- [ ] **Step 1: PreviewCompare pointer handlers**

On the wrapper div (beside `onClick`/`onDoubleClick`), add `onPointerDown`. Reuse `hitOf`'s coordinate math (extract the client-point→label-point mapping into a tiny local `pagePointOf(e)` helper both use):

```tsx
// Drag-to-move: pointerdown on a draggable element arms a vertical drag;
// crossing a 3px threshold opens ONE undo step (first=true) and every
// further move coalesces into it — the same session contract as onEditText.
// The browser's synthesized click after pointerup lands on the element at
// its NEW position (it moved with the cursor), so selection stays correct
// with no click suppression.
const drag = useRef<{ id: ElementId; startClientY: number; base: number;
  pxPerPt: number; started: boolean } | null>(null);

function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
  if (e.button !== 0 || editing || !measure) return;
  const id = hitOf(e);
  if (!id || !dragTarget(cfg, collab, id)) return;
  const r = e.currentTarget.getBoundingClientRect();
  drag.current = { id, startClientY: e.clientY, started: false,
    base: dragTarget(cfg, collab, id)!.get(), pxPerPt: r.height / PAGE.h };
  e.currentTarget.setPointerCapture(e.pointerId);
}
function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
  const d = drag.current;
  if (!d) return;
  const dyPx = e.clientY - d.startClientY;
  if (!d.started && Math.abs(dyPx) < 3) return; // plain click, no undo step
  const first = !d.started;
  d.started = true;
  onNudge(d.id, d.base + dyPx / d.pxPerPt, first);
}
function onPointerUp() { drag.current = null; }
```

Escape cancels an in-flight drag (restores via App's undo, like the editor's Escape): in a `useEffect` while a drag session could be live, listen for `keydown` Escape; if `drag.current?.started`, call `onNudgeCancel()` and null out `drag.current`. Also handle `onPointerCancel` = `onPointerUp`. Update the component's doc comment (top of file) to mention drag.

- [ ] **Step 2: App wiring**

Beside `onEditText`/`onEditCancel` (~line 1616):

```tsx
// Drag-to-move: first move opens the step, the rest coalesce — one undo
// per drag, mirroring the text-edit session above.
onNudge={(id, offsetY, first) => {
  update((c) => { dragTarget(c, collab, id)?.set(c, offsetY); }, !first);
}}
onNudgeCancel={mutating(undo)}
```

(Match the surrounding code exactly — if `onEditCancel` is wrapped differently than `mutating(undo)` at the time of writing, mirror whatever `onEditCancel` actually does. `collab` here is whatever slots value App already passes to `<PreviewCompare collab={…}>`.)

- [ ] **Step 3: Type-check + full suite** — `npx tsc --noEmit && npx vitest run` → green.

- [ ] **Step 4: Verify in real Chrome**

Start a dev server on a free port (NOT :5173; kill only the PID you started). Via the chrome-devtools MCP against real Chrome (headless Chromium cannot boot the app): enable collab + load slot art (or use a saved fixture project), then verify — (1) dragging the laurel moves it live and the selection box follows; (2) release, Cmd+Z restores the pre-drag position in ONE step; (3) Escape mid-drag snaps back; (4) a plain click still selects without creating an undo step; (5) with collab off, the laurel does not drag; (6) drag a collab slot logo. Remember: synthetic MouseEvents don't move real focus — irrelevant here, but a dirty tab throws a beforeunload dialog on navigation (`handle_dialog` accepts it).

- [ ] **Step 5: Commit** — `git add src/components/PreviewCompare.tsx src/App.tsx && git commit -m "feat: drag-to-move for the offsetY elements on the 2D preview"`

### Task 6: 4b release chores

- [ ] **Step 1:** Version 0.1.21 across the six files (same procedure as Task 3 Step 3), CHANGELOG entry ("Drag the laurel and collab logos vertically on the 2D preview; one undo step per drag"), `node scripts/check-release.mjs origin/main` passes, ledger entry appended.
- [ ] **Step 2:** `npx tsc --noEmit && npx vitest run` green, then `git add -A && git commit -m "chore: bump version to 0.1.21 and record the drag-to-move changelog"`.

**CHECKPOINT: report scope remaining and pause for user review before 4c.**

---

## Sub-phase 4c — Dynamic font infrastructure (v0.1.22)

Design (revised per user direction): **infrastructure only — no new bundled family, no picker UI.** Font *sourcing* is Phase 5 (Google Fonts browse/download/cache via static-instanced TTFs, plus external TTF import); it needs its own short spec because it touches the stored format (font bytes persisted with the project). 4c lands what Phase 5 plugs into: `cfg.fontFamily?: FontFamilyId` (optional, absent = `"poppins"`, so every existing file loads unchanged), a Node-safe catalog module (`fontCatalog.ts` — poppins is its only entry for now), and a family-aware `fonts.ts` gate registering each family under its own CSS name (`LabelFont-<id>`) so two open tabs can't race. `planFrom()` (deferred minor) lands here because both `planLabel` call sites are touched.

Because nothing user-visible changes, 4c is a pure refactor and inherits 4a's gate: **exports must stay byte-identical** (reuse the 4a fixture and `cmp` procedure).

### Task 7: Font catalog + config field

**Files:**
- Create: `src/fontCatalog.ts`
- Modify: `src/types.ts`, `src/defaults.ts` (only if `parseConfigFile` whitelists keys — inspect it; if it passes fields through, no change)
- Test: `tests/labelfile.test.ts` (round-trip), new `tests/fontcatalog.test.ts`

**Interfaces:**
- Produces: `FONT_FAMILIES`, `type FontFamilyId`, `fontFamilyOf(cfg): FontFamilyId`.

- [ ] **Step 1: Failing test** (new `tests/fontcatalog.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { FONT_FAMILIES, fontFamilyOf } from "../src/fontCatalog";
import { defaultConfig } from "../src/defaults";

describe("font catalog", () => {
  it("defaults to poppins; unknown ids from hand-edited files fall back", () => {
    expect(fontFamilyOf(defaultConfig())).toBe("poppins");
    expect(fontFamilyOf({ ...defaultConfig(), fontFamily: "poppins" })).toBe("poppins");
    expect(fontFamilyOf({ ...defaultConfig(), fontFamily: "papyrus" as never })).toBe("poppins");
  });
  it("every family names three faces and three files", () => {
    for (const fam of Object.values(FONT_FAMILIES)) {
      expect(Object.keys(fam.ps)).toEqual(["regular", "semibold", "bold"]);
      expect(Object.keys(fam.files)).toEqual(["regular", "semibold", "bold"]);
    }
  });
});
```

- [ ] **Step 2: Run → FAIL** (module missing).

- [ ] **Step 3: Implement**

`src/fontCatalog.ts` (Node-safe: plain data, NO `?url` imports — `generate.ts` and `psd/build.ts` import this):

```ts
// fontCatalog.ts — the label's font families as DATA: id, display label,
// PostScript names (what Photoshop resolves type layers against), and TTF
// basenames under src/assets/fonts. Node-safe on purpose (no ?url imports):
// the headless harness and psd/build.ts read names from here, while the
// DOM/URL side of each family lives in fonts.ts — the one gate. Poppins is
// the only entry today; Phase 5 (font sourcing: Google Fonts + user TTFs)
// turns this into a dynamic registry fed by downloaded/imported bytes.
export const FONT_FAMILIES = {
  poppins: {
    label: "Poppins",
    ps: { regular: "Poppins-Regular", semibold: "Poppins-SemiBold", bold: "Poppins-Bold" },
    files: { regular: "Poppins-Regular.ttf", semibold: "Poppins-SemiBold.ttf", bold: "Poppins-Bold.ttf" },
  },
} as const;
export type FontFamilyId = keyof typeof FONT_FAMILIES;

/** The config's family, with the fallback that makes the field optional:
 *  absent (every pre-0.1.22 file) and unknown ids both mean Poppins. */
export const fontFamilyOf = (cfg: { fontFamily?: string }): FontFamilyId =>
  (cfg.fontFamily && cfg.fontFamily in FONT_FAMILIES ? cfg.fontFamily : "poppins") as FontFamilyId;
```

`src/types.ts`: add to `LabelConfig` (import the type):

```ts
  /** Label typeface, one of fontCatalog's families. Absent = "poppins" —
   *  the fallback every pre-0.1.22 file relies on (see fontFamilyOf). */
  fontFamily?: FontFamilyId;
```

Add a labelfile round-trip case to `tests/labelfile.test.ts`: a config with `fontFamily: "poppins"` survives save→parse, and one without the field parses fine. Inspect `parseConfigFile` in `src/defaults.ts` first — if it strips unknown keys, add `fontFamily` to its handling.

- [ ] **Step 4: Tests pass** — `npx vitest run tests/fontcatalog.test.ts tests/labelfile.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: font catalog and the optional cfg.fontFamily field"` (add the touched files).

### Task 8: Family-aware fonts gate + renderers

**Files:**
- Modify: `src/fonts.ts`, `src/canvas/draw.ts`, `src/pdf/fonts.ts`, `src/psd/build.ts`, `src/components/PreviewCompare.tsx`, `src/three/labelTextures.ts` and/or `src/components/CanView.tsx` (wherever the second `planLabel` call site lives), `src/App.tsx`, `scripts/generate.ts`

**Interfaces:**
- Consumes: `FONT_FAMILIES`, `fontFamilyOf` (Task 7).
- Produces: `labelFontCss(id: FontFamilyId): string`; `loadLabelFont(id?)` / `loadLabelFaces(id?)` (default `"poppins"`); `loadFonts(id?)` in `pdf/fonts.ts`; `CanvasRenderSource.fontCss: string`; `planFrom(cfg: LabelConfig, source: CanvasRenderSource): Placed[]` in `src/canvas/draw.ts`.

- [ ] **Step 1: `src/fonts.ts` becomes family-aware**

- URL map (the ?url side of the catalog — Vite needs static imports): `export const FONT_URLS: Record<FontFamilyId, Record<Face, string>>` (one poppins entry today; consumed by `pdf/fonts.ts` too, so the URL side has one source).
- `export const labelFontCss = (id: FontFamilyId) => "LabelFont-" + id;` — delete `LABEL_FONT_FAMILY` and update its consumers (draw.ts, PreviewCompare) rather than keeping a poppins-flavoured constant around.
- `loadLabelFont(id: FontFamilyId = "poppins")` / `loadLabelFaces(id = "poppins")`: memoize per family in a `Map<FontFamilyId, Promise<…>>` (a failed load deletes its map entry so retries work — the current single-promise contract, per family). Register `FontFace(labelFontCss(id), url, { weight })` per face; measure closures set `ctx.font` with `labelFontCss(id)`.
- Update the module comment: the gate now takes the config's choice; Phase 5 supplies the choices.

- [ ] **Step 2: Canvas backend + planFrom**

`src/canvas/draw.ts`: add `fontCss: string` to `CanvasRenderSource`; `drawPlate` gains an optional trailing `fontCss = labelFontCss("poppins")` parameter used in `drawText` and `drawBarcode` in place of `LABEL_FONT_FAMILY`. Add the deferred-minor helper beside the type it consumes:

```ts
/** The one spelling of "plan from a render source" — PreviewCompare and the
 *  3D texture path both build the identical call (Phase-3 deferred minor). */
export const planFrom = (cfg: LabelConfig, s: CanvasRenderSource): Placed[] =>
  planLabel(cfg, s.m, { skip: s.skip, assets: s.planAssets });
```

Switch BOTH call sites (PreviewCompare's paint effect; the 3D texture path in `labelTextures.ts`/`CanView.tsx`) to `planFrom(cfg, source)` and pass `source.fontCss` into their `drawPlate`/`drawPlates` calls. In PreviewCompare's in-place editor, `fontFamily: canvasRender?.fontCss ?? labelFontCss(fontFamilyOf(cfg))` replaces the `LABEL_FONT_FAMILY` style (comment which source wins and why they agree).

- [ ] **Step 3: App assembles per-family**

In App: the effect that builds `measure` (`loadLabelFont`) and the render-source assembly (`loadLabelFaces`) now key on `fontFamilyOf(cfg)` — add it to those effects' dependency arrays and pass it to the loaders; set `fontCss: labelFontCss(family)` on the assembled `CanvasRenderSource`. A font-load failure surfaces exactly where measure-loading failures surface today (no new error channel — see Global Constraints).

- [ ] **Step 4: Export paths**

- `src/pdf/fonts.ts`: `loadFonts(id: FontFamilyId = "poppins")` — memoize per family; URLs via the `FONT_URLS` export from `fonts.ts`.
- `src/psd/build.ts`: replace the hardcoded `PS_NAME` with `FONT_FAMILIES[fontFamilyOf(cfg)].ps` (thread `cfg` to where names resolve). The FONT BYTES already arrive via `PsdAssets.fonts`; callers keep loading the family's bytes.
- App's export handlers: pass `fontFamilyOf(cfg)` to `loadFonts`.
- `scripts/generate.ts`: resolve TTF paths via `FONT_FAMILIES[fontFamilyOf(cfg)].files` against `src/assets/fonts` instead of hardcoded Poppins basenames.

- [ ] **Step 5: Type-check + full suite** — `npx tsc --noEmit && npx vitest run` → green (everything exercises the poppins default).

- [ ] **Step 6: Commit** — `git commit -m "feat: label font flows from cfg.fontFamily through the fonts.ts gate"` (add all touched files).

### Task 9: 4c verification + release chores

- [ ] **Step 1: Byte-identity** — pure refactor, so exports must not move: regenerate the 4a fixture + default outputs into `$SCRATCH/phase4c/after` and `cmp` every PDF and PSD against the 4a `after/` set (which Task 3 proved identical to the original baseline). Any difference = stop and fix the refactor.
- [ ] **Step 2: Parity** — `npm run parity`: all rows PASS ≤ 5% (geometry and face unchanged).
- [ ] **Step 3: Real Chrome regression** — own dev server, own PID: preview renders per keystroke as before, in-place editor shows the same face, both 3D views texture correctly, and a pre-existing `.label` file opens as Poppins. (No font *switching* to verify — one family until Phase 5.)
- [ ] **Step 4: Docs** — amend the spec's font Goals line with "gate landed in Phase 4c; font sourcing (choices) is Phase 5"; CHANGELOG entry ("Font pipeline is config-driven internally; typeface choices arrive with font sourcing").
- [ ] **Step 5: Version 0.1.22** across the six files, `node scripts/check-release.mjs origin/main` passes, ledger entry for 4c — include: "planFrom() deferred minor landed; buildError split ruled unnecessary — no new writers; Phase 5 backlog: font sourcing — Google Fonts (metadata scan via fonts.google.com/metadata/fonts, static-instanced TTFs via css2 wght requests, local byte cache, fonts embedded in the project file for print reproducibility) + external TTF import (fontkit-extracted PS names, three-face mapping, OS/2 fsType embedding check)".
- [ ] **Step 6:** `npx tsc --noEmit && npx vitest run` green; `git add -A && git commit -m "chore: bump version to 0.1.22 and record the font-infrastructure changelog"`.

**FINAL CHECKPOINT: report Phase 4 complete; do not merge or push without user approval.**
