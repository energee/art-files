# Canvas Preview Swap (Canvas Renderer Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 2D preview renders from the canvas backend for real — per-keystroke, no worker round-trip, no debounce — while the preview worker survives only for the 3D views' textures and PDFs/PSDs otherwise build on export alone; in-place editing becomes a `planLabel` skip flag and the v0.1.16 hide-element-and-rebuild plumbing is deleted.

**Architecture:** The dev-only `CANVAS_PREVIEW` path from Phase 2 is promoted to THE path and the flag deleted. App splits what was one debounced everything-effect into (a) an asset-assembly effect keyed only on asset-shaped inputs (bitmaps, collab tint knobs, eyes) and (b) config flowing straight through the `cfg` prop into PreviewCompare's rAF paint — so a keystroke repaints next frame without touching `createImageBitmap` or a worker. The debounced `buildPreviewPdfs` effect gates to `viewMode !== "2d"` (CanView still textures from PDF bytes until Phase 4). Canvas render failures route to the existing `buildError` strip; a failed frame keeps the last painted canvas.

**Tech Stack:** TypeScript, React, vitest, Canvas 2D. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-canvas-preview-renderer-design.md` (Phase 3 bullet + "Editing integration" + "Error handling"). Phase 2 conventions: `docs/superpowers/plans/2026-08-25-canvas-backend-phase2.md`.

## Global Constraints

- Exports stay pixel-identical: Phase 3 changes PREVIEW behavior only. `buildFull` / `exportPsd` / `npm run generate` are untouched.
- Every task ends with `npx tsc --noEmit` clean and `npx vitest run` fully green (258+ tests).
- No new dependencies. Never hardcode "Poppins" — fonts through `src/fonts.ts` (`loadLabelFaces`, `FACE_WEIGHT`, `LABEL_FONT_FAMILY`).
- Follow `.agents/conventions.md`: `// filename — purpose` headers, comments state constraints not narration. Commit prefixes `refactor:`/`feat:`/`fix:`/`chore:`, **no co-author lines**.
- Worktree: `/Users/tedslesinski/Repos/art-files/.claude/worktrees/update-dialog`, branch `fix/code-review-findings`. Never bare `git stash`; never kill processes by name pattern — only PIDs you started.
- Phase 2's six carried review items land here (Task 1 and Task 3): silent drawImage skip, ImageBitmap close race, stroke-before-fill pin tests, buildError routing, textBaseline/textAlign ownership, `box.x!` in `collabItems`.

---

### Task 1: Carried items in `plan.ts` and `canvas/draw.ts`

