# Master Authoring Implementation Plan (Plan 5b of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Design mode edits the **master** — the shared core every label inherits — or a chosen **variation**, instead of writing per-label overrides. Ships the "Editing: Master ▾ / Collab / New variation…" selector, overridden badges with per-property reset, `.master` save/open with library registration, and "Make fillable" from a selection.

**Architecture:** The semantic flip is expressed once, purely: a Design edit runs the caller's ordinary `LabelConfig` mutation against a *freshly resolved base*, diffs the result with the `configDiff` already built in Plan 4a, and merges that diff into `master.defaults` (editing the master) or `variation.overrides` (editing a variation). So every existing editor — `applyStyle`, the inspector's fields, drag, lock — keeps mutating a `LabelConfig` and needs no rewrite; only the *destination* of the resulting diff changes. The app's undo history widens from `{cfg, enabledVariations}` to also carry `master`, so master edits are undoable exactly like label edits.

**Tech Stack:** TypeScript, vitest, existing React components. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-master-variation-design.md` (sections "Variation editing"; "Selection carries context" — make-fillable; "Library index"; "`.master` file")

**Plan sequence:** Requires 5a (`docs/superpowers/plans/2026-08-27-master-layers-panel.md`) complete — this plan edits the layers 5a declares. Plan 6 is the Proof rename; Plan 7 is presets→masters migration.

## Global Constraints

- No new npm dependencies. Branch `design/master-variation`. Do NOT merge PR #41 — merging auto-publishes a release.
- After each task: `npx vitest run` green, `npx tsc --noEmit` clean, then commit (sentence-style, no Co-Authored-By).
- **What stays per-label, exactly:** field values, and dragging an *unlocked* layer in Fill mode. Everything else edited in Design mode is a master or variation edit. Fill mode's behavior does not change in this plan.
- **Print-output invariant:** the shipped master with no edits must still produce byte-identical PDF/PSD/plan output; the existing byte-identity locks are the gate.
- `planLabel` and the three backends are NOT edited by this plan.
- The `.label` `overrides` blob stays supported on **read** (legacy files and Fill-mode drags still use it) but Design mode stops producing it.
- Known pre-existing flake: `tests/pdf-build.test.ts`'s byte-compare can fail on a PDF timestamp second-boundary. Re-run once; it never produces false passes.
- Before push: synchronized version bump + CHANGELOG entry (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock `label-lab` entry, src-tauri/tauri.conf.json).
- Reviewer subagents are STRICTLY READ-ONLY — no stash, no checkout, no writes.

---

### Task 1: The pure authoring edit (applyDesignEdit) and master serialization

**Files:**
- Modify: `src/model/document.ts`
- Create: `src/model/masterfile.ts`
- Test: `tests/model-authoring.test.ts` (create)

**Interfaces:**
- Consumes: `composeConfig`, `configDiff` (`src/model/document.ts`), `deepMerge`/`DeepPartial` (`src/model/merge.ts`), `Master`/`Variation`/`MasterLayer` (`src/model/types.ts`), `parseMaster`.
- Produces:

```ts
// src/model/document.ts
/** Where a Design-mode edit is recorded. "master" = master.defaults; any
 *  other value = that variation's overrides (spec: "Editing: Master ▾"). */
export type EditTarget = "master" | { variation: string };

/** Run an ordinary LabelConfig mutation as an AUTHORING edit: apply it to a
 *  freshly resolved base, diff, and record the diff at `target`. Returns a
 *  NEW master — never mutates the one passed in — so it drops straight into
 *  the app's history stack.
 *
 *  This is the whole semantic flip in one function: every existing editor
 *  (applyStyle, the inspector's fields, drag, lock) keeps mutating a
 *  LabelConfig, and only the destination of the resulting diff changes. */
export function applyDesignEdit(
  master: Master, target: EditTarget, enabledVariations: string[],
  values: Record<string, FieldValue>,
  mutate: (cfg: LabelConfig) => void,
): Master;

