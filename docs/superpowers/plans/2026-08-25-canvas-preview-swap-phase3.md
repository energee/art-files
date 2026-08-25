# Canvas Preview Swap (Canvas Renderer Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything on screen renders from the canvas backend — the 2D preview per keystroke with no worker round-trip or debounce, and the 3D views' textures from the same plates — so the preview PDF worker stack (`pdf/client.ts`, `pdf/worker.ts`, App's debounced build, the `pdfs` state) is deleted outright; PDFs/PSDs build on export only. In-place editing becomes a `planLabel` skip flag and the v0.1.16 hide-element-and-rebuild plumbing is deleted.

**Architecture:** The dev-only `CANVAS_PREVIEW` path from Phase 2 is promoted to THE path and the flag deleted. App splits what was one debounced everything-effect into (a) an asset-assembly effect keyed only on asset-shaped inputs (bitmaps, collab tint knobs, eyes) and (b) config flowing straight through the `cfg` prop into PreviewCompare's rAF paint — so a keystroke repaints next frame without touching `createImageBitmap` or a worker. The 3D views consume the same source: `labelTextures.ts` stops rasterizing PDFs (its input was always just two plate images — `deriveMetalness` is a pixel pass, and its ink classifier is color-agnostic, so the canvas mask plate's `MASK_BLUE_HEX` classifies exactly like the pdf.js raster did) and instead receives plates drawn by `drawPlate` at texture resolution. With no consumer left, the preview worker protocol and its byte cache are deleted. pdf.js survives only for the dev parity page. Canvas render failures route to the existing `buildError` strip; a failed frame keeps the last painted canvas.

**Tech Stack:** TypeScript, React, vitest, Canvas 2D. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-25-canvas-preview-renderer-design.md` (Phase 3 + "Editing integration" + "Error handling"; the "3D views texture from the canvas plates" follow-on is pulled forward from Phase 4 by user decision — it deletes the whole worker stack instead of gating it). Phase 2 conventions: `docs/superpowers/plans/2026-08-25-canvas-backend-phase2.md`.

## Global Constraints

- Exports stay pixel-identical: Phase 3 changes on-screen rendering only. `buildFull` / `exportPsd` / `npm run generate` are untouched.
- Every task ends with `npx tsc --noEmit` clean and `npx vitest run` fully green.
- No new dependencies. Never hardcode "Poppins" — fonts through `src/fonts.ts` (`loadLabelFaces`, `FACE_WEIGHT`, `LABEL_FONT_FAMILY`).
- Follow `.agents/conventions.md`: `// filename — purpose` headers, comments state constraints not narration. Commit prefixes `refactor:`/`feat:`/`fix:`/`chore:`, **no co-author lines**.
- Worktree: `/Users/tedslesinski/Repos/art-files/.claude/worktrees/update-dialog`, branch `fix/code-review-findings`. Never bare `git stash`; never kill processes by name pattern — only PIDs you started.
- Phase 2's six carried review items land here (Tasks 1, 2, 4): silent drawImage skip, ImageBitmap close race, stroke-before-fill pin tests, buildError routing, textBaseline/textAlign ownership, `box.x!` in `collabItems`.

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

### Task 2: `CanvasRenderSource` + PreviewCompare — the canvas path becomes the only path

**Files:**
- Modify: `src/canvas/draw.ts` (add the shared source type)
- Modify: `src/components/PreviewCompare.tsx`

