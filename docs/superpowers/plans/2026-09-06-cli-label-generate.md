# CLI generate from `.master` + layer inputs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **As built (2026-09-07, PR #58):** landed with these deltas from the text below —
> the library is `scripts/generate-lib.ts`, not `src/generate.ts` (keeps it out of the
> desktop bundle); `FormatSet` is `"pdf" | "psd" | "all"`; the generate args carry a
> `source: {kind:"values", path?} | {kind:"label", path}` union instead of
> `valuesPath`/`labelPath`; a batch is validated, read and built whole before the
> first write; job `overrides` are type-checked per field; `titleOf`/`exportBase`/
> `PAGE_ART_ID` live in `src/model`. `tests/generate.test.ts` is the contract.

**Goal:** Let a script generate print-ready label PDFs (and PSDs) from a `.master` file plus a JSON of layer values, using the same resolve → plan → build path the app already uses.

**Architecture:** Extract a DOM-free `src/generate.ts` library (the generate component) that turns `(Master, values, assets)` into file bytes. Keep `scripts/generate.ts` as the `npm run generate` IO wrapper. Do not rewire `App.tsx` exports; the browser already has its own font/image loaders. No new npm dependencies — roll argv the way `scripts/golden-diff.mts` does.

**Tech Stack:** TypeScript, vitest, tsx, existing `unpackMaster` / `resolveLayers` / `planLayers` / `buildArtPdf` / `buildMaskPdf` / `buildPsd`. pngjs for Node raster decode (already a dep).

**Spec:** CLI contract is this plan. Model/render contract is `docs/superpowers/specs/2026-09-04-master-as-layers-design.md`. Fill values are `LabelFile.values` (`src/model/layers.ts`).

**Worktree:** `.agents/worktrees/cli-generate` on `feat/cli-generate`, branched from `origin/main` at `2463e00`. Do not edit `main`, `fix/last-applied-master`, or `.agents/worktrees/right-sidebar`. `pwd` + `git branch --show-current` before the first edit. The committed copy of this plan is `docs/superpowers/plans/2026-09-06-cli-label-generate.md` in that worktree.

## Global Constraints