/** Patch one layer's policy (name/enabled/locked) at `target`: the master's
 *  own layer entry, or the variation's layerOverrides[id]. Returns a new
 *  master. Layer policy is NOT part of LabelConfig, so it cannot ride
 *  applyDesignEdit's diff and gets its own entry point. */
export function applyLayerEdit(
  master: Master, target: EditTarget, layerId: string, patch: Partial<MasterLayer>,
): Master;

/** Every dot-path a variation currently overrides — what the inspector badges
 *  as "overridden" (spec: touched properties show a badge with per-property
 *  reset). Empty for the master, which overrides nothing by definition. */
export function overriddenPaths(master: Master, target: EditTarget): Set<string>;

/** Drop one overridden path from a variation, restoring the master's value.
 *  Returns a new master; a no-op for the master target. */
export function resetOverride(master: Master, target: EditTarget, path: string): Master;

/** Add a variation and return the new master. Ids are slugged from `name`
 *  and de-duplicated with a numeric suffix, so the caller only supplies a
 *  human name (spec: inline creation, no dialogs). */
export function addVariation(master: Master, name: string): { master: Master; id: string };

// src/model/masterfile.ts
/** A .master file is the Master JSON, pretty-printed — the same shape
 *  parseMaster validates. Files on disk are the source of truth; the library
 *  index (src/masters.ts) is only a resolver cache. */
export const MASTER_EXT = ".master";
export function serializeMaster(m: Master): string;
export function parseMasterFile(json: string): Master;  // JSON.parse + parseMaster
```

Binding semantics:
- `applyDesignEdit`: `base = composeConfig(master, enabledVariations, values, undefined).config`; `next = structuredClone(base)`; `mutate(next)`; `d = configDiff(base, next)`; if `d` is empty return `master` **by identity** (memo/dirty-flag contract); else deep-merge `d` into a clone of `master.defaults` (target `"master"`) or the named variation's `overrides`.
  - Editing a variation resolves its base **with that variation enabled** — otherwise the diff would re-record everything the variation already changes. If the target variation is not in `enabledVariations`, resolve with it appended.
- `overriddenPaths`: flatten the variation's `overrides` to leaf dot-paths (`"nameStyle.fill"`), arrays counting as leaves.
- `resetOverride`: delete the path, then prune objects left empty.
- `addVariation`: `id = slug(name)`, suffixing `-2`, `-3`… on collision; new variation ships `{ overrides: {}, layerOverrides: {}, fields: [] }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-authoring.test.ts
import { describe, expect, it } from "vitest";
import {
  addVariation, applyDesignEdit, applyLayerEdit, composeConfig,
  overriddenPaths, resetOverride,
} from "../src/model/document";
import { lolevMaster } from "../src/model/lolev";
import { parseMasterFile, serializeMaster } from "../src/model/masterfile";

const configOf = (m = lolevMaster(), enabled: string[] = []) =>
  composeConfig(m, enabled, {}, undefined).config;

describe("applyDesignEdit", () => {
  it("records a style edit into master.defaults, not the label", () => {
    const m = applyDesignEdit(lolevMaster(), "master", [], {},
      (c) => { c.nameStyle.fill = "#112233"; });
    expect(m.defaults).toEqual({ nameStyle: { fill: "#112233" } });
    expect(configOf(m).nameStyle.fill).toBe("#112233");
  });
  it("never mutates the master it was given", () => {
    const before = lolevMaster();
    applyDesignEdit(before, "master", [], {}, (c) => { c.abv = "9"; });
    expect(before.defaults).toEqual({});
  });
  it("returns the same master by identity when nothing changed", () => {
    const before = lolevMaster();
    expect(applyDesignEdit(before, "master", [], {}, () => {})).toBe(before);
  });
  it("records into a variation's overrides when that is the target", () => {
    const m = applyDesignEdit(lolevMaster(), { variation: "collab" }, [], {},
      (c) => { c.nameStyle.fill = "#445566"; });
    expect(m.defaults).toEqual({});
    expect(m.variations[0].overrides).toMatchObject({ nameStyle: { fill: "#445566" } });
    expect(configOf(m, []).nameStyle.fill).not.toBe("#445566");
    expect(configOf(m, ["collab"]).nameStyle.fill).toBe("#445566");
  });
  it("editing a variation does not re-record what it already overrides", () => {
    const m = applyDesignEdit(lolevMaster(), { variation: "collab" }, [], {},
      (c) => { c.abv = "7"; });
    expect(m.variations[0].overrides.abv).toBe("7");
    // collabEnabled was already the variation's own override — the diff must
    // not double-record it as a fresh edit.
    expect(m.variations[0].overrides.collabEnabled).toBe(true);
  });
});