**Interfaces:**
- Consumes: `drawPlate`, `CanvasAssets` from `src/canvas/draw.ts`; `planLabel`, `MeasureFace`, `PlanAssets` from `src/plan.ts`.
- Produces (Tasks 3–4 rely on these exact names):
  - `src/canvas/draw.ts` exports the wiring type both views consume:

    ```ts
    /** Everything a view needs to render label plates from the display list:
     *  the face-aware measure, the plan's asset descriptors, the decoded
     *  bitmaps, and the skip set (layer eyes + the in-place edit session). */
    export interface CanvasRenderSource {
      m: MeasureFace;
      planAssets: PlanAssets;
      drawAssets: CanvasAssets;
      skip: { has(id: ElementId): boolean };
    }
    ```

    (adds `MeasureFace`, `PlanAssets` to the existing type-only import from `../plan`, and `ElementId` from `../elements`.)
  - PreviewCompare: `artBytes` / `maskBytes` props DELETED; `useRenderPdfs`, `renderPdf`, and the `renderPdfPage` / `PREVIEW_RASTER_MAX_EDGE` imports deleted.
  - `canvasRender` prop becomes `canvasRender: CanvasRenderSource | null` — null means "not ready yet / a 3D view is up" and the canvases keep their last frame.
  - New prop `bleedIn: number` — repaint trigger only (the paint effect reads geometry from the live `PAGE`, which App's render already updated via `setLayoutBleed`; without this dep a bleed change would leave the canvas stale).
  - `onRenderError` semantics: called with the message on a failed frame, `""` on the next successful one (App wires it to `setBuildError`, same clearing contract the worker build had).

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
Expected: errors ONLY in `src/App.tsx` (it still passes `artBytes`/`maskBytes`). That is the expected mid-phase state; Task 4 fixes App. If errors appear anywhere else, fix them before moving on.

- [ ] **Step 3: Do not commit yet**

App is broken until Task 4 — Tasks 2–4 land as one commit there. (Sequencing note for the executor: they are one reviewable unit split for readability; run them back-to-back in the same session.)

---

### Task 3: `labelTextures` + CanView — the 3D views texture from canvas plates

**Files:**
- Modify: `src/three/labelTextures.ts`
- Modify: `src/components/CanView.tsx`

**Interfaces:**
- Consumes: `drawPlate`, `CanvasAssets`, `CanvasRenderSource` from `src/canvas/draw.ts`; `planLabel`, `Placed` from `src/plan.ts`; `PAGE` from `src/layout.ts`.
- Produces (Task 4 relies on these exact names):
  - `labelTextures.ts`: `export function drawPlates(plan: readonly Placed[], assets: CanvasAssets): { art: HTMLCanvasElement; mask: HTMLCanvasElement }` and `export function buildLabelTextures(plates: { art: HTMLCanvasElement; mask: HTMLCanvasElement }): LabelTextures` — now SYNCHRONOUS; the `renderPdfPage` import and `renderPlate` are deleted. `LabelTextures` shape unchanged.
  - CanView props: `artBytes`/`maskBytes` DELETED; new `cfg: LabelConfig`, `source: CanvasRenderSource | null`, `bleedIn: number`.

- [ ] **Step 1: Rewrite `labelTextures.ts`'s input half**

Delete the `renderPdfPage` import and `renderPlate`. Keep `MAX_EDGE`, `MAX_SCALE`, `isPage`, `LabelTextures`, `deriveMetalness` exactly as they are (`deriveMetalness`'s classifier is color-agnostic — the canvas mask plate's saturated `MASK_BLUE_HEX` ink classifies as matte and the white knockouts as foil, identical to the old pdf.js raster). Replace the bottom of the file:

```ts
/** Draw both plates from the display list at texture resolution: MAX_SCALE
 *  over the page's natural pt size, long edge capped at MAX_EDGE — the same
 *  texel density the old PDF raster produced. One scale for both plates, so
 *  the maps share the art's UV grid pixel-for-pixel. */
export function drawPlates(
  plan: readonly Placed[], assets: CanvasAssets,
): { art: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const s = Math.min(MAX_SCALE, MAX_EDGE / Math.max(PAGE.w, PAGE.h));
  const plate = (mode: "art" | "mask") => {
    const c = document.createElement("canvas");
    c.width = Math.round(PAGE.w * s);
    c.height = Math.round(PAGE.h * s);
    drawPlate(c.getContext("2d")!, plan, assets, mode);
    return c;
  };
  return { art: plate("art"), mask: plate("mask") };
}

/**
 * Build the 3D label's texture inputs from the two rendered plates. Pixel
 * work only — synchronous; drawing the plates is drawPlates' job.
 */
export function buildLabelTextures(
  { art, mask }: { art: HTMLCanvasElement; mask: HTMLCanvasElement },
): LabelTextures {
  const { canvas: metalness, hasFoil } = deriveMetalness(mask);
  return { art, metalness, hasFoil, aspect: art.width / art.height };
}
```

Imports become: `import { drawPlate, type CanvasAssets } from "@/canvas/draw";`, `import type { Placed } from "@/plan";`, `import { PAGE } from "@/layout";`. Update the file-header comment: the plates come from the canvas backend's display-list walk, not a PDF raster.

- [ ] **Step 2: Rewire CanView's texture effect**

Replace the `artBytes`/`maskBytes` props with `cfg: LabelConfig; source: CanvasRenderSource | null; bleedIn: number` (imports: `type { LabelConfig } from "@/types"`, `type { CanvasRenderSource } from "@/canvas/draw"`, `{ planLabel } from "@/plan"`, `{ drawPlates } from "@/three/labelTextures"`). The rebuild effect replaces the promise chain (everything is synchronous now — the chain existed for pdf.js):

```ts
  // Texture rebuilds are debounced: each one is a synchronous two-plate draw
  // plus deriveMetalness' per-pixel pass over ~3.4M px — fine per pause,
  // too heavy per keystroke. A superseded rebuild simply never fires
  // (clearTimeout), so stale textures can't overwrite newer ones.
  useEffect(() => {
    if (!source) return;
    setLoading(true);
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      try {
        const plan = planLabel(cfg, source.m,
          { skip: source.skip, assets: source.planAssets });
        sceneRef.current?.applyTextures(buildLabelTextures(drawPlates(plan, source.drawAssets)));
      } catch (err) {
        console.warn("3D label texture build failed:", err);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => { clearTimeout(timer); if (!done) setLoading(false); };
  }, [source, cfg, bleedIn]);
```

Update the file-header comment (no more "re-renders the PDF pair"). Delete the `chain` ref.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/App.tsx` (still passing the old props to both views). Task 4 fixes App.

- [ ] **Step 4: Do not commit yet** — Task 4 completes the unit.

---

### Task 4: App + TabsShell — promote the canvas path, delete the worker stack and the hide plumbing

**Files:**
- Modify: `src/App.tsx`, `src/TabsShell.tsx`, `src/layout.ts` (one stale comment), `src/pdf/fonts.ts` + `src/pdf/render.ts` (stale header comments)
- Delete: `src/pdf/client.ts`, `src/pdf/worker.ts`, `tests/preview-client.test.ts`

**Interfaces:**
- Consumes: Task 2's PreviewCompare props (`canvasRender`, `bleedIn`, `onRenderError`); Task 3's CanView props (`cfg`, `source`, `bleedIn`); `CanvasRenderSource` from `@/canvas/draw`; `loadLabelFaces` from `@/fonts`; existing `collabAssets` / `eyedAssets` helpers.
- Produces: no exported-interface changes. The preview worker protocol no longer exists anywhere in `src/`.

- [ ] **Step 1: Delete the flag and restructure the assembly effect**

1. Delete the `CANVAS_PREVIEW` const (module scope, ~line 354) and the `import { buildPreviewPdfs, disposePreviewWorker } from "@/pdf/client";` line.

2. The canvas-assets effect loses the flag gate and — critically — narrows its deps from `inputs` to asset-shaped inputs only, so a keystroke never re-decodes bitmaps. `skip` moves OUT of the assembled state (an edit session must skip the element the SAME frame, not after a 150ms debounce + decode):

```ts
  // The render source for BOTH views: fonts + decoded bitmaps for drawPlate,
  // assembled off the asset inputs alone (debounced — uploads and eye/tint
  // toggles are rare and each re-assembly decodes up to 4 ImageBitmaps).
  // Config changes deliberately DON'T re-run this: cfg flows into the views
  // as a prop and repaints with these same bitmaps. The two collab tint
  // knobs are the only cfg fields the bitmaps depend on, so they are
  // dependencies here by value.
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

3. **Close race fix (carried item):** the previous generation's bitmaps must be closed AFTER React commits the new one — closing them inline before `setCanvasAssets` let a pending rAF (scheduled with the old `canvasRender`) draw already-closed bitmaps. Post-commit, the views' effect cleanups have already cancelled that rAF / rebuild timer (child cleanups run before parent effects), so this is race-free:

```ts
  // Close the superseded generation's ImageBitmaps AFTER the commit that
  // replaces them: any rAF or rebuild timer still holding the old assets was
  // cancelled by the views' effect cleanups during this same commit (child
  // cleanups run first), so nothing can draw a closed bitmap. Unmount closes
  // the last generation.
  useEffect(() => {
    const prev = canvasBitmaps.current;
    if (prev && prev !== canvasAssets?.drawAssets) closeCanvasBitmaps(prev);
    canvasBitmaps.current = canvasAssets?.drawAssets ?? null;
  }, [canvasAssets]);
  useEffect(() => () => closeCanvasBitmaps(canvasBitmaps.current), []);
```

(`canvasBitmaps` / `closeCanvasBitmaps` already exist — keep them.)

4. The skip set and the shared source, memoized so a divider-drag re-render doesn't schedule repaints:

```ts
  // What planLabel omits: the layers-panel eyes, plus the in-place edit
  // session's element — the v0.1.16 hide-and-rebuild plumbing reduced to a
  // render flag. Same-frame: a new editSession changes this memo, the
  // source memo below, and PreviewCompare repaints on the next rAF.
  const skip = useMemo<{ has(id: ElementId): boolean }>(
    () => editSession
      ? { has: (id: ElementId) => id === editSession
          || hiddenLayers.has(id as HideableLayerId) }
      : hiddenLayers,
    [editSession, hiddenLayers],
  );
  // Null until the first assembly lands — both views render from this.
  const canvasSource = useMemo<CanvasRenderSource | null>(
    () => (canvasAssets ? { ...canvasAssets, skip } : null),
    [canvasAssets, skip],
  );
```

Type notes: import `MeasureFace` from `@/plan` (add to the existing type-only import) and `CanvasRenderSource` from `@/canvas/draw`; `ComponentProps` becomes unused — remove it from the react import.

5. Delete the whole old dev-only assembly effect (the one gated on `CANVAS_PREVIEW`, ~lines 1016–1105) — the effects above replace it.

- [ ] **Step 2: Delete the preview build machinery**

Delete outright from App.tsx:

- the `pdfs` state and its comment; the `building`-adjacent `needMask` const and comment block; the `inputs` array, `built` ref, `buildChain` ref, and the entire debounced build effect (~lines 914–1014); the deactivation effect's `setPdfs(null); built.current = null;` body — replace it with:

```ts
  // Background tabs keep their state and asset bytes but not their decoded
  // render source: the ImageBitmaps are the heavy, cheaply-rebuildable part.
  // The assembly effect above bails while inactive, and `active` in its deps
  // reruns it on reactivation; the close effect below reclaims the bitmaps.
  useEffect(() => {
    if (!active) setCanvasAssets(null);
  }, [active]);
```

- (`editSession` state itself STAYS — it feeds `skip`. `building` STAYS — the export builds still use it.)

Verify with `grep -n "pdfs\|needMask\|buildChain\|built\.current\|buildPreviewPdfs" src/App.tsx` — only `previewReady`-related lines from Step 3 may remain.

- [ ] **Step 3: Rewire the render and the readiness gates**

1. PreviewCompare call site: delete the `artBytes`/`maskBytes` props and their comment; pass

```tsx
              canvasRender={viewMode === "2d" ? canvasSource : null}
              bleedIn={render.bleedIn}
```

Keep `onRenderError={setBuildError}`.

2. CanView call site: replace `artBytes={...} maskBytes={...}` with

```tsx
                cfg={cfg} source={canvasSource} bleedIn={render.bleedIn}
```

3. Readiness gates — one definition replaces every `pdfs` check:

```ts
  // "The preview has something to render from": both views draw from the
  // assembled canvas source; CanView shows its own corner spinner while a
  // texture rebuild is in flight.
  const previewReady = !!canvasAssets;
```

- First-load spinner: `{!pdfs && !buildError && (` → `{!previewReady && !buildError && (`.
- Corner rebuild spinner: `{building && pdfs && (` → `{building && previewReady && (` (now shows only during export builds, which is when `building` is true).
- No-texture hint: `{!texture && !building && pdfs && (` → `{!texture && !building && previewReady && (`.
- Export guard: `const pdfExportBlocked = exportBlocked || !pdfs;` → `const pdfExportBlocked = exportBlocked || !previewReady;` and update its comment (the guard means "the render pipeline has come up", no longer "preview bytes exist").

4. Comment sweep: the file-header (lines 1–11: the 2D preview draws per keystroke from the canvas backend; the 3D views texture from the same plates; PDFs/PSDs build on export only); `editSession`'s state comment (~line 404 — "the preview build hides that element" → "planLabel skips it via the render flag"); the layout-publish comment (~line 555) loses its "preview worker holds its own layout module" paragraph; PreviewCompare's `onEditSession` prop comment if it says "preview build".

- [ ] **Step 4: TabsShell + dead-file deletion + stale comments elsewhere**

1. `src/TabsShell.tsx`: delete `import { disposePreviewWorker } from "@/pdf/client";`, the `useEffect(() => () => disposePreviewWorker(), []);` (and its comment), and the header comment's "preview worker" mention.
2. Delete `src/pdf/client.ts`, `src/pdf/worker.ts`, `tests/preview-client.test.ts` (`git rm`).
3. `src/layout.ts` (~line 340): rewrite the "NOTE for callers: the PDF preview worker runs its own copy of this module … pdf/client.ts ships the value with every request" comment — the preview worker is gone; the note shrinks to whatever remains true for `npm run generate`'s separate Node module registry (read the surrounding text and keep only what still holds).
4. `src/pdf/fonts.ts` header: drop the "preview worker" mention (its consumers are now the export builds and the parity page).
5. `src/pdf/render.ts` header: its consumers are now `src/dev/parity.ts` only — say so (dev-only; kept for the parity harness). `rasterWorker.ts` stays with it.

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green (262+ tests: Task 1 added four, `preview-client.test.ts`'s three are gone). `grep -rn "CANVAS_PREVIEW\|canvasPreview\|buildPreviewPdfs\|disposePreviewWorker" src tests` returns nothing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: canvas backend renders the 2D preview and 3D textures; preview PDF worker deleted"
```

---

### Task 5: Verification — real Chrome + parity

No file changes expected (fixes found here fold into a follow-up commit).

- [ ] **Step 1: Manual pass in real Chrome** (headless Chromium cannot boot the app — known pdf.js worker-startup issue; use the chrome-devtools MCP against a dev server)

Start `npm run dev` (record the PID; kill only that PID afterwards). Verify:

1. The 2D preview paints both plates on load with NO `localStorage.canvasPreview` flag set, and DevTools shows no preview-worker module loading at any point (pdf.js's rasterWorker may still load if the parity page was visited — not from the app itself).
2. Typing in the name field updates the canvas per keystroke (no 150ms lag, no blur flash).
3. Double-click the name → in-place editor opens and the drawn element vanishes the same frame; Enter restores it; Escape reverts the text.
4. Divider drag reveals the mask plate; both plates track config edits.
5. Texture/mask/collab uploads appear; layer eyes hide elements (a hidden background renders bare stock).
6. Keys 3/4/5: each 3D view textures the can from the canvas plates (corner "rendering…" while building, then the label wraps with foil/matte reading correctly — the metalness split is the thing this change could plausibly break, look at it deliberately); back to 2D keeps the canvas preview.
7. Export PDFs still produces both files (full-res on-demand build path untouched).
8. Zoom in past 250%: the raster ratchet re-sizes the canvas backing store (text stays sharp).
9. Bleed knob change (Document Settings) repaints the 2D preview AND rebuilds the 3D texture at the new geometry.

- [ ] **Step 2: Pixel parity**

Run: `npm run parity` — all four rows PASS (threshold 5%, Phase 2 observed 2.04–2.48%). The harness exercises `drawPlate` directly, so Task 1's changes are covered; expect no material change in the numbers.

- [ ] **Step 3: If anything failed** — fix, re-run the failing check, commit as `fix:` with the observed evidence in the message. Never claim a check passed without its output.

---

### Task 6: Release steward — version 0.1.19 + changelog

**Files:**
- Modify: `package.json`, `package-lock.json` (two version fields), `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `label-lab` entry), `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump the synchronized version**

`npm version 0.1.19 --no-git-tag-version` handles the npm pair; hand-edit `Cargo.toml`, the `Cargo.lock` `label-lab` entry, and `tauri.conf.json` to `0.1.19`.

- [ ] **Step 2: Changelog entry**

```markdown
## [0.1.19] - 2026-08-25

- The preview now renders directly on canvas from the shared display list —
  2D updates land per keystroke with no debounce, in-place editing hides the
  edited element instantly, and the 3D views texture from the same plates.
  PDFs and PSDs are built only on export; exported files are unchanged.
```

- [ ] **Step 3: Release check, final validation, commit**

Run: `node scripts/check-release.mjs origin/main`, then `npx tsc --noEmit && npx vitest run` — all green.

```bash
git add -A
git commit -m "chore: bump version to 0.1.19 and record the changelog"
```

Do NOT merge or push — the user gates that. After committing, update `.agents/ledger.md` (Phase 3 entry: status, delta, anything carried to Phase 4 — note that "3D from canvas plates" moved INTO Phase 3, so Phase 4 is now PSD-on-plan, drag-to-move, dynamic fonts) and `learnings.md` if anything new was learned, in a final `docs:` commit.

---

## Self-review notes

- Spec coverage (Phase 3 + pulled-forward item): preview renders from canvas per keystroke with no worker/debounce (Tasks 2, 4); 3D views texture from canvas plates and the whole preview worker stack — `pdf/client.ts`, `pdf/worker.ts`, App's debounced build, `pdfs`, TabsShell's dispose — is deleted (Tasks 3–4; user-approved scope pull from Phase 4); in-place editing via `skip` with the v0.1.16 hide plumbing deleted (Task 4); error handling to `buildError` with failed frames keeping the last canvas (Task 2); exports build on demand and stay pixel-identical (untouched paths; Task 5 checks). pdf.js (`render.ts`/`rasterWorker.ts`) survives solely for the dev parity page.
- All six carried Phase 2 items have homes: silent drawImage skip + textBaseline/textAlign + stroke-order pins + `box.x!` (Task 1), close race (Task 4 Step 1.3) + buildError routing (Task 2).
- Deliberate choices: the mask plate paints every frame even at split 0 (drawPlate is cheap; needMask bought nothing on the canvas path); CanView keeps a 150ms debounce because deriveMetalness is a ~3.4M-px pass — the 2D path has none; 3D texture quality is preserved by matching the old raster's texel density (MAX_SCALE 4 / MAX_EDGE 4096) and the texture bitmap was already sized for it (PREVIEW_PX 2400); `buildLabelTextures` goes synchronous, so CanView's promise chain dies with pdf.js.
- Type consistency: `CanvasRenderSource` defined once in `canvas/draw.ts` (Task 2), consumed by PreviewCompare (Task 2), CanView (Task 3), and App's memo (Task 4); `drawPlates`/`buildLabelTextures` signatures match between Tasks 3 and 4; `previewReady` defined and used only in Task 4.
