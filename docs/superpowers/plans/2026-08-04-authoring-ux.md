# Authoring UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the label authoring sidebar so only per-beer fields are
prominent, style controls appear contextually for the selected element
(Photoshop-style), the description becomes a WYSIWYG multiline field, and
clicking the preview selects an element.

**Architecture:** A new pure module `src/elements.ts` becomes the single
registry of stylable label elements — id, display label, group, and a `Style`
accessor into `LabelConfig`. Both the form and the preview read from it, so
they cannot disagree about what exists. Styling UI moves from eleven
always-resident `StylePopover` chips to one contextual `StyleProperties`
panel driven by a selected element id held in `App`.

**Tech Stack:** React 19, TypeScript, Tailwind v4, shadcn/ui (Base UI
flavor), vitest. No new dependencies.

## Global Constraints

- **No config schema change.** `LabelConfig` and its JSON form are untouched;
  `description` stays the markdown string. Existing saved configs must load.
- **No renderer change.** `src/pdf/build.ts`, `src/psd/build.ts`,
  `src/layout.ts` and `src/barcode.ts` are read-only for this work.
- **No capability removed.** Every element stylable today stays fully
  stylable: fill, layer, bold (where applicable), outer stroke + width.
- **Defaults are gold `#D0B070` and `metallic`** — applied silently, never
  presented as an open question.
- **Style controls reuse existing components:** `ColorField` for fill and
  stroke colour, shadcn `Select` for layer, `Checkbox` for bold/stroke.
- **Testing convention:** pure modules get vitest tests under `tests/`
  (the repo has no DOM test harness and this plan does not add one).
  Component behaviour is verified in the browser — the dev server plus the
  `browse` CLI, as used throughout this branch.
- **Run `npx tsc --noEmit` and `npx vitest run` before every commit.**

---

### Task 1: Element registry

The spine. Every later task consumes this.

**Files:**
- Create: `src/elements.ts`
- Test: `tests/elements.test.ts`

**Interfaces:**
- Consumes: `LabelConfig`, `Style` from `src/types.ts`; `GOLD` from `src/layout.ts`.
- Produces:
  - `type ElementId = "name" | "styleLine" | "abv" | "description" | "volume" | "wordmark" | "logo" | "handleAddress" | "warning" | "storeCold" | "qr"`
  - `interface LabelElement { id: ElementId; label: string; group: "beer" | "template"; hasBold: boolean; style(c: LabelConfig): Style }`
  - `const ELEMENTS: LabelElement[]`
  - `function elementById(id: ElementId): LabelElement`
  - `function applyStyle(c: LabelConfig, id: ElementId, patch: Partial<Style>): void`
  - `function isDefaultStyle(s: Style): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/elements.test.ts
import { describe, expect, it } from "vitest";
import { ELEMENTS, applyStyle, elementById, isDefaultStyle } from "../src/elements";
import { defaultConfig } from "../src/defaults";
import { GOLD } from "../src/layout";

describe("element registry", () => {
  it("covers every stylable element exactly once", () => {
    const ids = ELEMENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("name");
    expect(ids).toContain("storeCold");
    expect(ids).toContain("qr");
  });

  it("splits per-beer fields from set-once template fields", () => {
    const g = (id: string) => ELEMENTS.find((e) => e.id === id)!.group;
    expect(g("name")).toBe("beer");
    expect(g("styleLine")).toBe("beer");
    expect(g("wordmark")).toBe("template");
    expect(g("storeCold")).toBe("template");
  });

  it("reads each element's live style out of the config", () => {
    const cfg = defaultConfig();
    cfg.nameStyle.fill = "#123456";
    expect(elementById("name").style(cfg).fill).toBe("#123456");
    expect(elementById("qr").style(cfg).fill).toBe(GOLD);
  });

  it("writes back through applyStyle, including the flat QR fields", () => {
    const cfg = defaultConfig();
    applyStyle(cfg, "name", { fill: "#ABCDEF" });
    expect(cfg.nameStyle.fill).toBe("#ABCDEF");
    applyStyle(cfg, "qr", { fill: "#112233", layer: "white" });
    expect(cfg.qrFill).toBe("#112233");
    expect(cfg.qrLayer).toBe("white");
  });

  it("recognises the gold/metallic default so deviations can be marked", () => {
    expect(isDefaultStyle({ fill: GOLD, layer: "metallic" })).toBe(true);
    expect(isDefaultStyle({ fill: "#FF0000", layer: "metallic" })).toBe(false);
    expect(isDefaultStyle({ fill: GOLD, layer: "white" })).toBe(false);
    expect(isDefaultStyle({ fill: GOLD, layer: "metallic", stroke: "#FFFFFF" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/elements.test.ts`
