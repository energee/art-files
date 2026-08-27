# Master Layer Model + Panel Re-drive Implementation Plan (Plan 5a of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The master owns a real, ordered layer list; the layers panel renders *that* list flat in draw order instead of the hardcoded Beer/Collab/Template registry groups; the collab block dissolves into layers owned by the Collab variation; custom layers can be reordered front/back.

**Architecture:** Layers stay **thin** — a `MasterLayer` carries identity and policy (`id`, `name`, `enabled`, `locked`, owning `variation`), never style or content. Built-in layer ids are the existing `ElementId`s, so `planLabel` and every renderer are untouched; `resolve()` gains one step that applies layer policy to the `LabelConfig` it already produces (disabled → a skip set the app folds into its existing `skip`, locked → the `Positioned.locked` fields drag already honors). This is the spec's Approach 1 held one notch further, not the rejected clean-slate rewrite.

**Tech Stack:** TypeScript, vitest, existing React components. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-master-variation-design.md` (sections "Layer" — no reserved ids, no sacred built-ins; "Lock, snap & guides"; "Migration" — collab becomes a variation)

**Plan sequence:** Plans 1–4 complete (v0.1.34 pushed). This is 5a; 5b is master authoring (Design edits write the master); 6 is the Proof rename; 7 is presets→masters migration.

## Global Constraints

- No new npm dependencies. Branch `design/master-variation`. Do NOT merge PR #41 — merging auto-publishes a release.
- After each task: `npx vitest run` green, `npx tsc --noEmit` clean, then commit (sentence-style, no Co-Authored-By).
- **Print-output invariant:** the shipped master resolved with no variations must produce byte-identical PDF/PSD/plan output. The existing byte-identity locks (`tests/pdf-build.test.ts`, `tests/psd-build.test.ts`, `tests/custom-layers.test.ts`'s plan lock) are the gate — they must stay green unmodified.
- `planLabel` and the three backends (`src/pdf/build.ts`, `src/canvas/draw.ts`, `src/psd/build.ts`) are NOT edited by this plan. If a task seems to need it, the task is wrong — stop and report.
- Master edits are not yet persisted (that is 5b): `lolevMaster()` in code remains the source. Nothing in this plan may add a UI that writes the master.
- Known pre-existing flake: `tests/pdf-build.test.ts`'s byte-compare occasionally fails on a PDF timestamp straddling a second boundary. Re-run once; it never produces false passes.
- Before push: synchronized version bump + CHANGELOG entry (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock `label-lab` entry, src-tauri/tauri.conf.json).
- Reviewer subagents are STRICTLY READ-ONLY — no stash, no checkout, no writes.

---

### Task 1: MasterLayer model, shipped layer declarations, parser validation

**Files:**
- Modify: `src/model/types.ts`
- Modify: `src/model/lolev.ts`
- Test: `tests/model-master-layers.test.ts` (create)

**Interfaces:**
- Consumes: existing `Master`, `Variation`, `FieldDecl` (`src/model/types.ts`); `ElementId` values as documented below (do NOT import `src/elements.ts` into `src/model/` — that would drag the UI registry into the pure core; the ids are declared as plain strings with a pointer comment, the same deliberate duplication `FieldDecl.symbology` already uses).
- Produces:

```ts
// src/model/types.ts
/** One layer on the master: identity and POLICY only — never style or
 *  content (those stay in `defaults`, which resolves into LabelConfig).
 *  Built-in `id`s are the renderer's own element ids (see src/elements.ts's
 *  ElementId: "name" | "styleLine" | "abv" | "description" | "volume" |
 *  "wordmark" | "logo" | "handleAddress" | "warning" | "storeCold" | "qr" |
 *  "barcode" | "collabLead" | "collabLeft" | "collabCenter"), re-declared
 *  here rather than imported so the pure model never depends on the UI
 *  registry — keep the two in sync. */
export interface MasterLayer {
  id: string;
  /** Shown in the layers panel. */
  name: string;
  /** Master-level disable: the layer never draws on any label. */
  enabled: boolean;
  /** Fillers cannot move it (spec: Lock). Absent = unlocked. */
  locked?: boolean;
  /** Which variation owns this layer; absent = the master owns it. A layer
   *  owned by a disabled variation does not draw. This is how the collab
   *  block stops being a special case: its three layers are ordinary master
   *  layers tagged `variation: "collab"`. Deliberate extension of the spec's
   *  `variation.layers` (which stays, for layers a variation APPENDS): the
   *  collab layers sit at fixed positions in the draw order, which an
   *  appended list cannot express. */
  variation?: string;
}

