# Barcode/QR Layer Core Implementation Plan (Plan 2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add EAN-13 and Code 128 encoders, generalize the barcode geometry to take any module pattern, add QR style options (square/rounded/dots, error-correction level), and wire the new symbologies into the model's `code` field validation — all pure code, no UI, existing UPC-A output byte-identical.

**Architecture:** Encoders stay hand-rolled and pure, emitting the existing `{ modules, guards }` shape (`UpcModules` in `src/upc.ts`). `src/barcode.ts`'s geometry learns to take an encoded pattern instead of calling `encodeUpc` itself, with the UPC-A path unchanged. `src/qr.ts` grows an options parameter defaulting to today's exact behavior. `src/model/` gains the wider `symbology` union.

**Tech Stack:** TypeScript, vitest, no new dependencies. (`qrcode-generator` is already installed.)

**Spec:** `docs/superpowers/specs/2026-08-27-master-variation-design.md` (section "Layer types")

## Global Constraints

- No new npm dependencies.
- Module-level purpose comment on every new file; update stale comments in modified files.
- After each task: `npx vitest run` green and `npx tsc --noEmit` clean before commit.
- Branch `design/master-variation` in `/Users/tedslesinski/Repos/art-files`.
- Existing UPC-A rendering must not change: `tests/barcode.test.ts` and the full suite stay green untouched (except where a task explicitly extends them).
- The spec's excluded symbologies (Code 39, ITF-14, DataMatrix, PDF417) stay out.

---

### Task 1: EAN-13 encoder

**Files:**
- Modify: `src/upc.ts` (append; nothing existing changes)
- Test: `tests/ean13.test.ts`

**Interfaces:**
- Consumes: existing `L` patterns table and `UpcModules` in `src/upc.ts`.
- Produces: `ean13CheckDigit(first12: string): number`, `validateEan13(value: string): { ok: boolean; error?: string }`, `encodeEan13(value: string): UpcModules` (95 modules, same guards as UPC-A).

- [ ] **Step 1: Write the failing test**

```ts
// tests/ean13.test.ts
import { describe, expect, it } from "vitest";
import { ean13CheckDigit, encodeEan13, validateEan13, encodeUpc } from "../src/upc";

describe("EAN-13", () => {
  it("computes the check digit (spec example 400638133393 -> 1)", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
  });
  it("validates format and check digit", () => {
    expect(validateEan13("4006381333931").ok).toBe(true);
    expect(validateEan13("4006381333932").ok).toBe(false);
    expect(validateEan13("40063813339").ok).toBe(false);      // 11 digits
    expect(validateEan13("400638133393a").ok).toBe(false);
  });
  it("emits 95 modules with UPC guard positions", () => {
    const { modules, guards } = encodeEan13("4006381333931");
    expect(modules).toHaveLength(95);
    expect(guards).toEqual([[0, 10], [45, 50], [85, 95]]);
  });
  it("a leading-zero EAN-13 encodes identically to the UPC-A it wraps", () => {
    expect(encodeEan13("0036000291452").modules).toBe(encodeUpc("036000291452").modules);
  });
  it("first digit changes left-half parity for the same body digits", () => {
    const body = "006381333930";   // digits 2..13 incl. per-code check digit
    const a = encodeEan13("0" + "00638133393" + String(ean13CheckDigit("0" + "00638133393")));
    const b = encodeEan13("4" + "00638133393" + String(ean13CheckDigit("4" + "00638133393")));
    expect(a.modules.slice(3, 45)).not.toBe(b.modules.slice(3, 45));
  });
});
```

