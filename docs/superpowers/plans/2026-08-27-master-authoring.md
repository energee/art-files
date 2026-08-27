# Master Authoring Implementation Plan (Plan 5b of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Design mode edits the **master** — the shared core every label inherits — or a chosen **variant**, instead of writing per-label overrides. Ships the "Editing: Master ▾ / Collab / New variant…" selector, a Design sidebar scoped to that selector, overridden badges with per-property reset, `.master` save/open with library registration, and "Make fillable" from a selection.

Amended 2026-08-27 after the spec amendment of the same date, which this plan implements in full:

- A **variant is a named group of fields and layers** — that is what the author builds and the filler switches on. `overrides` / `layerOverrides` stay in the model (T3's badges survive) but stop being the headline. The Design sidebar's fields section shows the *current target's* fields only.
- **Added layers unify into `master.layers`** (or the editing variant's `layers`), with `resolve()` materializing them into `config.customLayers` — new **Task 5b**. This kills the built-in/custom split rather than rebuilding it inside `master.defaults.customLayers`.
- **`collabEnabled` is deleted from `LabelConfig`** and Collab becomes an ordinary variant carrying three fields — new **Task 5c**. This is the one deliberate breach of the "renderers untouched" rule; byte-identity goldens for collab on *and* off are the gate.
- The PDF byte-compare flake is pinned first — new **Task 0** — because it fires on most full-suite runs and every task below gates on that suite.

**Architecture:** The semantic flip is expressed once, purely: a Design edit runs the caller's ordinary `LabelConfig` mutation against a *freshly resolved base*, diffs the result with the `configDiff` already built in Plan 4a, and merges that diff into `master.defaults` (editing the master) or `variant.overrides` (editing a variant). So every existing editor — `applyStyle`, the inspector's fields, drag, lock — keeps mutating a `LabelConfig` and needs no rewrite; only the *destination* of the resulting diff changes. The app's undo history widens from `{cfg, enabledVariants}` to also carry `master`, so master edits are undoable exactly like label edits.

**Tech Stack:** TypeScript, vitest, existing React components. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-master-variation-design.md` (sections "Variant editing"; "Selection carries context" — make-fillable; "Library index"; "`.master` file")

**Plan sequence:** Requires 5a (`docs/superpowers/plans/2026-08-27-master-layers-panel.md`) complete — this plan edits the layers 5a declares. Plan 6 is the Proof rename; Plan 7 is presets→masters migration.

## Global Constraints

- No new npm dependencies. Branch `design/master-variation`. Do NOT merge PR #41 — merging auto-publishes a release.
- After each task: `npx vitest run` green, `npx tsc --noEmit` clean, then commit (sentence-style, no Co-Authored-By).
- **What stays per-label, exactly:** field values, and dragging an *unlocked* layer in Fill mode. Everything else edited in Design mode is a master or variant edit. Fill mode's behavior does not change in this plan.
- **Print-output invariant:** the shipped master with no edits must still produce byte-identical PDF/PSD/plan output; the existing byte-identity locks are the gate. Task 5c widens this to **both** collab states — on and off.
- `planLabel` and the three backends are NOT edited by this plan **except in Task 5c**, which removes their `cfg.collabEnabled` tests and nothing else. Tasks 0–5b leave them untouched.
- The `.label` `overrides` blob stays supported on **read** (legacy files and Fill-mode drags still use it) but Design mode stops producing it.
- ~~Known pre-existing flake~~ — Task 0 pins it. If `tests/pdf-build.test.ts` byte-compare fails after Task 0, it is a real failure, not the timestamp.
- Before push: synchronized version bump + CHANGELOG entry (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock `label-lab` entry, src-tauri/tauri.conf.json).
- Reviewer subagents are STRICTLY READ-ONLY — no stash, no checkout, no writes.

---

### Task 0: Pin the PDF timestamp so byte-compares are deterministic

**Files:**
- Modify: `src/pdf/build.ts`
- Test: `tests/pdf-build.test.ts` (extend)

**Why first:** every task below gates on `npx vitest run`, and this flake fired on two consecutive full-suite runs at the end of Plan 5a. It produces false failures only, but each one costs a re-run and erodes trust in the byte-identity locks that are this plan's *only* guard for Task 5c.

**Cause:** `pdf-lib` stamps `CreationDate` / `ModDate` from the wall clock at `PDFDocument.create()`. `tests/pdf-build.test.ts` compares two independently built documents byte-for-byte (e.g. `expect(withLayer).toEqual(plain)`); when the two builds straddle a second boundary the timestamps differ and the compare fails. No golden PDFs are stored on disk, so pinning changes nothing that is checked in.

Binding: in **every** `PDFDocument.create()` site in `src/pdf/build.ts` (the art doc and the mask doc), immediately call `doc.setCreationDate(PDF_EPOCH)` and `doc.setModificationDate(PDF_EPOCH)` with one module-level constant. Deterministic output is the point — a print deliverable should build byte-identically from identical input — so this is a fix, not a test workaround. Add a one-line comment saying so.

- [ ] **Step 1: Write the failing test** — in `tests/pdf-build.test.ts`, build the same config twice in a row and assert the two byte arrays are equal, plus assert the document's creation date equals the pinned constant. Left alone this passes ~most of the time; make it deterministic by construction, not by luck.

- [ ] **Step 2: Run it** — `npx vitest run tests/pdf-build.test.ts`. The date assertion fails immediately.

- [ ] **Step 3: Implement** the pinned dates.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green, twice in a row.

- [ ] **Step 5: Commit**

```bash
git add src/pdf/build.ts tests/pdf-build.test.ts
git commit -m "PDF: pin the document timestamp so identical input builds byte-identical output."
```

---

### Task 1: The pure authoring edit (applyDesignEdit) and master serialization

**Files:**
- Modify: `src/model/document.ts`
- Create: `src/model/masterfile.ts`
- Test: `tests/model-authoring.test.ts` (create)

**Interfaces:**
- Consumes: `composeConfig`, `configDiff` (`src/model/document.ts`), `deepMerge`/`DeepPartial` (`src/model/merge.ts`), `Master`/`Variant`/`MasterLayer` (`src/model/types.ts`), `parseMaster`.
- Produces:

```ts
// src/model/document.ts
/** Where a Design-mode edit is recorded. "master" = master.defaults; any
 *  other value = that variant's overrides (spec: "Editing: Master ▾"). */
export type EditTarget = "master" | { variant: string };

/** Run an ordinary LabelConfig mutation as an AUTHORING edit: apply it to a
 *  freshly resolved base, diff, and record the diff at `target`. Returns a
 *  NEW master — never mutates the one passed in — so it drops straight into
 *  the app's history stack.
 *
 *  This is the whole semantic flip in one function: every existing editor
 *  (applyStyle, the inspector's fields, drag, lock) keeps mutating a
 *  LabelConfig, and only the destination of the resulting diff changes. */
export function applyDesignEdit(
  master: Master, target: EditTarget, enabledVariants: string[],
  values: Record<string, FieldValue>,
  mutate: (cfg: LabelConfig) => void,
): Master;

/** Patch one layer's policy (name/enabled/locked) at `target`: the master's
 *  own layer entry, or the variant's layerOverrides[id]. Returns a new
 *  master. Layer policy is NOT part of LabelConfig, so it cannot ride
 *  applyDesignEdit's diff and gets its own entry point. */
export function applyLayerEdit(
  master: Master, target: EditTarget, layerId: string, patch: Partial<MasterLayer>,
): Master;

/** Every dot-path a variant currently overrides — what the inspector badges
 *  as "overridden" (spec: touched properties show a badge with per-property
 *  reset). Empty for the master, which overrides nothing by definition. */
export function overriddenPaths(master: Master, target: EditTarget): Set<string>;

/** Drop one overridden path from a variant, restoring the master's value.
 *  Returns a new master; a no-op for the master target. */
export function resetOverride(master: Master, target: EditTarget, path: string): Master;

/** Add a variant and return the new master. Ids are slugged from `name`
 *  and de-duplicated with a numeric suffix, so the caller only supplies a
 *  human name (spec: inline creation, no dialogs). */
export function addVariant(master: Master, name: string): { master: Master; id: string };

// src/model/masterfile.ts
/** A .master file is the Master JSON, pretty-printed — the same shape
 *  parseMaster validates. Files on disk are the source of truth; the library
 *  index (src/masters.ts) is only a resolver cache. */
export const MASTER_EXT = ".master";
export function serializeMaster(m: Master): string;
export function parseMasterFile(json: string): Master;  // JSON.parse + parseMaster
```

Binding semantics:
- `applyDesignEdit`: `base = composeConfig(master, enabledVariants, values, undefined).config`; `next = structuredClone(base)`; `mutate(next)`; `d = configDiff(base, next)`; if `d` is empty return `master` **by identity** (memo/dirty-flag contract); else deep-merge `d` into a clone of `master.defaults` (target `"master"`) or the named variant's `overrides`.
  - Editing a variant resolves its base **with that variant enabled** — otherwise the diff would re-record everything the variant already changes. If the target variant is not in `enabledVariants`, resolve with it appended.
- `overriddenPaths`: flatten the variant's `overrides` to leaf dot-paths (`"nameStyle.fill"`), arrays counting as leaves.
- `resetOverride`: delete the path, then prune objects left empty.
- `addVariant`: `id = slug(name)`, suffixing `-2`, `-3`… on collision; new variant ships `{ overrides: {}, layerOverrides: {}, fields: [] }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-authoring.test.ts
import { describe, expect, it } from "vitest";
import {
  addVariant, applyDesignEdit, applyLayerEdit, composeConfig,
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
  it("records into a variant's overrides when that is the target", () => {
    const m = applyDesignEdit(lolevMaster(), { variant: "collab" }, [], {},
      (c) => { c.nameStyle.fill = "#445566"; });
    expect(m.defaults).toEqual({});
    expect(m.variants[0].overrides).toMatchObject({ nameStyle: { fill: "#445566" } });
    expect(configOf(m, []).nameStyle.fill).not.toBe("#445566");
    expect(configOf(m, ["collab"]).nameStyle.fill).toBe("#445566");
  });
  it("editing a variant does not re-record what it already overrides", () => {
    const m = applyDesignEdit(lolevMaster(), { variant: "collab" }, [], {},
      (c) => { c.abv = "7"; });
    expect(m.variants[0].overrides.abv).toBe("7");
    // collabEnabled was already the variant's own override — the diff must
    // not double-record it as a fresh edit.
    expect(m.variants[0].overrides.collabEnabled).toBe(true);
  });
});

describe("applyLayerEdit", () => {
  it("patches the master's own layer", () => {
    const m = applyLayerEdit(lolevMaster(), "master", "qr", { enabled: false, name: "Web QR" });
    expect(m.layers.find((x) => x.id === "qr")!).toMatchObject({ enabled: false, name: "Web QR" });
    expect(lolevMaster().layers.find((x) => x.id === "qr")!.enabled).toBe(true);
  });
  it("patches a variant's layerOverrides", () => {
    const m = applyLayerEdit(lolevMaster(), { variant: "collab" }, "qr", { enabled: false });
    expect(m.layers.find((x) => x.id === "qr")!.enabled).toBe(true);
    expect(m.variants[0].layerOverrides.qr).toEqual({ enabled: false });
  });
});

describe("overriddenPaths / resetOverride", () => {
  it("reports a variant's overridden leaves and resets one", () => {
    let m = applyDesignEdit(lolevMaster(), { variant: "collab" }, [], {},
      (c) => { c.nameStyle.fill = "#445566"; c.abv = "7"; });
    const target = { variant: "collab" } as const;
    expect(overriddenPaths(m, target))
      .toEqual(new Set(["collabEnabled", "nameStyle.fill", "abv"]));
    m = resetOverride(m, target, "nameStyle.fill");
    expect(overriddenPaths(m, target)).toEqual(new Set(["collabEnabled", "abv"]));
    expect(m.variants[0].overrides.nameStyle).toBeUndefined();
  });
  it("the master overrides nothing", () => {
    expect(overriddenPaths(lolevMaster(), "master").size).toBe(0);
  });
});

describe("addVariant", () => {
  it("slugs the name and de-duplicates ids", () => {
    const a = addVariant(lolevMaster(), "Winter Release");
    expect(a.id).toBe("winter-release");
    const b = addVariant(a.master, "Winter Release");
    expect(b.id).toBe("winter-release-2");
    expect(b.master.variants).toHaveLength(3);
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
git commit -m "Model: Design-mode edits record into the master or a variant, with per-path reset and .master files."
```

---

### Task 2: App routes Design edits to the master; the Editing selector

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/LayersPanel.tsx` (layer name/enable/lock go through the layer-edit path)
- Create: `src/components/EditingTarget.tsx`
- Test: `tests/editingtarget-dom.test.tsx` (create — copy `tests/fieldlist-dom.test.ts`'s setup verbatim; do NOT add @testing-library)

**Interfaces:**
- Consumes: Task 1's `applyDesignEdit`, `applyLayerEdit`, `addVariant`, `EditTarget`.
- Produces:

```ts
// src/App.tsx — the history value widens again:
type Doc = { cfg: LabelConfig; enabledVariants: string[]; master: Master };

/** Design-mode edit: mutate as usual, but the diff lands on the master or the
 *  editing variant. Recomposes cfg from the new master in the same history
 *  step, so the preview updates and undo restores both together. */
function designEdit(mutate: (c: LabelConfig) => void): void;

/** Layer policy edit (rename / enable / lock) at the current target. */
function layerEdit(layerId: string, patch: Partial<MasterLayer>): void;

// src/components/EditingTarget.tsx
export function EditingTarget(props: {
  master: Master;
  target: EditTarget;
  onTarget: (t: EditTarget) => void;
  /** Creates the variant, enables it, and selects it as the target. */
  onNewVariant: (name: string) => void;
  /** Unsaved master edits — the label shows a dot. */
  dirty: boolean;
}): React.JSX.Element;
```

Binding behavior:
- `editingTarget` is App state (Design-only, not in history, not persisted), defaulting to `"master"`.
- **The routing rule:** in Design mode, `update()` routes through `designEdit`; in Fill mode it keeps writing `cfg` as today. Implement as one branch *inside* the existing `update` so no call site changes: `update(fn)` → `mode === "design" ? designEdit(fn) : <today's path>`. Two exceptions stay per-label **in both modes**, because they are label facts, each marked with a one-line comment naming why: field-value writes (`onFieldValue`) and the drag handlers (`onNudge` / `onNudgePosition`).
- `designEdit` produces the new master, then recomposes `cfg` from it (`composeConfig(master', enabledVariants, valuesFromConfig(...), labelOverrides)`) and stores `{cfg, enabledVariants, master}` as one history entry, marking the master dirty.
- Auto-target on selection: selecting a layer owned by variant V switches the target to V (spec: edits record into the selected variant automatically); selecting a master-owned layer does not switch away from an explicitly chosen target.
- `EditingTarget` renders at the top of the Design sidebar: a dropdown listing "Master" then every variant by name, plus a "New variant…" item that reveals an inline text input (Enter commits, Esc cancels — no dialog, per spec).
- **The sidebar is scoped by the selector** (spec: "The Design sidebar is scoped by that selector"). Order: master picker (T4b) · Editing selector · layers · **fields of the current target only** · inspector. The fields section is a plain read-only list of the target's `FieldDecl`s — name plus kind — rendered inside `EditingTarget.tsx`, not a new component and not a second `FieldList`: Design mode *declares* fields, Fill mode *fills* them, and the two lists have nothing in common but the word. A target with no fields yet shows one line: "No fields yet — select a layer and choose Make fillable." Task 5's Make fillable appends to exactly this list.
- `LayersPanel`'s per-row rename, enable, and lock go through `layerEdit`. The panel's *eye* stays session-only hiding — unchanged.

- [ ] **Step 1: Write the failing DOM test**

```tsx
// tests/editingtarget-dom.test.tsx — copy tests/fieldlist-dom.test.ts's setup
// verbatim (happy-dom pragma, createRoot + act helpers), then assert:
//   1. with the shipped master and target "master", the trigger's text
//      contains "Master";
//   2. opening the dropdown and clicking "Collab" calls onTarget with
//      { variant: "collab" };
//   3. clicking "New variant…" reveals an input; typing "Winter" and
//      pressing Enter calls onNewVariant("Winter"); pressing Escape
//      instead hides the input without calling it;
//   4. with dirty: true the trigger's text contains the "•" dot;
//   5. with target "master" the fields list shows the master's five field
//      labels; with target { variant: "collab" } on a LOCAL fixture whose
//      collab variant declares one field, it shows that field's label and
//      none of the master's (the shipped collab variant has no fields until
//      Task 5c — build the fixture in the test, do not wait on 5c);
//   6. a variant with no fields shows the "No fields yet" line.
```

- [ ] **Step 2: Run to verify failure** — component missing.

- [ ] **Step 3: Implement** `EditingTarget`, widen `Doc`, add `designEdit`/`layerEdit`, branch `update`, wire the selector and the panel's policy edits.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green. Byte-identity locks must not move: with no edits the shipped master is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/EditingTarget.tsx src/components/LayersPanel.tsx tests/editingtarget-dom.test.tsx
git commit -m "Design mode edits the master: an Editing selector routes every change to the master or a variant."
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

Binding: start with the Style section's `fill` / `layer` / `stroke` / `strokeWidth` / `letterSpacing` for the selected element — those cover every element uniformly, and the element's config prefix is exactly what `elements.ts`'s `ELEMENTS`/`FLAT` already encode. Controls whose path is not derivable render no badge, with a comment saying so. Badges render only while the editing target is a variant (the master overrides nothing).

- [ ] **Step 1: Write the failing test**

```ts
// appended to tests/model-authoring.test.ts
it("style edits produce the dot-paths the inspector badges", () => {
  const m = applyDesignEdit(lolevMaster(), { variant: "collab" }, [], {},
    (c) => { c.nameStyle.fill = "#445566"; c.nameStyle.strokeWidth = 9; });
  const paths = overriddenPaths(m, { variant: "collab" });
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
git commit -m "Inspector: badge a variant's overridden properties and reset one back to the master."
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
- Open parses, registers, sets it as the document's master, and recomposes `cfg` — routing the label's current values through `rebind`, which Task 4b makes non-destructive first.
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

### Task 4b: Non-destructive rebinding and the master picker

**Files:**
- Modify: `src/model/rebind.ts`
- Modify: `src/model/types.ts` (`LabelFileV2` gains the dormant store)
- Create: `src/components/MasterPicker.tsx`
- Modify: `src/App.tsx`
- Test: `tests/model-rebind.test.ts` (extend), `tests/masterpicker-dom.test.tsx` (create — copy `tests/fieldlist-dom.test.ts`'s setup)

**Interfaces:**

```ts
// src/model/types.ts — LabelFileV2 gains:
  /** Values and variant toggles that the CURRENT master does not declare,
   *  kept verbatim so aiming a label at another master and back loses
   *  nothing. Matching is by id, so a variant id the new master also
   *  declares comes straight back off the bench. */
  dormant?: { values: Record<string, FieldValue>; variants: string[] };

// src/model/rebind.ts — same signature, non-destructive semantics:
export function rebind(
  label: LabelFileV2, target: Master,
): { label: LabelFileV2; dropped: string[]; disabledVariants: string[] };
```

Binding semantics:
- Before matching, fold any existing `dormant` back into the candidate pool: values = `{...dormant.values, ...label.values}` (live wins), variant ids = `[...dormant.variants, ...label.enabledVariants]` de-duplicated, preserving enable order with dormant ones first.
- Match by id against the target's fields (its own plus its variants') and variant ids, exactly as today.
- Unmatched values and variant ids go to the returned label's `dormant` instead of being discarded; `dropped` / `disabledVariants` still report them so the UI can say what went to the bench.
- Round-trip property: `rebind(rebind(label, B).label, A).label` restores A's values and enabled variants. Pin this as a test.

Master picker (spec: the preset bar becomes the master picker):
- `MasterPicker` sits beside `EditingTarget` in Design mode: the current master's name, a dropdown listing every master in the library index by name, plus "Open Master…" and "Duplicate as new master…".
- Choosing another master runs `rebind` and shows a **preview before committing** — a small inline confirm naming the counts and the ids ("3 values and 1 variant move to the bench — continue?"). This is the one confirmation the spec's no-dialogs rule permits, because a rebind is not a single undoable canvas act.
- "Duplicate as new master…" clones the current master with a new id and name, registers it, and leaves the label bound to the clone — the app's answer to "start a new master" without a blank-slate wizard.

- [ ] **Step 1: Write the failing tests**

```ts
// appended to tests/model-rebind.test.ts
it("benches unmatched values and variants instead of dropping them", () => {
  const other: Master = { ...lolevMaster(), id: "other", variants: [] };
  const label = {
    formatVersion: 2 as const, masterId: "lolev", enabledVariants: ["collab"],
    values: { name: "Peregrine", nope: "gone" },
  };
  const r = rebind(label, other);
  expect(r.disabledVariants).toEqual(["collab"]);
  expect(r.dropped).toContain("nope");
  expect(r.label.dormant!.variants).toContain("collab");
  expect(r.label.dormant!.values.nope).toBe("gone");
});
it("rebinding home restores the benched values and variants", () => {
  const other: Master = { ...lolevMaster(), id: "other", variants: [] };
  const label = {
    formatVersion: 2 as const, masterId: "lolev", enabledVariants: ["collab"],
    values: { name: "Peregrine" },
  };
  const back = rebind(rebind(label, other).label, lolevMaster()).label;
  expect(back.enabledVariants).toEqual(["collab"]);
  expect(back.values.name).toBe("Peregrine");
});
```

```tsx
// tests/masterpicker-dom.test.tsx — copy the fieldlist-dom setup, then assert:
//   1. the trigger shows the current master's name;
//   2. choosing another library entry shows the preview line with the counts
//      and does NOT call onMaster until "Continue" is pressed;
//   3. "Duplicate as new master…" calls onDuplicate.
```

- [ ] **Step 2: Run to verify failure** — `dormant` missing.

- [ ] **Step 3: Implement** the dormant store, `rebind`'s fold-and-bench, `MasterPicker`, and the App wiring (the picker's commit path replaces Task 4's bare Open-Master rebind call).

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green.

- [ ] **Step 5: Commit**

```bash
git add src/model/rebind.ts src/model/types.ts src/components/MasterPicker.tsx src/App.tsx tests/model-rebind.test.ts tests/masterpicker-dom.test.tsx
git commit -m "Masters: pick another master from the library, benching what does not carry over instead of dropping it."
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
/** Declare a field for a layer on the master (or the editing variant).
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
it("addField on a variant declares it there, not on the master", () => {
  const m = addField(lolevMaster(), { variant: "collab" },
    { id: "partner", label: "Partner", kind: "text", path: "collabLead.text" });
  expect(m.fields.map((f) => f.id)).not.toContain("partner");
  expect(m.variants[0].fields.map((f) => f.id)).toContain("partner");
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

### Task 5b: Added layers join the master (or the editing variant), not `defaults.customLayers`

**Files:**
- Modify: `src/model/resolve.ts`
- Modify: `src/model/document.ts`
- Modify: `src/App.tsx` (the four Add-layer handlers)
- Test: `tests/model-master-layers.test.ts` (extend), `tests/model-authoring.test.ts` (extend)

**The problem this exists to solve:** today Add layer appends to `cfg.customLayers`, which is per-label. Once Task 2 routes Design edits at the master, that append would diff into `master.defaults.customLayers` — rebuilding the exact built-in/custom split the spec set out to kill, one level down. A layer added in Design mode is a layer *of the master*, and must appear in `master.layers` beside `name`, `qr`, and `warning`.

**Interfaces:**

```ts
// src/model/types.ts — MasterLayer gains what a custom layer needs to exist
//                      before any styling is applied:
  /** Custom layers only: which renderer shape this layer is. Absent = a
   *  built-in layer whose id planLabel already knows. */
  kind?: "text" | "image" | "barcode" | "qr";

// src/model/document.ts
/** Add a layer to the master (or the editing variant), returning a new
 *  master. The layer's identity and policy land in `layers`; its styling
 *  lands in `defaults` (or the variant's `overrides`) keyed by the new id,
 *  exactly like every built-in layer's styling already does. */
export function addLayer(
  master: Master, target: EditTarget, layer: MasterLayer, style: unknown,
): Master;
```

Binding semantics:
- `resolve()` materializes every `MasterLayer` carrying a `kind` into `config.customLayers`, in `master.layers` order, reading its styling out of the resolved config by id. `planLabel` and the three backends see exactly the `customLayers` array they see today — this is the whole reason the change is safe.
- Target `"master"` → the layer is appended to `master.layers`; target `{ variant }` → to that variant's `layers`. A layer in a disabled variant does not resolve, so it neither draws nor appears in the panel — the same rule the collab layers already follow.
- `LabelConfig.customLayers` stays on the type and stays honoured on **read**, so legacy `.label` files with per-label custom layers keep opening. Design mode stops producing them.
- The panel's existing forward/backward reorder (Plan 5a Task 4) now moves the entry within `master.layers`. Built-in rows still get no control.

- [ ] **Step 1: Write the failing test** — in `tests/model-master-layers.test.ts`: a master with a `kind: "text"` layer resolves it into `config.customLayers` in declaration order; the same layer on a *disabled* variant resolves to no custom layer and lands in `disabledLayers`. In `tests/model-authoring.test.ts`: `addLayer(m, "master", …)` appends to `m.layers` and leaves `m.defaults.customLayers` undefined; `addLayer(m, { variant: "collab" }, …)` appends to the variant's `layers` and not to `m.layers`.

- [ ] **Step 2: Run to verify failure** — `addLayer` missing, `kind` not materialized.

- [ ] **Step 3: Implement** the `kind` field, the resolve-time materialization, `addLayer`, and re-point App's four Add-layer handlers at it.

- [ ] **Step 4: Gate** — `npx vitest run && npx tsc --noEmit` green. The byte-identity locks must not move: a master with no added layers resolves to the same empty `customLayers` as today.

- [ ] **Step 5: Commit**

```bash
git add src/model/resolve.ts src/model/document.ts src/model/types.ts src/App.tsx tests/model-master-layers.test.ts tests/model-authoring.test.ts
git commit -m "Added layers belong to the master: Add layer records into master.layers, resolving into customLayers."
```

---

### Task 5c: Delete `collabEnabled`; Collab becomes an ordinary variant of three fields

**Files:**
- Modify: `src/types.ts`, `src/defaults.ts`, `src/plan.ts`, `src/pdf/build.ts`, `src/hittest.ts`, `src/elements.ts`
- Modify: `src/model/lolev.ts`, `src/model/document.ts` (`bridgeCollabOverride`), `src/labelfile.ts`
- Modify: `src/components/FieldList.tsx` (real image widget), `src/components/StyleProperties.tsx` (drop the collab wells + copy), `src/App.tsx` (drop `collabFiles` state)
- Test: `tests/pdf-build.test.ts`, `tests/psd-build.test.ts`, `tests/plan.test.ts`, `tests/hittest.test.ts`, `tests/model-lolev.test.ts`, `tests/fieldlist-dom.test.ts`

**This is the one deliberate breach of the "renderers untouched" rule.** Take the goldens FIRST, in their own commit, and treat them as the gate for everything after.

Binding semantics:
- **Gating.** `plan.ts`, `pdf/build.ts` and `hittest.ts` drop `cfg.collabEnabled &&` from their collab tests and keep the rest verbatim. The resolver's disabled-layer set already suppresses `collabLead` / `collabLeft` / `collabCenter` when the Collab variant is off — Plan 5a's final review verified that skip union is a strict subset of what `collabEnabled` suppressed, which is exactly why this substitution is safe. The `slots.*` tests stay: art must still be loaded for a slot to draw.
- **The logo nudge.** `elements.ts`'s `logoNudge` becomes an unconditional `cfg.logo.offsetY ?? 0`. The Collab variant carries `overrides: { logo: { offsetY: N } }` with N read off today's shipped behaviour, and the master default stays 0 — so the nudge arrives with the variant instead of being gated by a flag.
- **Legacy `.label` v1.** The loader already maps `collabEnabled: true` → `enabledVariants: ["collab"]`. It additionally **zeroes `logo.offsetY` when the saved flag was false**, so a file that stored a stale nudge with collab off does not suddenly render nudged. `bridgeCollabOverride` loses its reason to exist once no override carries the key; delete it and its test with the flag.
- **The three fields** land on the Collab variant in `lolev.ts`: `collabLead` (`text`, path `collabLead.text`), `collabLeft` and `collabCenter` (`image`, paths `collabLeft.image` / `collabCenter.image`).
- **Image field values are asset ids.** `FieldValue` does not change: an image field's value is the string id of the image in the `.label`'s existing per-id image store (`custom/<assetId>/<name>`, already used by custom image layers). `FieldList`'s image placeholder ("Set in Design mode.") becomes a real file well reusing `App.tsx`'s `readCollab`, minting an asset id on drop and clearing to `""`. The fixed `collab-left` / `collab-center` ZIP roles stay **readable** for existing files and stop being written.
- **UI removed:** the two bespoke collab logo wells in the inspector, `App.tsx`'s `collabFiles` / `collabLeft` / `collabCenter` state, and `StyleProperties.tsx:191`'s "applies while collab is on" copy (the metallic line loses its conditional and states what it covers). The generic per-variant checkbox in `FieldList` **stays** — that is how any variant is enabled, and it is the only collab-named control left.

- [ ] **Step 1: Take the goldens** — a test that builds art + mask PDF and the PSD for the shipped master with the Collab variant **off**, and again with it **on** (both logo slots loaded), and pins the bytes. Commit this alone, before any production change, so the gate exists independently of the change it guards.

- [ ] **Step 2: Write the failing tests** — `model-lolev`: the Collab variant declares the three fields and the `logo.offsetY` override, and `LabelConfig` has no `collabEnabled` key. `fieldlist-dom`: an image field renders a file input, not the placeholder text.

- [ ] **Step 3: Run to verify failure.**

- [ ] **Step 4: Implement** the deletion, the field declarations, the image widget, and the legacy-load nudge zeroing.

- [ ] **Step 5: Gate** — `npx vitest run && npx tsc --noEmit` green, **and both Step 1 goldens still match byte-for-byte**. A golden that moves is a stop-and-report, not a golden to update.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Collab is just a variant: delete collabEnabled and declare its three fields on the variant."
```

---

### Task 6: Version bump + CHANGELOG + push gate

**Files:** `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (label-lab entry), `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump 0.1.36 → 0.1.37** in all five locations.

- [ ] **Step 2: CHANGELOG entry**

```markdown
## [0.1.37] - 2026-08-27

- Design mode now edits the master — the shared core every label inherits —
  instead of the label in front of you. Restyle the name, move the QR, lock
  the logo, switch a layer off: it applies to every label made from that
  master from now on. For a one-off, pick or create a variant from the new
  "Editing" selector at the top of the layers panel and the change is recorded
  there instead, ready to enable whenever you need it; properties a variant
  changes are badged, and each can be reset back to the master. Masters save
  and open as `.master` files and register themselves in the library, so a
  label can find its master again — or be re-aimed at someone else's. Any
  layer with editable content can be made fillable from the inspector, and a
  layer added in Design mode now belongs to the master rather than to the one
  label in front of you.
- Collab is no longer a special case. It is an ordinary variant carrying its
  three pieces — the lead-in line and the two partner logos — which you fill
  from the field list like anything else, and switch on and off from the same
  checkbox every variant gets. Labels saved with the old collab switch open
  with the variant already on and look exactly as they did.
```

- [ ] **Step 3: Full gate** — `npx vitest run && npx tsc --noEmit` green (re-run once if the known PDF timestamp flake fires).

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "Version 0.1.37: Design mode authors the master and its variants."
git push
```

Do NOT merge PR #41.

---

## Self-Review

- Spec coverage (5b slice): "Editing: Master ▾ / Collab" selector ✓ (T2); edits record into the selected variant automatically ✓ (T2's auto-target); sidebar scoped to the target, fields section ✓ (T2); overridden badge + per-property reset ✓ (T3); no separate diff UI ✓ (badges live on the controls); `.master` files + library index ✓ (T4); make-fillable infers kind, names after ✓ (T5); inline variant creation, no dialog ✓ (T2); added layers belong to the master ✓ (T5b); collab → ordinary variant with three fields, `collabEnabled` deleted ✓ (T5c). Deferred: compliance rule packs (its own plan, unchanged); presets→masters migration (Plan 7); a blank "New Master" (Save Master As from the shipped master covers it).
- Amendment coverage: variant-as-named-group is delivered by T2's scoped sidebar + T5/T5b recording into the selected target — no new type was needed, which is the point. `overrides` survives as T3's demoted secondary path.
- Risk register: T5c is the only task that edits `planLabel`'s callers or the backends. Its Step 1 goldens (collab on **and** off) are committed before the change and are a stop-and-report gate, not a file to regenerate. T0 exists so those goldens cannot fail for a reason unrelated to the change.
- Placeholder scan: two prose-only steps (T2's DOM test body, T3's inspector wiring) each name their exact assertions and the file whose conventions they copy; every other code step carries real code.
- Type consistency: `EditTarget` (T1) is the single target type used by `applyDesignEdit` / `applyLayerEdit` / `overriddenPaths` / `resetOverride` / `addField`, by App's `editingTarget`, and by `EditingTarget`'s props; `Doc` (T2) is what T4's dirty flag sits beside.
- Stated judgment calls: diff-and-record (reuses `configDiff`, leaves every editor untouched) over teaching each editor to write master paths; field values and unlocked drags stay per-label in both modes; `.label` `overrides` stays readable but Design stops producing it.