**Files:**
- Modify: `src/plan.ts` (collabItems' `box.x!`)
- Modify: `src/canvas/draw.ts` (textAlign/textBaseline ownership; missing-image throw)
- Test: `tests/canvas-draw.test.ts` (append)

**Interfaces:**
- Consumes: `barcodeItem`, `planLabel` from `src/plan.ts`; `drawPlate` from `src/canvas/draw.ts` (signatures unchanged).
- Produces: `drawPlate` THROWS `Error` when an art-mode `PlacedImage` has no bitmap in `CanvasAssets` (Task 2 routes that to `buildError`). `collabItems`' `box` param becomes `({ x: number } | { cx: number }) & { top: number; maxW: number; maxH: number }` (internal; call sites already pass one or the other).

- [ ] **Step 1: Write the failing tests**

```ts
// append inside describe("drawPlate") in tests/canvas-draw.test.ts
import { barcodeItem } from "../src/plan"; // add to the existing plan import line

  it("throws when an art-mode image item has no bitmap (assembly bug, not a blank)", () => {
    const c = { ...cfg, collabEnabled: true };
    const p = planLabel(c, m, {
      assets: { logoSvg, collabCenter: { kind: "raster", w: 10, h: 10 } },
    });
    const { ctx } = fakeCtx();
    expect(() => drawPlate(ctx, p, {}, "art")).toThrow(/collabCenter/);
  });

  it("owns textAlign/textBaseline: pins both before any text paints", () => {
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, plan(), {}, "art");
    const firstText = log.findIndex((x) => x.op === "fillText");
    const align = log.findIndex((x) => x.op === "set:textAlign" && x.args[0] === "left");
    const base = log.findIndex((x) => x.op === "set:textBaseline" && x.args[0] === "alphabetic");
    expect(align).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(-1);
    expect(align).toBeLessThan(firstText);
    expect(base).toBeLessThan(firstText);
  });

  it("strokes every laurel path before filling any (the laurel-branch rule)", () => {
    // Force a stroke on the logo, then draw ONLY its items so the op stream
    // is unambiguous.
    const stroked = planLabel(
      { ...cfg, logo: { ...cfg.logo, stroke: "#112233" } }, m, { assets: { logoSvg } },
    ).filter((r) => r.id === "logo");
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, stroked, {}, "art");
    const strokes = log.map((x, i) => (x.op === "stroke" ? i : -1)).filter((i) => i >= 0);
    const fills = log.map((x, i) => (x.op === "fill" ? i : -1)).filter((i) => i >= 0);
    expect(strokes.length).toBeGreaterThan(0);
    expect(fills.length).toBeGreaterThan(0);
    expect(Math.max(...strokes)).toBeLessThan(Math.min(...fills));
  });

  it("paints every barcode halo shape before any ink shape", () => {
    const item = barcodeItem(cfg, m);
    expect(item.S).toBeGreaterThan(0); // default config ships the measured halo
    const { ctx, log } = fakeCtx();
    drawPlate(ctx, [item], {}, "art");
    const halo = log
      .map((x, i) => (x.op === "strokeRect" || x.op === "strokeText" ? i : -1))
      .filter((i) => i >= 0);
    const ink = log
      .map((x, i) => (x.op === "fillRect" || x.op === "fillText" ? i : -1))
      .filter((i) => i >= 0);
    expect(halo.length).toBeGreaterThan(0);
    expect(Math.max(...halo)).toBeLessThan(Math.min(...ink));
  });
```

Note: if `barcodeItem(cfg, m).S` is 0 for the default config (check against `tests/plan.test.ts`'s existing halo assertions — it should be `L.BARCODE.stroke`), set `barcodeStrokeWidth: 10` on the cfg literal instead of asserting the default. If the stroked-logo cfg literal doesn't typecheck (check `Style`'s stroke fields in `src/types.ts`), mirror how the existing "strokes a stroked text run" test forces a stroke.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/canvas-draw.test.ts`
Expected: the missing-image test FAILS (drawPlate silently skips today); the textAlign test FAILS (drawPlate never sets either); the two ordering tests may already pass (they are pins — that is fine, confirm they run).

- [ ] **Step 3: Implement**

`src/canvas/draw.ts` — after the `lineCap` line in `drawPlate`:

```ts
  // This backend owns text alignment: the plan's x/baseline are start-of-run
  // and alphabetic-baseline coordinates, so a caller-mutated ctx (canvas
  // contexts persist state between frames) must not be able to shift every
  // glyph.
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
```

`src/canvas/draw.ts` — the image branch's art half:

```ts
      if (mode === "art") {
        const img = r.id === "collabLeft" ? assets.collabLeft : assets.collabCenter;
        // The plan only places an image the caller declared (PlanArt came
        // from the same slot), so a missing bitmap is an assembly bug —
        // fail fast rather than render a silently incomplete label.
        if (!img) throw new Error(`Canvas asset missing for "${r.id}" — the plan placed it, so its bitmap must be supplied.`);
        c.drawImage(img, r.x, r.y, r.w, r.h);
      } else {
```

`src/plan.ts` — `collabItems`:

```ts
function collabItems(
  id: ElementId,
  art: PlanArt,
  slot: CollabSlot,
  box: ({ x: number } | { cx: number }) & { top: number; maxW: number; maxH: number },
): Placed[] {
  const maxW = box.maxW * slot.scale;
  const maxH = box.maxH * slot.scale;
  const top = box.top + (slot.offsetY ?? 0);
  const place = (w: number) => ("cx" in box ? box.cx - w / 2 : box.x);
  ...
```

(the two call sites already pass exactly `{ x, top, maxW, maxH }` and `{ cx, top, maxW, maxH }` — no change there).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green (existing raster-collab test in canvas-draw still passes — it supplies the bitmap in art mode and the mask half never reads it).

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts src/canvas/draw.ts tests/canvas-draw.test.ts
git commit -m "fix: drawPlate pins text alignment and fails fast on a missing image asset"
```

---

### Task 2: PreviewCompare — the canvas path becomes the only path

**Files:**
- Modify: `src/components/PreviewCompare.tsx`

**Interfaces:**
- Consumes: `drawPlate`, `CanvasAssets` from `src/canvas/draw.ts`; `planLabel`, `MeasureFace`, `PlanAssets` from `src/plan.ts` (all unchanged).
- Produces (Task 3 relies on these exact prop names):
  - `artBytes` / `maskBytes` props DELETED; `useRenderPdfs`, `renderPdf`, and the `renderPdfPage` / `PREVIEW_RASTER_MAX_EDGE` imports deleted.
  - `canvasRender` prop keeps its shape `{ m: MeasureFace; planAssets: PlanAssets; drawAssets: CanvasAssets; skip: { has(id: ElementId): boolean } } | null` but loses the "DEV-ONLY" framing: null now means "not ready yet / view hidden" (first font+asset assembly still in flight, or a 3D view is up) and the canvases keep their last frame.
  - New prop `bleedIn: number` — repaint trigger only (the paint effect reads geometry from the live `PAGE`, which App's render already updated via `setLayoutBleed`; without this dep a bleed change would leave the canvas stale).
  - `onRenderError` semantics: called with the message on a failed frame, `""` on the next successful one (Task 3 wires it to `setBuildError`, same clearing contract the worker build had).

- [ ] **Step 1: Replace the two render paths with one**

Delete `renderPdf` and `useRenderPdfs` (lines ~110–161) and the `renderPdfPage` import; drop `PREVIEW_RASTER_MAX_EDGE` from the layout import if nothing else uses it. Delete the `artBytes`/`maskBytes` props from the type and destructuring, and the `useRenderPdfs(...)` call.

The paint effect replaces both (same slot the dev effect occupied), with the spec's error policy:

```ts
  // The one render path: repaint both plates straight from the display list
  // on every config/asset change, on a rAF so a burst of keystrokes coalesces
  // into one paint per frame. drawPlate is synchronous and cheap — no
  // debounce, no worker. null canvasRender (assets still assembling, or a 3D
  // view is up) paints nothing and the canvases keep their last frame.
  useEffect(() => {
    if (!canvasRender) return;
    const raf = requestAnimationFrame(() => {
      try {
        // planLabel runs before any canvas is touched, so its throws (the
        // realistic failure) leave the last frame intact — the spec's
        // failed-frame policy.
        const plan = planLabel(cfg, canvasRender.m,
          { skip: canvasRender.skip, assets: canvasRender.planAssets });
        for (const [canvas, mode] of
            [[artCanvas.current, "art"], [maskCanvas.current, "mask"]] as const) {
          if (!canvas) continue;
          const w = Math.round(PAGE.w * rasterScale);
          if (canvas.width !== w) {
            canvas.width = w;
            canvas.height = Math.round(PAGE.h * rasterScale);
          }
          drawPlate(canvas.getContext("2d")!, plan, canvasRender.drawAssets, mode);
        }
        onRenderError?.("");
      } catch (err) {
        // Routed to App's buildError strip; the canvases keep whatever frame
        // last painted successfully.
        onRenderError?.(String(err));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [canvasRender, cfg, rasterScale, bleedIn]);
```

`onRenderError` is a useState setter in App (identity-stable), so it stays out of the deps exactly as `useRenderPdfs` kept it in a ref; add the eslint-disable comment the file already uses for stable setters if the linter complains.

Update the prop doc comments: `canvasRender` is the render source (drop "DEV-ONLY (Phase 2)"), and the component header comment — the preview is drawn by the canvas backend from the display list, not "both generated PDFs rendered via pdf.js".

- [ ] **Step 2: Typecheck the tree mid-task**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/App.tsx` (it still passes `artBytes`/`maskBytes`). That is the expected mid-phase state; Task 3 fixes App. If errors appear anywhere else, fix them before moving on.

- [ ] **Step 3: Do not commit yet**

App is broken until Task 3 — the two land as one commit there. (Sequencing note for the executor: Tasks 2 and 3 are one reviewable unit split for readability; run them back-to-back in the same session.)

---

### Task 3: App — promote the canvas path, retire the 2D worker builds, delete the hide plumbing

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 2's PreviewCompare props (`canvasRender`, `bleedIn`, `onRenderError`; no more `artBytes`/`maskBytes`); `loadLabelFaces` from `@/fonts`; existing `collabAssets` / `eyedAssets` helpers.
- Produces: no exported-interface changes. `buildPreviewPdfs` is now called only while a 3D view is up; `pdfs` feeds CanView alone.

- [ ] **Step 1: Delete the flag and restructure the assembly effect**

1. Delete the `CANVAS_PREVIEW` const (module scope, ~line 354).

2. The canvas-assets effect loses the flag gate and — critically — narrows its deps from `inputs` to asset-shaped inputs only, so a keystroke never re-decodes bitmaps. `skip` moves OUT of the assembled state (an edit session must skip the element the SAME frame, not after a 150ms debounce + decode):

```ts
  // The 2D preview's render source: fonts + decoded bitmaps for drawPlate,
  // assembled off the asset inputs alone (debounced — uploads and eye/tint
  // toggles are rare and each re-assembly decodes up to 4 ImageBitmaps).
  // Config changes deliberately DON'T re-run this: cfg flows into
  // PreviewCompare as a prop and repaints per-keystroke with these same
  // bitmaps. The two collab tint knobs are the only cfg fields the bitmaps
  // depend on, so they are dependencies here by value.
  const [canvasAssets, setCanvasAssets] = useState<{
    m: MeasureFace; planAssets: PlanAssets; drawAssets: CanvasAssets;
  } | null>(null);
  useEffect(() => {
    if (blocked || !active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const m = await loadLabelFaces();
        const bitmap = async (bytes: Uint8Array | undefined) =>
          bytes ? await createImageBitmap(new Blob([bytes as BlobPart])) : null;
        const { collabLeft: cl, collabCenter: cc } = await collabAssets();
        const slot = async (img: CollabImage | null | undefined) => {
          if (!img) return { art: null, image: null };
          if (img.kind === "svg") return { art: img, image: null };
          const bmp = await createImageBitmap(new Blob([img.bytes as BlobPart]));
          return { art: { kind: "raster" as const, w: bmp.width, h: bmp.height }, image: bmp };
        };
        const [left, center] = await Promise.all([slot(cl), slot(cc)]);
        const eyed = eyedAssets(true);
        const drawAssets: CanvasAssets = {
          texture: await bitmap(eyed.texture?.bytes),
          maskImage: await bitmap(eyed.maskPng),
          collabLeft: left.image, collabCenter: center.image,
        };
        if (cancelled) {
          // Superseded before publish: nothing will ever reference these.
          closeCanvasBitmaps(drawAssets);
          return;
        }
        setCanvasAssets({
          m,
          planAssets: { logoSvg, collabLeft: left.art, collabCenter: center.art },
          drawAssets,
        });
      })().catch((err) => {
        // The font gate or a decode failed: the preview cannot render.
        // Surface it — the spec's "never a silently wrong face".
        if (!cancelled) setBuildError(String(err));
      });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
    // Asset inputs only — cfg deliberately excluded except the tint knobs
    // (see the comment above). eslint can't see that collabAssets() reads
    // exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    texture, mask, collabLeft, collabCenter, hiddenLayers,
    cfg.collabLeft.fill, cfg.collabLeft.tintRaster,
    cfg.collabCenter.fill, cfg.collabCenter.tintRaster,
    blocked, active,
  ]);
```

3. **Close race fix (carried item):** the previous generation's bitmaps must be closed AFTER React commits the new one — closing them inline before `setCanvasAssets` let a pending rAF (scheduled with the old `canvasRender`) draw already-closed bitmaps. Post-commit, PreviewCompare's effect cleanup has already cancelled that rAF (child cleanups run before parent effects), so this is race-free:

```ts
  // Close the superseded generation's ImageBitmaps AFTER the commit that
  // replaces them: any rAF still holding the old assets was cancelled by
  // PreviewCompare's effect cleanup during this same commit (child cleanups
  // run first), so nothing can draw a closed bitmap. Unmount closes the
  // last generation.
  useEffect(() => {
    const prev = canvasBitmaps.current;
    if (prev && prev !== canvasAssets?.drawAssets) closeCanvasBitmaps(prev);
    canvasBitmaps.current = canvasAssets?.drawAssets ?? null;
  }, [canvasAssets]);
  useEffect(() => () => closeCanvasBitmaps(canvasBitmaps.current), []);
```

(`canvasBitmaps` / `closeCanvasBitmaps` already exist — keep them, delete the old inline `closeCanvasBitmaps(canvasBitmaps.current)` call from the assembly effect body.)

4. The skip set and the prop, memoized so a divider-drag re-render doesn't schedule repaints:

```ts
  // What planLabel omits: the layers-panel eyes, plus the in-place edit
  // session's element — the v0.1.16 hide-and-rebuild plumbing reduced to a
  // render flag. Same-frame: a new editSession changes this memo, the
  // canvasRender memo below, and PreviewCompare repaints on the next rAF.
  const skip = useMemo<{ has(id: ElementId): boolean }>(
    () => editSession
      ? { has: (id: ElementId) => id === editSession
          || hiddenLayers.has(id as HideableLayerId) }
      : hiddenLayers,
    [editSession, hiddenLayers],
  );
  // Null while assets assemble or a 3D view is up — PreviewCompare keeps its
  // last frame and, before any first frame, App shows the loading state.
  const canvasRender = useMemo(
    () => (canvasAssets && viewMode === "2d" ? { ...canvasAssets, skip } : null),
    [canvasAssets, skip, viewMode],
  );
```

Type note: import `MeasureFace` from `@/plan` (add to the existing type-only import) for the state annotation; `ComponentProps` may become unused — remove it if so.

- [ ] **Step 2: Gate the worker builds to the 3D views and delete the hide plumbing**

1. `inputs` drops `editSession` (the worker build no longer draws while a session is possible — sessions live in the 2D view):

```ts
  const inputs = [
    cfg, texture, mask, collabLeft, collabCenter, hiddenLayers, render.bleedIn,
  ] as const;
```

Delete the `editSession` entry and its comment. (`editSession` state itself STAYS — it feeds `skip`.)

2. The debounced build effect bails in 2D — the canvas is the preview; PDF bytes exist for CanView alone (Phase 4 retargets that too). `needMask` dies: every 3D view textures with both plates.

```ts
  useEffect(() => {
    // PDFs are built for the 3D views' textures only (see CanView); the 2D
    // preview renders from the canvas backend and exports rebuild at full
    // resolution on demand. Leaving 2D triggers the first build here.
    if (blocked || !active || viewMode === "2d") return;
    ...
        const assets = {
          ...(await collabAssets()),
          ...eyedAssets(true),
          hidden: hiddenLayers,
        };
        const { art, mask: maskPdf } =
          await buildPreviewPdfs(cfg, assets, { art: !sameInputs, mask: true }, render.bleedIn);
    ...
  }, [...inputs, blocked, active, viewMode]);
```

Concretely: replace the `hidden:` wrapper (the `editSession ? { has: ... } : hiddenLayers` conditional) with plain `hiddenLayers`; replace `mask: needMask` with `mask: true`; change `built.current = { inputs, withMask: needMask }` to `withMask: true`; the `sameInputs && (!needMask || done.withMask)` guard becomes `sameInputs && done.withMask`; swap `needMask` for `viewMode` in the dep array. Then delete the `needMask` const and its comment block entirely (`grep -n needMask src/App.tsx` must come back empty). Keep the deactivation effect (`!active` → `setPdfs(null)`) as is.

3. Delete the whole old dev-only assembly effect (the one gated on `CANVAS_PREVIEW`, ~lines 1016–1105) — Step 1's new effects replace it. Make sure the `canvasBitmaps` ref and `closeCanvasBitmaps` helper survive the deletion (Step 1.3 uses them).

- [ ] **Step 3: Rewire the render**

1. `PreviewCompare` call site: delete the `artBytes`/`maskBytes` props and their comment; pass

```tsx
              canvasRender={canvasRender}
              bleedIn={render.bleedIn}
```

(the `canvasRender` memo already nulls itself in 3D, so no inline `viewMode` ternary). Keep `onRenderError={setBuildError}` — Task 2's success-clears-error contract matches what the worker build did with `setBuildError("")`.

2. Readiness gates — `pdfs` no longer exists in 2D, so the three overlays split on view:

```ts
  // What "the preview has rendered" means per view: 2D paints from
  // canvasAssets; the 3D views texture from the worker-built PDFs.
  const previewReady = viewMode === "2d" ? !!canvasAssets : !!pdfs;
```

- First-load spinner: `{!pdfs && !buildError && (` → `{!previewReady && !buildError && (`.
- Corner rebuild spinner: `{building && pdfs && (` → `{building && previewReady && (`.
- No-texture hint: `{!texture && !building && pdfs && (` → `{!texture && !building && previewReady && (`.
- Export guard: `const pdfExportBlocked = exportBlocked || !pdfs;` → `const pdfExportBlocked = exportBlocked || !previewReady;` and update its comment (the guard means "the pipeline has proven it can render", no longer "preview bytes exist").

3. Update the file-header comment (App.tsx lines 1–11): the 2D preview is drawn by the canvas backend per keystroke; debounced preview-resolution PDF builds serve the 3D views only.

4. Update stale comments that describe the old flow: `editSession`'s state comment (~line 404 — "the preview build hides that element" → "planLabel skips that element via the render flag"), `PreviewCompare`'s `onEditSession` prop comment if it says "preview build", and the `built`/`inputs` comments if they reference editSession or needMask.

- [ ] **Step 4: Full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green, 262+ tests (Task 1 added four). `grep -rn "CANVAS_PREVIEW\|canvasPreview" src` returns nothing; `grep -n "needMask" src/App.tsx` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/PreviewCompare.tsx
git commit -m "feat: the 2D preview renders from the canvas backend; PDFs build for 3D views and exports only"
```

---

### Task 4: Verification — real Chrome + parity

No file changes expected (fixes found here fold into a follow-up commit).

- [ ] **Step 1: Manual pass in real Chrome** (headless Chromium cannot boot the app — known pdf.js worker-startup issue; use the chrome-devtools MCP against a dev server)

Start `npm run dev` (record the PID; kill only that PID afterwards). Verify:

1. The 2D preview paints both plates on load with NO `localStorage.canvasPreview` flag set (and DevTools network shows no preview-worker traffic while typing).
2. Typing in the name field updates the canvas per keystroke (no 150ms lag, no blur flash).
3. Double-click the name → in-place editor opens and the drawn element vanishes the same frame; Enter restores it; Escape reverts the text.
4. Divider drag reveals the mask plate; both plates track config edits.
5. Texture/mask/collab uploads appear; layer eyes hide elements (a hidden background renders bare stock).
6. Keys 3/4/5: the 3D views build their textures (first trip shows the spinner, then the can renders); back to 2D keeps the canvas preview.
7. Export PDFs still produces both files (full-res on-demand build path untouched).
8. Zoom in past 250%: the raster ratchet re-sizes the canvas backing store (text stays sharp).
9. Bleed knob change (Document Settings) repaints the preview at the new geometry.

- [ ] **Step 2: Pixel parity**

Run: `npm run parity` — all four rows PASS (threshold 5%, Phase 2 observed 2.04–2.48%). The harness exercises `drawPlate` directly, so Task 1's changes are covered; expect no material change in the numbers.

- [ ] **Step 3: If anything failed** — fix, re-run the failing check, commit as `fix:` with the observed evidence in the message. Never claim a check passed without its output.

---

### Task 5: Release steward — version 0.1.19 + changelog

**Files:**
- Modify: `package.json`, `package-lock.json` (two version fields), `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `label-lab` entry), `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump the synchronized version**

`npm version 0.1.19 --no-git-tag-version` handles the npm pair; hand-edit `Cargo.toml`, the `Cargo.lock` `label-lab` entry, and `tauri.conf.json` to `0.1.19`.

- [ ] **Step 2: Changelog entry**

```markdown
## [0.1.19] - 2026-08-25

- The 2D preview now renders directly on canvas from the shared display
  list — updates land per keystroke with no debounce, and in-place editing
  hides the edited element instantly. PDFs are built only for the 3D views
  and on export; exported files are unchanged.
```

- [ ] **Step 3: Release check, final validation, commit**

Run: `node scripts/check-release.mjs origin/main`, then `npx tsc --noEmit && npx vitest run` — all green.

```bash
git add -A
git commit -m "chore: bump version to 0.1.19 and record the changelog"
```

Do NOT merge or push — the user gates that. After committing, update `.agents/ledger.md` (Phase 3 entry: status, delta, anything carried to Phase 4) and `learnings.md` if anything new was learned, in a final `docs:` commit.

---

## Self-review notes

- Spec coverage (Phase 3): preview renders from canvas per keystroke with no worker/debounce (Tasks 2–3), preview worker + App's debounced build retired *for the preview* and retained only where 3D views still consume bytes — confirmed by reading `src/three`/`CanView` (`buildLabelTextures({ artBytes, maskBytes })`), in-place editing via `skip` with the v0.1.16 hide plumbing deleted (Task 3), error handling to `buildError` with failed frames keeping the last canvas (Task 2), exports build on demand and stay pixel-identical (untouched paths, Task 4 checks), release steward (Task 5).
- All six carried Phase 2 items have homes: silent drawImage skip + textBaseline/textAlign + stroke-order pins + `box.x!` (Task 1), close race (Task 3 Step 1.3) + buildError routing (Task 2).
- Deliberate choices: `pdfs`/worker survive for CanView (Phase 4 removes); the mask plate paints every frame even at split 0 (drawPlate is cheap; the old needMask machinery bought nothing on the canvas path); the 150ms debounce survives only in the asset-assembly effect (decode churn) and the 3D build effect — never between a keystroke and the canvas.
- Type consistency: `canvasRender` prop shape identical between Task 2 (PreviewCompare) and Task 3 (App memo); `bleedIn` prop consumed in Task 2's dep list and passed in Task 3; `previewReady` defined and used only in Task 3.