// Master gains:
  /** Every layer, in DRAW ORDER (the order planLabel emits them). */
  layers: MasterLayer[];

// Variation.layerOverrides tightens from Record<string, unknown> to:
  layerOverrides: Record<string, Partial<MasterLayer>>;
```

`lolevMaster()` declares its layers in `planLabel`'s exact draw order (read `src/plan.ts`'s `planLabel` top-to-bottom to confirm before writing; as of this plan it is): `volume`, `abv`, `description`, `collabLead`, `collabLeft`, `wordmark`, `logo`, `collabCenter`, `name`, `styleLine`, `handleAddress`, `warning`, `storeCold`, `qr`, `barcode`. Names follow the spec's rename of the wordmark to **Brand**; the rest reuse the labels `src/elements.ts`'s `ELEMENTS` already carries (Volume, ABV, Description, Lead-In, Text Logo, Brand, Logo, Graphic Logo, Name, Style, Info, Warning, Store cold, QR, Barcode). The three collab layers carry `variation: "collab"`. `warning` ships `locked: true` (spec: the warning is correct-by-default); everything else ships unlocked, and every layer ships `enabled: true`.

`parseMaster` gains validation: `layers` must be an array; every layer needs a non-empty string `id` and `name` and a boolean `enabled`; duplicate layer ids fail; a `variation` naming no declared variation fails.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-master-layers.test.ts
import { describe, expect, it } from "vitest";
import { lolevMaster } from "../src/model/lolev";
import { parseMaster } from "../src/model/types";

describe("lolevMaster layers", () => {
  it("declares every built-in element in draw order", () => {
    expect(lolevMaster().layers.map((l) => l.id)).toEqual([
      "volume", "abv", "description", "collabLead", "collabLeft", "wordmark",
      "logo", "collabCenter", "name", "styleLine", "handleAddress", "warning",
      "storeCold", "qr", "barcode",
    ]);
  });
  it("tags the collab block as the Collab variation's layers", () => {
    const owned = lolevMaster().layers.filter((l) => l.variation === "collab");
    expect(owned.map((l) => l.id)).toEqual(["collabLead", "collabLeft", "collabCenter"]);
  });
  it("renames the wordmark to Brand and ships every layer enabled", () => {
    const m = lolevMaster();
    expect(m.layers.find((l) => l.id === "wordmark")!.name).toBe("Brand");
    expect(m.layers.every((l) => l.enabled)).toBe(true);
  });
  it("ships the government warning locked", () => {
    expect(lolevMaster().layers.find((l) => l.id === "warning")!.locked).toBe(true);
  });
});

describe("parseMaster layer validation", () => {
  const withLayers = (layers: unknown) => ({ ...lolevMaster(), layers });
  it("accepts the shipped master", () => {
    expect(() => parseMaster(lolevMaster())).not.toThrow();
  });
  it("rejects a missing layers array", () => {
    expect(() => parseMaster(withLayers(undefined))).toThrow(/layers/i);
  });
  it("rejects a layer without an id or name", () => {
    expect(() => parseMaster(withLayers([{ name: "x", enabled: true }]))).toThrow(/id/i);
    expect(() => parseMaster(withLayers([{ id: "x", enabled: true }]))).toThrow(/name/i);
  });
  it("rejects duplicate layer ids", () => {
    expect(() => parseMaster(withLayers([
      { id: "a", name: "A", enabled: true }, { id: "a", name: "A2", enabled: true },
    ]))).toThrow(/duplicate/i);
  });
  it("rejects a layer owned by an undeclared variation", () => {
    expect(() => parseMaster(withLayers([
      { id: "a", name: "A", enabled: true, variation: "nope" },
    ]))).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/model-master-layers.test.ts`
Expected: FAIL — `lolevMaster().layers` is undefined.

- [ ] **Step 3: Implement**

