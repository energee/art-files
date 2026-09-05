# Design/Fill Modes + Master Wiring Implementation Plan (Plan 4a of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app runs on master + variations + values: a Design/Fill segmented control (Fill default), the field list and variation checkboxes in Fill mode, `.label` v2 load/save (legacy files still open), the shipped Lolev master via `lolevMaster()`, and a master library index where files are the truth.

**Architecture:** `cfg` (the `LabelConfig` in App's history stack) stays the single live document — nothing about rendering, undo, drag, or the inspector changes. The master model wires in at the *boundaries*: opening a v2 `.label` composes `cfg = deepMerge(resolve(master, enabledVariations, values).config, overrides)`; saving derives `values` back out of `cfg` through each field's `path` and captures everything else as a label-level `overrides` diff. Variation toggles re-compose `cfg` around the preserved diff. A new pure module `src/model/document.ts` owns those three derivations (values-from-config, config-diff, compose/toggle) so they are unit-testable without the app.

**Tech Stack:** TypeScript, vitest, existing React components. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-master-variation-design.md` (sections "UI" — two hats; "`.label` file"; "Library index"; "Resolution"; "Migration" — label-level overrides clause)

**Plan resequencing:** Plan 4b (add-layer UI, barcode/QR layer types, PSD prerequisites, chip builder) follows this plan; compliance is Plan 5; migration + rename Plan 6.

## Global Constraints

- No new npm dependencies. Branch `design/master-variation`.
- After each task: `npx vitest run` green, `npx tsc --noEmit` clean, then commit (sentence-style, no Co-Authored-By).
- Existing v1 `.label` files (ZIP with `config.json`) must keep opening exactly as today; saving always writes the v2 format (spec: Migration — "Saving writes the new format").
- `src/model/` stays pure — no DOM, no localStorage, no Tauri imports there. App-side storage lives in `src/masters.ts`.
- Print output for an untouched document must be unchanged: `defaultConfig()` and the composed shipped-master config must produce identical output (the existing regression suites guard this).
- Fonts through the existing `Face`/measure machinery — never a hardcoded font name.
- Before push: synchronized version bump to 0.1.31 + CHANGELOG entry (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock `label-lab` entry, src-tauri/tauri.conf.json) — Task 6.
- Do NOT merge PR #41; merging auto-publishes a release.
- Reviewer subagents are STRICTLY READ-ONLY — no stash, no checkout, no writes.

---

### Task 1: Pure document derivations (values-from-config, diff, compose, toggle)

**Files:**
- Modify: `src/model/types.ts` (LabelFileV2 gains `overrides`)
- Modify: `src/model/labelfile.ts` (parse/serialize carry `overrides`)
- Create: `src/model/document.ts`
- Test: `tests/model-document.test.ts`

**Interfaces:**
- Consumes: `resolve` (`src/model/resolve.ts`), `deepMerge`/`DeepPartial` (`src/model/merge.ts`), `Master`, `FieldDecl`, `FieldValue`, `LabelFileV2` (`src/model/types.ts`), `defaultConfig` (`src/defaults.ts`).
- Produces (later tasks and App rely on these exact names):

```ts
// added to LabelFileV2 in src/model/types.ts:
//   /** Label-level deviations from the resolved master (spec: Migration —
//    *  "preserves nonstandard styling as label-level overrides"). Applied
//    *  by composeConfig AFTER resolve; absent = none. */
//   overrides?: DeepPartial<LabelConfig>;

// src/model/document.ts
export function visibleFieldsOf(master: Master, enabledVariations: string[]): FieldDecl[];
export function getPath(obj: unknown, path: string): unknown;
export function valuesFromConfig(
  master: Master, enabledVariations: string[], cfg: LabelConfig,
): Record<string, FieldValue>;
export function configDiff(base: LabelConfig, cfg: LabelConfig): DeepPartial<LabelConfig>;
export function composeConfig(
  master: Master, enabledVariations: string[],
  values: Record<string, FieldValue>, overrides: DeepPartial<LabelConfig> | undefined,
): { config: LabelConfig; errors: Record<string, string>; warnings: string[] };
export function toggleVariation(
  master: Master, cfg: LabelConfig, enabled: string[], id: string, on: boolean,
): { enabled: string[]; config: LabelConfig };
```

Semantics (binding):
- `visibleFieldsOf` = master's fields plus each enabled variation's, in enable order (same walk `resolve` does; extracted so the UI can list fields without resolving).
- `valuesFromConfig` reads each visible field's `path` out of `cfg` (dot-path get). `toggle` kind reads a boolean; every other kind reads the value at the path as-is (they are stored as strings in `LabelConfig`). Fields with a `format` are skipped — their content is derived; the filler's inputs are the referenced fields. A path resolving to `undefined` contributes no entry.
- `configDiff` walks `base` and `cfg` key-by-key, recursing into plain objects; arrays and differing leaf values are kept from `cfg` wholesale; identical subtrees vanish. A key present in `cfg` but absent in `base` (e.g. `customLayers`) is kept. Result `{}` means "no deviations".
- `composeConfig` = `resolve(master, enabledVariations, values)` then `deepMerge(config, overrides ?? {})`, passing `errors`/`warnings` through.
- `toggleVariation` preserves the user's deviations across a toggle:
  1. `values = valuesFromConfig(master, enabled, cfg)`
  2. `overrides = configDiff(composeConfig(master, enabled, values, undefined).config, cfg)`
  3. `enabled' = on ? [...enabled, id] : enabled.filter(x => x !== id)` (append order = enable order; no-op if already in the target state)
  4. return `{ enabled: enabled', config: composeConfig(master, enabled', values, overrides).config }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-document.test.ts
import { describe, expect, it } from "vitest";
import {
  composeConfig, configDiff, toggleVariation, valuesFromConfig,
} from "../src/model/document";
import { lolevMaster } from "../src/model/lolev";
import { defaultConfig } from "../src/defaults";
import { parseLabelFile, serializeLabelFile } from "../src/model/labelfile";

describe("valuesFromConfig", () => {
  it("reads visible fields back out of the config by path", () => {
    const cfg = defaultConfig();
    cfg.beerName = "Peregrine";
    cfg.abv = "8";
    cfg.styleLine.text = "DIPA";
    const v = valuesFromConfig(lolevMaster(), [], cfg);
    expect(v.name).toBe("Peregrine");
    expect(v.abv).toBe("8");
    expect(v.style).toBe("DIPA");
    expect(v.upc).toBe(cfg.upc);
  });
});

describe("configDiff / composeConfig round-trip", () => {
  it("captures deviations and restores them exactly", () => {
    const m = lolevMaster();
    const base = composeConfig(m, [], {}, undefined).config;
    const cfg = structuredClone(base);
    cfg.nameStyle.fill = "#112233";
    cfg.volume.text = "12 OZ";
    const d = configDiff(base, cfg);
    expect(d).toEqual({ nameStyle: { fill: "#112233" }, volume: { text: "12 OZ" } });
    expect(composeConfig(m, [], {}, d).config).toEqual(cfg);
  });
  it("empty diff for an untouched document", () => {
    const m = lolevMaster();
    const base = composeConfig(m, [], {}, undefined).config;
    expect(configDiff(base, structuredClone(base))).toEqual({});
  });
  it("keeps arrays wholesale (customLayers)", () => {
    const m = lolevMaster();
    const base = composeConfig(m, [], {}, undefined).config;
    const cfg = structuredClone(base);
    cfg.customLayers = [{
      id: "custom-a", name: "Note", type: "text", size: 10,
      position: { anchor: "left", vAnchor: "top", offsetX: 0, offsetY: 0 },
      line: { text: "hi", fill: "#000000", layer: "white" },
    }];
    const d = configDiff(base, cfg);
    expect(d.customLayers).toEqual(cfg.customLayers);
  });
});

describe("toggleVariation", () => {
  it("enabling collab flips collabEnabled and keeps user deviations", () => {
    const m = lolevMaster();
    const cfg = composeConfig(m, [], {}, undefined).config;
    cfg.beerName = "Peregrine";
    cfg.nameStyle.fill = "#112233";
    const on = toggleVariation(m, cfg, [], "collab", true);
    expect(on.enabled).toEqual(["collab"]);
    expect(on.config.collabEnabled).toBe(true);
    expect(on.config.beerName).toBe("Peregrine");
    expect(on.config.nameStyle.fill).toBe("#112233");
    const off = toggleVariation(m, on.config, on.enabled, "collab", false);
    expect(off.enabled).toEqual([]);
    expect(off.config.collabEnabled).toBe(false);
    expect(off.config.nameStyle.fill).toBe("#112233");
  });
});

describe("LabelFileV2 overrides", () => {
  it("round-trips through serialize/parse", () => {
    const l = {
      formatVersion: 2 as const, masterId: "lolev", enabledVariations: [],
      values: { name: "Peregrine" }, overrides: { nameStyle: { fill: "#112233" } },
    };
    const back = parseLabelFile(JSON.parse(serializeLabelFile(l)));
    expect("legacy" in back).toBe(false);
    if (!("legacy" in back)) expect(back.overrides).toEqual(l.overrides);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/model-document.test.ts`
Expected: FAIL — `src/model/document` does not exist.

- [ ] **Step 3: Implement**

Add to `LabelFileV2` in `src/model/types.ts` (import `DeepPartial` from `./merge`):

```ts
  /** Label-level deviations from the resolved master, applied after resolve
   *  (spec: Migration — "preserves nonstandard styling as label-level
   *  overrides"). Absent = none. */
  overrides?: DeepPartial<LabelConfig>;
```

In `src/model/labelfile.ts`, carry it through `parseLabelFile` (`overrides: o.overrides && typeof o.overrides === "object" ? o.overrides as LabelFileV2["overrides"] : undefined`) and `serializeLabelFile` (add `overrides: l.overrides` to the serialized object — JSON.stringify drops it when undefined).

Create `src/model/document.ts`:

```ts
// src/model/document.ts — pure derivations between the live LabelConfig and
// the master model. cfg stays the app's single live document; these functions
// are the boundary: values/diff OUT of cfg at save time, compose INTO cfg at
// open/toggle time (spec: Resolution; Migration — label-level overrides).
import type { LabelConfig } from "../types";
import type { FieldDecl, FieldValue, Master } from "./types";
import { deepMerge, type DeepPartial } from "./merge";
import { resolve } from "./resolve";

export function visibleFieldsOf(master: Master, enabledVariations: string[]): FieldDecl[] {
  const out = [...master.fields];
  for (const id of enabledVariations) {
    const v = master.variations.find((x) => x.id === id);
    if (v) out.push(...v.fields);
  }
  return out;
}

/** Dot-path read, the mirror of resolve.ts's setPath. */
export function getPath(obj: unknown, path: string): unknown {
  let at: unknown = obj;
  for (const k of path.split(".")) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[k];
  }
  return at;
}

export function valuesFromConfig(
  master: Master, enabledVariations: string[], cfg: LabelConfig,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const f of visibleFieldsOf(master, enabledVariations)) {
    if (f.format) continue; // derived content — the filler edits the refs
    const v = getPath(cfg, f.path);
    if (f.kind === "toggle") { if (typeof v === "boolean") values[f.id] = v; }
    else if (typeof v === "string" || typeof v === "number") values[f.id] = v;
  }
  return values;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Everything in `cfg` that differs from `base`, deep for plain objects,
 *  wholesale for arrays and leaves. {} = no deviations. */
export function configDiff(base: LabelConfig, cfg: LabelConfig): DeepPartial<LabelConfig> {
  const walk = (b: unknown, c: unknown): unknown => {
    if (isPlain(b) && isPlain(c)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(c)) {
        if (!(k in b)) { out[k] = c[k]; continue; }
        const d = walk(b[k], c[k]);
        if (d !== undefined) out[k] = d;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return JSON.stringify(b) === JSON.stringify(c) ? undefined : c;
  };
  return (walk(base, cfg) ?? {}) as DeepPartial<LabelConfig>;
}

export function composeConfig(
  master: Master, enabledVariations: string[],
  values: Record<string, FieldValue>, overrides: DeepPartial<LabelConfig> | undefined,
): { config: LabelConfig; errors: Record<string, string>; warnings: string[] } {
  const r = resolve(master, enabledVariations, values);
  return {
    config: overrides ? deepMerge(r.config, overrides) : r.config,
    errors: r.errors, warnings: r.warnings,
  };
}

/** Re-compose the live config around a variation toggle, preserving the
 *  user's deviations. The diff runs against the OLD enable set's base, so a
 *  variation's own overrides are attributed to the variation, never to the
 *  user — that attribution is what makes disable actually undo them. */
export function toggleVariation(
  master: Master, cfg: LabelConfig, enabled: string[], id: string, on: boolean,
): { enabled: string[]; config: LabelConfig } {
  const values = valuesFromConfig(master, enabled, cfg);
  const base = composeConfig(master, enabled, values, undefined).config;
  const overrides = configDiff(base, cfg);
  const next = on
    ? (enabled.includes(id) ? enabled : [...enabled, id])
    : enabled.filter((x) => x !== id);
  return { enabled: next, config: composeConfig(master, next, values, overrides).config };
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green. If the collab toggle test fails with `collabEnabled` stuck `true` after disable, the diff ran against the wrong base — see `toggleVariation`'s comment.

- [ ] **Step 5: Commit**

```bash
git add src/model/types.ts src/model/labelfile.ts src/model/document.ts tests/model-document.test.ts
git commit -m "Model: label-level overrides and pure config/values derivations for master wiring."
```

---

### Task 2: `.label` v2 in the ZIP (label.json), legacy config.json still opens

**Files:**
- Modify: `src/labelfile.ts`
- Modify: `src/App.tsx` (call-site rename only, temporary v2 guard)
- Test: `tests/labelfile.test.ts` (extend)

**Interfaces:**
- Consumes: `LabelFileV2`, `serializeLabelFile` (`src/model/labelfile.ts`); existing `LabelAssets`, `ROLE_DIRS`, fflate.
- Produces (App relies on these in Task 4):

```ts
/** v2 save: label.json (LabelFileV2 JSON) instead of config.json. */
export function packLabelV2(label: LabelFileV2, assets: LabelAssets): Uint8Array;
/** Unpack either generation. Exactly one of config/label is set:
 *  config = config.json contents (v1), label = label.json contents (v2). */
export function unpackLabel(bytes: Uint8Array): {
  config?: string; label?: string; assets: LabelAssets;
};
```

The ZIP asset roles are unchanged. A file with neither `config.json` nor `label.json` throws the existing "Not a .label file" error (message updated to name both).

- [ ] **Step 1: Write the failing test** — extend `tests/labelfile.test.ts`:

```ts
import { packLabelV2 } from "../src/labelfile"; // alongside existing imports
import { defaultConfig } from "../src/defaults";

describe("label v2 zip", () => {
  const v2 = {
    formatVersion: 2 as const, masterId: "lolev",
    enabledVariations: ["collab"], values: { name: "Peregrine" },
  };
  it("round-trips label.json and assets", () => {
    const bytes = packLabelV2(v2, { texture: { name: "rock.png", bytes: new Uint8Array([1, 2]) } });
    const u = unpackLabel(bytes);
    expect(u.config).toBeUndefined();
    expect(JSON.parse(u.label!)).toMatchObject({ formatVersion: 2, masterId: "lolev" });
    expect(u.assets.texture?.name).toBe("rock.png");
  });
  it("v1 zips still unpack as config", () => {
    const bytes = packLabel(defaultConfig(), {});
    const u = unpackLabel(bytes);
    expect(u.label).toBeUndefined();
    expect(JSON.parse(u.config!).version).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/labelfile.test.ts` — FAIL: `packLabelV2` not exported; `unpackLabel` return shape.

- [ ] **Step 3: Implement** in `src/labelfile.ts`:

```ts
import { serializeLabelFile } from "@/model/labelfile";
import type { LabelFileV2 } from "@/model/types";

export function packLabelV2(label: LabelFileV2, assets: LabelAssets): Uint8Array {
  const zip: Zippable = { "label.json": strToU8(serializeLabelFile(label)) };
  for (const [role, dir] of Object.entries(ROLE_DIRS) as [keyof LabelAssets, string][]) {
    const a = assets[role];
    if (a) zip[`${dir}/${a.name}`] = [a.bytes, { level: 0 }];
  }
  return zipSync(zip);
}
```

Rework `unpackLabel`: read `entries["label.json"]` and `entries["config.json"]`; return `{ label, assets }` when label.json exists, else `{ config, assets }`, else throw `new Error("Not a .label file: missing label.json/config.json")`. Asset extraction unchanged. Update `packLabel`'s doc comment: it is now the legacy/v1 writer, kept for tests and the Node harness until Plan 6.

Fix call sites of the renamed return field (`unpacked.json` → `unpacked.config`): `src/App.tsx`'s `openProject` (add a temporary `if (unpacked.label) throw new Error("v2 label files open in a later task");` guard that Task 4 removes), plus any hits from `grep -rn "unpackLabel" src/` (check `src/dev/` and the Node harness).

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/labelfile.ts src/App.tsx tests/labelfile.test.ts
git commit -m "Label files: v2 zip payload (label.json) with legacy config.json still unpacking."
```

(Include any other adjusted call-site files in the add.)

---

### Task 3: Master library index (files are truth) + resolver

**Files:**
- Create: `src/masters.ts`
- Test: `tests/masters.test.ts`

**Interfaces:**
- Consumes: `Master`, `parseMaster` (`src/model/types.ts`), `lolevMaster` (`src/model/lolev.ts`), `readNativeFile` (`src/files.ts`), `isTauri` (`@tauri-apps/api/core`), `strFromU8` (fflate).
- Produces (App relies on these in Task 4):

```ts
export const SHIPPED_MASTER_ID: string;           // lolevMaster().id
export interface MasterIndexEntry { name: string; path: string; lastSeen: string }
export function masterIndex(): Record<string, MasterIndexEntry>;
export function rememberMaster(m: Master, path: string): void;
/** Resolve by id: shipped master built-in; else index path (desktop read),
 *  else masterHint (desktop read), else null — the caller reports. A
 *  successful hint-read re-registers the master (self-healing index). */
export async function resolveMasterById(id: string, hint?: string): Promise<Master | null>;
```

Storage: localStorage key `"labellab.masters"`, a resolver cache only — the `.master` files on disk are the source of truth (spec: Library index). Browser builds without Tauri resolve only the shipped master; that is correct, not a gap (no filesystem paths to read there).

- [ ] **Step 1: Write the failing test**

```ts
// tests/masters.test.ts
// @vitest-environment jsdom   (only if this project's node environment lacks localStorage — match presets.test's setup)
import { beforeEach, describe, expect, it } from "vitest";
import { masterIndex, rememberMaster, resolveMasterById, SHIPPED_MASTER_ID } from "../src/masters";
import { lolevMaster } from "../src/model/lolev";

beforeEach(() => localStorage.clear());

describe("master library index", () => {
  it("resolves the shipped master with an empty index", async () => {
    expect(await resolveMasterById(SHIPPED_MASTER_ID)).toEqual(lolevMaster());
  });
  it("remembers and lists a master", () => {
    rememberMaster(lolevMaster(), "/tmp/lolev.master");
    const idx = masterIndex();
    expect(idx[SHIPPED_MASTER_ID].path).toBe("/tmp/lolev.master");
    expect(idx[SHIPPED_MASTER_ID].name).toBe("Lolev");
  });
  it("unknown id with no hint resolves null", async () => {
    expect(await resolveMasterById("nope")).toBeNull();
  });
  it("survives a mangled index entry", () => {
    localStorage.setItem("labellab.masters", "{not json");
    expect(masterIndex()).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** — `npx vitest run tests/masters.test.ts` — FAIL: module missing.

- [ ] **Step 3: Implement**

```ts
// src/masters.ts — the master library index: {id -> {name, path, lastSeen}}.
// A RESOLVER CACHE ONLY — .master files on disk are the source of truth
// (spec: Library index). The shipped Lolev master is built-in and needs no
// path. localStorage (per-operator app state, like the view toggles), not
// presets.json: the index describes this machine's filesystem.
import { isTauri } from "@tauri-apps/api/core";
import { strFromU8 } from "fflate";
import type { Master } from "@/model/types";
import { parseMaster } from "@/model/types";
import { lolevMaster } from "@/model/lolev";
import { readNativeFile } from "@/files";

export const SHIPPED_MASTER_ID = lolevMaster().id;
const KEY = "labellab.masters";

export interface MasterIndexEntry { name: string; path: string; lastSeen: string }

export function masterIndex(): Record<string, MasterIndexEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, MasterIndexEntry>;
  } catch {
    return {}; // a mangled entry falls back rather than crashing open
  }
}

export function rememberMaster(m: Master, path: string): void {
  const idx = masterIndex();
  idx[m.id] = { name: m.name, path, lastSeen: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(idx));
}

async function readMasterAt(path: string): Promise<Master | null> {
  if (!isTauri()) return null; // browser: no filesystem paths to read
  try {
    const m = parseMaster(JSON.parse(strFromU8(await readNativeFile(path))));
    rememberMaster(m, path); // self-healing: a good read refreshes the index
    return m;
  } catch {
    return null; // moved/deleted/corrupt — caller falls through to the hint
  }
}

export async function resolveMasterById(id: string, hint?: string): Promise<Master | null> {
  if (id === SHIPPED_MASTER_ID) return lolevMaster();
  const entry = masterIndex()[id];
  if (entry) {
    const m = await readMasterAt(entry.path);
    if (m?.id === id) return m;
  }
  if (hint) {
    const m = await readMasterAt(hint);
    if (m?.id === id) return m;
  }
  return null;
}
```

(Verify `readNativeFile`'s exact signature in `src/files.ts` before writing — adapt the decode line to what it returns.)

- [ ] **Step 4: Run the tests and typecheck** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 5: Commit**

```bash
git add src/masters.ts tests/masters.test.ts
git commit -m "Masters: library index in app storage with shipped-master and hint fallback resolution."
```

---

### Task 4: App wiring — master state, v2 open/save, variation state

**Files:**
- Modify: `src/App.tsx`
- Test: extend `tests/model-document.test.ts` (round-trip composition); existing suites stay green.

**Interfaces:**
- Consumes: everything Tasks 1–3 produced; existing `openProject`/`saveProject`/`resetDocument` machinery in App.
- Produces (Task 5 relies on these): App state `master: Master`, `enabledVariations: string[]`, handler `setVariation(id: string, on: boolean): void`.

Wiring rules (binding):
- New state: `const [master, setMaster] = useState<Master>(lolevMaster);` and `const [enabledVariations, setEnabledVariations] = useState<string[]>([]);`. Variation state sits OUTSIDE the undo history, like `hiddenLayers` — the composed `cfg` it produces IS in history, so undo restores the visual result; document the asymmetry in a comment.
- `setVariation(id, on)`: `const r = toggleVariation(master, cfg, enabledVariations, id, on); setEnabledVariations(r.enabled); markDirty(); setCfg(() => r.config);` — one undoable history step (the whole next config is already built, so no clone-and-mutate `update` needed).
- `openProject` v2 branch: when `unpacked.label` is set — `const parsed = parseLabelFile(JSON.parse(unpacked.label)); if ("legacy" in parsed) throw new Error("label.json is not a v2 label");` then `const m = await resolveMasterById(parsed.masterId, parsed.masterHint);` null → `setLoadError(\`Could not find master "${parsed.masterId}"${parsed.masterHint ? \` (last seen at ${parsed.masterHint})\` : ""} — open its .master file once to register it.\`)` and return false. Else `const c = composeConfig(m, parsed.enabledVariations, parsed.values, parsed.overrides); setMaster(m); setEnabledVariations(parsed.enabledVariations); resetDocument(c.config);` then the existing asset restore. Non-empty `c.warnings` surface via `setLoadError(c.warnings.join(" · "))` (advisory, does not block the open). Remove Task 2's temporary throw guard.
- Legacy branch (`unpacked.config`): unchanged parse, plus `setMaster(lolevMaster())` and `setEnabledVariations(parsedCfg.collabEnabled ? ["collab"] : [])` — the bridge that shows an old collab label's Collab checkbox checked.
- `saveProject`: always writes v2. Replace `packLabel(cfg, …)` with:

```ts
const values = valuesFromConfig(master, enabledVariations, cfg);
const overrides = configDiff(
  composeConfig(master, enabledVariations, values, undefined).config, cfg);
const label: LabelFileV2 = {
  formatVersion: 2, masterId: master.id,
  masterHint: masterIndex()[master.id]?.path,
  enabledVariations, values,
  ...(Object.keys(overrides).length ? { overrides } : {}),
};
const zip = packLabelV2(label, { /* same asset object as today */ });
```

- New-document reset: `resetDocument` also runs `setMaster(lolevMaster()); setEnabledVariations([]);` — the v2 open branch sets both again right after, so an open can't leak the previous document's variation state.

- [ ] **Step 1: Add the round-trip composition test first** (the pure half of what App will do):

```ts
// appended to tests/model-document.test.ts
it("save/open round-trip: v2 label reproduces the exact config", () => {
  const m = lolevMaster();
  const cfg = composeConfig(m, ["collab"], {}, undefined).config;
  cfg.beerName = "Peregrine";
  cfg.nameStyle.fill = "#112233";
  const values = valuesFromConfig(m, ["collab"], cfg);
  const overrides = configDiff(composeConfig(m, ["collab"], values, undefined).config, cfg);
  const reopened = composeConfig(m, ["collab"], values, overrides).config;
  expect(reopened).toEqual(cfg);
});
```

Run: `npx vitest run tests/model-document.test.ts` — should PASS already (Task 1 built it); if it fails, fix Task 1's functions, not this test.

- [ ] **Step 2: Implement the App wiring per the rules above**

- [ ] **Step 3: Full gate**

Run: `npx vitest run && npx tsc --noEmit`
Expected: green — especially the canvas/pdf regression locks (an untouched document must render identically) and `labelfile.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx tests/model-document.test.ts
git commit -m "App: documents run on master + variations + values, saving v2 labels and still opening v1."
```

---

### Task 5: Design/Fill segmented control, Fill field list, variation checkboxes

**Files:**
- Create: `src/components/FieldList.tsx`
- Modify: `src/App.tsx` (mode state, header control, sidebar swap, Fill-mode inspector gating)
- Modify: `src/model/resolve.ts` (export `setPath`)
- Test: `tests/fieldlist-dom.test.tsx` (match the existing DOM suites' extension/setup — see `tests/description-editor-dom.test.ts`)

**Interfaces:**
- Consumes: `FieldDecl`, `validateField` (`src/model/fields.ts`), `visibleFieldsOf`/`getPath` (`src/model/document.ts`), App's `update`/`cfg`/`master`/`enabledVariations`/`setVariation`.
- Produces:

```ts
// src/components/FieldList.tsx
export function FieldList(props: {
  master: Master;
  enabledVariations: string[];
  cfg: LabelConfig;
  /** Write one field's value through its path (App routes through update()). */
  onValue: (field: FieldDecl, value: FieldValue) => void;
  onVariation: (id: string, on: boolean) => void;
}): JSX.Element;
```

Behavior (binding):
- Variation checkboxes first (one per `master.variations`, labeled by `name`, checked = enabled), then one row per visible field, labeled by `label`.
- Widgets per kind: `text` → `<input>` (`<textarea rows={4}>` when `field.path === "description"` — the one multiline field; the canvas WYSIWYG remains the rich path, spec: "The canvas is the field list"); `number` → `<input type="number" min max>`; `code` → `<input>` with its `validateField` error under it; `select` → `<select>` over `options`; `toggle` → checkbox; `image` → a muted "Set in Design mode" note (asset-bound image fields land with Plan 4b's asset wiring).
- Every widget reads its current value from `cfg` via `getPath` and calls `onValue` on change — controlled inputs, no local state.
- App's `onValue`: `update((c) => setPath(c as unknown as Record<string, unknown>, field.path, field.kind === "toggle" ? value === true : String(value)), true)` — coalesced like text edits so typing a name is one undo step per session of keystrokes is NOT required; plain per-keystroke coalescing (second arg `true` after the first) matches the in-place editor's contract. Simplest faithful form: mirror `onEditText`'s `first` handling by tracking the focused field id in a ref.
- App: `const [mode, setMode] = useState<"design" | "fill">("fill");` — per-document, not persisted, not in history. Header segmented control (two buttons after `<SidebarTrigger>`, `aria-pressed`, view-toggle styling): `Design | Fill`.
- Sidebar: `mode === "design" ? <LayersPanel …/> : <FieldList …/>`.
- Fill-mode gating: the style Inspector Sheet renders only in Design mode (`open={active && mode === "design" && selected.length > 0}`) — canvas clicks still select and in-place edit in Fill, but expose no styling and no layers panel (spec: "no styling, no layers panel"). Dragging is already lock-gated by `dragTarget`/`dragTarget2`.
- Commands: add `{ id: "mode-design", label: "Design mode", run: () => setMode("design") }` and `{ id: "mode-fill", label: "Fill mode", run: () => setMode("fill") }`.

- [ ] **Step 1: Write the failing DOM test**

```tsx
// tests/fieldlist-dom.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FieldList } from "../src/components/FieldList";
import { lolevMaster } from "../src/model/lolev";
import { defaultConfig } from "../src/defaults";

afterEach(cleanup);

describe("FieldList", () => {
  it("lists the master's fields with current values", () => {
    const cfg = defaultConfig();
    cfg.beerName = "Peregrine";
    render(<FieldList master={lolevMaster()} enabledVariations={[]} cfg={cfg}
      onValue={vi.fn()} onVariation={vi.fn()} />);
    expect(screen.getByLabelText("Beer name")).toHaveValue("Peregrine");
    expect(screen.getByLabelText("Collab")).not.toBeChecked();
  });
  it("edits write through onValue and variations through onVariation", () => {
    const onValue = vi.fn();
    const onVariation = vi.fn();
    render(<FieldList master={lolevMaster()} enabledVariations={[]} cfg={defaultConfig()}
      onValue={onValue} onVariation={onVariation} />);
    fireEvent.change(screen.getByLabelText("Beer name"), { target: { value: "Kestrel" } });
    expect(onValue).toHaveBeenCalledWith(expect.objectContaining({ id: "name" }), "Kestrel");
    fireEvent.click(screen.getByLabelText("Collab"));
    expect(onVariation).toHaveBeenCalledWith("collab", true);
  });
  it("shows a validation error for a bad code value", () => {
    const cfg = defaultConfig();
    cfg.upc = "123";
    render(<FieldList master={lolevMaster()} enabledVariations={[]} cfg={cfg}
      onValue={vi.fn()} onVariation={vi.fn()} />);
    // Pin to validateUpc's real message — read src/upc.ts and use its text.
    expect(screen.getByText(/digit/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails** — component missing.

- [ ] **Step 3: Implement `FieldList.tsx`**

```tsx
// FieldList.tsx — Fill mode's sidebar: variation checkboxes + one widget per
// visible field, each writing through its FieldDecl.path (spec: UI — "Fill
// shows the label, the field list, and variation checkboxes"). The canvas
// remains the primary editing surface; this is the parallel path.
import type { LabelConfig } from "@/types";
import type { FieldDecl, FieldValue, Master } from "@/model/types";
import { getPath, visibleFieldsOf } from "@/model/document";
import { validateField } from "@/model/fields";

function FieldRow({ field, cfg, onValue }: {
  field: FieldDecl; cfg: LabelConfig;
  onValue: (f: FieldDecl, v: FieldValue) => void;
}) {
  const raw = getPath(cfg, field.path);
  const id = `field-${field.id}`;
  if (field.kind === "toggle") {
    return (
      <div className="flex items-center gap-2">
        <input type="checkbox" id={id} checked={raw === true}
          onChange={(e) => onValue(field, e.target.checked)} />
        <label htmlFor={id} className="text-sm">{field.label}</label>
      </div>
    );
  }
  if (field.kind === "image") {
    return (
      <div className="space-y-1">
        <span className="text-sm">{field.label}</span>
        <p className="text-xs text-muted-foreground">Set in Design mode.</p>
      </div>
    );
  }
  const value = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  const check = value === "" ? { ok: true as const } : validateField(field, value);
  const multiline = field.path === "description";
  const inputCls = "w-full rounded border border-input bg-transparent px-2 py-1 text-sm";
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm">{field.label}</label>
      {field.kind === "select" ? (
        <select id={id} value={value} className={inputCls}
          onChange={(e) => onValue(field, e.target.value)}>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : multiline ? (
        <textarea id={id} rows={4} value={value} className={inputCls}
          onChange={(e) => onValue(field, e.target.value)} />
      ) : (
        <input id={id} value={value} className={inputCls}
          type={field.kind === "number" ? "number" : "text"}
          min={field.min} max={field.max}
          onChange={(e) => onValue(field, e.target.value)} />
      )}
      {!check.ok && <p className="text-xs text-destructive">{check.error}</p>}
    </div>
  );
}

export function FieldList({ master, enabledVariations, cfg, onValue, onVariation }: {
  master: Master; enabledVariations: string[]; cfg: LabelConfig;
  onValue: (f: FieldDecl, v: FieldValue) => void;
  onVariation: (id: string, on: boolean) => void;
}) {
  return (
    <div className="space-y-4 p-3">
      {master.variations.map((v) => (
        <div key={v.id} className="flex items-center gap-2">
          <input type="checkbox" id={`variation-${v.id}`}
            checked={enabledVariations.includes(v.id)}
            onChange={(e) => onVariation(v.id, e.target.checked)} />
          <label htmlFor={`variation-${v.id}`} className="text-sm font-medium">{v.name}</label>
        </div>
      ))}
      {visibleFieldsOf(master, enabledVariations).map((f) => (
        <FieldRow key={f.id} field={f} cfg={cfg} onValue={onValue} />
      ))}
    </div>
  );
}
```

(If `src/components/ui/` provides Checkbox/Label/Input primitives the rest of the app uses, swap the plain elements for them — match the sidebar's existing idiom, don't invent a second one.)

Then wire App per the Interfaces block: mode state, segmented control, sidebar swap, Sheet gated on Design, `onValue` through `update` + `setPath` (export `setPath` from `src/model/resolve.ts`), `onVariation` = `setVariation`.

- [ ] **Step 4: Run tests and typecheck** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 5: Commit**

```bash
git add src/components/FieldList.tsx src/App.tsx src/model/resolve.ts tests/fieldlist-dom.test.tsx
git commit -m "Fill mode: segmented Design/Fill control, field list with per-kind widgets, variation checkboxes."
```

---

### Task 6: Version bump + CHANGELOG + push gate

**Files:**
- Modify: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (label-lab entry), `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump 0.1.30 → 0.1.31 in all five locations** (`npm install --package-lock-only` refreshes package-lock; edit Cargo.lock's `label-lab` entry to match).

- [ ] **Step 2: CHANGELOG entry**

```markdown
## [0.1.31] - 2026-08-27

- Labels now run on a master + variations + values model. A new Design/Fill
  control (Fill is the default) shows fillers just the label, a field list,
  and variation checkboxes — the collab switch is now the shipped Collab
  variation. Files save in a slimmer v2 `.label` format recording the master,
  enabled variations, and values; existing `.label` files still open exactly
  as before, and re-saving upgrades them. The app keeps a library index of
  where `.master` files live; the Lolev master ships built in.
```

- [ ] **Step 3: Full gate** — `npx vitest run && npx tsc --noEmit` — green.

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "Version 0.1.31: Design/Fill modes, master wiring, and v2 label files."
git push
```

Do NOT merge PR #41.

---

## Self-Review

- Spec coverage (this plan's slice): two-hats segmented control ✓ (T5); Fill = label + field list + variation checkboxes only ✓ (T5); resolve() wired with lolevMaster() shipped ✓ (T4); v2 load/save + legacy open ✓ (T2/T4); collab → shipped Collab variation ✓ (T1 toggleVariation + T4 bridge); library index, files-as-truth ✓ (T3); label-level overrides per Migration ✓ (T1). Deferred to Plan 4b by design: add-layer UI, chip builder, PSD work, custom-image assets, barcode/QR layer types.
- Placeholder scan: none — every code step carries real code; the two "verify against the actual file" notes (readNativeFile signature, validateUpc message, ui primitives) are implementer look-ups, not deferrals.
- Type consistency: `packLabelV2(label, assets)`, `unpackLabel → {config?, label?, assets}`, `resolveMasterById(id, hint?)`, `composeConfig/valuesFromConfig/configDiff/toggleVariation/visibleFieldsOf/getPath` names match across tasks.
- Stated judgment calls: variation state outside history (composed cfg is in history); Fill mode hides the Inspector rather than adding selection plumbing; image fields deferred to 4b.
