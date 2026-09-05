# Label Owns Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the per-layer `fillable` flag. The master is the placeholder; every edit made while a label is open lives in the `.label`, and an explicit **Edit master** toggle is the only way to change the master.

**Architecture:** The `.label` already has two stores the resolver applies on top of the master: `values` (a layer's content by id) and `overrides` (a deep-partial design patch by id). Today only `fillable` layers accept a value and every design edit hits the master. After this change the resolver fills any layer's value, and App routes every edit through one pure function, `applyDocEdit`, that writes to the label unless the Edit master toggle is on. No file-format bump: `values` and `overrides` keep their shapes, `fillable` on disk is ignored.

**Tech Stack:** TypeScript, React 19, Vitest (`happy-dom` for DOM tests), Tauri 2 desktop shell.

**Spec:** This plan is its own spec. Decisions taken with the user on 2026-09-05: (1) drop `fillable` entirely; (2) all edits in a label, content and design, go to the `.label`; (3) master edits happen behind an Edit master toggle in the shell.

## Global Constraints

- Work only in worktree `/Users/tedslesinski/Repos/art-files-label-owns-edits`, branch `label-owns-edits`. The `main` checkout has uncommitted 0.1.55 work from another session in `src/App.tsx`, `src/model/layers.ts`, `src/components/LayerInspector.tsx`. Rebase onto `origin/main` before opening the PR and re-run every check.
- Every task: `npx tsc --noEmit` clean and `npx vitest run` green before commit.
- Release steward (`.agents/release-steward.md`): this is binary-impacting. The final task bumps the version in `package.json`, `package-lock.json` (root two entries), `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `label-lab` package), `src-tauri/tauri.conf.json`, and adds a dated `CHANGELOG.md` section. Run `node scripts/check-release.mjs --release <latest label-lab-v* tag>` to validate.
- Ponytail: no new abstractions beyond `applyDocEdit`. `values` and `overrides` stay two stores; folding them is future work, noted in the code.
- Per-repo conventions in `.agents/conventions.md`; module-level comment at the top of every touched file must stay accurate.

---

### Task 1: Resolver fills any layer's value

**Files:**
- Modify: `src/model/resolveLayers.ts:1-10` (header comment), `:80-86` (the values loop), `:97-99` (delete `fillableLayers`)
- Test: `tests/model-resolve-layers.test.ts`

**Interfaces:**
- Produces: `resolveLayers(master, enabledVariants, values, overrides?, opts?)` unchanged signature; a value for any existing layer id is applied, unknown ids are still skipped silently. `fillableLayers` export is removed. `valueOf(layer)` stays.

- [ ] **Step 1: Rewrite the tests that assume the flag**

In `tests/model-resolve-layers.test.ts`, replace the test at line ~128 (`values for non-fillable or unknown layers are ignored`) with:

```ts
it("values apply to any known layer; unknown ids are ignored", () => {
  const r = resolveLayers(lolevMaster(), [], { wordmark: [{ text: "Hi", fill: "#000", layer: "fill" }], nope: "x" });
  const w = r.layers.find((l) => l.id === "wordmark");
  expect(w?.kind === "text" && w.lines[0].text).toBe("Hi");
  expect(r.errors).toEqual({});
  expect(r.warnings).toEqual([]);
});
```

Delete the `describe("fillableLayers / valueOf")` block's `fillableLayers` test (line ~165) and drop `fillableLayers` from the import on line 7. Keep any `valueOf` test.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/model-resolve-layers.test.ts`
Expected: FAIL. `wordmark` keeps its master text because it is not fillable; `fillableLayers` import error.

- [ ] **Step 3: Implement**

In `src/model/resolveLayers.ts`:

```ts
// line 82: was  if (i < 0 || !layers[i].fillable) continue; // dormant, not an error
    if (i < 0) continue; // dormant, not an error
```

Delete lines 97-99 (`fillableLayers`). Update the header comment: "the label's values into fillable layers" becomes "the label's values into their layers (any layer id the master resolves)". Update the `applyValue` doc: "One value into one fillable layer" becomes "One value into one layer".

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/model-resolve-layers.test.ts && npx tsc --noEmit`
Expected: PASS. If `tsc` reports other importers of `fillableLayers`, note them; Task 6 removes the App one.

- [ ] **Step 5: Commit**

```bash
git add src/model/resolveLayers.ts tests/model-resolve-layers.test.ts
git commit -m "Resolver fills any layer's value; drop fillableLayers"
```

---

### Task 2: Remove `fillable` from the model, shipped master, and edit helpers

**Files:**
- Modify: `src/model/layers.ts:1-10` (header), `:47-48` (delete the field), `:83`, `:120`, `:144`, `:169-171` (doc strings)
- Modify: `src/model/lolevLayers.ts:65,68,77,81,108,128,131` (delete `fillable: true`)
- Modify: `src/model/edit.ts:213` (doc)
- Test: `tests/model-edit.test.ts:97-100`

**Interfaces:**
- Produces: `LayerBase` without `fillable`. Any `fillable` key in a loaded file is ignored (the parser copies unknown keys through but nothing reads it).

- [ ] **Step 1: Update the test**

In `tests/model-edit.test.ts` line 97, change `{ size: 20, style: { fill: "#112233" }, fillable: false }` to `{ size: 20, style: { fill: "#112233" }, locked: true }` and line 100 to `expect(l.locked).toBe(true);`.

- [ ] **Step 2: Run to confirm the reshaped test passes on the current code**

Run: `npx vitest run tests/model-edit.test.ts`
Expected: PASS (this task is a type-level removal; the compiler is the red step).

- [ ] **Step 3: Implement**

`src/model/layers.ts`: delete lines 47-48. Header line 6 "and the values filled into fillable layers" becomes "and the values and overrides it lays over them". Line 83 doc: "A fillable text layer's .label value is this array." becomes "A .label value for this layer is this array." Same pattern on 120 and 144. Line 169: "What a .label stores for a fillable layer" becomes "What a .label stores as a layer's content".

`src/model/lolevLayers.ts`: delete every `fillable: true,` token (seven sites). Keep `input`, `min`, `max`, `placeholder`, `symbology`.

`src/model/edit.ts` line 213: remove `fillable` from the list "enabled/locked/fillable/name".

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in files later tasks own: `src/App.tsx`, `src/components/LayerList.tsx`, `src/components/LayerInspector.tsx`, `src/model/rebindLayers.ts`, `src/model/convert.ts`, and tests. Record the list in the commit body.

- [ ] **Step 5: Commit**

```bash
git add src/model/layers.ts src/model/lolevLayers.ts src/model/edit.ts tests/model-edit.test.ts
git commit -m "Remove the fillable flag from the layer model and shipped master"
```

---

### Task 3: Rebind matches values against every layer

**Files:**
- Modify: `src/model/rebindLayers.ts:1-8` (header), `:16-27` (`fillableKinds` becomes `layerKinds`), `:44`
- Test: `tests/model-rebind-layers.test.ts`

**Interfaces:**
- Produces: `rebindLabel(label, from, to)` unchanged signature. A value is kept when the target master, or any of its variants, declares that layer id with a matching kind; otherwise it is benched on `dormant`.

- [ ] **Step 1: Update tests**

In `tests/model-rebind-layers.test.ts`:
- Line 16: the fixture strips `fillable` from every layer but `name` to make them undeclared. Replace with a master that actually lacks the layers: `layers: lolevMaster().layers.filter((l) => l.id === "name" || l.id === "background" || l.id === "mask")`.
- Line 33 title: "benches and reports values the target does not declare fillable" becomes "benches and reports values for layers the target lacks".
- Line 44 title: "a variant-added fillable layer counts as declared" becomes "a variant-added layer counts as declared"; on line 53 delete `fillable: true,`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/model-rebind-layers.test.ts`
Expected: FAIL (type error on `fillable`, or a value for a still-declared layer is not benched).

- [ ] **Step 3: Implement**

```ts
/** Layer kind by id across the master's layers and every variant's entries
 *  (a variant-added layer, or an entry that restates the kind). */
function layerKinds(master: Master): Map<string, Layer["kind"] | undefined> {
  const kinds = new Map<string, Layer["kind"] | undefined>();
  for (const l of master.layers) kinds.set(l.id, l.kind);
  for (const v of master.variants) {
    for (const [id, e] of Object.entries(v.layers) as [string, DeepPartial<Layer>][]) {
      if (!kinds.has(id)) kinds.set(id, e.kind);
    }
  }
  return kinds;
}
```

Line 44: `const kinds = layerKinds(to);`. Header line 3: "against what the target declares fillable" becomes "against the layers the target declares".

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/model-rebind-layers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/rebindLayers.ts tests/model-rebind-layers.test.ts
git commit -m "Rebind keeps a value for any layer the target declares"
```

---

### Task 4: v2 conversion stops emitting `fillable`

**Files:**
- Modify: `src/model/convert.ts:161-176` (`overrideFrom`), `:238-262` (`fillableProps` becomes `widgetProps`), `:307`, `:360-372`, `:415-430` (call site of `overrideFrom`)
- Test: `tests/model-convert.test.ts:33-34,77-87,160`

**Interfaces:**
- Consumes: `LayerBase` without `fillable` (Task 2).
- Produces: `convertMasterV2` output layers carry `input`/`min`/`max`/`symbology`/`suffix` from FieldDecls but no `fillable`. `overrideFrom(base, p, filled: boolean)` gains a third argument: whether the label supplies this layer's text as a value.

- [ ] **Step 1: Update tests**

`tests/model-convert.test.ts`:
- Lines 33-34: drop `!!got.fillable` and `!!w.fillable` from both tuples.
- Line 77 title becomes "carries policy (enabled, locked, names); widgets follow the FieldDecls". Replace lines 86-87 with:
  ```ts
  expect(layer(master.layers, "styleLine").input).toBeUndefined();
  expect(layer(master.layers, "abv").input).toBe("number");
  ```
- Line 160: `expect([x.kind, x.lines[0].text, x.name]).toEqual(["text", "X", "Extra"]);`

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/model-convert.test.ts`
Expected: FAIL on type errors referencing `fillable`.

- [ ] **Step 3: Implement**

`src/model/convert.ts`:
- Rename `fillableProps` to `widgetProps`; its first line becomes `const p: Partial<TextLayer> = {};`. Update the doc: "What a FieldDecl adds to its layer: the Fill-mode widget hint for number/code text inputs, and a `{id}<literal>` format's literal as the suffix". Update the section banner on line 238 to `// --- Fields → widgets ---`.
- Delete line 307 (`delete layer.fillable;`).
- `overrideFrom(base: Layer, p: ElementPatch, filled: boolean)`: line 174 becomes
  `if (p.text !== undefined || p.bold !== undefined || (restyled && !filled)) o.lines = applied.lines;`
  Doc: "A text layer whose content the label supplies as a value leaves its lines to that value; any other text layer carries its restyled lines here".
- At the call site in `convertLabelV2` (around line 415, where `overrideFrom` is invoked per overridden layer), compute once before the loop:
  ```ts
  const filledIds = new Set(Object.keys(old.values).map((fid) => FIELD_RENAMES[fid] ?? fid));
  ```
  and pass `filledIds.has(id)` as the third argument.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/model-convert.test.ts tests/model-authoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/convert.ts tests/model-convert.test.ts
git commit -m "v2 conversion: fields set widgets, not a fillable flag"
```

---

### Task 5: `applyDocEdit` routes one edit to the label or the master

**Files:**
- Modify: `src/model/edit.ts` (append after `clearLabelOverride`, ~line 458)
- Test: `tests/model-edit.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `patchLayer`, `patchLayerIn`, `setLabelOverride`, `setValue`, `toggleVariant` from `src/model/edit.ts`; `LayerValue`, `Layer`, `LabelFile`, `Master`, `TextLine` from `src/model/layers.ts`.
- Produces:
  ```ts
  export interface Doc { master: Master; label: LabelFile }
  export type DocEdit =
    | { id: string; patch: DeepPartial<Layer> }
    | { id: string; kind: Layer["kind"]; value: LayerValue };
  export function applyDocEdit(doc: Doc, edit: DocEdit, editMaster: boolean): Doc
  export const contentPatch = (kind: Layer["kind"], value: LayerValue): DeepPartial<Layer> => ...
  ```
  `editMaster === false`: a `patch` goes to `label.overrides[id]` via `setLabelOverride`; a `value` goes to `label.values[id]` via `setValue`. `editMaster === true`: the current App behaviour, moved verbatim: a `value` becomes `contentPatch` and, like a `patch`, lands in the last enabled variant that carries the layer, else the master; `patch.enabled === true` on a variant-owned layer also enables that variant on the label.

- [ ] **Step 1: Write the failing tests**

Append to `tests/model-edit.test.ts`:

```ts
describe("applyDocEdit", () => {
  const doc = () => ({ master: lolevMaster(), label: { formatVersion: 3 as const, masterId: "lolev", enabledVariants: [], values: {} } });

  it("a design patch lands in the label's overrides while not editing the master", () => {
    const out = applyDocEdit(doc(), { id: "name", patch: { size: 30 } }, false);
    expect(out.label.overrides).toEqual({ name: { size: 30 } });
    expect(out.master).toEqual(lolevMaster());
  });

  it("a content value lands in the label's values while not editing the master", () => {
    const out = applyDocEdit(doc(), { id: "name", kind: "text", value: "Pils" }, false);
    expect(out.label.values).toEqual({ name: "Pils" });
    expect(out.master).toEqual(lolevMaster());
  });

  it("with Edit master on, a design patch changes the master layer", () => {
    const out = applyDocEdit(doc(), { id: "name", patch: { size: 30 } }, true);
    expect(out.master.layers.find((l) => l.id === "name")?.size).toBe(30);
    expect(out.label.overrides).toBeUndefined();
  });

  it("with Edit master on, a content value becomes the master's placeholder", () => {
    const out = applyDocEdit(doc(), { id: "name", kind: "text", value: [{ text: "Beer", fill: "#000", layer: "fill" }] }, true);
    const name = out.master.layers.find((l) => l.id === "name");
    expect(name?.kind === "text" && name.lines[0].text).toBe("Beer");
    expect(out.label.values).toEqual({});
  });

  it("with Edit master on, a patch to a variant-carried layer lands in that variant and enabling it turns the variant on", () => {
    const out = applyDocEdit(doc(), { id: "collabLeft", patch: { enabled: true } }, true);
    expect(out.label.enabledVariants).toEqual(["collab"]);
    expect(out.master.variants.find((v) => v.id === "collab")?.layers.collabLeft?.enabled).toBe(true);
  });
});
```

Add `applyDocEdit` to the import from `../src/model/edit` and `lolevMaster` from `../src/model/lolevLayers` if not already imported. Check the collab variant id and `collabLeft` layer id against `src/model/lolevLayers.ts:128` before running; the shipped master's `id` for `masterId` is at the top of that file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/model-edit.test.ts`
Expected: FAIL, `applyDocEdit` is not exported.

- [ ] **Step 3: Implement**

Append to `src/model/edit.ts`:

```ts
// --- One edit, one owner -----------------------------------------------------

export interface Doc { master: Master; label: LabelFile }

/** One edit to one layer: a design patch, or the layer's content. */
export type DocEdit =
  | { id: string; patch: LayerPatch }
  | { id: string; kind: Layer["kind"]; value: LayerValue };

/** A layer's content as the design patch that sets it. */
export const contentPatch = (kind: Layer["kind"], value: LayerValue): LayerPatch =>
  kind === "text" ? { lines: value as TextLine[] }
    : kind === "image" ? { asset: value as string } : { value: value as string };

/** THE fill/design split. The master is the placeholder: while not editing
 *  it, every edit lives in the .label (a patch in `overrides`, content in
 *  `values`). With Edit master on, the edit changes the template — in the
 *  last enabled variant that carries the layer, else the master — and
 *  enabling a variant-owned layer turns that variant on for this label.
 *  ponytail: values and overrides stay two stores; fold them when a second
 *  reader of `values` appears. */
export function applyDocEdit(doc: Doc, edit: DocEdit, editMaster: boolean): Doc {
  const { master, label } = doc;
  if (!editMaster) {
    return "patch" in edit
      ? { master, label: setLabelOverride(label, edit.id, edit.patch) }
      : { master, label: setValue(label, edit.id, edit.value) };
  }
  const p = "patch" in edit ? edit.patch : contentPatch(edit.kind, edit.value);
  const owner = master.layers.some((l) => l.id === edit.id) ? undefined
    : master.variants.find((v) => edit.id in v.layers);
  const nextLabel = p.enabled === true && owner && !label.enabledVariants.includes(owner.id)
    ? toggleVariant(label, owner.id) : label;
  // Last enabled variant carrying the layer wins (no findLast in this lib target).
  let variant: string | undefined;
  for (let i = nextLabel.enabledVariants.length - 1; i >= 0 && !variant; i--) {
    const v = nextLabel.enabledVariants[i];
    if (master.variants.some((x) => x.id === v && edit.id in x.layers)) variant = v;
  }
  return {
    master: variant ? patchLayerIn(master, variant, edit.id, p) : patchLayer(master, edit.id, p),
    label: nextLabel,
  };
}
```

Add `TextLine` and `LayerValue` to the type import on line 13 if missing.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/model-edit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/edit.ts tests/model-edit.test.ts
git commit -m "applyDocEdit: one edit lands in the label, or the master behind a toggle"
```

---

### Task 6: App routes every edit through `applyDocEdit` behind an Edit master toggle

**Files:**
- Modify: `src/App.tsx:12-17` (header), `:49` (imports), `:171-175` (delete local `contentPatch`), `:435` (`fillableOnly` state becomes `editMaster`), `:645-680` (`patch`, `patchMany`, `setContent`), `:855-870` (`onLayerImage`), `:1245-1252` (`masterAssetBundle`), `:1634-1638` (doc), `:1700-1706` (LayerList props)
- Test: `tests/app-v3-dom.test.tsx` (append)

**Interfaces:**
- Consumes: `applyDocEdit`, `contentPatch`, `Doc`, `DocEdit` from `src/model/edit.ts` (Task 5).
- Produces: `App` state `editMaster: boolean` (default `false`), passed to `LayerList` as `editMaster`/`onEditMaster` (Task 7 adds those props). `setContent(layer, value, coalesce?)` and `patch(id, p, coalesce?)` keep their signatures.

- [ ] **Step 1: Write the failing DOM test**

Open `tests/app-v3-dom.test.tsx`, find how it renders `App` and locates the Layers list and inspector, and how it reads the current master or label back (grep for `enabledVariants` or `values` in that file). Append, adapting the helper names to what the file exposes:

```ts
it("edits land in the .label until Edit master is on", async () => {
  const h = await renderApp();
  await h.selectLayer("name");
  await h.typeContent("Pils");
  expect(h.doc().label.values.name).toBeTruthy();
  expect(h.doc().master.layers.find((l) => l.id === "name")).toEqual(lolevMaster().layers.find((l) => l.id === "name"));
  await h.click(h.byLabel("Edit master"));
  await h.typeContent("Beer");
  const name = h.doc().master.layers.find((l) => l.id === "name");
  expect(name?.kind === "text" && plainText(name.lines)).toBe("Beer");
});
```

If the file has no way to read the current document back, add one the way its existing assertions inspect state; do not add a test-only prop to `App`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/app-v3-dom.test.tsx`
Expected: FAIL, no "Edit master" control; the content edit changed the master.

- [ ] **Step 3: Implement**

`src/App.tsx`:
- Imports (line 49): add `applyDocEdit, contentPatch` and type `Doc`; keep `setValue`, `patchLayer` only if still referenced after the edits below (`tsc` will tell).
- Delete the local `contentPatch` at lines 171-175 and its doc.
- Line 435: `const [editMaster, setEditMaster] = useState(false);`
- Replace `patch`, `patchMany`, `setContent` (lines 645-680) with:

```ts
  /** One layer edit → the .label, or the master when Edit master is on
   *  (model/edit.ts applyDocEdit is the one place that split is decided). */
  const patch = (id: string, p: DeepPartial<Layer>, coalesce?: boolean) =>
    patchMany([[id, p]], coalesce);
  /** patch for several layers in ONE doc edit (one clone, one undo entry) —
   *  a group drag patches every selected layer per pointermove. */
  const patchMany = (entries: [string, DeepPartial<Layer>][], coalesce?: boolean) =>
    edit((d0) => entries.reduce((d, [id, p]) => applyDocEdit(d, { id, patch: p }, editMaster), d0), coalesce);
  /** A layer's CONTENT — this label's value, or the master's placeholder
   *  when Edit master is on. */
  const setContent = (layer: Layer, value: LayerValue, coalesce?: boolean) =>
    edit((d) => applyDocEdit(d, { id: layer.id, kind: layer.kind, value }, editMaster), coalesce);
```

  Check `edit`'s callback type is `(d: Doc) => Doc` with `Doc = { master; label }`; if App has its own `Doc` type, alias or replace it with the one from `edit.ts`.

- `onLayerImage` (line ~866): replace the `after` computation with
  `const after = applyDocEdit({ master, label }, { id: layer.id, kind: "image", value: assetId }, editMaster);`
- `masterAssetBundle` (line ~1251): drop `&& !e.fillable`. Update its doc: every variant image asset is master art now; label values stay label deltas.
- Line 1706: `editMaster={editMaster} onEditMaster={setEditMaster}` replacing the two `fillableOnly` props.
- Header comment lines 12-17: describe the toggle. "the Layers list (LayerList) with its Edit master toggle ... every edit lands in the .label, or in the master (or the variant that adds the layer) while Edit master is on."
- Line 1634-1638 doc on `contentFor`: "each writing through setContent so the content is this label's, or the master's placeholder while Edit master is on."
- `onToggle`, `onRename` already call `patch`, so they follow the toggle for free.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` errors only in `LayerList.tsx`/`LayerInspector.tsx` (Task 7). The new app test cannot pass until Task 7 adds the chip: mark it `it.todo` for this commit and un-todo it in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx tests/app-v3-dom.test.tsx
git commit -m "App: every edit lands in the .label unless Edit master is on"
```

---

### Task 7: Layers list and inspector: Edit master chip replaces the fillable UI

**Files:**
- Modify: `src/components/LayerList.tsx:1-15` (header), `:60-75` (props), `:98-102`, `:114`, `:145-150`, `:268-282` (delete the fillable switch), `:403-406` (no filter), `:444-456` (chip), `:494`
- Modify: `src/components/LayerInspector.tsx:1-6,20-26` (header), `:745-755` (delete the Fillable field)
- Test: `tests/layerlist-dom.test.tsx`, `tests/layerinspector-dom.test.tsx`, `tests/app-v3-dom.test.tsx` (un-todo)

**Interfaces:**
- Consumes: App passes `editMaster: boolean`, `onEditMaster: (v: boolean) => void` (Task 6).
- Produces: `LayerList` props lose `fillableOnly`/`onFillableOnly`, gain `editMaster`/`onEditMaster`; `onToggle` prop type becomes `"enabled" | "locked"`. A header chip with `aria-label="Edit master"`, `aria-pressed={editMaster}`, text "Edit master", `title="Edits change the master template instead of this label"`.

- [ ] **Step 1: Update tests**

`tests/layerlist-dom.test.tsx`:
- Lines 62-63: `editMaster: false, onEditMaster: vi.fn(),`
- Delete the test at 112-118 ("Fillable only hides…").
- Lines 138-143: title becomes "lock switch reports onToggle with the flipped value"; delete the two `fillable` lines.
- Lines 161-166: replace with
  ```ts
  it("no row has a fillable switch", () => {
    render(baseProps());
    expect([...document.querySelectorAll("[aria-label$=': fillable']")]).toHaveLength(0);
  });
  ```
- Lines 282-288: title "header chips: Edit master and one toggle per variant"; find the button whose text is "Edit master"; click; `expect(props.onEditMaster).toHaveBeenCalledWith(true)`.

`tests/layerinspector-dom.test.tsx` lines 103-110: title "toggles enabled / locked as top-level patches"; delete the two `Fillable` lines.

`tests/app-v3-dom.test.tsx`: change `it.todo` back to `it` on the Task 6 test.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/layerlist-dom.test.tsx tests/layerinspector-dom.test.tsx tests/app-v3-dom.test.tsx`
Expected: FAIL: no "Edit master" button; unknown props.

- [ ] **Step 3: Implement**

`src/components/LayerList.tsx`:
- Props: `onToggle: (id: string, prop: "enabled" | "locked", value: boolean) => void;` and replace `fillableOnly`/`onFillableOnly` with
  ```ts
  /** Header toggle: edits change the master template instead of this label. */
  editMaster: boolean;
  onEditMaster: (v: boolean) => void;
  ```
- Delete `const fillable = !!layer.fillable;` (line 147) and the whole fillable `<button>` (lines ~268-282). Fix the comment at 268-270 that says the fillable column lines up.
- Line 405: `const shown = rows` (drop the filter). Line 494 empty state: just "No layers."
- Chip (lines 447-456):
  ```tsx
  <button
    type="button"
    aria-label="Edit master"
    aria-pressed={props.editMaster}
    onClick={() => props.onEditMaster(!props.editMaster)}
    title="Edits change the master template instead of this label"
    className={chip(props.editMaster)}
  >
    <PencilRuler /> Edit master
  </button>
  ```
  Import `PencilRuler` from `lucide-react` in place of `ListFilter` if `ListFilter` has no other use.
- Header comment (lines 9-13): "the two per-layer switches — enabled and locked"; "The header carries the title, the Edit master toggle and one chip per variant".
- Lines 98-102 comment about background/mask having no fillable switch: delete.

`src/components/LayerInspector.tsx`: delete the Fillable `<Field>` (lines ~745-755). Header lines 4 and 23-24: drop `fillable` mentions ("enabled/locked" and remove the "fillable is a…" clause).

- [ ] **Step 4: Run everything**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green, including the Task 6 app test.

- [ ] **Step 5: Commit**

```bash
git add src/components/LayerList.tsx src/components/LayerInspector.tsx tests/layerlist-dom.test.tsx tests/layerinspector-dom.test.tsx tests/app-v3-dom.test.tsx
git commit -m "Layers list: Edit master chip replaces the fillable switch and filter"
```

---

### Task 8: Sweep, dev harnesses, ledger

**Files:**
- Modify: `tests/fixtures.ts:72` (doc: "Values into layers, by layer id."), `src/dev/parity.ts:91`, `src/dev/strokecap.ts:62` (signatures unchanged; confirm they compile)
- Modify: `.agents/ledger.md` (append an entry in the shape of the last one), `.agents/learnings.md` (one line only if something surprised you)

- [ ] **Step 1: Sweep**

Run: `grep -rn -i "fillable" src tests README.md .agents/*.md`
Expected after fixes: zero hits in `src`/`tests`/`README.md`; historical ledger text may stay.

- [ ] **Step 2: Ledger**

Append to `.agents/ledger.md`:
- finding: the per-layer `fillable` flag split edits between master and label by a hidden property
- delta: flag removed; every edit lands in the `.label`; Edit master toggle in the Layers header for template edits; resolver fills any layer's value
- status: done, version in Task 9

- [ ] **Step 3: Run everything**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add -A src tests .agents
git commit -m "Sweep fillable mentions; ledger entry for label-owns-edits"
```

---

### Task 9: Release metadata and PR

**Files:**
- Modify: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Rebase**

```bash
git fetch origin && git rebase origin/main
```
Resolve conflicts in `src/App.tsx`, `src/model/layers.ts`, `src/components/LayerInspector.tsx` if the 0.1.55 work landed. Re-run `npx tsc --noEmit && npx vitest run`.

- [ ] **Step 2: Pick the version**

Read `package.json` on `origin/main`; use the next patch. Set it in all five metadata files (Cargo.lock: only the `label-lab` package block). Add to `CHANGELOG.md` above the previous section:

```md
## [0.1.X] - 2026-09-05

- The per-layer Fillable switch is gone. A master is the placeholder design;
  everything you change while a label is open, text, images, codes,
  position and style, is saved in that .label. Turn on “Edit master” in the
  Layers header to change the master template itself. Existing labels open
  unchanged.
```

- [ ] **Step 3: Validate**

```bash
node scripts/check-release.mjs --release "$(git tag -l 'label-lab-v*' | sort -V | tail -1)"
npx tsc --noEmit && npx vitest run
```
Expected: "Release metadata check passed".

- [ ] **Step 4: Commit and open the PR**

```bash
git add -A && git commit -m "Remove fillable: the label owns edits, Edit master toggle (0.1.X)"
git push -u origin label-owns-edits
gh pr create --title "Remove fillable: the label owns edits, Edit master toggle (0.1.X)" --body "<summary + test plan>"
```

Do not merge: merging a version change to `main` publishes a release.

---

## Parallelism

- Task 1 first, then Task 2. Tasks 3, 4, 5 are independent after Task 2 and can run in parallel.
- Task 6 depends on 5. Task 7 depends on 6 (props). Task 8 after 7. Task 9 last.

## Out of scope, deliberately

- Folding `values` into `overrides` (one store). Noted with a `ponytail:` comment in `applyDocEdit`.
- Disabling add/remove/reorder layer and variant commands while Edit master is off. They still edit the master; a follow-up can gate them on the toggle.
- Persisting the Edit master toggle across sessions.
- Migrating legacy `fillable` keys out of saved masters. They are ignored on load and dropped on the next save.