Add `MasterLayer` and the `Master.layers` field per the Interfaces block, tighten `Variation.layerOverrides`, extend `parseMaster` with the validation above (follow the existing `fail(...)` idiom in that function), and add the `layers` array to `lolevMaster()`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green. Nothing consumes `layers` yet, so no other suite can move.

- [ ] **Step 5: Commit**

```bash
git add src/model/types.ts src/model/lolev.ts tests/model-master-layers.test.ts
git commit -m "Model: the master owns an ordered layer list, with the collab block tagged as its variation's."
```

---

### Task 2: resolve() applies layer policy (enabled, locked, ownership)

**Files:**
- Modify: `src/model/resolve.ts`
- Modify: `src/model/document.ts` (composeConfig passes the new fields through)
- Test: `tests/model-resolve.test.ts` (extend), `tests/model-document.test.ts` (extend)

**Interfaces:**
- Consumes: `MasterLayer` (Task 1), existing `resolve`/`composeConfig`.
- Produces:

```ts
// src/model/resolve.ts — resolve()'s return type gains:
  /** Layer ids that must not draw: master-disabled, or owned by a variation
   *  that is not enabled. The app folds these into the same `skip` set the
   *  layers-panel eyes already feed planLabel — the renderers stay untouched
   *  (spec: Approach 1). */
  disabledLayers: Set<string>;
  /** The resolved layers, in draw order, each with its owning variation —
   *  what the layers panel lists. Variation-owned layers are INCLUDED even
   *  when their variation is off (they appear dimmed in Design mode); the
   *  `disabledLayers` set is what decides drawing. */
  layers: MasterLayer[];

// src/model/document.ts — composeConfig()'s return gains the same two fields,
// passed straight through from resolve().
```