- No new npm dependencies (`commander`/`yargs` are out).
- Source files stay single lowercase words with a `// filename — purpose` header.
- Pure logic stays DOM-free (`src/generate.ts`); `scripts/generate.ts` is argv + fs + exit codes only.
- Tests live in `tests/generate.test.ts` (and stay under `tests/` so vitest's `test.dir` picks them up).
- TDD: failing test first, then the code, then `npx vitest run tests/generate.test.ts`, then full `npx vitest run` + `npx tsc --noEmit` at each task commit.
- Commits: one capitalized summary line, no conventional-commit types, no Co-Authored-By.
- Do not import `src/generate.ts` from `App.tsx` / `src/main.tsx`. This change is **not binary-impacting** (CLI + tests + docs only; Vite graph unchanged) — no version bump, no CHANGELOG desktop section. Record that classification in the PR.
- Fail-fast: unknown layer ids in CLI values are errors (unlike `.label` rebind, which parks them as dormant). Unknown `--variant` is an error. `resolveLayers` errors are fatal.
- Preserve the old positional argv used by `docs/goldens.md` (`texture mask outDir [config.json]`).

---

## What already exists (reuse, do not rebuild)

| Sub-problem | Existing code | Plan uses it |
|---|---|---|
| Unpack `.master` ZIP / legacy JSON | `unpackMaster` in `src/model/files.ts` | yes |
| Unpack `.label` | `unpackLabel` in `src/model/files.ts` | yes (`--label`) |
| Resolve master + variants + values | `resolveLayers` in `src/model/resolveLayers.ts` | yes |
| Markdown → lines | `parseDescription` in `src/description.ts` (convert.ts has a Lolev-id-only private `textLines`; do not reuse that — CLI is generic) | yes, via a new generic coerce |
| String → one text line | `widenValue` in `src/model/resolveLayers.ts` | yes, for `input: "number" \| "code"` |
| Guide math from master.physical | `guideLines` in `src/model/convert.ts` | yes (current `scripts/generate.ts` skips this — fix it) |
| Display list | `planLayers` in `src/planLayers.ts` | yes |
| PDF/PSD builders | `src/pdf/build.ts`, `src/psd/build.ts` | yes |
| Font catalog (Node-safe filenames) | `FONT_FAMILIES` in `src/fontCatalog.ts` | yes, load every family the plan actually uses |
| Raster kind / tint | `rasterKind`, `tintRgba` in `src/collab.ts` | yes |
| Headless build today | `scripts/generate.ts` | replace internals; keep the npm script and old argv |
| Test fonts / content-stream asserts | `tests/fixtures.ts` | yes |
| Argv style | `parseArgs` in `scripts/golden-diff.mts` | mirror the `--name=value` / `--name value` / unknown-flag-throws pattern |

`scripts/generate.ts` already calls `convertConfigV1` → `resolveLayers(lolevMaster(), …)` → `planLayers` → the four builders. It is stuck on the v1 config + hardcoded Lolev master + texture/mask paths. This plan teaches that same pipeline to take a `.master` and layer values.

## User-facing CLI

```bash
# Primary: a .master plus layer values
npm run generate -- beer.master values.json ./out
npm run generate -- --master beer.master --values values.json --out ./out
npm run generate -- --master beer.master --values - --out ./out          # stdin
npm run generate -- --master beer.master --out ./out                     # master defaults / placeholders

# Variants, extra image files, format subset
npm run generate -- beer.master values.json ./out --variant collab \
  --asset collabLeft=./partner.svg --format pdf

# A saved .label is also "layer inputs" (values + variants + overrides + embedded art)
npm run generate -- --master beer.master --label run.label --out ./out

# Discover the fill contract (JSON on stdout, exit 0)
npm run generate -- beer.master --inspect

# Legacy (goldens.md / old scripts) — still works
npm run generate -- <texture|none> <mask.png|none> <outDir> [config.json] \
  [--collab-left=…] [--collab-center=…]
```

`npm run generate` stays the entry. No `bin` field, no published package.

### Layer-values JSON

A single job:

```json
{
  "name": "Labradorite",
  "styleLine": "Hazy India Pale Ale",
  "abv": "6.5",
  "description": "# HOPS\nCitra, Mosaic\n_dry hopped_",
  "barcode": "850051366224"
}
```

Or an explicit job object (needed when variants/files/overrides travel with the values):

```json
{
  "variants": ["collab"],
  "values": { "name": "Labradorite", "barcode": "850051366224" },
  "files": { "collabLeft": "./partner.svg" },
  "overrides": { "name": { "size": 18 } }
}
```

Or a batch (array). Each job writes its own `{basename}.pdf` etc. Duplicate basenames in one run are a hard error.

Keys are **layer ids** from the master (`name`, `abv`, `description`, `barcode`, …), not the old v1 config keys (`beerName`, `upc`). `--inspect` prints those ids.

### Coercion rules (the CLI's one extra job above `resolveLayers`)

| Raw JSON | Layer | Becomes |
|---|---|---|
| `string` / `number` | text with `input: "number"` or `"code"` | one plain line via `widenValue` (number stringified) |
| `string` | any other text | `parseDescription(src, layer.style)` → `TextLine[]` (header + body + `_white_` / `**bold**`) |
| `TextLine[]` | text | passed through |
| `string` | barcode / qr | `value` |
| `string` | image | asset id (bytes come from the master ZIP or `--asset` / job `files`) |
| anything else | — | error naming the layer id |

`--set name=Labradorite` overlays the values object after JSON load (repeatable). `--asset layerId=path` overlays job `files`.

### Outputs

Default `--format all` writes the same four files as today:

- `{basename}.pdf` / `{basename}-mask.pdf`
- `{basename}.psd` / `{basename}-mask.psd`

`--format pdf` skips PSDs; `--format psd` skips PDFs. `basename` is `machineName(titleOf(layers))` where `titleOf` is the `name` text layer's plain text, falling back to `"label"`.

Exit codes match `golden-diff`: **0** ok, **1** validation/resolve/build, **2** usage.

Warnings (unknown *dormant* is not a CLI thing — unknown ids fail) go to stderr. `resolveLayers` warnings (e.g. format refs) also stderr; they do not fail the run unless `errors` is non-empty.

## Data flow

```
  argv
    │
    ├─ --inspect ── unpackMaster ── inspectMaster ── stdout JSON ── exit 0
    │
    ├─ legacy argv ── parseConfigFile ── convertConfigV1 ──┐
    │                                                     │
    └─ new argv ── unpackMaster / unpackLabel             │
                     coerceValues / files                 │
                     unknown id/variant? ── error, exit 1 │
                                          │               │
                                          ▼               ▼
                              GenerateInput ── buildLabel
                                          │
                    setBleed(master.physical.bleedIn)
                    resolveLayers(master, variants, values, overrides)
                    errors? ── throw, exit 1
                    bind page-art assets (texture/mask)
                    load fonts used by the plan from src/assets/fonts
                    planLayers(layers, pdfMeasure, { logoSvg, guides, custom })
                    buildArtPdf / buildMaskPdf / buildPsd
                                          │
                                          ▼
                              write {basename}.{pdf,psd} to --out
```

Shadow paths:

- **Missing master:** usage, exit 2 (or "file not found", exit 1).
- **Empty values `{}`:** legal — master placeholders / default lines, QR still expands `{name\|slug}` through the placeholder.
- **Bad UPC / number out of range:** `resolveLayers.errors`, exit 1, message includes the layer id.
- **Image not png/jpg/svg:** exit 1 (Node has no WebP decoder; the browser transcodes, the CLI does not). Mask must be PNG, same as today.
- **Batch name collision:** exit 1 before writing the colliding job (jobs already written stay; document that — or write to a temp dir and publish at the end? Prefer: compute all basenames first, fail if any collide, then write. No partial output on collision.)

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/generate.ts` | CREATE | DOM-free generate component: argv parse, inspect, coerce, assemble, build |
| `tests/generate.test.ts` | CREATE | argv, coerce, inspect, assemble, one real PDF smoke |
| `scripts/generate.ts` | UPDATE | Thin IO: read files, call `buildLabel` / `inspectMaster`, write, exit |
| `README.md` | UPDATE | Replace the headless usage block (~line 331) with the new CLI |
| `docs/goldens.md` | UPDATE | Show both the legacy argv (still valid) and the equivalent `--master` form |

Do **not** move `withPageArt` out of `App.tsx` in this change. The CLI binds page art the way `scripts/generate.ts` already does: as `resolveLayers` overrides `{ background: { asset: "texture" }, mask: { asset: "mask" } }` when those bytes exist. `PAGE_ART_ID` stays `{ background: "texture", mask: "mask" }` as a constant inside `src/generate.ts`.

## NOT in scope

- Rewiring `App.tsx` `buildFull` / `exportPsd` onto `buildLabel` (browser font loader is `src/fonts.ts` + `fetch`; Node reads TTF paths). Follow-up if the two pipelines drift.
- Custom page width/height from `master.physical` (layout.ts `PAGE` is still the Lolev 8×5 + bleed; only `setBleed(master.physical.bleedIn)` is applied).
- CSV / spreadsheet batch (JSON array is the batch form).
- `--values-dir`, watch mode, HTTP, `package.json` `"bin"`.
- Publishing a package; adding commander.
- CMYK (`tools/to-cmyk.sh` stays a separate step).
- Writing a `.label` as output (this CLI prints, it does not save projects).
- Changing dormant-value semantics inside `resolveLayers` (CLI rejects unknown ids *before* calling it).

---

### Task 1: Argv parser

**Files:**
- Create: `src/generate.ts` (parser + `USAGE` only at this step)
- Test: `tests/generate.test.ts`

**Interfaces:**
- Produces: `parseGenerateArgs(argv: string[]): GenerateArgs`
- `GenerateArgs` is a discriminated union: `{ mode: "legacy"; … } | { mode: "generate"; … } | { mode: "inspect"; … }`

```ts
export type FormatSet = { pdf: boolean; psd: boolean };

export type GenerateArgs =
  | {
      mode: "legacy";
      texturePath: string; // "none" or a file
      maskPath: string;
      outDir: string;
      configPath?: string;
      collabLeft?: string;
      collabCenter?: string;
    }
  | {
      mode: "inspect";
      masterPath?: string; // absent = shipped Lolev
    }
  | {
      mode: "generate";
      masterPath?: string; // absent = shipped Lolev
      valuesPath?: string; // "-" = stdin, absent = {}
      labelPath?: string;
      outDir: string;
      variants: string[];
      assets: Record<string, string>; // layerId → path
      set: Record<string, string>;    // --set overlays
      format: FormatSet;
    };
```

Mode selection (lock this; tests pin it):

1. `--inspect` present → `inspect`. Master from `--master` or first positional ending in `.master`.
2. Else if `--master`, `--values`, `--label`, or the first positional ends with `.master` → `generate`.
3. Else if ≥3 positionals → `legacy` (`texture mask outDir [config.json]`).
4. Else throw `USAGE`.

Flag rules, copied from `scripts/golden-diff.mts:276-299`: `--name=value` or `--name value`; unknown flag throws; `--variant` and `--asset` and `--set` are repeatable (`--asset` value is `layerId=path`). `--format` is `pdf`, `psd`, or `all` (default `all`). `--label` and `--values` together throw. `generate` without `--out` / a trailing out positional throws.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { parseGenerateArgs } from "../src/generate";

describe("parseGenerateArgs", () => {
  it("new form: positional master + values + out", () => {
    expect(parseGenerateArgs(["beer.master", "v.json", "out"])).toEqual({
      mode: "generate", masterPath: "beer.master", valuesPath: "v.json",
      outDir: "out", variants: [], assets: {}, set: {}, format: { pdf: true, psd: true },
    });
  });

  it("new form: flags, stdin values, one variant, one asset, pdf only", () => {
    expect(parseGenerateArgs([
      "--master", "beer.master", "--values", "-", "--out", "out",
      "--variant", "collab", "--asset", "collabLeft=./a.svg", "--format", "pdf",
    ])).toMatchObject({
      mode: "generate", valuesPath: "-", variants: ["collab"],
      assets: { collabLeft: "./a.svg" }, format: { pdf: true, psd: false },
    });
  });

  it("inspect", () => {
    expect(parseGenerateArgs(["beer.master", "--inspect"])).toEqual({
      mode: "inspect", masterPath: "beer.master",
    });
  });

  it("legacy positional still parses", () => {
    expect(parseGenerateArgs(["none", "none", "out", "cfg.json", "--collab-left=a.svg"]))
      .toMatchObject({ mode: "legacy", texturePath: "none", maskPath: "none",
        outDir: "out", configPath: "cfg.json", collabLeft: "a.svg" });
  });

  it("unknown flag throws USAGE", () => {
    expect(() => parseGenerateArgs(["beer.master", "v.json", "out", "--bogus"]))
      .toThrow(/usage/i);
  });

  it("--label and --values together throw", () => {
    expect(() => parseGenerateArgs(["--master", "m.master", "--label", "a.label",
      "--values", "v.json", "--out", "out"])).toThrow(/--label/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/generate.test.ts` → cannot find `../src/generate`.
- [ ] **Step 3: Implement `parseGenerateArgs` + `USAGE`** in `src/generate.ts`. Header: `// generate.ts — DOM-free headless generate: argv, inspect, coerce, build.`
- [ ] **Step 4: Tests pass.**
- [ ] **Step 5: Commit** — `Generate: parse npm run generate argv for .master jobs`

---

### Task 2: Coerce layer values

**Files:**
- Modify: `src/generate.ts`
- Test: `tests/generate.test.ts`

**Interfaces:**
- Consumes: `Master` from `src/model/layers.ts`, `widenValue` from `src/model/resolveLayers.ts`, `parseDescription` from `src/description.ts`
- Produces:

```ts
export function coerceValues(
  master: Master,
  raw: Record<string, unknown>,
  enabledVariants: string[],
): { values: Record<string, LayerValue>; errors: Record<string, string> };

export function parseJobs(json: unknown): JobInput[]; // 1 job from object, N from array

export interface JobInput {
  values: Record<string, unknown>;
  variants?: string[];
  files?: Record<string, string>;
  overrides?: LabelFile["overrides"];
}
```

`parseJobs`:

- Array → one job per element (each element is either a values-map or a job object).
- Object with `values` key → one job object.
- Plain object (layer-id keys) → one job `{ values: object }`.
- Anything else → throw `"values JSON must be an object or an array of jobs"`.

A values-map vs job-object: treat as job-object iff it has `values` and every other key is in `{ variants, files, overrides, values }`. A label whose layer is literally named `values` is not a thing we support as a bare map key at the same time — if that ever happens they use the explicit job object.

`coerceValues` layer lookup: master.layers plus layers each enabled variant *adds* (ids the master lacks). `--variant nope` is **not** this function's job (Task 3 rejects unknown variant ids against `master.variants`).

Unknown raw key → `errors[id] = 'Unknown layer "id".'`.

Text markdown helper (generic, not convert.ts's description-only `textLines`):

```ts
function linesFromText(src: string, base: Style): TextLine[] {
  const d = parseDescription(src, base);
  const out: TextLine[] = [];
  if (d.header) out.push({ ...d.header, header: true });
  for (const l of d.lines) out.push(l);
  return out;
}
```

- [ ] **Step 1: Failing tests** against `lolevMaster()`:

```ts
import { lolevMaster } from "../src/model/lolevLayers";
import { coerceValues, parseJobs } from "../src/generate";

describe("parseJobs", () => {
  it("plain values object is one job", () => {
    expect(parseJobs({ name: "X" })).toEqual([{ values: { name: "X" } }]);
  });
  it("array is a batch", () => {
    expect(parseJobs([{ values: { name: "A" } }, { name: "B" }]))
      .toEqual([{ values: { name: "A" } }, { values: { name: "B" } }]);
  });
});

describe("coerceValues", () => {
  const m = lolevMaster();
  it("plain name string becomes one styled line", () => {
    const r = coerceValues(m, { name: "Labradorite" }, []);
    expect(r.errors).toEqual({});
    expect(r.values.name).toEqual([
      expect.objectContaining({ text: "Labradorite" }),
    ]);
  });
  it("description markdown keeps header and white-ink lines", () => {
    const r = coerceValues(m, { description: "# HOPS\n_dry hopped_" }, []);
    expect(r.values.description).toEqual([
      expect.objectContaining({ text: "HOPS", header: true }),
      expect.objectContaining({ text: "dry hopped", layer: "white" }),
    ]);
  });
  it("abv number stringifies; barcode stays a string", () => {
    const r = coerceValues(m, { abv: 6.5, barcode: "850051366224" }, []);
    expect(r.values.abv).toEqual([expect.objectContaining({ text: "6.5" })]);
    expect(r.values.barcode).toBe("850051366224");
  });
  it("unknown layer id is an error, not dormant", () => {
    const r = coerceValues(m, { nam: "X" }, []);
    expect(r.errors.nam).toMatch(/unknown layer/i);
    expect(r.values).toEqual({});
  });
  it("collabLeft is unknown until the collab variant is enabled", () => {
    expect(coerceValues(m, { collabLeft: "a" }, []).errors.collabLeft).toMatch(/unknown/i);
    expect(coerceValues(m, { collabLeft: "a" }, ["collab"]).errors).toEqual({});
  });
});
```

- [ ] **Step 2: Run — fail on missing exports.**
- [ ] **Step 3: Implement `parseJobs` + `coerceValues`.**
- [ ] **Step 4: Tests pass.** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `Generate: coerce JSON layer values onto a master`

---

### Task 3: Inspect + assemble a GenerateInput

**Files:**
- Modify: `src/generate.ts`
- Test: `tests/generate.test.ts`

**Interfaces:**

```ts
export interface InspectReport {
  id: string;
  name: string;
  fontFamily: FontFamilyId;
  variants: { id: string; name: string }[];
  layers: {
    id: string;
    name: string;
    kind: LayerKind;
    input?: TextLayer["input"];
    symbology?: string;
    placeholder?: string;
    role?: "background" | "mask";
    variant?: string; // id of the variant that adds this layer, if any
  }[];
}

export function inspectMaster(master: Master): InspectReport;

export const PAGE_ART_ID = { background: "texture", mask: "mask" } as const;

export interface GenerateInput {
  master: Master;
  masterAssets: MasterAssets;          // from unpackMaster
  values: Record<string, LayerValue>;
  enabledVariants: string[];
  overrides?: LabelFile["overrides"];
  extraImages: Record<string, { name: string; bytes: Uint8Array }>; // by layer id
  format: FormatSet;
  assetRoot: string;                   // repo `src/assets`
}

export function assertVariants(master: Master, ids: string[]): void; // throws listing unknown ids
```

`inspectMaster` lists `master.layers` then, for each variant, the ids that variant *adds* (not overrides), tagged `variant: variant.id`. Lolev `--inspect` therefore includes `collabLead` / `collabLeft` / `collabCenter` under `collab`.

- [ ] **Step 1: Failing tests**

```ts
it("inspectMaster lists Lolev fill layers and the collab additions", () => {
  const r = inspectMaster(lolevMaster());
  expect(r.id).toBe("lolev");
  expect(r.layers.map((l) => l.id)).toContain("name");
  expect(r.layers.find((l) => l.id === "abv")?.input).toBe("number");
  expect(r.layers.find((l) => l.id === "collabLeft")).toMatchObject({
    kind: "image", variant: "collab",
  });
});

it("assertVariants throws on typos", () => {
  expect(() => assertVariants(lolevMaster(), ["collab", "nope"]))
    .toThrow(/nope/);
});
```

- [ ] **Step 2–4: Implement, pass, typecheck.**
- [ ] **Step 5: Commit** — `Generate: inspect a master's fill contract`

---

### Task 4: `buildLabel` — resolve, plan, encode

**Files:**
- Modify: `src/generate.ts`
- Test: `tests/generate.test.ts` (smoke) — reuse `tests/fixtures.ts` fonts / `contentStreamText` / `onePxPng`

**Interfaces:**

```ts
export interface GenerateFile { name: string; bytes: Uint8Array }

export interface GenerateResult {
  title: string;
  basename: string;
  warnings: string[];
  files: GenerateFile[];
}

export async function buildLabel(input: GenerateInput): Promise<GenerateResult>;
```

Implementation sketch (this is the body `scripts/generate.ts` already has, generalized):

1. `assertVariants`; `setBleed(input.master.physical.bleedIn)`.
2. Page-art overrides: if `masterAssets.texture` or `extraImages.background`, set `overrides.background.asset = PAGE_ART_ID.background`; same for mask. Empty string when neither source has bytes (bare stock / white-ink flood).
3. Image extras: for each `extraImages[layerId]`, mint a stable asset id `cli-${layerId}` (deterministic — **not** `crypto.randomUUID`, so tests can pin) and override that layer's `asset`.
4. `resolveLayers(master, enabledVariants, values, overrides)`. If `errors` is non-empty, `throw new Error(Object.entries(errors).map(([id, e]) => `${id}: ${e}`).join("\n"))`.
5. Title: plain text of the `name` text layer, else `""`. Basename: `machineName(title) || "label"`.
6. Load `logo2025.svg` from `assetRoot`. Load TTF bytes for `master.fontFamily ?? "poppins"` plus every text layer's `fontFamily` via `FONT_FAMILIES[id].files`.
7. Build `images: Record<string, CollabImage>`:
   - `texture` / `mask` from masterAssets + extraImages (mask must be PNG; throw otherwise)
   - `customImages` from the master ZIP, keyed by their existing ids
   - extraImages under `cli-${layerId}`
   - SVG vs raster via `rasterKind` / `.svg`; tint PNG when the resolved layer has `tintRaster` (same warning as today for JPEG + tint)
8. Plan assets: `{ logoSvg, guides: guideLines(master), custom: { [id]: { aspect, art? } } }`. Aspect from pdf-lib embed (png/jpg) or `1` for SVG (matches current generate.ts).
9. Measure with pdf-lib + fontkit, same as `tests/fixtures.ts` `pdfMeasure`, but with every loaded family (the `MeasureFace` 4th argument is `family?: FontFamilyId` — pass it through).
10. `planLayers` → `buildArtPdf` / `buildMaskPdf` / `buildPsd` according to `format`. PSD rasters: pngjs decode; JPEG extra images warn and omit from PSD (today's behavior).
11. Sequential embeds, not `Promise.all`, when feeding pdf-lib (learnings.md: parallel embedPng makes bytes nondeterministic). The builders themselves already control embed order; do not parallelize jobs' `buildArtPdf`+`buildMaskPdf` if that reorders XObjects — today's generate.ts awaits art then mask sequentially. Keep that.
12. Return files named `{basename}.pdf`, `{basename}-mask.pdf`, `{basename}.psd`, `{basename}-mask.psd` as requested by `format`.

- [ ] **Step 1: Failing smoke tests**

```ts
it("buildLabel writes an art PDF whose stream contains the filled name", async () => {
  const result = await buildLabel({
    master: lolevMaster(),
    masterAssets: {},
    values: coerceValues(lolevMaster(), { name: "Labradorite", barcode: "850051366224" }, []).values,
    enabledVariants: [],
    extraImages: {},
    format: { pdf: true, psd: false },
    assetRoot: join(import.meta.dirname, "..", "src", "assets"),
  });
  expect(result.basename).toBe("labradorite");
  const art = result.files.find((f) => f.name === "labradorite.pdf");
  expect(art).toBeTruthy();
  expect(await contentStreamText(art!.bytes)).toMatch(/LABRADORITE/); // uppercase layer
});

it("invalid UPC fails loudly", async () => {
  await expect(buildLabel({
    /* same scaffolding, barcode: "123" */
  })).rejects.toThrow(/barcode/i);
});
```

Fill in the scaffolding from the first test. Use a real valid UPC (`850051366224`, the Labradorite / tests pin).

- [ ] **Step 2: Run — fail on missing `buildLabel`.**
- [ ] **Step 3: Implement.** Port collab-image loading / pngjs PSD decode from current `scripts/generate.ts` rather than inventing a second copy.
- [ ] **Step 4: `npx vitest run tests/generate.test.ts` green.** Then `npx vitest run` full suite + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `Generate: build PDFs from a master and layer values`

---

### Task 5: Wire `scripts/generate.ts` as IO

**Files:**
- Modify: `scripts/generate.ts` (replace the body; keep the file — `package.json` `"generate": "tsx scripts/generate.ts"`)
- Modify: `tests/generate.test.ts` — add `runGenerate` tests with a temp dir **or** test a exported `mainForTest` that takes `{ argv, readStdin, readFile, writeFile, mkdir, stdout, stderr }` so we do not spawn. Prefer the injected-IO function in `src/generate.ts`:

```ts
export async function runGenerate(opts: {
  argv: string[];
  cwd: string;
  stdin?: string;
  readFile: (p: string) => Uint8Array;
  readFileText: (p: string) => string;
  writeFile: (p: string, bytes: Uint8Array) => void;
  mkdir: (p: string) => void;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}): Promise<number>; // exit code
```

`scripts/generate.ts` becomes:

```ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { runGenerate } from "../src/generate";

const code = await runGenerate({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  stdin: process.argv.includes("-") || process.argv.includes("--values=-")
    ? await new Response(process.stdin).text() : undefined,
  readFile: (p) => readFileSync(p),
  readFileText: (p) => readFileSync(p, "utf8"),
  writeFile: (p, b) => writeFileSync(p, b),
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
process.exit(code);
```

Stdin detection: valuesPath `=== "-"`. Reading stdin in the script is fine; `runGenerate` just receives `opts.stdin`.

`runGenerate` responsibilities:

- parse argv (catch → stderr USAGE, return 2)
- inspect: unpack master (missing path → shipped `lolevMaster()`), print `JSON.stringify(inspectMaster(m), null, 2) + "\n"`, return 0
- generate:
  - unpack master from disk or shipped
  - load values JSON / `--label` via `unpackLabel` (v3 only for v1; if `v2`/`legacy`, run existing converters — `parseLabel` + `convertLabelV2` / `convertConfigV1`. If that's more than a screen of code, **v3 `.label` only** and throw `"this CLI opens v3 .label files; open and re-save in Label Lab first"` — YAGNI. Lock: **v3 `.label` only**. Legacy config.json stays on the legacy argv path.)
  - merge `--set` into each job's values, `--asset` into each job's files, `--variant` as default variants when the job omits them
  - coerce; any errors → stderr, return 1
  - read extra image files (paths resolved against `cwd`)
  - compute all basenames (need a cheap resolve pass, or coerce + `machineName` of the `name` value). Collision → return 1, no writes
  - `mkdir(outDir)`; `buildLabel` per job; write files; log `wrote … (NMB)` like today
- legacy: keep current behavior by building a `GenerateInput` from `convertConfigV1` + texture/mask/collab paths so both paths share `buildLabel`. Do not leave a second builder in `scripts/generate.ts`.

Shipped master with no `--master`: `lolevMaster()`, `masterAssets: {}`. Texture/mask then come only from `--asset background=` / `--asset mask=` or legacy positionals.

- [ ] **Step 1: Failing tests for `runGenerate`** with in-memory fs (a `Map<string, Uint8Array>`). Cover: inspect stdout JSON has `"name"`; generate writes `out/labradorite.pdf`; unknown variant returns 1; legacy `none none out` still returns 0 and writes four files named from the default config beer name (`"New Beer"` → `new-beer.pdf` — check `defaultConfig()`).
- [ ] **Step 2–4: Implement, pass, full vitest + tsc.**
- [ ] **Step 5: Commit** — `Generate: npm run generate drives the master/values CLI`

---

### Task 6: Docs

**Files:**
- Modify: `README.md` (the "Headless" block around line 331)
- Modify: `docs/goldens.md` (re-baseline procedure still shows the legacy argv; add one equivalent `--master` line so future goldens can use either)

README replacement:

```markdown
Headless (same renderer as the app; a `.master` plus layer values):

```bash
npm run generate -- beer.master values.json ./out
# writes {name}.pdf, {name}-mask.pdf, {name}.psd, {name}-mask.psd

npm run generate -- beer.master --inspect
# prints the master's layer ids (the keys values.json uses)
```

`values.json` is keyed by layer id (`name`, `abv`, `description`, `barcode`, …).
Text layers accept a string (markdown subset for rich layers: `# header`,
`**bold**`, `_white ink_`). Enable variants with `--variant collab`; attach
image files with `--asset collabLeft=./logo.svg`. `--format pdf` skips PSDs.

The older texture/mask/config.json argv still works for golden re-baselines.
```

- [ ] **Step 1:** No test. Edit the two docs.
- [ ] **Step 2:** Commit — `Docs: headless generate from a .master`

---

## Validation

```bash
npx tsc --noEmit
npx vitest run tests/generate.test.ts
npx vitest run
# smoke, from the worktree:
npm run generate -- --inspect
npm run generate -- none none /tmp/label-cli-legacy
# then a .master + values.json once a fixture exists in the test (or a tiny sample in /tmp)
node scripts/check-release.mjs origin/main
# expected: not binary-impacting (src/generate.ts is not in the Vite graph).
# If the checker disagrees because it treats any src/ file as app code, move
# generate.ts to scripts/generate-lib.ts rather than bump a desktop version.
```

Release steward: classify **not binary-impacting**. If `check-release.mjs` flags `src/generate.ts`, relocate the library to `scripts/generate-lib.ts` (tests import that path) — do not ship a desktop version for a CLI-only module.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Parallel PDF embeds nondeterminism | Med (already bitten) | Sequential `buildArtPdf` then `buildMaskPdf`; no `Promise.all` on embeds |
| Legacy argv silently mis-detected as new | Med | First positional must end in `.master` or flags must opt in; `none` stays legacy |
| Description markdown vs one-line text surprise | Low | `--inspect` shows `input`; number/code stay one line; tests pin description headers |
| JPEG collab logo in PSD omitted | Low (existing) | Keep the stderr warning |
| `setBleed` mutates process-global layout | Low for CLI (one process per run); batch jobs share one master | Document that a batch is one master; do not mix masters in one argv |
| Unknown values parked dormant if we forget the CLI check | High impact | Task 2 test `"nam"`; never call `resolveLayers` until coerce is clean |

## Acceptance

- [ ] `npm run generate -- beer.master values.json out` writes the four print files from a real `.master` and layer-id JSON
- [ ] `--inspect` prints layer ids a script can key
- [ ] `--variant`, `--asset`, `--format pdf`, stdin values, JSON array batch all covered by tests
- [ ] Unknown layer id / unknown variant / bad UPC exit 1 with the id in the message
- [ ] `npm run generate -- none none out` still works (legacy)
- [ ] `npx tsc --noEmit` clean, full vitest green
- [ ] README + goldens.md updated
- [ ] No desktop version bump
- [ ] Plan committed on the feature branch as `docs/superpowers/plans/2026-09-06-cli-label-generate.md` (this document)

## Patterns to mirror

| Category | Source | Pattern |
|---|---|---|
| Naming | `src/upc.ts`, `src/maskimage.ts` | single-word file, camelCase exports, header comment |
| Argv | `scripts/golden-diff.mts:276` | hand-rolled `--flag=value`, USAGE on throw, exit 2 |
| Errors | `src/upc.ts:21`, `resolveLayers` | result objects for input; throw for invariants / IO |
| Tests | `tests/core.test.ts`, `tests/fixtures.ts` | vitest, real Lolev UPC, content-stream asserts |
| Headless fonts | `scripts/generate.ts` / `tests/fixtures.ts` | read `src/assets/fonts` via `FONT_FAMILIES` |

---

**WAITING FOR CONFIRMATION:** Proceed with this plan? (yes / modify / different approach)