(The last test computes each code's own check digit so both inputs are
valid; the assertion is that the left-half pattern differs when only the
first digit differs. The unused `body` const may be dropped.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ean13.test.ts` — expected FAIL (exports missing).

- [ ] **Step 3: Write the implementation** (append to `src/upc.ts`; update the module comment to say it now covers UPC-A + EAN-13)

```ts
/** EAN-13 parity selection by first digit: which of the left six digits use
 *  G (even parity) patterns. UPC-A is EAN-13 with first digit 0 = all-L. */
const PARITY: string[] = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

/** G pattern = L pattern reversed. R pattern = L pattern bit-inverted. */
const gOf = (l: string) => [...l].reverse().join("");
const rOf = (l: string) => [...l].map((b) => (b === "0" ? "1" : "0")).join("");

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++)
    sum += (first12.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function validateEan13(value: string): { ok: boolean; error?: string } {
  if (!/^\d{13}$/.test(value))
    return { ok: false, error: `"${value}" is not a valid EAN-13 code (13 digits).` };
  if (ean13CheckDigit(value.slice(0, 12)) !== +value[12])
    return { ok: false, error: "EAN-13 check digit does not match." };
  return { ok: true };
}

/** Encode a validated EAN-13 into its 95-module pattern. The first digit is
 *  implied by the left half's L/G parity sequence, not drawn as bars. */
export function encodeEan13(value: string): UpcModules {
  const parity = PARITY[value.charCodeAt(0) - 48];
  let m = "101";
  for (let i = 1; i <= 6; i++) {
    const l = L[value.charCodeAt(i) - 48];
    m += parity[i - 1] === "L" ? l : gOf(l);
  }
  m += "01010";
  for (let i = 7; i < 13; i++) m += rOf(L[value.charCodeAt(i) - 48]);
  m += "101";
  return { modules: m, guards: [[0, 10], [45, 50], [85, 95]] };
}
```

Verify the check-digit example in Step 1 against the implementation (the
weighting is odd-position ×1 / even ×3 over the first 12 digits,
0-indexed even = ×1). If the spec example literal is wrong, correct the
LITERAL from a real EAN-13 (e.g. any retail product) — never the algorithm.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ean13.test.ts && npx vitest run && npx tsc --noEmit` — all green.

- [ ] **Step 5: Commit**

```bash
git add src/upc.ts tests/ean13.test.ts
git commit -m "Codes: EAN-13 encoder sharing the UPC-A module tables"
```

---

### Task 2: Code 128 encoder

**Files:**
- Create: `src/code128.ts`
- Test: `tests/code128.test.ts`

**Interfaces:**
- Consumes: `UpcModules` type from `src/upc.ts`.
- Produces: `validateCode128(value: string): { ok: boolean; error?: string }` (non-empty, printable ASCII 32–126), `encodeCode128(value: string): UpcModules` (guards `[]` — Code 128 bars are all one height), `WIDTHS: string[]` (exported for the table-integrity test).

**Sourcing the symbol table (required method):** the 107-entry Code 128
pattern table (values 0–106, 11 modules each; stop pattern 13 modules) MUST
be fetched from an authoritative reference (the Wikipedia "Code 128" symbol
chart, which mirrors ISO/IEC 15417) via WebSearch/WebFetch during
implementation — never recited from memory. Store it as bar/space width
strings (e.g. value 0 = `"212222"`), expand to modules in code. From the
same source, take one documented example encoding (payload + full bar
pattern) and pin it as the reference-vector test below.

Encoding strategy (spec's YAGNI): code set B for everything, code set C
only when the ENTIRE payload is an even count of digits. No mid-string set
switching in v1 — a `// ponytail:` comment marks that ceiling.

- [ ] **Step 1: Write the failing test**

```ts
// tests/code128.test.ts
import { describe, expect, it } from "vitest";
import { WIDTHS, encodeCode128, validateCode128 } from "../src/code128";

describe("Code 128", () => {
  it("validates printable ASCII, rejects empty and control chars", () => {
    expect(validateCode128("BEER-123").ok).toBe(true);
    expect(validateCode128("").ok).toBe(false);
    expect(validateCode128("a\tb").ok).toBe(false);
  });
  it("widths table is 107 unique entries, each summing to 11 modules", () => {
    expect(WIDTHS).toHaveLength(107);
    expect(new Set(WIDTHS).size).toBe(107);
    for (const w of WIDTHS)
      expect([...w].reduce((a, b) => a + +b, 0)).toBe(11);
  });
  it("structure: start + data + check + stop module count", () => {
    const { modules, guards } = encodeCode128("AB");
    // start(11) + 2 data(22) + check(11) + stop(13) = 57
    expect(modules).toHaveLength(57);
    expect(guards).toEqual([]);
  });
  it("all-digit even-length payloads use code set C (shorter)", () => {
    expect(encodeCode128("123456").modules.length)
      .toBeLessThan(encodeCode128("12345A").modules.length);
  });
  it("check symbol changes when the payload changes", () => {
    expect(encodeCode128("AB").modules).not.toBe(encodeCode128("AC").modules);
  });
  it("matches a published reference encoding", () => {
    // REQUIRED: replace both literals with a documented example (payload and
    // its full module string) from the SAME source as the widths table. A
    // table without an external vector is unverified. Do not delete.
    expect(encodeCode128("REPLACE-ME").modules).toBe("REPLACE-ME");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/code128.test.ts` — expected FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
// code128.ts — pure Code 128 encoding (no DOM), emitting the same
// {modules, guards} shape as upc.ts so barcode geometry can draw any
// symbology. Widths table sourced from the ISO/IEC 15417 symbol chart via
// its public mirrors; tests/code128.test.ts pins a published reference
// vector against transcription errors.
import type { UpcModules } from "./upc";

// ponytail: code set B, or C only for an all-digit even-length payload —
// no mid-string set switching; add optimal switching if labels ever need it.

export const WIDTHS: string[] = [ /* 107 entries fetched per plan: "212222", ... */ ];
const STOP = "2331112";
const START_B = 104, START_C = 105;

const toModules = (widths: string): string =>
  [...widths].map((w, i) => (i % 2 === 0 ? "1" : "0").repeat(+w)).join("");

export function validateCode128(value: string): { ok: boolean; error?: string } {
  if (value.length === 0) return { ok: false, error: "Code 128 value is empty." };
  if (!/^[\x20-\x7e]+$/.test(value))
    return { ok: false, error: "Code 128 supports printable ASCII only." };
  return { ok: true };
}

export function encodeCode128(value: string): UpcModules {
  const setC = /^(\d\d)+$/.test(value);
  const symbols: number[] = [setC ? START_C : START_B];
  if (setC)
    for (let i = 0; i < value.length; i += 2) symbols.push(+value.slice(i, i + 2));
  else
    for (const ch of value) symbols.push(ch.charCodeAt(0) - 32);
  let check = symbols[0];
  for (let i = 1; i < symbols.length; i++) check += i * symbols[i];
  symbols.push(check % 103);
  const modules = symbols.map((s) => toModules(WIDTHS[s])).join("") + toModules(STOP) + "11";
  return { modules, guards: [] };
}
```

The `WIDTHS` placeholder is the ONE part filled from the fetched chart.
Note the stop pattern: `2331112` expands to 11 modules and the final
`"11"` appends the termination bar — total 13 stop modules. Confirm
against the source; if the source's stop is listed as a single 13-module
pattern, use it directly and drop the `+ "11"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/code128.test.ts && npx vitest run && npx tsc --noEmit` — all green, reference vector filled in.

- [ ] **Step 5: Commit**

```bash
git add src/code128.ts tests/code128.test.ts
git commit -m "Codes: Code 128 encoder with sourced symbol table and pinned vector"
```

---

### Task 3: Symbology-agnostic barcode geometry

**Files:**
- Modify: `src/barcode.ts`
- Modify: `src/model/types.ts`, `src/model/fields.ts` (widen `symbology`)
- Test: extend `tests/barcode.test.ts`, `tests/model-fields.test.ts`

**Interfaces:**
- Consumes: `encodeUpc`, `encodeEan13`, `validateEan13` (src/upc.ts); `encodeCode128`, `validateCode128` (src/code128.ts).
- Produces: `export type Symbology = "upc-a" | "ean-13" | "code-128"` (in `src/barcode.ts`); `encodeFor(symbology: Symbology, value: string): UpcModules`; the existing geometry entry point gains an optional trailing `pattern?: UpcModules` parameter — absent, it calls `encodeUpc` exactly as today (UPC-A output byte-identical); `FieldDecl.symbology` widens to the same 3-literal union (re-declared in model/types.ts with a pointer comment — no circular import); `validateField`'s `code` branch dispatches `upc-a`→`validateUpc`, `ean-13`→`validateEan13`, `code-128`→`validateCode128`.

Read `src/barcode.ts` fully before editing: the digit-group layout
(`place(...)`) is UPC-A-specific. Scope rule: digit rendering stays
UPC-A-only in this task — a non-UPC pattern gets bars (and guard heights if
the pattern has guards) with an EMPTY `digits` array; human-readable text
for EAN-13/Code 128 arrives with the layer renderer in Plan 3. Say so in a
comment on the parameter.

- [ ] **Step 1: Write the failing tests**

Read `tests/barcode.test.ts` first and write these with its existing
fixture/helper style — real assertions, not comments:

- "explicit UPC pattern matches the implicit default exactly": call the
  geometry entry point twice — without `pattern`, and with
  `pattern: encodeUpc(<same upc>)` — and `expect(...).toEqual(...)` on the
  full geometry object.
- "a Code 128 pattern yields bars, no digits, uniform heights": pass
  `encodeCode128("BEER-123")`; expect `digits` to equal `[]` and every
  bar's height/yTop to be identical (no guard-height bars).

Append to `tests/model-fields.test.ts`:

```ts
it("validates EAN-13 and Code 128 through the code kind", () => {
  const d = (s: "ean-13" | "code-128"): FieldDecl =>
    ({ id: "f", label: "F", kind: "code", path: "upc", symbology: s });
  expect(validateField(d("ean-13"), "4006381333931").ok).toBe(true);
  expect(validateField(d("ean-13"), "4006381333932").ok).toBe(false);
  expect(validateField(d("code-128"), "BEER-123").ok).toBe(true);
  expect(validateField(d("code-128"), "").ok).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/barcode.test.ts tests/model-fields.test.ts` — new tests FAIL.

- [ ] **Step 3: Implement**

In `src/barcode.ts`: add `Symbology` + `encodeFor` (3-way dispatch to the
encoders); add the optional `pattern` parameter defaulting to the current
`encodeUpc` call; run the digit-layout block only on the default/UPC path.
Update the module comment ("UPC-A layout" → barcode layout with UPC-A
digit rendering). In `src/model/types.ts` widen `symbology?: "upc-a"` to
`symbology?: "upc-a" | "ean-13" | "code-128"` with a comment pointing at
`src/barcode.ts`'s `Symbology`. In `src/model/fields.ts` dispatch the three
validators in the `code` branch.

- [ ] **Step 4: Run full gate**

Run: `npx vitest run && npx tsc --noEmit` — all green, including untouched UPC tests.

- [ ] **Step 5: Commit**

```bash
git add src/barcode.ts src/model/types.ts src/model/fields.ts tests/barcode.test.ts tests/model-fields.test.ts
git commit -m "Codes: symbology-agnostic barcode geometry and code-field dispatch"
```

---

### Task 4: QR style options

**Files:**
- Modify: `src/qr.ts`
- Test: `tests/qr-options.test.ts`

**Interfaces:**
- Consumes: existing `qrShapes`, `qrPath`, `QrShapes` in `src/qr.ts`.
- Produces: `export interface QrOptions { style?: "square" | "rounded" | "dots"; ecLevel?: "L" | "M" | "Q" | "H" }`; `qrShapes(data: string, opts?: QrOptions): QrShapes` (default `{ style: "dots", ecLevel: "L" }` — today's exact behavior; memo keyed on data + opts); `QrShapes` gains `squares?: { x: number; y: number }[]` (unit-space top-left corners of dark modules INCLUDING finders, used by square/rounded); `qrPath(shapes, size, grow?)` renders `squares` as rects when present (`rounded`: corner radius 0.25 module), untouched circle output for dots.

- [ ] **Step 1: Write the failing test**

```ts
// tests/qr-options.test.ts
import { describe, expect, it } from "vitest";
import { qrPath, qrShapes } from "../src/qr";

describe("QR options", () => {
  it("defaults reproduce the legacy dots output exactly", () => {
    const legacy = qrPath(qrShapes("https://lolev.beer/beer/x"), 100);
    const opted = qrPath(qrShapes("https://lolev.beer/beer/x", { style: "dots", ecLevel: "L" }), 100);
    expect(opted).toBe(legacy);
  });
  it("square style emits module squares, not circles", () => {
    const s = qrShapes("test", { style: "square" });
    expect(s.squares!.length).toBeGreaterThan(0);
    expect(qrPath(s, 100)).not.toContain("a ");   // no arc commands
  });
  it("rounded style emits arcs on rects", () => {
    expect(qrPath(qrShapes("test", { style: "rounded" }), 100)).toContain("a ");
  });
  it("higher EC level yields an equal-or-larger matrix", () => {
    const l = qrShapes("test", { ecLevel: "L" }).count;
    const h = qrShapes("test", { ecLevel: "H" }).count;
    expect(h).toBeGreaterThanOrEqual(l);
  });
  it("memo distinguishes options", () => {
    const a = qrShapes("same", { style: "square" });
    const b = qrShapes("same", { style: "dots" });
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/qr-options.test.ts` — FAIL.

- [ ] **Step 3: Implement**

In `src/qr.ts`: thread `QrOptions` through `buildShapes` (pass
`opts.ecLevel ?? "L"` to `qrcode(0, ec)`); for `square`/`rounded`, collect
every dark module (finders included) into `squares` and leave `dots`/
`finders` empty; extend `qrPath` — when `shapes.squares` is set, emit rect
paths (`M x y h s v s h -s Z` for square; arc-cornered with radius
`0.25 * moduleSize * size` for rounded — store the style on `QrShapes` so
`qrPath` knows which), keeping the existing circle code for dots. Memo key:
`` `${data}|${opts?.style ?? "dots"}|${opts?.ecLevel ?? "L"}` ``. Update the
module comment (no longer always "round data dots").

- [ ] **Step 4: Run full gate**

Run: `npx vitest run && npx tsc --noEmit` — all green (legacy-equality test is the regression lock).

- [ ] **Step 5: Commit**

```bash
git add src/qr.ts tests/qr-options.test.ts
git commit -m "Codes: QR square/rounded/dots styles and error-correction option"
```

---

## Done means

EAN-13 and Code 128 encode to the shared `{modules, guards}` shape with
externally pinned tests; the barcode geometry accepts any pattern while
UPC-A output is provably unchanged; QR takes style + EC options with legacy
output locked by test; the model's `code` fields validate all three
symbologies. Full suite + typecheck green. Version bump for the release
gate happens at push time (same procedure as 0.1.28).