Resolution rules (binding, applied after the existing merge + value steps, before returning):
1. Start from `master.layers` in order; for each enabled variation, apply its `layerOverrides[id]` as a shallow patch onto the matching layer, then append its own `layers` (spec's appended-layer path — none ship today, but the code path exists and is tested).
2. `disabledLayers` = every layer with `enabled === false`, plus every layer whose `variation` is set and not in `enabledVariations`.
3. **Lock is a master default, not a label fact (5a only):** for each layer with `locked === true` whose id names a `Positioned` config field (`logo`, `collabLeft`, `collabCenter`), set `config.<id>.locked = true`. Because `composeConfig` applies label overrides *after* `resolve`, a label that carries its own `locked` still wins — which is the precedence 5a wants, and 5b will move the authority to the master.

- [ ] **Step 1: Write the failing test**

```ts
// appended to tests/model-resolve.test.ts
describe("layer policy", () => {
  it("lists every layer in draw order and skips the off-variation ones", () => {
    const r = resolve(lolevMaster(), [], {});
    expect(r.layers[0].id).toBe("volume");
    expect(r.layers.at(-1)!.id).toBe("barcode");
    expect([...r.disabledLayers].sort())
      .toEqual(["collabCenter", "collabLead", "collabLeft"]);
  });
  it("enabling the collab variation lets its layers draw", () => {
    expect(resolve(lolevMaster(), ["collab"], {}).disabledLayers.size).toBe(0);
  });
  it("a master-disabled layer never draws", () => {
    const m = lolevMaster();
    m.layers.find((l) => l.id === "qr")!.enabled = false;
    expect(resolve(m, ["collab"], {}).disabledLayers.has("qr")).toBe(true);
  });
  it("a variation's layerOverrides patch the layer only while it is enabled", () => {
    const m = lolevMaster();
    m.variations[0].layerOverrides = { qr: { enabled: false } };
    expect(resolve(m, ["collab"], {}).disabledLayers.has("qr")).toBe(true);
    expect(resolve(m, [], {}).disabledLayers.has("qr")).toBe(false);
  });
  it("a locked layer stamps the config's Positioned lock", () => {
    const m = lolevMaster();
    m.layers.find((l) => l.id === "logo")!.locked = true;
    expect(resolve(m, [], {}).config.logo.locked).toBe(true);
  });
});
```

```ts
// appended to tests/model-document.test.ts
it("a label-level lock override beats the master's locked layer", () => {
  const m = lolevMaster();
  m.layers.find((l) => l.id === "logo")!.locked = true;
  const { config } = composeConfig(m, [], {}, { logo: { locked: false } });
  expect(config.logo.locked).toBe(false);
});
it("composeConfig passes layers and disabledLayers through", () => {
  const r = composeConfig(lolevMaster(), [], {}, undefined);
  expect(r.layers.map((l) => l.id)).toContain("barcode");
  expect(r.disabledLayers.has("collabLead")).toBe(true);
});
```

(Add whatever imports each suite is missing — `lolevMaster`, `resolve`, `composeConfig`.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/model-resolve.test.ts tests/model-document.test.ts`, FAIL: `disabledLayers` undefined.

- [ ] **Step 3: Implement** the three rules above in `resolve.ts` and widen `composeConfig`'s return in `document.ts` (pass `layers`/`disabledLayers` straight through; the override merge already happens after, which is what gives label-lock precedence).

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green. The byte-identity locks must be untouched: nothing is skipped by default except the collab layers, which `cfg.collabEnabled === false` already suppresses in `planLabel`.

- [ ] **Step 5: Commit**

```bash
git add src/model/resolve.ts src/model/document.ts tests/model-resolve.test.ts tests/model-document.test.ts
git commit -m "Resolve: apply layer policy — disabled and variation-owned layers skip, locked layers stamp the drag lock."
```

---

### Task 3: The layers panel renders the master's layers, flat and in draw order

**Files:**
- Create: `src/model/panel.ts`
- Modify: `src/components/layers.ts` (delete `PANEL_GROUPS`, `PanelGroup`, `rowsOf`, `PANEL_ORDER`; keep `LAYER_ICONS`, `DOC_LAYER_LABELS`, `DocLayerId`, `LayerId`, `isElementId`, `isHideable`)
- Modify: `src/elements.ts` (drop `group` from `LabelElement` and every `ELEMENTS` row)
- Modify: `src/components/LayersPanel.tsx`
- Modify: `src/App.tsx` (skip set folds in `disabledLayers`; selection order comes from the computed rows; panel gets the rows)
- Test: `tests/model-panel.test.ts` (create), `tests/layerspanel-dom.test.tsx` (create — follow `tests/fieldlist-dom.test.ts`'s happy-dom + react-dom/client + act convention exactly; do NOT add @testing-library)

**Interfaces:**
- Consumes: `composeConfig`'s `layers`/`disabledLayers` (Task 2); `cfg.customLayers`.
- Produces:

```ts
// src/model/panel.ts — pure: what the layers panel lists, in one place, so
// the panel's rows and the shift-range selection order cannot disagree.
export interface PanelRow {
  id: string;
  name: string;
  /** Owning variation's id, when a variation owns this layer. */
  variation?: string;
  /** Owning variation's display name, for the row badge. */
  variationName?: string;
  /** The layer does not draw right now (master-disabled, or its variation is
   *  off) — the panel dims the row. */
  inactive: boolean;
  /** A per-label custom layer rather than a master layer: the only rows that
   *  can be reordered or removed. */
  custom: boolean;
  locked: boolean;
}

export function panelRows(
  master: Master, layers: MasterLayer[], disabledLayers: ReadonlySet<string>,
  cfg: LabelConfig,
): PanelRow[];
```

`panelRows` = the resolved master layers in draw order, then `cfg.customLayers` in stored order (custom rows: `custom: true`, `locked` from the layer, never `inactive`). Master rows take `locked` from the resolved layer and `variationName` from `master.variations`.

Panel structure (binding):
- **One `Layers` group**, flat, in draw order, holding every row `panelRows` returns — master, variation-owned, and custom inline. No Beer/Collab/Template groups. The "Add layer ▾" menu moves onto this group's header (Design-only, unchanged behavior).
- A variation-owned row shows its `variationName` as a small muted badge after the name; an `inactive` row renders at reduced opacity (`opacity-50`) with its eye and metallic toggle disabled — it is not on this label.
- The collab on/off `Switch` on the old group header is **deleted**: enabling Collab is the variation checkbox in Fill mode, and `cfg.collabEnabled` stops being directly editable from the panel.
- The **Document** group (background/mask/settings) stays exactly as it is.
- `LayerRow` takes its display name from the row (`row.name`), not `elementById`, so a renamed layer shows its master name.
- App: `skip` becomes the union of `hiddenLayers`, the edit-session element, and `disabledLayers`; the shift-range order passed to `resolveSelect` becomes `panelRows(...).map(r => r.id)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/model-panel.test.ts
import { describe, expect, it } from "vitest";
import { panelRows } from "../src/model/panel";
import { composeConfig } from "../src/model/document";
import { lolevMaster } from "../src/model/lolev";

const rowsFor = (enabled: string[]) => {
  const m = lolevMaster();
  const r = composeConfig(m, enabled, {}, undefined);
  return panelRows(m, r.layers, r.disabledLayers, r.config);
};

describe("panelRows", () => {
  it("lists master layers flat, in draw order", () => {
    expect(rowsFor([]).map((r) => r.id).slice(0, 3)).toEqual(["volume", "abv", "description"]);
  });
  it("marks collab rows inactive and badged while the variation is off", () => {
    const lead = rowsFor([]).find((r) => r.id === "collabLead")!;
    expect(lead.inactive).toBe(true);
    expect(lead.variationName).toBe("Collab");
    expect(rowsFor(["collab"]).find((r) => r.id === "collabLead")!.inactive).toBe(false);
  });
  it("appends custom layers, flagged and never inactive", () => {
    const m = lolevMaster();
    const r = composeConfig(m, [], {}, undefined);
    const cfg = structuredClone(r.config);
    cfg.customLayers = [{
      id: "custom-a", name: "Note", type: "text", size: 10,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "hi", fill: "#000000", layer: "white" },
    }];
    const rows = panelRows(m, r.layers, r.disabledLayers, cfg);
    expect(rows.at(-1)).toMatchObject({ id: "custom-a", name: "Note", custom: true, inactive: false });
  });
  it("reports the master's lock on a row", () => {
    const m = lolevMaster();
    const r = composeConfig(m, [], {}, undefined);
    expect(panelRows(m, r.layers, r.disabledLayers, r.config)
      .find((x) => x.id === "warning")!.locked).toBe(true);
  });
});
```

```tsx
// tests/layerspanel-dom.test.tsx — copy tests/fieldlist-dom.test.ts's setup
// verbatim (happy-dom pragma, createRoot + act helpers), then:
//   1. render <LayersPanel …/> in design mode with the shipped master's rows
//      and assert the document contains a "Layers" group label, a row named
//      "Brand", and NO text "Beer" / "Template" and no element with
//      aria-label "Collab enabled" (the deleted switch).
//   2. assert the "Lead-In" row's container carries the "Collab" badge text
//      and the opacity-50 class while the variation is off.
```

- [ ] **Step 2: Run to verify failure** — module missing / panel still renders groups.

- [ ] **Step 3: Implement** `src/model/panel.ts`, then delete the group machinery from `src/components/layers.ts` and the `group` field from `src/elements.ts`'s `LabelElement` and rows, then rewrite `LayersPanel`'s body around the flat row list, then wire App (skip union, selection order, rows prop). Compile errors are the checklist: every consumer of `group`/`PANEL_GROUPS`/`PANEL_ORDER` must be re-pointed, not stubbed.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green, byte-identity locks unmoved.

- [ ] **Step 5: Commit**

```bash
git add src/model/panel.ts src/components/layers.ts src/components/LayersPanel.tsx src/elements.ts src/App.tsx tests/model-panel.test.ts tests/layerspanel-dom.test.tsx
git commit -m "Layers panel: one flat list driven by the master's layers, with the collab block as a badged variation."
```

---

### Task 4: Reorder custom layers front/back

**Files:**
- Modify: `src/components/LayersPanel.tsx`
- Modify: `src/App.tsx` (the reorder handler)
- Test: `tests/custom-layers.test.ts` (extend)

**Interfaces:**
- Consumes: `PanelRow.custom` (Task 3), App's `update`.
- Produces:

```ts
// src/App.tsx
/** Move a custom layer one place earlier (back) or later (front) in
 *  cfg.customLayers — which IS its z-order: planLabel appends custom layers
 *  in stored order, so later means drawn on top. One undoable step; a no-op
 *  at either end of the custom range. */
function moveCustomLayer(id: string, delta: -1 | 1): void;
```

Panel: a custom row in Design mode shows two small chevron buttons (`ChevronUp`/`ChevronDown` from lucide-react, already a dependency), `aria-label`s `"Bring ${name} forward"` / `"Send ${name} backward"`, disabled at the ends. **Master rows get no reorder control** — built-in draw order is fixed in `planLabel`, so offering it would be a lie; add a one-line comment saying so.

- [ ] **Step 1: Write the failing test**

```ts
// appended to tests/custom-layers.test.ts — pins the contract the buttons
// rely on: stored order IS z-order.
it("custom layer order is z-order: a later layer plans on top", () => {
  const cfg = defaultConfig();
  const layer = (id: `custom-${string}`, text: string) => ({
    id, name: text, type: "text" as const, size: 10,
    position: { anchor: "left" as const, vAnchor: "top" as const, offsetX: 0, offsetY: 0 },
    line: { text, fill: "#000000" as const, layer: "white" as const },
  });
  cfg.customLayers = [layer("custom-a", "A"), layer("custom-b", "B")];
  const ids = (c: LabelConfig) =>
    planLabel(c, m).filter((p) => p.id.startsWith("custom-")).map((p) => p.id);
  expect(ids(cfg)).toEqual(["custom-a", "custom-b"]);
  const swapped = structuredClone(cfg);
  swapped.customLayers = [cfg.customLayers[1], cfg.customLayers[0]];
  expect(ids(swapped)).toEqual(["custom-b", "custom-a"]);
});
```

(Use the `m` measure stub and imports the surrounding suite already defines.)

- [ ] **Step 2: Run it** — if it already passes, that IS the contract; note which in the report and continue.

- [ ] **Step 3: Implement** `moveCustomLayer` in App (splice within `update`) and the two chevron buttons on custom rows.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/LayersPanel.tsx tests/custom-layers.test.ts
git commit -m "Layers panel: move custom layers forward and backward in the stack."
```

---

### Task 5: Version bump + CHANGELOG + push gate

**Files:** `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (label-lab entry), `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump 0.1.34 → 0.1.35** in all five locations (`npm install --package-lock-only` refreshes the lockfile; edit Cargo.lock's `label-lab` entry by hand).

- [ ] **Step 2: CHANGELOG entry**

```markdown
## [0.1.35] - 2026-08-27

- The layers panel now lists the label's real layers in drawing order, in one
  flat list, instead of the fixed Beer / Collab / Template groups. Each layer
  is declared by the master, so a layer can be renamed, switched off, or
  locked there rather than being hardwired into the app — the wordmark is now
  "Brand", and the government warning ships locked. The collab block is no
  longer a special section with its own switch: its three layers belong to the
  Collab variation and appear when it is enabled, marked with a Collab badge
  while it is off. Custom layers can be moved forward and backward in the
  stack.
```

- [ ] **Step 3: Full gate** — `npx vitest run && npx tsc --noEmit` green (re-run once if the known PDF timestamp flake fires).

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "Version 0.1.35: master-declared layers and a flat layers panel."
git push
```

Do NOT merge PR #41.

---

## Self-Review

- Spec coverage (5a slice): no reserved ids / no sacred built-ins ✓ (T1 declares every built-in as an ordinary layer); layer `enabled`/`locked`/`name` ✓ (T1/T2); collab → variation-owned layers ✓ (T1/T2/T3); panel reflects the master ✓ (T3); warning locked by default ✓ (T1). Deferred to 5b by design: Design edits writing the master, the Editing selector, `.master` save/open, make-fillable. Deferred beyond: built-in draw-order reordering (fixed in `planLabel`), collab slot images as `image` fields (Plan 7 migration).
- Placeholder scan: the only prose-only step is Task 3's DOM test body, which names its exact assertions and the suite whose setup it copies; every other code step carries real code.
- Type consistency: `MasterLayer` (T1) → `resolve`'s `layers`/`disabledLayers` (T2) → `panelRows`/`PanelRow` (T3) → `moveCustomLayer` (T4) line up; `PanelRow.custom` is what T4 gates its buttons on.
- Stated judgment calls: thin layers (policy only, style stays in `defaults`); `MasterLayer.variation` as an ownership tag rather than the spec's appended `variation.layers` (kept for genuinely appended layers); lock as a master *default* a label override can still beat, until 5b moves the authority.
