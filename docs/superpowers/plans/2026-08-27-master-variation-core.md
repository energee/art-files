# Master/Variation Core Model Implementation Plan (Plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure data core of the Master/Variation model — types, format strings, variation merging, field validation, and the resolver that collapses master + variations + values into today's `LabelConfig` — fully tested, no UI wiring yet.

**Architecture:** Incremental re-layering (spec, Approach 1). A new `src/model/` module sits *above* the existing config: `resolve(master, enabledVariationIds, values)` returns the exact `LabelConfig` shape the renderers/PDF/PSD already consume, so nothing downstream changes. Field declarations bind to `LabelConfig` paths in this plan; Plan 2 generalizes layers.

**Tech Stack:** TypeScript, vitest (`npm test`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-master-variation-design.md`

**Plan sequence:** 1 core model (this) → 2 layer types + encoders → 3 lock/snap/UI modes → 4 compliance packs → 5 migration + rename.

## Global Constraints

- No new npm dependencies.
- All new files carry a module-level purpose comment (repo convention).
- After each task: `npx tsc --noEmit` clean and `npm test` green before commit.
- Work on branch `design/master-variation` in `/Users/tedslesinski/Repos/art-files` (this plan only adds `src/model/` + tests).
- Never hardcode "poppins" — fonts stay behind the existing font gate (`fontFamilyOf`).
- `LabelConfig` (`src/types.ts`) is not modified in this plan.

---

### Task 1: Model types + parser

**Files:**
- Create: `src/model/types.ts`
- Test: `tests/model-types.test.ts`

**Interfaces:**
- Consumes: `LabelConfig` from `src/types.ts` (type-only).
- Produces: `Master`, `Variation`, `FieldDecl`, `FieldKind`, `FieldValue`, `Guides`, `LabelFileV2`, and `parseMaster(json: unknown): Master` (throws `Error` with a plain-English message on invalid input).

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-types.test.ts
import { describe, expect, it } from "vitest";
import { parseMaster } from "../src/model/types";

const minimal = {
  formatVersion: 1, id: "m1", name: "Test",
  physical: { labelWidthIn: 8.125, labelHeightIn: 3.625, bleedIn: 0.125, canDiameterIn: 2.6 },
  defaults: {}, guides: { left: 24.12, center: "auto", right: 24.12, top: 24.12, bottom: 24.12 },
  fields: [], variations: [],
};

describe("parseMaster", () => {
  it("accepts a minimal master", () => {
    const m = parseMaster(minimal);
    expect(m.id).toBe("m1");
    expect(m.guides.top).toBe(24.12);
  });
  it("rejects a missing physical block with a plain message", () => {
    expect(() => parseMaster({ ...minimal, physical: undefined }))
      .toThrow(/physical/);
  });
  it("rejects an unknown formatVersion", () => {
    expect(() => parseMaster({ ...minimal, formatVersion: 99 }))
      .toThrow(/format/i);
  });
  it("rejects a variation with a duplicate id", () => {
    const v = { id: "collab", name: "Collab", overrides: {}, layerOverrides: {}, fields: [] };
    expect(() => parseMaster({ ...minimal, variations: [v, v] }))
      .toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model-types.test.ts`
Expected: FAIL — cannot resolve `../src/model/types`.

- [ ] **Step 3: Write the implementation**

```ts
// src/model/types.ts — the Master/Variation data model (spec:
// docs/superpowers/specs/2026-08-27-master-variation-design.md). Pure types +
// a defensive parser; no DOM, no rendering. resolve.ts collapses these into
// the existing LabelConfig, which stays the renderers' contract.
import type { LabelConfig } from "../types";

export type FieldKind = "text" | "number" | "image" | "code" | "select" | "toggle";
export type FieldValue = string | number | boolean;

/** What a .label may fill. `path` binds the value into the resolved
 *  LabelConfig (dot path, e.g. "beerName", "styleLine.text") — the Plan-1
 *  bridge until layers generalize in Plan 2. */
export interface FieldDecl {
  id: string;
  label: string;
  kind: FieldKind;
  path: string;
  /** Derived content: a format string over field values (format.ts); when
   *  set, the expanded string is written to `path` instead of the raw value. */
  format?: string;
  /** number kind */
  min?: number; max?: number;
  /** select kind */
  options?: string[];
  /** code kind: which validator applies */
  symbology?: "upc-a";
}

export interface Guides {
  left: number | null; center: "auto" | null; right: number | null;
  top: number | null; bottom: number | null;   // null = guide removed
}

/** A pure diff on the master — never a copy. */
export interface Variation {
  id: string;
  name: string;
  overrides: Partial<LabelConfig>;
  layerOverrides: Record<string, unknown>;   // used from Plan 2 on
  fields: FieldDecl[];
}

export interface Master {
  formatVersion: 1;
  id: string;
  name: string;
  physical: { labelWidthIn: number; labelHeightIn: number; bleedIn: number; canDiameterIn: number };
  defaults: Partial<LabelConfig>;
  guides: Guides;
  fields: FieldDecl[];
  variations: Variation[];
}

/** The new .label payload: IDs and values only — no layout, no styling. */
export interface LabelFileV2 {
  formatVersion: 2;
  masterId: string;
  masterHint?: string;
  enabledVariations: string[];        // in enable order
  values: Record<string, FieldValue>; // keyed by FieldDecl.id; dormant values kept
}

function fail(msg: string): never { throw new Error(`Invalid master file: ${msg}`); }

export function parseMaster(json: unknown): Master {
  const m = json as Master;
  if (!m || typeof m !== "object") fail("not an object");
  if (m.formatVersion !== 1) fail(`unsupported formatVersion (expected 1)`);
  if (!m.id || typeof m.id !== "string") fail("missing id");
  if (!m.name || typeof m.name !== "string") fail("missing name");
  const p = m.physical;
  if (!p || [p.labelWidthIn, p.labelHeightIn, p.bleedIn, p.canDiameterIn].some((n) => typeof n !== "number"))
    fail("missing or incomplete physical dimensions");
  if (!m.defaults || typeof m.defaults !== "object") fail("missing defaults");
  if (!m.guides || typeof m.guides !== "object") fail("missing guides");
  const fields = m.fields ?? fail("missing fields");
  const variations = m.variations ?? fail("missing variations");
  const seen = new Set<string>();
  for (const v of variations) {
    if (!v.id) fail("variation without id");
    if (seen.has(v.id)) fail(`duplicate variation id "${v.id}"`);
    seen.add(v.id);
  }
  const fids = new Set<string>();
  for (const f of [...fields, ...variations.flatMap((v) => v.fields ?? [])]) {
    if (!f.id || !f.kind || !f.path) fail(`field "${f.id ?? "?"}" missing id/kind/path`);
    if (fids.has(f.id)) fail(`duplicate field id "${f.id}"`);
    fids.add(f.id);
  }
  return m;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/model-types.test.ts` — expected PASS.
Then: `npx tsc --noEmit` — expected clean.

- [ ] **Step 5: Commit**

```bash
git add src/model/types.ts tests/model-types.test.ts
git commit -m "Model: Master/Variation types and defensive parser"
```

---

### Task 2: Format strings

**Files:**
- Create: `src/model/format.ts`
- Test: `tests/model-format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `expandFormat(fmt: string, values: Record<string, string>): { text: string; missing: string[] }`, `TRANSFORMS: Record<string, (s: string) => string>` (`slug`, `upper`, `lower`, `trim`), `fieldRefs(fmt: string): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-format.test.ts
import { describe, expect, it } from "vitest";
import { expandFormat, fieldRefs } from "../src/model/format";

describe("expandFormat", () => {
  it("substitutes plain refs", () => {
    expect(expandFormat("{abv}% alc by vol", { abv: "6.2" }).text).toBe("6.2% alc by vol");
  });
  it("applies the slug transform", () => {
    expect(expandFormat("http://lolev.beer/beer/{name|slug}", { name: "Hazy IPA!" }).text)
      .toBe("http://lolev.beer/beer/hazy-ipa");
  });
  it("applies upper, lower, trim", () => {
    expect(expandFormat("{a|upper}/{b|lower}/{c|trim}", { a: "x", b: "Y", c: " z " }).text)
      .toBe("X/y/z");
  });
  it("reports missing fields and leaves the ref visible", () => {
    const r = expandFormat("{upc}", {});
    expect(r.missing).toEqual(["upc"]);
    expect(r.text).toBe("{upc}");
  });
  it("passes literal text through, including braces-free strings", () => {
    expect(expandFormat("1 PINT", {}).text).toBe("1 PINT");
  });
  it("lists referenced fields", () => {
    expect(fieldRefs("{name|slug} and {upc}")).toEqual(["name", "upc"]);
  });
  it("ignores an unknown transform, keeping the raw value", () => {
    expect(expandFormat("{a|nope}", { a: "v" }).text).toBe("v");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model-format.test.ts` — expected FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/model/format.ts — format strings for derived layer content: literal
// text with {fieldId} or {fieldId|transform} refs over FIELD values only
// (never other layers, so cycles are impossible by construction). Spec:
// "Format strings (derived content)".
export const TRANSFORMS: Record<string, (s: string) => string> = {
  slug: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  trim: (s) => s.trim(),
};

const REF = /\{([a-zA-Z][\w-]*)(?:\|([a-z]+))?\}/g;

export function fieldRefs(fmt: string): string[] {
  return [...fmt.matchAll(REF)].map((m) => m[1]);
}

/** Expand refs; a missing field keeps its literal "{ref}" (visible in the
 *  preview as an obvious placeholder) and is reported in `missing`. */
export function expandFormat(
  fmt: string, values: Record<string, string>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = fmt.replace(REF, (raw, id: string, tr?: string) => {
    const v = values[id];
    if (v === undefined) { missing.push(id); return raw; }
    return tr && TRANSFORMS[tr] ? TRANSFORMS[tr](v) : v;
  });
  return { text, missing };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/model-format.test.ts` — expected PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/model/format.ts tests/model-format.test.ts
git commit -m "Model: format strings with slug/upper/lower/trim transforms"
```

---

### Task 3: Variation merge

**Files:**
- Create: `src/model/merge.ts`
- Test: `tests/model-merge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `deepMerge<T>(base: T, patch: DeepPartial<T>): T` (pure — never mutates; arrays and non-object leaves replace wholesale; `undefined` in patch means "no override"), exported type `DeepPartial<T>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-merge.test.ts
import { describe, expect, it } from "vitest";
import { deepMerge } from "../src/model/merge";

describe("deepMerge", () => {
  const base = { a: 1, style: { fill: "#fff", layer: "white" }, list: [1, 2] };
  it("merges nested objects", () => {
    expect(deepMerge(base, { style: { fill: "#000" } }))
      .toEqual({ a: 1, style: { fill: "#000", layer: "white" }, list: [1, 2] });
  });
  it("replaces arrays wholesale", () => {
    expect(deepMerge(base, { list: [9] }).list).toEqual([9]);
  });
  it("ignores undefined patch values", () => {
    expect(deepMerge(base, { a: undefined }).a).toBe(1);
  });
  it("does not mutate its inputs", () => {
    deepMerge(base, { style: { fill: "#000" } });
    expect(base.style.fill).toBe("#fff");
  });
  it("stacks: later merges win (last-enabled-wins)", () => {
    const once = deepMerge(base, { a: 2 });
    expect(deepMerge(once, { a: 3 }).a).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model-merge.test.ts` — expected FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/model/merge.ts — the variation-override merge: plain recursive object
// merge, patch wins, arrays and scalars replace wholesale. Stacked variations
// get last-enabled-wins by simply merging in enable order (spec: Resolution
// step 2).
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/model-merge.test.ts` — expected PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/model/merge.ts tests/model-merge.test.ts
git commit -m "Model: deep merge for stacked variation overrides"
```

---

### Task 4: Field validation

**Files:**
- Create: `src/model/fields.ts`
- Test: `tests/model-fields.test.ts`

**Interfaces:**
- Consumes: `FieldDecl`, `FieldValue` from `src/model/types.ts`; `validateUpc` from `src/upc.ts`.
- Produces: `validateField(decl: FieldDecl, value: FieldValue): { ok: boolean; error?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-fields.test.ts
import { describe, expect, it } from "vitest";
import { validateField } from "../src/model/fields";
import type { FieldDecl } from "../src/model/types";

const decl = (over: Partial<FieldDecl>): FieldDecl =>
  ({ id: "f", label: "F", kind: "text", path: "beerName", ...over });

describe("validateField", () => {
  it("accepts any string for text", () => {
    expect(validateField(decl({}), "Hazy").ok).toBe(true);
  });
  it("rejects a non-number for number", () => {
    expect(validateField(decl({ kind: "number" }), "abc").ok).toBe(false);
  });
  it("enforces number min/max", () => {
    const d = decl({ kind: "number", min: 0, max: 20 });
    expect(validateField(d, 6.2).ok).toBe(true);
    expect(validateField(d, 21).ok).toBe(false);
    expect(validateField(d, 21).error).toMatch(/20/);
  });
  it("accepts numeric strings for number (form inputs are strings)", () => {
    expect(validateField(decl({ kind: "number", min: 0, max: 20 }), "6.2").ok).toBe(true);
  });
  it("validates UPC-A check digit for code/upc-a", () => {
    const d = decl({ kind: "code", symbology: "upc-a" });
    expect(validateField(d, "036000291452").ok).toBe(true);   // valid check digit
    expect(validateField(d, "036000291453").ok).toBe(false);
  });
  it("restricts select to its options", () => {
    const d = decl({ kind: "select", options: ["ale", "lager"] });
    expect(validateField(d, "ale").ok).toBe(true);
    expect(validateField(d, "ipa").ok).toBe(false);
  });
  it("requires boolean for toggle", () => {
    expect(validateField(decl({ kind: "toggle" }), true).ok).toBe(true);
    expect(validateField(decl({ kind: "toggle" }), "yes").ok).toBe(false);
  });
  it("requires a string for image (asset key)", () => {
    expect(validateField(decl({ kind: "image" }), "logo.png").ok).toBe(true);
    expect(validateField(decl({ kind: "image" }), 5).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model-fields.test.ts` — expected FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/model/fields.ts — per-kind field validation (spec: FieldDecl). A field
// is "what editor the filler gets and how the value is validated"; this is
// the validation half. Invalid values become field-level errors upstream —
// the preview never crashes on them (resolve.ts skips applying them).
import type { FieldDecl, FieldValue } from "./types";
import { validateUpc } from "../upc";

type Result = { ok: boolean; error?: string };
const ok: Result = { ok: true };
const err = (error: string): Result => ({ ok: false, error });

export function validateField(decl: FieldDecl, value: FieldValue): Result {
  switch (decl.kind) {
    case "text":
      return typeof value === "string" ? ok : err("Expected text.");
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (typeof value === "boolean" || Number.isNaN(n)) return err("Expected a number.");
      if (decl.min !== undefined && n < decl.min) return err(`Must be at least ${decl.min}.`);
      if (decl.max !== undefined && n > decl.max) return err(`Must be at most ${decl.max}.`);
      return ok;
    }
    case "image":
      return typeof value === "string" ? ok : err("Expected an image.");
    case "code": {
      if (typeof value !== "string") return err("Expected a code value.");
      if (decl.symbology === "upc-a") {
        const r = validateUpc(value);
        return r.ok ? ok : err(r.error!);
      }
      return ok;   // other symbologies validate from Plan 2 on
    }
    case "select":
      return decl.options?.includes(String(value))
        ? ok : err(`Must be one of: ${decl.options?.join(", ") ?? ""}.`);
    case "toggle":
      return typeof value === "boolean" ? ok : err("Expected on/off.");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/model-fields.test.ts` — expected PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/model/fields.ts tests/model-fields.test.ts
git commit -m "Model: per-kind field validation reusing UPC check-digit logic"
```

---

### Task 5: The resolver

**Files:**
- Create: `src/model/resolve.ts`
- Test: `tests/model-resolve.test.ts`

**Interfaces:**
- Consumes: `Master`, `FieldDecl`, `FieldValue` (types.ts); `deepMerge`, `DeepPartial` (merge.ts); `validateField` (fields.ts); `expandFormat` (format.ts); the shipped default config from `src/defaults.ts` — verify its actual export name first (`rg "export const" src/defaults.ts`) and use that; referred to as `DEFAULT_CONFIG` below.
- Produces: `resolve(master: Master, enabledVariations: string[], values: Record<string, FieldValue>): { config: LabelConfig; visibleFields: FieldDecl[]; errors: Record<string, string>; warnings: string[] }`.

Semantics (spec "Resolution", steps 1–5; step 6 anchors/guides lands in Plan 3):
start from `DEFAULT_CONFIG` merged with `master.defaults`; merge each enabled
variation's `overrides` in enable order; visible fields = master's + enabled
variations'; apply `values` per field `path` only when `validateField` passes
(failures land in `errors`, the config keeps its prior value); a field with
`format` writes its expanded string to `path` instead of the raw value.
Unknown enabled variation ids append a warning and are skipped. Dot paths
write nested config slots (`"styleLine.text"`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-resolve.test.ts
import { describe, expect, it } from "vitest";
import { resolve } from "../src/model/resolve";
import type { Master } from "../src/model/types";

const master: Master = {
  formatVersion: 1, id: "m1", name: "Test",
  physical: { labelWidthIn: 8.125, labelHeightIn: 3.625, bleedIn: 0.125, canDiameterIn: 2.6 },
  defaults: { beerName: "DEFAULT", abv: "5" },
  guides: { left: 24.12, center: "auto", right: 24.12, top: 24.12, bottom: 24.12 },
  fields: [
    { id: "name", label: "Beer name", kind: "text", path: "beerName" },
    { id: "abv", label: "ABV", kind: "number", path: "abv", min: 0, max: 20 },
    { id: "style", label: "Style", kind: "text", path: "styleLine.text" },
  ],
  variations: [
    { id: "collab", name: "Collab", overrides: { collabEnabled: true }, layerOverrides: {},
      fields: [{ id: "partner", label: "Partner logo", kind: "image", path: "collabLeft.asset" }] },
    { id: "loud", name: "Loud", overrides: { abv: "9" }, layerOverrides: {}, fields: [] },
  ],
};

describe("resolve", () => {
  it("starts from defaults", () => {
    const r = resolve(master, [], {});
    expect(r.config.beerName).toBe("DEFAULT");
    expect(r.config.collabEnabled).toBe(false);   // DEFAULT_CONFIG's value
  });
  it("applies enabled variations in order, last wins", () => {
    expect(resolve(master, ["collab"], {}).config.collabEnabled).toBe(true);
    expect(resolve(master, ["loud"], {}).config.abv).toBe("9");
  });
  it("exposes variation fields only when enabled", () => {
    expect(resolve(master, [], {}).visibleFields.map((f) => f.id)).not.toContain("partner");
    expect(resolve(master, ["collab"], {}).visibleFields.map((f) => f.id)).toContain("partner");
  });
  it("applies valid values via dot paths", () => {
    const r = resolve(master, [], { name: "HAZY", style: "India Pale Ale" });
    expect(r.config.beerName).toBe("HAZY");
    expect(r.config.styleLine.text).toBe("India Pale Ale");
  });
  it("rejects invalid values into errors, keeping the prior value", () => {
    const r = resolve(master, [], { abv: "99" });
    expect(r.errors.abv).toMatch(/20/);
    expect(r.config.abv).toBe("5");
  });
  it("ignores dormant values for disabled variations", () => {
    const r = resolve(master, [], { partner: "x.png" });
    expect(r.errors.partner).toBeUndefined();   // dormant, not an error
  });
  it("warns on unknown variation ids", () => {
    expect(resolve(master, ["nope"], {}).warnings.join(" ")).toMatch(/nope/);
  });
  it("expands a field's format string", () => {
    const m: Master = { ...master, fields: [...master.fields,
      { id: "qr", label: "QR", kind: "text", path: "qrPayload", format: "https://x.co/{name|slug}" }] };
    const r = resolve(m, [], { name: "Hazy IPA" });
    expect((r.config as Record<string, unknown>).qrPayload).toBe("https://x.co/hazy-ipa");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model-resolve.test.ts` — expected FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/model/resolve.ts — the heart of the design: collapse master + enabled
// variations + field values into the LabelConfig the renderers and both
// deliverable builders already consume (spec: Resolution). Pure, synchronous,
// deterministic; anchors/guides (spec step 6) land with the layer work.
import type { LabelConfig } from "../types";
import type { FieldDecl, FieldValue, Master } from "./types";
import { deepMerge, type DeepPartial } from "./merge";
import { validateField } from "./fields";
import { expandFormat } from "./format";
import { DEFAULT_CONFIG } from "../defaults";   // use the actual export name

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let at = obj;
  for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  at[keys[keys.length - 1]] = value;
}

export function resolve(
  master: Master, enabledVariations: string[], values: Record<string, FieldValue>,
): { config: LabelConfig; visibleFields: FieldDecl[]; errors: Record<string, string>; warnings: string[] } {
  const warnings: string[] = [];
  let config = deepMerge(DEFAULT_CONFIG, master.defaults as DeepPartial<LabelConfig>);
  const visibleFields = [...master.fields];
  for (const id of enabledVariations) {
    const v = master.variations.find((x) => x.id === id);
    if (!v) { warnings.push(`Unknown variation "${id}" — skipped.`); continue; }
    config = deepMerge(config, v.overrides as DeepPartial<LabelConfig>);
    visibleFields.push(...v.fields);
  }
  const errors: Record<string, string> = {};
  const strings: Record<string, string> = {};
  for (const f of visibleFields) {
    const raw = values[f.id];
    if (raw === undefined) continue;
    const r = validateField(f, raw);
    if (!r.ok) { errors[f.id] = r.error!; continue; }
    strings[f.id] = String(raw);
  }
  const out = config as unknown as Record<string, unknown>;
  for (const f of visibleFields) {
    if (f.format) {
      const { text, missing } = expandFormat(f.format, strings);
      if (missing.length === 0) setPath(out, f.path, text);
    } else if (strings[f.id] !== undefined) {
      const v = values[f.id];
      setPath(out, f.path, f.kind === "toggle" ? v === true : strings[f.id]);
    }
  }
  return { config, visibleFields, errors, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/model-resolve.test.ts` — expected PASS. Then the full gate: `npx vitest run && npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/model/resolve.ts tests/model-resolve.test.ts
git commit -m "Model: resolver collapsing master + variations + values to LabelConfig"
```

---

### Task 6: Rebinding report

**Files:**
- Create: `src/model/rebind.ts`
- Test: `tests/model-rebind.test.ts`

**Interfaces:**
- Consumes: `Master`, `LabelFileV2` from types.ts.
- Produces: `rebind(label: LabelFileV2, target: Master): { label: LabelFileV2; dropped: string[]; disabledVariations: string[] }` — pure; carries matching values, reports what the target has no field for; enabled variations missing on the target are disabled and reported.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-rebind.test.ts
import { describe, expect, it } from "vitest";
import { rebind } from "../src/model/rebind";
import type { LabelFileV2, Master } from "../src/model/types";

const target: Master = {
  formatVersion: 1, id: "m2", name: "Other Brewery",
  physical: { labelWidthIn: 8.125, labelHeightIn: 3.625, bleedIn: 0.125, canDiameterIn: 2.6 },
  defaults: {}, guides: { left: 24.12, center: "auto", right: 24.12, top: 24.12, bottom: 24.12 },
  fields: [{ id: "name", label: "Name", kind: "text", path: "beerName" }],
  variations: [{ id: "collab", name: "Collab", overrides: {}, layerOverrides: {}, fields: [] }],
};

const label: LabelFileV2 = {
  formatVersion: 2, masterId: "m1", enabledVariations: ["collab", "seasonal"],
  values: { name: "HAZY", untappd: "u/x" },
};

describe("rebind", () => {
  it("keeps matching values and retargets the master", () => {
    const r = rebind(label, target);
    expect(r.label.masterId).toBe("m2");
    expect(r.label.values.name).toBe("HAZY");
  });
  it("drops and reports values the target has no field for", () => {
    const r = rebind(label, target);
    expect(r.dropped).toEqual(["untappd"]);
    expect(r.label.values.untappd).toBeUndefined();
  });
  it("disables and reports variations the target lacks", () => {
    const r = rebind(label, target);
    expect(r.label.enabledVariations).toEqual(["collab"]);
    expect(r.disabledVariations).toEqual(["seasonal"]);
  });
  it("does not mutate the input label", () => {
    rebind(label, target);
    expect(label.masterId).toBe("m1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model-rebind.test.ts` — expected FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/model/rebind.ts — re-aim a .label at a different master (the
// cross-brewery collab flow). Values match by field ID — that is why field
// IDs are stable and human-readable; anything unmatched is REPORTED, never
// silently lost (spec: Resolution / rebinding).
import type { LabelFileV2, Master } from "./types";

export function rebind(
  label: LabelFileV2, target: Master,
): { label: LabelFileV2; dropped: string[]; disabledVariations: string[] } {
  const fieldIds = new Set(
    [...target.fields, ...target.variations.flatMap((v) => v.fields)].map((f) => f.id),
  );
  const values: LabelFileV2["values"] = {};
  const dropped: string[] = [];
  for (const [id, v] of Object.entries(label.values))
    (fieldIds.has(id) ? (values[id] = v) : dropped.push(id));
  const varIds = new Set(target.variations.map((v) => v.id));
  const enabledVariations = label.enabledVariations.filter((id) => varIds.has(id));
  const disabledVariations = label.enabledVariations.filter((id) => !varIds.has(id));
  return {
    label: { ...label, masterId: target.id, masterHint: undefined, enabledVariations, values },
    dropped, disabledVariations,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/model-rebind.test.ts` — expected PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/model/rebind.ts tests/model-rebind.test.ts
git commit -m "Model: rebind a .label against a different master with drop report"
```

---

### Task 7: Label file v2 read/write

**Files:**
- Create: `src/model/labelfile.ts`
- Test: `tests/model-labelfile.test.ts`

**Interfaces:**
- Consumes: `LabelFileV2` from types.ts.
- Produces: `parseLabelFile(json: unknown): LabelFileV2 | { legacy: unknown }` (a v1 file — no `formatVersion: 2` — is returned tagged `legacy` for Plan 5's migrator; garbage throws), `serializeLabelFile(l: LabelFileV2): string` (stable-ordered JSON).

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-labelfile.test.ts
import { describe, expect, it } from "vitest";
import { parseLabelFile, serializeLabelFile } from "../src/model/labelfile";
import type { LabelFileV2 } from "../src/model/types";

const v2: LabelFileV2 = {
  formatVersion: 2, masterId: "m1", masterHint: "lolev.master",
  enabledVariations: ["collab"], values: { name: "HAZY", abv: "6.2" },
};

describe("label file v2", () => {
  it("round-trips", () => {
    expect(parseLabelFile(JSON.parse(serializeLabelFile(v2)))).toEqual(v2);
  });
  it("tags a legacy v1 file instead of throwing", () => {
    const legacy = { version: 1, beerName: "OLD" };
    expect(parseLabelFile(legacy)).toEqual({ legacy });
  });
  it("throws a plain message on garbage", () => {
    expect(() => parseLabelFile({ formatVersion: 2 })).toThrow(/masterId/);
    expect(() => parseLabelFile("nope")).toThrow(/label file/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model-labelfile.test.ts` — expected FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/model/labelfile.ts — the v2 .label payload: master ref + variation
// toggles + field values BY ID ONLY, never layout (spec: ".label file" —
// that is what makes rebinding meaningful). Legacy v1 files (version: 1,
// embedded LabelConfig) are tagged for the migrator, not parsed here.
import type { LabelFileV2 } from "./types";

export function parseLabelFile(json: unknown): LabelFileV2 | { legacy: unknown } {
  if (!json || typeof json !== "object") throw new Error("Not a label file.");
  const o = json as Record<string, unknown>;
  if (o.formatVersion !== 2) return { legacy: json };   // v1 has {version: 1}
  if (typeof o.masterId !== "string" || !o.masterId)
    throw new Error("Label file is missing its masterId.");
  return {
    formatVersion: 2,
    masterId: o.masterId,
    masterHint: typeof o.masterHint === "string" ? o.masterHint : undefined,
    enabledVariations: Array.isArray(o.enabledVariations) ? (o.enabledVariations as string[]) : [],
    values: (o.values && typeof o.values === "object" ? o.values : {}) as LabelFileV2["values"],
  };
}

export function serializeLabelFile(l: LabelFileV2): string {
  return JSON.stringify(
    { formatVersion: 2, masterId: l.masterId, masterHint: l.masterHint,
      enabledVariations: l.enabledVariations, values: l.values },
    null, 2,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/model-labelfile.test.ts` — expected PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/model/labelfile.ts tests/model-labelfile.test.ts
git commit -m "Model: v2 .label parse/serialize with legacy tagging"
```

---

### Task 8: Lolev master fixture — the coverage bridge

Proves the model can express today's product: a Master whose resolution
reproduces the shipped Lolev defaults exactly, with collab as a variation.
This is the Plan-1 slice of the spec's print-output invariant (the full
golden PDF/PSD test lands in Plan 5 when rendering routes through resolve).

**Files:**
- Create: `src/model/lolev.ts`
- Test: `tests/model-lolev.test.ts`

**Interfaces:**
- Consumes: `Master` (types.ts), `resolve` (resolve.ts), `DEFAULT_CONFIG` (src/defaults.ts — same export name Task 5 settled on).
- Produces: `lolevMaster(): Master` — fields: `name`→`beerName`, `style`→`styleLine.text`, `abv`→`abv` (number 0–20), `description`→`description`, `upc`→`upc` (code/upc-a); variation `collab` with `overrides: { collabEnabled: true }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/model-lolev.test.ts
import { describe, expect, it } from "vitest";
import { lolevMaster } from "../src/model/lolev";
import { resolve } from "../src/model/resolve";
import { DEFAULT_CONFIG } from "../src/defaults";   // Task 5's settled name

describe("lolevMaster", () => {
  it("resolves with no variations/values to exactly the shipped defaults", () => {
    expect(resolve(lolevMaster(), [], {}).config).toEqual(DEFAULT_CONFIG);
  });
  it("collab variation flips only collabEnabled", () => {
    const base = resolve(lolevMaster(), [], {}).config;
    const collab = resolve(lolevMaster(), ["collab"], {}).config;
    expect(collab.collabEnabled).toBe(true);
    expect({ ...collab, collabEnabled: base.collabEnabled }).toEqual(base);
  });
  it("fills a typical label", () => {
    const r = resolve(lolevMaster(), [], { name: "HAZY", abv: "6.2", upc: "036000291452" });
    expect(r.errors).toEqual({});
    expect(r.config.beerName).toBe("HAZY");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/model-lolev.test.ts` — expected FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// src/model/lolev.ts — today's Lolev product expressed as a Master: empty
// defaults (DEFAULT_CONFIG already IS the Lolev label), the well-known field
// set, and collab as a plain variation. Doubles as the migration seed and
// the proof the model expresses the existing product (spec: Migration).
import type { Master } from "./types";

export function lolevMaster(): Master {
  return {
    formatVersion: 1,
    id: "lolev",
    name: "Lolev",
    // Mirror src/layout.ts's real TRIM / MEASURED_BLEED constants at
    // implementation time (read them; do not invent numbers) and note the
    // source constants here.
    physical: { labelWidthIn: 8.125, labelHeightIn: 3.625, bleedIn: 0.125, canDiameterIn: 2.6 },
    defaults: {},   // DEFAULT_CONFIG is the Lolev label; nothing to override
    guides: { left: 24.12, center: "auto", right: 24.12, top: 24.12, bottom: 24.12 },
    fields: [
      { id: "name", label: "Beer name", kind: "text", path: "beerName" },
      { id: "style", label: "Style", kind: "text", path: "styleLine.text" },
      { id: "abv", label: "ABV", kind: "number", path: "abv", min: 0, max: 20 },
      { id: "description", label: "Description", kind: "text", path: "description" },
      { id: "upc", label: "UPC", kind: "code", symbology: "upc-a", path: "upc" },
    ],
    variations: [
      { id: "collab", name: "Collab", overrides: { collabEnabled: true }, layerOverrides: {}, fields: [] },
    ],
  };
}
```

- [ ] **Step 4: Run test + full gate**

Run: `npx vitest run && npx tsc --noEmit` — everything green.

- [ ] **Step 5: Commit**

```bash
git add src/model/lolev.ts tests/model-lolev.test.ts
git commit -m "Model: Lolev master fixture proving resolution matches shipped defaults"
```

---

## Done means

`src/model/` contains the complete pure core (types, format, merge, fields,
resolve, rebind, labelfile, lolev) with one test file each; nothing outside
`src/model/` and `tests/` changed; full suite and typecheck green. Plans 2–5
wire layers, UI, compliance, and migration onto this base.