Expected: FAIL — cannot resolve `../src/elements`.

- [ ] **Step 3: Write the implementation**

```ts
// elements.ts — the one registry of stylable label elements. The form and
// the preview both read it, so they cannot disagree about what exists or
// which config field backs it.
import type { LabelConfig, Style } from "./types";
import { GOLD } from "./layout";

export type ElementId =
  | "name" | "styleLine" | "abv" | "description"
  | "volume" | "wordmark" | "logo" | "handleAddress" | "warning" | "storeCold"
  | "qr";

export interface LabelElement {
  id: ElementId;
  /** Shown in the form row and as the properties panel header. */
  label: string;
  /** "beer" changes every time; "template" is set once. */
  group: "beer" | "template";
  /** Whether a bold toggle applies (logo and QR have no text). */
  hasBold: boolean;
  /** Read accessor. Writes go through applyStyle. */
  style(c: LabelConfig): Style;
}

/** The QR's style lives in flat config fields rather than a Style object;
 *  this adapts it so the registry can treat every element uniformly. */
const qrStyle = (c: LabelConfig): Style => ({
  fill: c.qrFill, layer: c.qrLayer, stroke: c.qrStroke, strokeWidth: c.qrStrokeWidth,
});

export const ELEMENTS: LabelElement[] = [
  { id: "name", label: "Beer name", group: "beer", hasBold: false, style: (c) => c.nameStyle },
  { id: "styleLine", label: "Subtitle", group: "beer", hasBold: true, style: (c) => c.styleLine },
  { id: "abv", label: "ABV", group: "beer", hasBold: false, style: (c) => c.abvStyle },
  { id: "description", label: "Description", group: "beer", hasBold: false, style: (c) => c.descStyle },
  { id: "qr", label: "QR", group: "beer", hasBold: false, style: qrStyle },
  { id: "volume", label: "Volume", group: "template", hasBold: true, style: (c) => c.volume },
  { id: "wordmark", label: "Wordmark", group: "template", hasBold: false, style: (c) => c.wordmark },
  { id: "logo", label: "Logo", group: "template", hasBold: false, style: (c) => c.logo },
  { id: "handleAddress", label: "Handle / address", group: "template", hasBold: true, style: (c) => c.handleAddress },
  { id: "warning", label: "Warning", group: "template", hasBold: false, style: (c) => c.warning },
  { id: "storeCold", label: "Store cold", group: "template", hasBold: true, style: (c) => c.storeCold },
];

export function elementById(id: ElementId): LabelElement {
  const e = ELEMENTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown element: ${id}`);
  return e;
}

/** Apply a Style patch to whichever config fields back `id`. */
export function applyStyle(c: LabelConfig, id: ElementId, patch: Partial<Style>): void {
  if (id === "qr") {
    if (patch.fill !== undefined) c.qrFill = patch.fill;
    if (patch.layer !== undefined) c.qrLayer = patch.layer;
    if (patch.stroke !== undefined) c.qrStroke = patch.stroke;
    if (patch.strokeWidth !== undefined) c.qrStrokeWidth = patch.strokeWidth;
    return;
  }
  Object.assign(elementById(id).style(c), patch);
}

/** True when nothing deviates from the silent gold/metallic default, so the
 *  UI knows whether to show a deviation marker and a reset. */