describe("applyLayerEdit", () => {
  it("patches the master's own layer", () => {
    const m = applyLayerEdit(lolevMaster(), "master", "qr", { enabled: false, name: "Web QR" });
    expect(m.layers.find((x) => x.id === "qr")!).toMatchObject({ enabled: false, name: "Web QR" });
    expect(lolevMaster().layers.find((x) => x.id === "qr")!.enabled).toBe(true);
  });
  it("patches a variation's layerOverrides", () => {
    const m = applyLayerEdit(lolevMaster(), { variation: "collab" }, "qr", { enabled: false });
    expect(m.layers.find((x) => x.id === "qr")!.enabled).toBe(true);
    expect(m.variations[0].layerOverrides.qr).toEqual({ enabled: false });
  });
});

describe("overriddenPaths / resetOverride", () => {
  it("reports a variation's overridden leaves and resets one", () => {
    let m = applyDesignEdit(lolevMaster(), { variation: "collab" }, [], {},
      (c) => { c.nameStyle.fill = "#445566"; c.abv = "7"; });
    const target = { variation: "collab" } as const;
    expect(overriddenPaths(m, target))
      .toEqual(new Set(["collabEnabled", "nameStyle.fill", "abv"]));
    m = resetOverride(m, target, "nameStyle.fill");
    expect(overriddenPaths(m, target)).toEqual(new Set(["collabEnabled", "abv"]));
    expect(m.variations[0].overrides.nameStyle).toBeUndefined();
  });
  it("the master overrides nothing", () => {
    expect(overriddenPaths(lolevMaster(), "master").size).toBe(0);
  });
});

describe("addVariation", () => {
  it("slugs the name and de-duplicates ids", () => {
    const a = addVariation(lolevMaster(), "Winter Release");
    expect(a.id).toBe("winter-release");
    const b = addVariation(a.master, "Winter Release");
    expect(b.id).toBe("winter-release-2");
    expect(b.master.variations).toHaveLength(3);
  });
});

describe(".master file", () => {
  it("round-trips through serialize/parse", () => {
    const m = applyDesignEdit(lolevMaster(), "master", [], {}, (c) => { c.abv = "6"; });
    expect(parseMasterFile(serializeMaster(m))).toEqual(m);
  });
  it("rejects a file that is not a master", () => {
    expect(() => parseMasterFile('{"formatVersion":9}')).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/model-authoring.test.ts`, FAIL: exports missing.

- [ ] **Step 3: Implement** the six functions in `document.ts` and `src/model/masterfile.ts` per the semantics above. Reuse `configDiff`/`deepMerge`; do not write a second diff.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green.

- [ ] **Step 5: Commit**

```bash
git add src/model/document.ts src/model/masterfile.ts tests/model-authoring.test.ts
git commit -m "Model: Design-mode edits record into the master or a variation, with per-path reset and .master files."
```

---

### Task 2: App routes Design edits to the master; the Editing selector

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/LayersPanel.tsx` (layer name/enable/lock go through the layer-edit path)
- Create: `src/components/EditingTarget.tsx`
- Test: `tests/editingtarget-dom.test.tsx` (create — copy `tests/fieldlist-dom.test.ts`'s setup verbatim; do NOT add @testing-library)

**Interfaces:**
- Consumes: Task 1's `applyDesignEdit`, `applyLayerEdit`, `addVariation`, `EditTarget`.
- Produces:

```ts
// src/App.tsx — the history value widens again:
type Doc = { cfg: LabelConfig; enabledVariations: string[]; master: Master };

/** Design-mode edit: mutate as usual, but the diff lands on the master or the
 *  editing variation. Recomposes cfg from the new master in the same history
 *  step, so the preview updates and undo restores both together. */
function designEdit(mutate: (c: LabelConfig) => void): void;

/** Layer policy edit (rename / enable / lock) at the current target. */
function layerEdit(layerId: string, patch: Partial<MasterLayer>): void;

// src/components/EditingTarget.tsx
export function EditingTarget(props: {
  master: Master;
  target: EditTarget;
  onTarget: (t: EditTarget) => void;
  /** Creates the variation, enables it, and selects it as the target. */
  onNewVariation: (name: string) => void;
  /** Unsaved master edits — the label shows a dot. */
  dirty: boolean;
}): React.JSX.Element;
```

Binding behavior:
- `editingTarget` is App state (Design-only, not in history, not persisted), defaulting to `"master"`.
- **The routing rule:** in Design mode, `update()` routes through `designEdit`; in Fill mode it keeps writing `cfg` as today. Implement as one branch *inside* the existing `update` so no call site changes: `update(fn)` → `mode === "design" ? designEdit(fn) : <today's path>`. Two exceptions stay per-label **in both modes**, because they are label facts, each marked with a one-line comment naming why: field-value writes (`onFieldValue`) and the drag handlers (`onNudge` / `onNudgePosition`).
- `designEdit` produces the new master, then recomposes `cfg` from it (`composeConfig(master', enabledVariations, valuesFromConfig(...), labelOverrides)`) and stores `{cfg, enabledVariations, master}` as one history entry, marking the master dirty.
- Auto-target on selection: selecting a layer owned by variation V switches the target to V (spec: edits record into the selected variation automatically); selecting a master-owned layer does not switch away from an explicitly chosen target.
- `EditingTarget` renders at the top of the Design sidebar: a dropdown listing "Master" then every variation by name, plus a "New variation…" item that reveals an inline text input (Enter commits, Esc cancels — no dialog, per spec).
- `LayersPanel`'s per-row rename, enable, and lock go through `layerEdit`. The panel's *eye* stays session-only hiding — unchanged.

- [ ] **Step 1: Write the failing DOM test**

```tsx
// tests/editingtarget-dom.test.tsx — copy tests/fieldlist-dom.test.ts's setup
// verbatim (happy-dom pragma, createRoot + act helpers), then assert:
//   1. with the shipped master and target "master", the trigger's text
//      contains "Master";
//   2. opening the dropdown and clicking "Collab" calls onTarget with
//      { variation: "collab" };
//   3. clicking "New variation…" reveals an input; typing "Winter" and
//      pressing Enter calls onNewVariation("Winter"); pressing Escape
//      instead hides the input without calling it;
//   4. with dirty: true the trigger's text contains the "•" dot.
```

- [ ] **Step 2: Run to verify failure** — component missing.

- [ ] **Step 3: Implement** `EditingTarget`, widen `Doc`, add `designEdit`/`layerEdit`, branch `update`, wire the selector and the panel's policy edits.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green. Byte-identity locks must not move: with no edits the shipped master is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/EditingTarget.tsx src/components/LayersPanel.tsx tests/editingtarget-dom.test.tsx
git commit -m "Design mode edits the master: an Editing selector routes every change to the master or a variation."
```

---

### Task 3: Overridden badges and per-property reset

**Files:**
- Modify: `src/components/StyleProperties.tsx`
- Modify: `src/App.tsx` (pass the overridden set + reset handler down)
- Test: `tests/model-authoring.test.ts` (extend)

**Interfaces:**
- Consumes: `overriddenPaths`, `resetOverride` (Task 1).
- Produces: for each property control whose dot-path is in the overridden set, a small "overridden" dot with a reset affordance (`aria-label` `"Reset ${label} to the master"`) calling `resetOverride` for that path.

Binding: start with the Style section's `fill` / `layer` / `stroke` / `strokeWidth` / `letterSpacing` for the selected element — those cover every element uniformly, and the element's config prefix is exactly what `elements.ts`'s `ELEMENTS`/`FLAT` already encode. Controls whose path is not derivable render no badge, with a comment saying so. Badges render only while the editing target is a variation (the master overrides nothing).

- [ ] **Step 1: Write the failing test**

```ts
// appended to tests/model-authoring.test.ts
it("style edits produce the dot-paths the inspector badges", () => {
  const m = applyDesignEdit(lolevMaster(), { variation: "collab" }, [], {},
    (c) => { c.nameStyle.fill = "#445566"; c.nameStyle.strokeWidth = 9; });
  const paths = overriddenPaths(m, { variation: "collab" });
  expect(paths.has("nameStyle.fill")).toBe(true);
  expect(paths.has("nameStyle.strokeWidth")).toBe(true);
});
```

- [ ] **Step 2: Run it** — it should pass on Task 1's code. If it fails, fix `overriddenPaths`, not the test. Then write the inspector wiring.

- [ ] **Step 3: Implement** the badge + reset in `StyleProperties`, threaded from App.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green.

- [ ] **Step 5: Commit**

```bash
git add src/components/StyleProperties.tsx src/App.tsx tests/model-authoring.test.ts
git commit -m "Inspector: badge a variation's overridden properties and reset one back to the master."
```

---

### Task 4: `.master` save / open, library registration, master dirty flag

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/masters.ts` (registration on save/open)
- Modify: `src/components/AppMenu.tsx` (File-menu items — check its layout table first)
- Test: `tests/masters.test.ts` (extend)

**Interfaces:**
- Consumes: `serializeMaster` / `parseMasterFile` / `MASTER_EXT` (Task 1), `rememberMaster` / `resolveMasterById` (Plan 4a), `rebind` (`src/model/rebind.ts`), and the platform save/open plumbing `saveProject` already uses (`saveNativeFile`, `savePicker`, `writeHandle`, `readNativeFile`).
- Produces: commands `master-save` ("Save Master"), `master-save-as` ("Save Master As…"), `master-open` ("Open Master…"), each also a File-menu item.

Binding:
- Save writes `serializeMaster(master)` through the same platform save path `.label` uses, then `rememberMaster(master, path)` and clears the master-dirty flag. The `.master` path is remembered exactly like `projectPath` / `projectHandle`; `Save Master` is disabled while clean and falls through to Save As when no path is known.
- Open parses, registers, sets it as the document's master, and recomposes `cfg` — routing the label's current values through `rebind` so unmatched fields are reported, surfaced as `setLoadError("Note: " + …)` (advisory, never blocking).
- The master-dirty dot shows in `EditingTarget`'s label (Task 2's `dirty` prop).

- [ ] **Step 1: Write the failing test**

```ts
// appended to tests/masters.test.ts
import { parseMasterFile, serializeMaster } from "../src/model/masterfile";
it("a saved master registers in the library index under its own id", () => {
  const m = parseMasterFile(serializeMaster(lolevMaster()));
  rememberMaster(m, "/tmp/lolev.master");
  expect(masterIndex()[m.id]).toMatchObject({ name: "Lolev", path: "/tmp/lolev.master" });
});
```

- [ ] **Step 2: Run it** — passes if `rememberMaster` is unchanged; the real work is App wiring, which has no automated harness. Say so in the report rather than inventing a test that asserts nothing.

- [ ] **Step 3: Implement** the three commands, the dirty flag, and the open path's `rebind` + advisory.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/masters.ts src/components/AppMenu.tsx tests/masters.test.ts
git commit -m "Masters: save and open .master files, registering each in the library as it lands."
```

---

### Task 5: Make fillable from a selection

**Files:**
- Modify: `src/model/document.ts`
- Modify: `src/components/StyleProperties.tsx`
- Modify: `src/App.tsx`
- Test: `tests/model-authoring.test.ts` (extend)

**Interfaces:**

```ts
// src/model/document.ts
/** Declare a field for a layer on the master (or the editing variation).
 *  The caller supplies the whole FieldDecl because the config `path` and the
 *  kind inference live in the UI registry (src/elements.ts) — the pure model
 *  must not import it. Returns a new master; a no-op (same identity) if a
 *  visible field already binds that path. */
export function addField(master: Master, target: EditTarget, decl: FieldDecl): Master;
```

Binding: the inspector shows "Make fillable" for the selected layer when no visible field already covers its path. Kind is inferred from the layer type — text → `"text"`, image → `"image"`, barcode/qr → `"code"` (spec: infer the kind, name after). The name defaults to the layer's name, editable inline before commit. Layers with no config-backed content (the laurel, the fixed wordmark) show no button; `editableText` and `FLAT` in `elements.ts` are the source of "does this element have a content path".

- [ ] **Step 1: Write the failing test**

```ts
// appended to tests/model-authoring.test.ts
it("addField declares a field on the master and refuses a duplicate path", () => {
  const decl = { id: "volume", label: "Volume", kind: "text" as const, path: "volume.text" };
  const m = addField(lolevMaster(), "master", decl);
  expect(m.fields.map((f) => f.id)).toContain("volume");
  expect(addField(m, "master", { ...decl, id: "volume2" })).toBe(m);
});
it("addField on a variation declares it there, not on the master", () => {
  const m = addField(lolevMaster(), { variation: "collab" },
    { id: "partner", label: "Partner", kind: "text", path: "collabLead.text" });
  expect(m.fields.map((f) => f.id)).not.toContain("partner");
  expect(m.variations[0].fields.map((f) => f.id)).toContain("partner");
});
```

- [ ] **Step 2: Run to verify failure** — `addField` missing.

- [ ] **Step 3: Implement** `addField` and the inspector button.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green.

- [ ] **Step 5: Commit**

```bash
git add src/model/document.ts src/components/StyleProperties.tsx src/App.tsx tests/model-authoring.test.ts
git commit -m "Design mode: make a selected layer fillable, inferring the field kind from its type."
```

---

### Task 6: Version bump + CHANGELOG + push gate

**Files:** `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (label-lab entry), `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump 0.1.35 → 0.1.36** in all five locations.

- [ ] **Step 2: CHANGELOG entry**

```markdown
## [0.1.36] - 2026-08-27

- Design mode now edits the master — the shared core every label inherits —
  instead of the label in front of you. Restyle the name, move the QR, lock
  the logo, switch a layer off: it applies to every label made from that
  master from now on. For a one-off, pick or create a variation from the new
  "Editing" selector at the top of the layers panel and the change is recorded
  there instead, ready to enable whenever you need it; properties a variation
  changes are badged, and each can be reset back to the master. Masters save
  and open as `.master` files and register themselves in the library, so a
  label can find its master again — or be re-aimed at someone else's. Any
  layer with editable content can be made fillable from the inspector.
```

- [ ] **Step 3: Full gate** — `npx vitest run && npx tsc --noEmit` green (re-run once if the known PDF timestamp flake fires).

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "Version 0.1.36: Design mode authors the master and its variations."
git push
```

Do NOT merge PR #41.

---

## Self-Review

- Spec coverage (5b slice): "Editing: Master ▾ / Collab" selector ✓ (T2); edits record into the selected variation automatically ✓ (T2's auto-target); overridden badge + per-property reset ✓ (T3); no separate diff UI ✓ (badges live on the controls); `.master` files + library index ✓ (T4); make-fillable infers kind, names after ✓ (T5); inline variation creation, no dialog ✓ (T2). Deferred: compliance rule packs (its own plan, unchanged); presets→masters migration and collab slot images as `image` fields (Plan 7); a blank "New Master" (Save Master As from the shipped master covers it).
- Placeholder scan: two prose-only steps (T2's DOM test body, T3's inspector wiring) each name their exact assertions and the file whose conventions they copy; every other code step carries real code.
- Type consistency: `EditTarget` (T1) is the single target type used by `applyDesignEdit` / `applyLayerEdit` / `overriddenPaths` / `resetOverride` / `addField`, by App's `editingTarget`, and by `EditingTarget`'s props; `Doc` (T2) is what T4's dirty flag sits beside.
- Stated judgment calls: diff-and-record (reuses `configDiff`, leaves every editor untouched) over teaching each editor to write master paths; field values and unlocked drags stay per-label in both modes; `.label` `overrides` stays readable but Design stops producing it.