export function isDefaultStyle(s: Style): boolean {
  return (
    s.fill === GOLD &&
    s.layer === "metallic" &&
    (s.stroke === undefined || s.stroke === "none")
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/elements.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/elements.ts tests/elements.test.ts
git commit -m "Element registry: one source of truth for stylable label elements"
```

---

### Task 2: Description serialiser

`parseDescription` reads markdown; the WYSIWYG editor needs the inverse.

**Files:**
- Modify: `src/description.ts`
- Test: `tests/core.test.ts` (append inside the existing `description markdown` block)

**Interfaces:**
- Consumes: `ParsedDescription` and `StyledLine`, already in scope in `src/description.ts`.
- Produces: `function serializeDescription(d: ParsedDescription): string`

- [ ] **Step 1: Write the failing test**

Add `serializeDescription` to the existing import from `../src/description`,
then append inside `describe("description markdown", ...)`:

```ts
  it("round-trips through serialize", () => {
    const src = "# HOPS\nFreestyle Motueka\n**_Roy Farms_**\n_Silvery_\n**Bold Gold**";
    expect(serializeDescription(parseDescription(src))).toBe(src);
  });

  it("serializes an empty block to an empty string", () => {
    expect(serializeDescription({ header: null, lines: [] })).toBe("");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core.test.ts`
Expected: FAIL — `serializeDescription is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/description.ts`:

```ts
/** Inverse of parseDescription — the WYSIWYG editor edits styled lines and
 *  writes back the markdown string LabelConfig still stores. Marker order
 *  mirrors what styleLine strips: bold outside, white inside. The header is
 *  always bold, so it takes no ** markers. */
export function serializeDescription(d: ParsedDescription): string {
  const line = (l: StyledLine, header = false) => {
    let s = l.text;
    if (l.layer === "white") s = `_${s}_`;
    if (l.bold && !header) s = `**${s}**`;
    return header ? `# ${s}` : s;
  };
  const head = d.header ? [line(d.header, true)] : [];
  return [...head, ...d.lines.map((l) => line(l))].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/description.ts tests/core.test.ts
git commit -m "Description: add serializer so the editor can write back markdown"
```

---

### Task 3: Preview hit-testing

Maps a click in label space to an `ElementId`.

**Files:**
- Create: `src/hittest.ts`
- Test: `tests/hittest.test.ts`

**Interfaces:**
- Consumes: `ElementId` from `src/elements.ts`; `parseDescription`; constants from `src/layout.ts`.
- Produces:
  - `type Measure = (text: string, size: number, bold: boolean) => number`
  - `interface Box { x0: number; y0: number; x1: number; y1: number; id: ElementId }`
  - `function boxesOf(cfg: LabelConfig, m: Measure): Box[]`
  - `function hitTest(xPt: number, yPt: number, m: Measure, cfg: LabelConfig): ElementId | null`
  - `function boxOf(id: ElementId, cfg: LabelConfig, m: Measure): Box | null`

**Note on text boxes:** `pdftotext -bbox` measurement on this label
established Poppins' font box as ascender `1.05em` above the baseline and
descender `0.35em` below. Horizontal text at `(x, baseline, size)` occupies
`x .. x+width` by `baseline-1.05*size .. baseline+0.35*size`. Rotated text
(`rotate(90)`, reading bottom-to-top, glyphs growing toward `-x`) at
`(x, yStart, size)` occupies `x-1.05*size .. x+0.35*size` by
`yStart-width .. yStart`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/hittest.test.ts
import { describe, expect, it } from "vitest";
import { boxOf, hitTest } from "../src/hittest";
import { defaultConfig } from "../src/defaults";
import * as L from "../src/layout";

// Deterministic stand-in for real font metrics.
const measure = (text: string, size: number) => text.length * size * 0.55;

describe("preview hit-testing", () => {
  const cfg = defaultConfig();

  it("hits the beer name just above its baseline", () => {
    expect(hitTest(L.NAME.cx, L.NAME.baseline - 2, measure, cfg)).toBe("name");
  });

  it("hits the logo inside its box", () => {
    expect(hitTest(L.LOGO.cx, L.LOGO.cy, measure, cfg)).toBe("logo");
  });

  it("hits the QR inside its box", () => {
    expect(hitTest(L.QR.x + 5, L.QR.yTop + 5, measure, cfg)).toBe("qr");
  });

  it("hits rotated store-cold text", () => {
    expect(hitTest(L.STORE_COLD.x - 5, L.STORE_COLD.yStart - 20, measure, cfg)).toBe("storeCold");
  });

  it("returns null on empty background", () => {
    expect(hitTest(300, 250, measure, cfg)).toBeNull();
  });

  it("exposes the same box it hit, for drawing the selection", () => {
    const b = boxOf("logo", cfg, measure)!;
    expect(b.x0).toBeCloseTo(L.LOGO.cx - L.LOGO.w / 2, 5);
    expect(hitTest((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, measure, cfg)).toBe("logo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hittest.test.ts`
Expected: FAIL — cannot resolve `../src/hittest`.

- [ ] **Step 3: Write the implementation**

```ts
// hittest.ts — maps a point in label space (points, top-left origin) to the
// element under it, so clicking the preview can select that element. Boxes
// mirror what the PDF renderer draws; Poppins' font box is 1.05em above the
// baseline and 0.35em below (measured with pdftotext -bbox).
import type { LabelConfig } from "./types";
import type { ElementId } from "./elements";
import { parseDescription } from "./description";
import * as L from "./layout";

export type Measure = (text: string, size: number, bold: boolean) => number;
export interface Box { x0: number; y0: number; x1: number; y1: number; id: ElementId }

const ASC = 1.05;
const DESC = 0.35;

const flat = (
  id: ElementId, text: string, x: number, baseline: number, size: number,
  m: Measure, bold = false,
): Box => ({
  id, x0: x, x1: x + m(text, size, bold),
  y0: baseline - ASC * size, y1: baseline + DESC * size,
});

const centred = (
  id: ElementId, text: string, cx: number, baseline: number, size: number,
  m: Measure, bold = false,
): Box => {
  const w = m(text, size, bold);
  return {
    id, x0: cx - w / 2, x1: cx + w / 2,
    y0: baseline - ASC * size, y1: baseline + DESC * size,
  };
};

const rotated = (
  id: ElementId, text: string, x: number, yStart: number, size: number,
  m: Measure, bold = false,
): Box => ({
  id, x0: x - ASC * size, x1: x + DESC * size,
  y0: yStart - m(text, size, bold), y1: yStart,
});

/** Every element's box, in paint order (later entries sit on top). */
export function boxesOf(cfg: LabelConfig, m: Measure): Box[] {
  const desc = parseDescription(cfg.description, cfg.descStyle);
  const boxes: Box[] = [
    flat("volume", cfg.volume.text, L.VOLUME.x, L.VOLUME.baseline, L.VOLUME.size, m, !!cfg.volume.bold),
    flat("abv", `${cfg.abv}% alc by vol`, L.ABV.x, L.ABV.baseline, L.ABV.size, m),
    centred("wordmark", L.WORDMARK.text, L.WORDMARK.cx, L.WORDMARK.baseline, L.WORDMARK.size, m, true),
    centred("name", cfg.beerName.toUpperCase(), L.NAME.cx, L.NAME.baseline, L.NAME.size, m, true),
    centred("styleLine", cfg.styleLine.text, L.STYLE_LINE.cx, L.STYLE_LINE.baseline, L.STYLE_LINE.size, m, !!cfg.styleLine.bold),
    rotated("handleAddress", cfg.handleAddress.text, L.HANDLE_ADDR.x, L.HANDLE_ADDR.yStart, L.HANDLE_ADDR.size, m),
    rotated("storeCold", cfg.storeCold.text, L.STORE_COLD.x, L.STORE_COLD.yStart, L.STORE_COLD.size, m),
    // Logo and QR are boxes, not text.
    { id: "logo",
      x0: L.LOGO.cx - L.LOGO.w / 2, x1: L.LOGO.cx + L.LOGO.w / 2,
      y0: L.LOGO.cy - L.LOGO.w / 2, y1: L.LOGO.cy + L.LOGO.w / 2 },
    { id: "qr",
      x0: L.QR.x, x1: L.QR.x + L.QR.size,
      y0: L.QR.yTop, y1: L.QR.yTop + L.QR.size },
  ];
  // The warning is three rotated columns sharing one style.
  for (let i = 0; i < 3; i++)
    boxes.push({
      id: "warning",
      x0: L.WARNING.x + i * L.WARNING.leading - ASC * L.WARNING.size,
      x1: L.WARNING.x + i * L.WARNING.leading + DESC * L.WARNING.size,
      y0: L.WARNING.yStart - L.WARNING.maxLen, y1: L.WARNING.yStart,
    });
  // Every description line maps to the one description element.
  const lines = [
    ...(desc.header
      ? [{ text: desc.header.text, x: L.DESC_HEADER.x, baseline: L.DESC_HEADER.baseline, size: L.DESC_HEADER.size }]
      : []),
    ...desc.lines.map((l, i) => ({
      text: l.text, x: L.DESC.x,
      baseline: L.DESC.firstBaseline + i * L.DESC.leading, size: L.DESC.size,
    })),
  ];
  for (const d of lines) boxes.push(flat("description", d.text, d.x, d.baseline, d.size, m));
  return boxes;
}

export function hitTest(
  xPt: number, yPt: number, m: Measure, cfg: LabelConfig,
): ElementId | null {
  const boxes = boxesOf(cfg, m);
  // Topmost first, matching paint order.
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (xPt >= b.x0 && xPt <= b.x1 && yPt >= b.y0 && yPt <= b.y1) return b.id;
  }
  return null;
}

/** The union box for an element, for drawing the selection outline. */
export function boxOf(id: ElementId, cfg: LabelConfig, m: Measure): Box | null {
  const parts = boxesOf(cfg, m).filter((b) => b.id === id);
  if (!parts.length) return null;
  return parts.reduce((a, b) => ({
    id, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hittest.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hittest.ts tests/hittest.test.ts
git commit -m "Hit-testing: map a point in label space to the element under it"
```

---

### Task 4: Contextual properties panel

Replaces the eleven always-resident swatch chips.

**Files:**
- Create: `src/components/StyleProperties.tsx`
- Reference only (do not modify): `src/components/StylePopover.tsx`, `src/components/ColorField.tsx`

**Interfaces:**
- Consumes: `ElementId`, `elementById`, `isDefaultStyle`, `applyStyle` (Task 1); `ColorField`.
- Produces: `function StyleProperties(props: { id: ElementId; cfg: LabelConfig; update: (fn: (c: LabelConfig) => void) => void; onClose: () => void }): JSX.Element`

- [ ] **Step 1: Confirm ColorField's props**

Read `src/components/ColorField.tsx` and note its exact prop names before
writing the calls below (it is `{ value, onChange, allowNone?, id? }` at time
of writing).

- [ ] **Step 2: Write the component**

```tsx
// StyleProperties.tsx — the contextual style panel. Photoshop's model: it
// exists only while an element is selected, so the gold/metallic defaults
// stay silent everywhere else.
import { X } from "lucide-react";
import type { LabelConfig, Style } from "@/types";
import { applyStyle, elementById, isDefaultStyle, type ElementId } from "@/elements";
import { ColorField } from "./ColorField";
import { DEFAULT_STROKE_PX, GOLD } from "@/layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function StyleProperties(props: {
  id: ElementId;
  cfg: LabelConfig;
  update: (fn: (c: LabelConfig) => void) => void;
  onClose: () => void;
}) {
  const el = elementById(props.id);
  const s = el.style(props.cfg);
  const set = (patch: Partial<Style>) =>
    props.update((c) => applyStyle(c, props.id, patch));
  const strokeOn = !!s.stroke && s.stroke !== "none";

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{el.label}</span>
        <div className="flex items-center gap-1">
          {!isDefaultStyle(s) && (
            <Button
              variant="ghost" size="sm" className="h-6 px-2 text-[11px]"
              onClick={() => set({ fill: GOLD, layer: "metallic", stroke: "none" })}
            >
              Reset
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-6" onClick={props.onClose}>
            <X className="size-3" />
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Fill</Label>
        <ColorField value={s.fill} onChange={(v) => set({ fill: v })} />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Layer</Label>
        <Select value={s.layer} onValueChange={(v) => set({ layer: v as "metallic" | "white" })}>
          <SelectTrigger className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="metallic">metallic</SelectItem>
            <SelectItem value="white">white</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Outer stroke</Label>
          <Checkbox
            checked={strokeOn}
            onCheckedChange={(v) => set({ stroke: v === true ? "#FFFFFF" : "none" })}
          />
        </div>
        {strokeOn && (
          <div className="flex items-center gap-1">
            <ColorField value={s.stroke!} onChange={(v) => set({ stroke: v })} allowNone={false} />
            <Input
              type="number" min={1} max={60}
              aria-label="Stroke width (px at 600dpi)"
              className="h-6 w-14 text-xs"
              value={s.strokeWidth ?? DEFAULT_STROKE_PX}
              onChange={(e) =>
                set({ strokeWidth: Math.min(60, Math.max(1, Number(e.target.value) || DEFAULT_STROKE_PX)) })}
            />
            <span className="text-[10px] text-muted-foreground">px</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/StyleProperties.tsx
git commit -m "Contextual style panel, shown only for the selected element"
```

---

### Task 5: Restructure the form

**Files:**
- Modify: `src/components/LabelForm.tsx` (rewrite the component body)
- Modify: `src/App.tsx` — hold `selected`, render `StyleProperties`

**Interfaces:**
- Consumes: `ELEMENTS`, `isDefaultStyle`, `elementById`, `ElementId` (Task 1); `StyleProperties` (Task 4).
- Produces: `LabelForm` gains props `selected: ElementId | null` and `onSelect: (id: ElementId | null) => void`.

- [ ] **Step 1: Re-add the Collapsible primitive**

It was deleted from `src/components/ui/` earlier on this branch.

```bash
echo y | npx shadcn@latest add -o collapsible
```

If that reverts unrelated vendored files, implement the disclosure with a
plain `<button>` plus a conditional render instead — it is two elements.

- [ ] **Step 2: Rewrite LabelForm**

Two bands, replacing the current flat list. Every row that maps to an
element calls `onSelect(id)` on focus, and shows a small dot when
`!isDefaultStyle(elementById(id).style(cfg))`. **No swatch chips anywhere.**

```tsx
<Heading>This beer</Heading>
<Row label="Name" htmlFor="beer-name" error={errors.name}>
  <Input id="beer-name" className="h-6 flex-1 text-xs" value={cfg.beerName}
    onFocus={() => onSelect("name")}
    onChange={(e) => update((c) => { c.beerName = e.target.value; })} />
</Row>
<Row label="Subtitle" htmlFor="subtitle">
  <Input id="subtitle" className="h-6 flex-1 text-xs" value={cfg.styleLine.text}
    onFocus={() => onSelect("styleLine")}
    onChange={(e) => update((c) => { c.styleLine.text = e.target.value; })} />
</Row>
{/* ABV and UPC share one row — both are short. */}
<div className="mb-1.5 flex items-center gap-1.5">
  <Label className="w-24 shrink-0 text-[13px] font-normal text-muted-foreground">ABV %</Label>
  <Input className="h-6 w-14 text-xs" value={cfg.abv}
    onFocus={() => onSelect("abv")}
    onChange={(e) => update((c) => { c.abv = e.target.value; })} />
  <Label className="shrink-0 text-[13px] font-normal text-muted-foreground">UPC</Label>
  <Input className="h-6 min-w-0 flex-1 font-mono text-xs" value={cfg.upc}
    onChange={(e) => update((c) => { c.upc = e.target.value.trim(); })} />
</div>
{errors.upc && <p className="ml-[6.375rem] text-xs text-destructive">{errors.upc}</p>}

{/* Description editor lands here in Task 6; keep the existing Textarea
    until then so this task stands alone. */}

<Collapsible>
  <Heading>
    <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1">
      <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
      Brand template
      <span className="ml-1 rounded bg-muted px-1 text-[10px]">
        {ELEMENTS.filter((e) => e.group === "template").length}
      </span>
    </CollapsibleTrigger>
  </Heading>
  <CollapsibleContent className="pt-1.5">
    {/* Volume, Wordmark, Logo, Handle/addr, Warning, Store cold.
        Text inputs where the element has editable text (volume,
        handleAddress, storeCold); label-only rows for wordmark, logo,
        warning. Each calls onSelect(id) on focus or click. */}
  </CollapsibleContent>
</Collapsible>
```

- [ ] **Step 3: Wire selection state in App**

```tsx
const [selected, setSelected] = useState<ElementId | null>(null);
// ...in the sidebar, directly under <LabelForm>:
<LabelForm cfg={cfg} errors={errors} update={update}
  selected={selected} onSelect={setSelected} />
{selected && (
  <StyleProperties id={selected} cfg={cfg} update={update}
    onClose={() => setSelected(null)} />
)}
```

- [ ] **Step 4: Verify in the browser**

```bash
npm run dev
```

Confirm with the `browse` CLI: the primary band shows six fields and no
swatches; focusing Name opens a panel headed "Beer name"; changing its fill
updates the preview; the template band is collapsed with a count of 6.

- [ ] **Step 5: Type-check, test, commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/components/LabelForm.tsx src/App.tsx src/components/ui/collapsible.tsx
git commit -m "Form: split per-beer fields from brand template, contextual styling"
```

---

### Task 6: WYSIWYG description editor

**Files:**
- Create: `src/components/DescriptionEditor.tsx`
- Modify: `src/components/LabelForm.tsx` — swap the `Textarea` for it
- Test: `tests/description-editor.test.ts`

**Interfaces:**
- Consumes: `parseDescription`, `serializeDescription` (Task 2); `Style`.
- Produces:
  - `interface EditorLine { text: string; bold: boolean; white: boolean; header: boolean }`
  - `function markdownToLines(md: string, base: Style): EditorLine[]`
  - `function linesToMarkdown(lines: EditorLine[]): string`
  - `function DescriptionEditor(props: { value: string; base: Style; onChange: (markdown: string) => void }): JSX.Element`

- [ ] **Step 1: Write the failing test for the pure helpers**

```ts
// tests/description-editor.test.ts
import { describe, expect, it } from "vitest";
import { linesToMarkdown, markdownToLines } from "../src/components/DescriptionEditor";
import { GOLD } from "../src/layout";

const base = { fill: GOLD, layer: "metallic" } as const;

describe("description editor mapping", () => {
  it("round-trips the default block", () => {
    const md = "# HOPS\nFreestyle Motueka\n**_Roy Farms_**";
    const lines = markdownToLines(md, base);
    expect(lines[0]).toMatchObject({ text: "HOPS", header: true });
    expect(lines[1]).toMatchObject({ text: "Freestyle Motueka", bold: false, white: false });
    expect(lines[2]).toMatchObject({ text: "Roy Farms", bold: true, white: true });
    expect(linesToMarkdown(lines)).toBe(md);
  });

  it("handles a headerless block", () => {
    const lines = markdownToLines("just a line", base);
    expect(lines).toHaveLength(1);
    expect(lines[0].header).toBe(false);
    expect(linesToMarkdown(lines)).toBe("just a line");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/description-editor.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the pure helpers**

```ts
// In src/components/DescriptionEditor.tsx, above the component.
import type { Style } from "@/types";
import { parseDescription, serializeDescription } from "@/description";

export interface EditorLine { text: string; bold: boolean; white: boolean; header: boolean }

export function markdownToLines(md: string, base: Style): EditorLine[] {
  const d = parseDescription(md, base);
  const head: EditorLine[] = d.header
    ? [{ text: d.header.text, bold: true, white: d.header.layer === "white", header: true }]
    : [];
  return [
    ...head,
    ...d.lines.map((l) => ({
      text: l.text, bold: !!l.bold, white: l.layer === "white", header: false,
    })),
  ];
}

export function linesToMarkdown(lines: EditorLine[]): string {
  const header = lines.find((l) => l.header);
  const body = lines.filter((l) => !l.header);
  const asStyled = (l: EditorLine) => ({
    text: l.text, bold: l.bold,
    fill: l.white ? ("none" as const) : ("#D0B070" as const),
    layer: l.white ? ("white" as const) : ("metallic" as const),
  });
  return serializeDescription({
    header: header ? asStyled(header) : null,
    lines: body.map(asStyled),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/description-editor.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Build the editor component**

Behaviour, on top of the tested helpers:

- A `contenteditable` div, one child `<div>` per line, each carrying
  `data-bold` and `data-white` attributes and `data-header` on the first if
  it is a header.
- Style each child to match the label: `font-heading`, colour
  `#D0B070` for metallic lines and `#FFFFFF` for white-ink lines,
  `font-semibold` when bold, larger `text-sm` for the header. The sidebar is
  dark, so both read correctly as themselves.
- Seed the DOM from `markdownToLines(value, base)` on mount and whenever
  `value` changes **while the field is not focused** — re-seeding during
  editing would move the caret.
- `onInput`: read the children back into `EditorLine[]` and call
  `onChange(linesToMarkdown(lines))`.
- `onPaste`: `e.preventDefault()`, then insert
  `e.clipboardData.getData("text/plain")` at the selection.
- Two toggles (Bold, White ink) rendered while the field has focus; each
  flips the attribute on every line the selection touches, then re-emits.
- An "Edit as text" switch swaps in the existing `Textarea` bound to the raw
  markdown, as the escape hatch.

- [ ] **Step 6: Verify in the browser**

Typing updates the preview; a white-ink line renders white in the field;
Bold toggles the caret's line; pasting styled text from a web page arrives
as plain text; "Edit as text" shows the markdown and round-trips back.

- [ ] **Step 7: Type-check, test, commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/components/DescriptionEditor.tsx tests/description-editor.test.ts src/components/LabelForm.tsx
git commit -m "Description: WYSIWYG multiline editor, no markdown syntax to remember"
```

---

### Task 7: Click the preview to select

**Files:**
- Modify: `src/components/PreviewCompare.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `hitTest`, `boxOf`, `Measure` (Task 3); `ElementId`.
- Produces: `PreviewCompare` gains `cfg: LabelConfig`, `measure: Measure | null`, `selected: ElementId | null`, `onPick: (id: ElementId | null) => void`.

- [ ] **Step 1: Provide font metrics from App**

`App.tsx` already resolves `fontsPromise` at module level. Embed the faces
once with pdf-lib and expose a `Measure`:

```tsx
const [measure, setMeasure] = useState<Measure | null>(null);
useEffect(() => {
  void (async () => {
    const { PDFDocument } = await import("pdf-lib");
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    const fonts = await fontsPromise;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(fonts.regular);
    const semibold = await doc.embedFont(fonts.semibold);
    const bold = await doc.embedFont(fonts.bold);
    setMeasure(() => (text: string, size: number, isBold: boolean) =>
      (isBold ? bold : regular).widthOfTextAtSize(text, size));
    void semibold; // keep if you decide semibold should back the bold flag
  })();
}, []);
```

Match whichever face the renderer uses for each element so boxes line up;
`drawLine` uses semibold for `line.bold` and the Bold face only for the
wordmark and beer name.

- [ ] **Step 2: Add the click handler**

The art canvas fills the container and the container's aspect ratio is
locked to `PAGE.w / PAGE.h`, so a click maps proportionally off the
bounding rect:

```tsx
function onClick(e: React.MouseEvent<HTMLDivElement>) {
  if (!onPick || !measure) return;
  const r = e.currentTarget.getBoundingClientRect();
  const xPt = ((e.clientX - r.left) / r.width) * PAGE.w;
  const yPt = ((e.clientY - r.top) / r.height) * PAGE.h;
  onPick(hitTest(xPt, yPt, measure, cfg));
}
```

Attach it to the outer wrapper div. `ResizablePanelGroup` is absolutely
positioned over the canvases and will swallow clicks — give it
`pointer-events-none` and restore `pointer-events-auto` on
`ResizableHandle` only, so dragging the divider still works.

- [ ] **Step 3: Draw the selection outline**

An absolutely-positioned div sized from `boxOf(selected, cfg, measure)`,
expressed as percentages of `PAGE.w` / `PAGE.h`, with
`pointer-events-none` and a 1px ring in `--color-ring`.

- [ ] **Step 4: Verify in the browser**

Click the beer name on the preview — the properties panel opens headed "Beer
name" and an outline appears around it. Click empty background — selection
clears. Drag the divider — still works.

- [ ] **Step 5: Type-check, test, commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/components/PreviewCompare.tsx src/App.tsx
git commit -m "Preview: click an element to select and style it"
```

---

### Task 8: Consolidate export

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the four flat buttons**

One primary **Export** button opening a menu with "Print PDFs (art + mask)"
and "Photoshop PSD". Save config and Load config become quiet ghost buttons
beside it, or entries in the same menu. The ⌘K palette keeps all four
actions exactly as they are.

`DropdownMenu` is not currently vendored; either add it
(`npx shadcn@latest add dropdown-menu`) or use `Popover`, which is already
present and sufficient for a two-item menu.

- [ ] **Step 2: Verify in the browser**

Both exports still download and produce valid files; the ⌘K palette still
lists every action.

- [ ] **Step 3: Type-check, test, commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/App.tsx
git commit -m "Export: one primary action with a menu"
```

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| This beer / Brand template split | 5 |
| No swatches in the primary band | 5 |
| Contextual style panel on selection | 4, 5 |
| Deviation marker + one-click reset | 1 (`isDefaultStyle`), 4, 5 |
| Preview click-to-select, in scope | 3, 7 |
| WYSIWYG multiline description | 6 |
| Storage stays the markdown string | 2, 6 |
| Export consolidation | 8 |
| Existing configs load unchanged | Global constraint; no schema change |

**Deliberate gap:** the spec's "apply to all text" bulk fill has no task. It
is a small addition to `StyleProperties` once Task 1 exists — iterate
`ELEMENTS` applying the chosen fill — and is the least load-bearing item in
the spec. Add it as Task 9 if wanted.

**Type consistency:** `ElementId`, `elementById`, `applyStyle` and
`isDefaultStyle` are defined in Task 1 and used under those exact names in
Tasks 3, 4, 5 and 7. `serializeDescription` is defined in Task 2 and used in
Task 6. `hitTest`, `boxOf` and `Measure` are defined in Task 3 and used in
Task 7. `EditorLine`, `markdownToLines` and `linesToMarkdown` are defined
and used within Task 6.

**Known risk:** Task 6's `contenteditable` is the least predictable piece —
caret preservation across React re-renders is the usual failure. The pure
helpers are tested independently of the DOM, and the "edit as text" escape
hatch is the fallback if the rich field proves troublesome.

**Ordering note:** Tasks 1–4 are independent of the UI and can land without
any visible change. Task 5 is the first task a user would notice. Tasks 6, 7
and 8 are independent of each other once 5 has landed.
