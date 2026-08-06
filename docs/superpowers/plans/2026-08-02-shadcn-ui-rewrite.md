# shadcn UI Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the label-generator frontend as a React + Tailwind v4 + shadcn/ui app with a Linear-neutral dark theme, plus three functional changes: free hex fill colors, QR payload derived from the beer name, and QR fill/stroke pickers.

**Architecture:** Label logic (`src/*.ts`, `src/pdf/build.ts`) stays framework-free; the `Fill` type changes from an enum to `#rrggbb | "none"` and the QR becomes derived + colorable. The UI is rebuilt as React components (`src/App.tsx`, `src/components/*`) that own a single `LabelConfig` state and call the same `buildArtPdf`/`buildMaskPdf`.

**Tech Stack:** Vite, React 19, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui (new-york, neutral), pdf-lib (unchanged), vitest (core logic only — UI is validated by `tsc`, `vite build`, and a browser smoke test).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-shadcn-ui-rewrite-design.md` — read it first.
- Default gold is exactly `#D0B070`; UI theme is Linear neutral dark (zinc grays, muted indigo accent `#6E79D6`), **no gold in the UI chrome**.
- QR payload is always `https://lolev.beer/beer/<machine-name>`; machine name = lowercase, non-alphanumeric runs → single `-`, trimmed of leading/trailing `-`.
- `Fill` = `` `#${string}` `` or `"none"`; `"none"` means no ink (draws white in the art PDF, exactly like the old `"white"`).
- Legacy config migration: `gold` → `#D0B070`, `black` → `#000000`, `white` → `none`; `qrData` ignored; missing `qrFill` → `#D0B070`, missing `qrStroke` → `none`.
- Base UI font size 13px; headings use the bundled Poppins.
- Commit after every task. Never commit with failing tests or `tsc` errors.
- All commands run from the repo root `/Users/tedslesinski/Repos/art-files`.

---

### Task 1: Hex Fill core

**Files:**
- Modify: `src/types.ts` (Fill type + doc comments)
- Modify: `src/layout.ts` (add `GOLD`, keep `COLORS` for white/black/maskBlue)
- Modify: `src/pdf/build.ts:41-43` (`fillColor` parses hex)
- Modify: `src/description.ts` (emit hex/none fills)
- Modify: `src/defaults.ts` (defaults use hex; `parseConfigFile` migrates legacy fills)
- Test: `tests/core.test.ts`

**Interfaces:**
- Produces: `type Fill = \`#${string}\` | "none"`; `export const GOLD: Fill = "#D0B070"` (from `src/layout.ts`); `parseHexFill(fill: Fill): {r,g,b}` exported from `src/layout.ts`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write failing tests**

Append to `tests/core.test.ts`:

```ts
import { GOLD, parseHexFill } from "../src/layout";

describe("hex fills", () => {
  it("parses hex fills to rgb 0-1", () => {
    expect(parseHexFill("#D0B070")).toEqual({ r: 208 / 255, g: 176 / 255, b: 112 / 255 });
    expect(parseHexFill("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexFill("none")).toEqual({ r: 1, g: 1, b: 1 }); // no ink = white in art
  });

  it("migrates legacy named fills in config files", () => {
    const legacy = toConfigFile(defaultConfig()) as Record<string, unknown>;
    (legacy.nameStyle as Record<string, string>).fill = "gold";
    (legacy.warning as Record<string, string>).fill = "black";
    (legacy.styleLine as Record<string, string>).fill = "white";
    const cfg = parseConfigFile(JSON.stringify(legacy));
    expect(cfg.nameStyle.fill).toBe(GOLD);
    expect(cfg.warning.fill).toBe("#000000");
    expect(cfg.styleLine.fill).toBe("none");
  });
});
```

Then update existing description-parser expectations in `tests/core.test.ts` (~lines 71-94): `fill: "gold"` → `fill: "#D0B070"`, `fill: "white"` → `fill: "none"` **only in expected parser OUTPUT**. Leave legacy-format INPUT objects (the `descriptionLines` migration test input) with their old string values — that's the point of the migration.

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `npx vitest run`
Expected: FAIL — `parseHexFill` not exported; fill mismatches.

- [ ] **Step 3: Implement**

`src/types.ts` — replace the `Fill` type and its comment:

```ts
/** Fill color drawn in the art PDF: a "#rrggbb" hex string, or "none"
 *  meaning no ink (draws white; stock/white ink shows through). */
export type Fill = `#${string}` | "none";
```

Also update the `LabelConfig` doc comments that mention "gold metallic" for description/QR to say "default gold (#D0B070)".

`src/layout.ts` — replace the `COLORS` block:

```ts
/** Default metallic gold, sampled from the Labradorite reference render.
 *  (Hex of the old rgb 0.815/0.69/0.44.) */
export const GOLD = "#D0B070" as const;

/** Fixed drawing colors (RGB 0-1). Element fills are free hex now — these
 *  remain for the barcode, mask, and "none" handling. */
export const COLORS = {
  white: { r: 1, g: 1, b: 1 },
  black: { r: 0.1, g: 0.1, b: 0.1 },
  maskBlue: { r: 0, g: 156 / 255, b: 215 / 255 },
};

/** Parse a Fill to rgb 0-1. "none" = no ink = white in the art PDF. */
export function parseHexFill(fill: `#${string}` | "none"): { r: number; g: number; b: number } {
  if (fill === "none") return COLORS.white;
  const n = parseInt(fill.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
```

`src/pdf/build.ts` — replace `fillColor`:

```ts
function fillColor(fill: Fill) {
  return toRgb(L.parseHexFill(fill));
}
```

`src/description.ts` — in `styleLine`, replace the return:

```ts
  return {
    text: s,
    bold,
    fill: white ? "none" : GOLD,
    layer: white ? "white" : "metallic",
  };
```

with `import { GOLD } from "./layout";` at the top, and update the header comment (`plain lines are default gold`).

`src/defaults.ts` — import `GOLD` from `./layout`; replace every `fill: "gold"` with `fill: GOLD` and `fill: "black"` with `fill: "#000000"` in `defaultConfig()`. In `parseConfigFile`, after the description migration and before the missing-field check, add:

```ts
  // Legacy fill migration: configs saved before free-hex fills.
  const LEGACY_FILLS: Record<string, string> = { gold: GOLD, black: "#000000", white: "none" };
  for (const k of [
    "nameStyle", "styleLine", "abvStyle", "volume", "wordmark",
    "logo", "handleAddress", "warning", "storeCold",
  ]) {
    const s = cfg[k];
    if (s && typeof s.fill === "string" && s.fill in LEGACY_FILLS) s.fill = LEGACY_FILLS[s.fill];
  }
```

- [ ] **Step 4: Run all tests + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS / clean. (`src/main.ts` still compiles — it never names fill literals.)

- [ ] **Step 5: Commit**

```bash
git add src tests && git commit -m "Fill becomes free hex with 'none' for no ink; legacy configs migrate"
```

---

### Task 2: Derived QR payload + qrFill/qrStroke

**Files:**
- Modify: `src/types.ts` (drop `qrData`, add `qrFill`, `qrStroke`)
- Modify: `src/qr.ts` (add `machineName`, `qrUrl`; `qrPath` gains a `grow` param)
- Modify: `src/pdf/build.ts:262-268` (derived payload, fill + optional stroke)
- Modify: `src/layout.ts` (QR stroke width)
- Modify: `src/defaults.ts` (defaults + migration)
- Modify: `src/main.ts` (drop the QR data row so tsc stays clean)
- Test: `tests/core.test.ts`

**Interfaces:**
- Consumes: `Fill`, `GOLD` from Task 1.
- Produces: `machineName(name: string): string`, `qrUrl(beerName: string): string`, `qrPath(shapes: QrShapes, size: number, grow?: number): string` (all from `src/qr.ts`); `LabelConfig.qrFill: Fill`, `LabelConfig.qrStroke: Fill` (`"none"` = no stroke).

- [ ] **Step 1: Write failing tests**

Append to `tests/core.test.ts`:

```ts
import { machineName, qrUrl } from "../src/qr";

describe("derived QR payload", () => {
  it("machine-names beer titles", () => {
    expect(machineName("Ultra Juice")).toBe("ultra-juice");
    expect(machineName("  Käse & Bier!  ")).toBe("k-se-bier");
    expect(machineName("LABRADORITE")).toBe("labradorite");
  });
  it("builds the beer URL", () => {
    expect(qrUrl("Ultra Juice")).toBe("https://lolev.beer/beer/ultra-juice");
  });
  it("config migration drops qrData and defaults qrFill/qrStroke", () => {
    const legacy = { ...toConfigFile(defaultConfig()), qrData: "https://old.example" } as Record<string, unknown>;
    delete legacy.qrFill;
    delete legacy.qrStroke;
    const cfg = parseConfigFile(JSON.stringify(legacy)) as Record<string, unknown>;
    expect("qrData" in cfg).toBe(false);
    expect(cfg.qrFill).toBe(GOLD);
    expect(cfg.qrStroke).toBe("none");
  });
});
```

- [ ] **Step 2: Run tests, verify failures**

Run: `npx vitest run`
Expected: FAIL — `machineName`/`qrUrl` not exported.

- [ ] **Step 3: Implement**

`src/types.ts` — in `LabelConfig`, replace

```ts
  /** QR code payload (URL). QR modules are gold; layer assignable. */
  qrData: string;
  qrLayer: Layer;
```

with

```ts
  /** QR payload is derived: https://lolev.beer/beer/<machineName(beerName)>.
   *  Fill is free hex; qrStroke "none" = no stroke, else modules are
   *  outlined in that color (like the barcode's white stroke). */
  qrFill: Fill;
  qrStroke: Fill;
  qrLayer: Layer;
```

`src/qr.ts` — add near the top:

```ts
/** Beer title -> machine name: lowercase, non-alphanumeric runs -> "-". */
export function machineName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function qrUrl(beerName: string): string {
  return `https://lolev.beer/beer/${machineName(beerName)}`;
}
```

and change `qrPath` to accept a stroke-underlay growth (grow expands solid circles and shrinks punched holes, mirroring the barcode's expanded-underlay technique):

```ts
export function qrPath(shapes: QrShapes, size: number, grow = 0): string {
  const parts: string[] = [];
  const ms = shapes.moduleSize * size;
  for (const d of shapes.dots)
    parts.push(circle(d.cx * size, d.cy * size, ms * 0.5 * 0.92 + grow));
  for (const f of shapes.finders) {
    parts.push(circle(f.cx * size, f.cy * size, 3.5 * ms * 0.95 + grow));
    parts.push(circle(f.cx * size, f.cy * size, 2.3 * ms - grow, true));
    parts.push(circle(f.cx * size, f.cy * size, 1.4 * ms + grow));
  }
  return parts.join(" ");
}
```

`src/layout.ts` — add a stroke width to `QR` (matches `BARCODE.stroke`):

```ts
export const QR = { x: 23, yTop: 289, size: 59, stroke: 0.55 };
```

`src/pdf/build.ts` — add `qrUrl` to the `../qr` import; replace the QR block in `drawElements`:

```ts
  // QR — payload derived from the beer name; optional stroked underlay.
  const shapes = qrShapes(qrUrl(cfg.beerName));
  const qrAt = { x: L.QR.x, y: y(L.QR.yTop) };
  if (mode === "art" && cfg.qrStroke !== "none")
    page.drawSvgPath(qrPath(shapes, L.QR.size, L.QR.stroke), {
      ...qrAt, color: fillColor(cfg.qrStroke),
    });
  const qrColor = mode === "art" ? fillColor(cfg.qrFill) : maskColor(cfg.qrLayer);
  page.drawSvgPath(qrPath(shapes, L.QR.size), { ...qrAt, color: qrColor });
```

`src/defaults.ts` — in `defaultConfig()` replace `qrData: "https://lolev.beer",` with `qrFill: GOLD, qrStroke: "none",`. In `parseConfigFile`, next to the fill migration add:

```ts
  delete cfg.qrData; // payload is derived from beerName now
  cfg.qrFill ??= GOLD;
  cfg.qrStroke ??= "none";
```

`src/main.ts` — the old UI still references `cfg.qrData` (plainRow "QR data"); delete that row so `tsc` stays clean (the whole file is deleted in Task 3).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src tests && git commit -m "QR: payload derived from beer name; qrFill + optional qrStroke"
```

---

### Task 3: React + Tailwind + shadcn scaffold

**Files:**
- Modify: `package.json` (via npm install)
- Create: `vite.config.ts`, `components.json`, `src/index.css`, `src/lib/utils.ts`, `src/main.tsx`, `src/App.tsx`
- Modify: `index.html`, `tsconfig.json`
- Delete: `src/main.ts`, `src/style.css`

**Interfaces:**
- Produces: the `@/` path alias (→ `src/`); CSS vars `--background --panel --foreground --muted --muted-foreground --border --input --primary --accent --destructive --ring --radius`; `cn()` from `src/lib/utils.ts`; shadcn components in `src/components/ui/` (button, input, select, checkbox, textarea, label, tabs, tooltip, command, dialog).
- Consumes: nothing.

- [ ] **Step 1: Install dependencies**

```bash
npm i react react-dom
npm i -D @vitejs/plugin-react @types/react @types/react-dom tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Vite + TS config**

Create `vite.config.ts`:

```ts
// vite.config.ts — React + Tailwind v4; "@" aliases src/ (shadcn convention).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
```

In `tsconfig.json` `compilerOptions`, add:

```json
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
```

- [ ] **Step 3: Theme CSS + utils + entry + stub App**

Create `src/index.css` (Tailwind v4 + Linear-neutral dark tokens; Poppins is registered for headings):

```css
/* index.css — Tailwind v4 entry + Linear-neutral dark theme tokens.
   The app is dark-only (print studio). Headings use the bundled Poppins. */
@import "tailwindcss";

@font-face {
  font-family: "Poppins";
  src: url("./assets/fonts/Poppins-SemiBold.ttf") format("truetype");
  font-weight: 600;
}

:root {
  --background: #0e0f11;
  --panel: #16171a;
  --foreground: #e2e3e5;
  --muted: #1e2024;
  --muted-foreground: #8b8e94;
  --border: #26282d;
  --input: #1a1c1f;
  --primary: #6e79d6;      /* Linear-style muted indigo */
  --primary-foreground: #ffffff;
  --accent: #23252a;
  --accent-foreground: #e2e3e5;
  --destructive: #d66e6e;
  --ring: #6e79d6;
  --radius: 0.375rem;
}

@theme inline {
  --color-background: var(--background);
  --color-panel: var(--panel);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-ring: var(--ring);
  --font-heading: "Poppins", sans-serif;
}

html { font-size: 13px; }
body { @apply bg-background text-foreground antialiased; }
h1, h2, h3 { font-family: var(--font-heading); }
```

Create `src/lib/utils.ts`:

```ts
// utils.ts — shadcn's class combiner.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Create `src/main.tsx`:

```tsx
// main.tsx — React entry point.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Create `src/App.tsx` (stub for now; Task 6 replaces it):

```tsx
// App.tsx — application shell (stub; replaced by the full app in Task 6).
export default function App() {
  return <h1 className="p-4 text-lg">Lolev Label Generator</h1>;
}
```

Replace `index.html`'s `<body>` with:

```html
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
```

Delete `src/main.ts` and `src/style.css`.

- [ ] **Step 4: shadcn init + components**

Create `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/index.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide"
}
```

Run: `npx shadcn@latest add button input select checkbox textarea label tabs tooltip command dialog --yes`
(This installs `class-variance-authority clsx tailwind-merge lucide-react` and the Radix deps itself. If the CLI balks, install those four plus the needed `radix-ui` packages manually and re-run.)

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit && npx vite build && npx vitest run`
Expected: all clean. Also `npx vite` briefly and confirm the stub heading renders dark at http://localhost:5173.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Scaffold React + Tailwind v4 + shadcn (Linear neutral dark theme)"
```

---

### Task 4: FileDrop and ColorField components

**Files:**
- Create: `src/components/FileDrop.tsx`
- Create: `src/components/ColorField.tsx`

**Interfaces:**
- Consumes: `cn()` (Task 3), `Fill` (Task 1).
- Produces:
  - `FileDrop({ label, accept, fileName, previewUrl, error, onFile }: { label: string; accept: string; fileName?: string; previewUrl?: string; error?: string; onFile: (f: File) => void })`
  - `ColorField({ value, onChange, allowNone }: { value: Fill; onChange: (v: Fill) => void; allowNone?: boolean })`

- [ ] **Step 1: FileDrop**

Create `src/components/FileDrop.tsx`:

```tsx
// FileDrop.tsx — drag-and-drop/click file target with image thumbnail and
// inline error. Thumbnails sit on a checkerboard so mask alpha is visible.
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CHECKER =
  "repeating-conic-gradient(#2a2c31 0% 25%, #1a1c1f 0% 50%) 0 0 / 12px 12px";

export function FileDrop(props: {
  label: string;
  accept: string;
  fileName?: string;
  previewUrl?: string;
  error?: string;
  onFile: (f: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="flex-1">
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) props.onFile(f);
        }}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-2 transition-colors",
          over && "border-primary bg-accent",
        )}
      >
        {props.previewUrl ? (
          <img
            src={props.previewUrl}
            alt=""
            className="size-9 shrink-0 rounded-sm object-cover"
            style={{ background: CHECKER }}
          />
        ) : (
          <div className="size-9 shrink-0 rounded-sm" style={{ background: CHECKER }} />
        )}
        <div className="min-w-0">
          <div className="text-xs font-medium">{props.label}</div>
          <div className="truncate text-xs text-muted-foreground">
            {props.fileName ?? "drop or click"}
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept={props.accept}
          hidden
          onChange={(e) => e.target.files?.[0] && props.onFile(e.target.files[0])}
        />
      </div>
      {props.error && <p className="mt-1 text-xs text-destructive">{props.error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: ColorField**

Create `src/components/ColorField.tsx`:

```tsx
// ColorField.tsx — Fill editor: native color swatch + hex text + optional
// "no ink" toggle rendered as a checkerboard chip ("none").
import { useState } from "react";
import type { Fill } from "@/types";
import { cn } from "@/lib/utils";

const CHECKER =
  "repeating-conic-gradient(#3a3d43 0% 25%, #1a1c1f 0% 50%) 0 0 / 8px 8px";
const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField(props: {
  value: Fill;
  onChange: (v: Fill) => void;
  allowNone?: boolean;
}) {
  const none = props.value === "none";
  // Local text state so a half-typed hex doesn't clobber the config.
  const [text, setText] = useState<string | null>(null);
  const hex = none ? "#ffffff" : props.value;
  return (
    <div className="flex items-center gap-1">
      {props.allowNone !== false && (
        <button
          type="button"
          title='No ink ("none")'
          aria-pressed={none}
          onClick={() => props.onChange(none ? "#D0B070" : "none")}
          className={cn(
            "size-6 shrink-0 rounded-sm border border-border",
            none && "ring-2 ring-ring",
          )}
          style={{ background: CHECKER }}
        />
      )}
      <input
        type="color"
        value={hex}
        disabled={none}
        onChange={(e) => { setText(null); props.onChange(e.target.value as Fill); }}
        className="size-6 shrink-0 cursor-pointer rounded-sm border border-border bg-input p-0 disabled:opacity-30"
      />
      <input
        type="text"
        value={none ? "none" : (text ?? props.value)}
        disabled={none}
        onChange={(e) => {
          setText(e.target.value);
          if (HEX.test(e.target.value)) props.onChange(e.target.value as Fill);
        }}
        onBlur={() => setText(null)}
        className="h-6 w-[4.6rem] rounded-sm border border-border bg-input px-1 font-mono text-xs disabled:opacity-50"
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npx vite build`
Expected: clean.

```bash
git add src/components && git commit -m "FileDrop (thumbnail, inline error) and ColorField (hex + no-ink) components"
```

---

### Task 5: LabelForm

**Files:**
- Create: `src/components/LabelForm.tsx`

**Interfaces:**
- Consumes: `ColorField` (Task 4); shadcn `Input`, `Checkbox`, `Select…`, `Textarea` (Task 3); `LabelConfig`, `Fill`, `StyledLine`, `Layer` types.
- Produces: `LabelForm({ cfg, errors, update }: { cfg: LabelConfig; errors: Record<string, string>; update: (fn: (c: LabelConfig) => void) => void })`. `errors` keys used: `name`, `upc`.

- [ ] **Step 1: Implement**

Create `src/components/LabelForm.tsx`:

```tsx
// LabelForm.tsx — every LabelConfig field as tight Linear-style rows.
// `update` clones the config, applies the mutation, and sets state upstream.
import type { Fill, LabelConfig, Layer, StyledLine } from "@/types";
import { ColorField } from "./ColorField";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Update = (fn: (c: LabelConfig) => void) => void;

function Row(props: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5">
        <span className="w-24 shrink-0 text-muted-foreground">{props.label}</span>
        {props.children}
      </div>
      {props.error && <p className="ml-[6.375rem] text-xs text-destructive">{props.error}</p>}
    </div>
  );
}

function LayerSelect(props: { value: Layer; onChange: (v: Layer) => void }) {
  return (
    <Select value={props.value} onValueChange={(v) => props.onChange(v as Layer)}>
      <SelectTrigger className="h-6 w-24 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="metallic">metallic</SelectItem>
        <SelectItem value="white">white</SelectItem>
      </SelectContent>
    </Select>
  );
}

function StyleControls(props: {
  fill: Fill; layer: Layer;
  onFill: (v: Fill) => void; onLayer: (v: Layer) => void;
}) {
  return (
    <>
      <ColorField value={props.fill} onChange={props.onFill} />
      <LayerSelect value={props.layer} onChange={props.onLayer} />
    </>
  );
}

function TextRow(props: {
  label: string; line: StyledLine; update: Update;
  get: (c: LabelConfig) => StyledLine; editable?: boolean;
}) {
  const { line, update, get } = props;
  return (
    <Row label={props.label}>
      {props.editable !== false && (
        <Input
          className="h-6 min-w-0 flex-1 text-xs"
          value={line.text}
          onChange={(e) => update((c) => { get(c).text = e.target.value; })}
        />
      )}
      <Checkbox
        title="bold"
        checked={!!line.bold}
        onCheckedChange={(v) => update((c) => { get(c).bold = v === true; })}
      />
      <StyleControls
        fill={line.fill} layer={line.layer}
        onFill={(v) => update((c) => { get(c).fill = v; })}
        onLayer={(v) => update((c) => { get(c).layer = v; })}
      />
    </Row>
  );
}

function Heading(props: { children: string }) {
  return (
    <h2 className="mb-1.5 mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">
      {props.children}
    </h2>
  );
}

export function LabelForm(props: {
  cfg: LabelConfig;
  errors: Record<string, string>;
  update: Update;
}) {
  const { cfg, errors, update } = props;
  const style = (label: string, get: (c: LabelConfig) => { fill: Fill; layer: Layer }) => (
    <Row label={label}>
      <StyleControls
        fill={get(cfg).fill} layer={get(cfg).layer}
        onFill={(v) => update((c) => { get(c).fill = v; })}
        onLayer={(v) => update((c) => { get(c).layer = v; })}
      />
    </Row>
  );
  return (
    <div>
      <Heading>Beer</Heading>
      <Row label="Name" error={errors.name}>
        <Input className="h-6 flex-1 text-xs" value={cfg.beerName}
          onChange={(e) => update((c) => { c.beerName = e.target.value; })} />
      </Row>
      {style("Name style", (c) => c.nameStyle)}
      <TextRow label="Subtitle" line={cfg.styleLine} update={update} get={(c) => c.styleLine} />
      <Row label="ABV %">
        <Input className="h-6 flex-1 text-xs" value={cfg.abv}
          onChange={(e) => update((c) => { c.abv = e.target.value; })} />
      </Row>
      {style("ABV style", (c) => c.abvStyle)}
      <Row label="UPC-A" error={errors.upc}>
        <Input className="h-6 flex-1 font-mono text-xs" value={cfg.upc}
          onChange={(e) => update((c) => { c.upc = e.target.value.trim(); })} />
      </Row>
      <Row label="QR">
        <ColorField value={cfg.qrFill} onChange={(v) => update((c) => { c.qrFill = v; })} allowNone={false} />
        <LayerSelect value={cfg.qrLayer} onChange={(v) => update((c) => { c.qrLayer = v; })} />
      </Row>
      <Row label="QR stroke">
        <Checkbox
          title="stroke on/off"
          checked={cfg.qrStroke !== "none"}
          onCheckedChange={(v) =>
            update((c) => { c.qrStroke = v === true ? "#FFFFFF" : "none"; })}
        />
        {cfg.qrStroke !== "none" && (
          <ColorField value={cfg.qrStroke}
            onChange={(v) => update((c) => { c.qrStroke = v; })} allowNone={false} />
        )}
      </Row>

      <Heading>Description</Heading>
      <Textarea
        rows={7} className="font-mono text-xs" value={cfg.description}
        onChange={(e) => update((c) => { c.description = e.target.value; })}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        # header · **bold** · _white ink_ · plain = default gold
      </p>

      <Heading>Template elements</Heading>
      <TextRow label="Volume" line={cfg.volume} update={update} get={(c) => c.volume} />
      {style("Wordmark", (c) => c.wordmark)}
      {style("Logo", (c) => c.logo)}
      <TextRow label="Handle/addr" line={cfg.handleAddress} update={update} get={(c) => c.handleAddress} />
      {style("Warning", (c) => c.warning)}
      <TextRow label="Store cold" line={cfg.storeCold} update={update} get={(c) => c.storeCold} />
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx vite build`
Expected: clean.

```bash
git add src/components && git commit -m "LabelForm: all config rows with shadcn inputs and ColorField"
```

---

### Task 6: App — state, generation, previews, downloads

**Files:**
- Modify: `src/App.tsx` (replace the stub entirely)

**Interfaces:**
- Consumes: everything above; `buildArtPdf`, `buildMaskPdf`, `Assets` from `src/pdf/build`; `validateUpc`, `validateMask`, `recolorMaskForPdf`, `defaultConfig`, `parseConfigFile`, `toConfigFile`.
- Produces: the working app. Leaves a `{/* command palette mounts here (Task 7) */}` marker for Task 7.

- [ ] **Step 1: Implement**

Replace `src/App.tsx`:

```tsx
// App.tsx — owns all state: LabelConfig, texture/mask assets, validation,
// debounced PDF generation, preview mode, and downloads. Mirrors the old
// main.ts wiring, componentized.
import { useEffect, useMemo, useRef, useState } from "react";
import type { LabelConfig } from "@/types";
import { defaultConfig, parseConfigFile, toConfigFile } from "@/defaults";
import { validateUpc } from "@/upc";
import { validateMask, recolorMaskForPdf } from "@/maskimage";
import { buildArtPdf, buildMaskPdf, type Assets } from "@/pdf/build";
import { LabelForm } from "@/components/LabelForm";
import { FileDrop } from "@/components/FileDrop";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import poppinsRegular from "@/assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "@/assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "@/assets/fonts/Poppins-Bold.ttf?url";
import logoSvg from "@/assets/logo2025.svg?raw";

type Loaded = { bytes: Uint8Array; name: string; previewUrl: string };

const fontsPromise = (async () => {
  const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const [regular, semibold, bold] = await Promise.all([
    get(poppinsRegular), get(poppinsSemiBold), get(poppinsBold),
  ]);
  return { regular, semibold, bold };
})();

const blobUrl = (bytes: Uint8Array, type: string) =>
  URL.createObjectURL(new Blob([bytes.slice() as unknown as BlobPart], { type }));

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

export default function App() {
  const [cfg, setCfg] = useState<LabelConfig>(defaultConfig);
  const [texture, setTexture] = useState<(Loaded & { kind: "png" | "jpg" }) | null>(null);
  const [mask, setMask] = useState<(Loaded & { error?: string }) | null>(null);
  const [pdfs, setPdfs] = useState<{ art: string; mask: string } | null>(null);
  const [building, setBuilding] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<"art" | "mask" | "split">("split");
  const configInput = useRef<HTMLInputElement>(null);

  const update = (fn: (c: LabelConfig) => void) =>
    setCfg((c) => { const n = structuredClone(c); fn(n); return n; });

  const upc = useMemo(() => validateUpc(cfg.upc), [cfg.upc]);
  const errors: Record<string, string> = {};
  if (!upc.ok) errors.upc = upc.error!;
  if (!cfg.beerName.trim()) errors.name = "Beer name is required.";
  const blocked = !texture || !mask || !!mask.error || !upc.ok || !cfg.beerName.trim();
  const blockedWhy = [
    !texture && "drop a texture image",
    !mask && "drop a metallic mask PNG",
    mask?.error, errors.upc, errors.name,
  ].filter(Boolean).join(" · ");

  async function onTexture(f: File) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    setTexture({
      bytes, name: f.name, kind: /\.jpe?g$/i.test(f.name) ? "jpg" : "png",
      previewUrl: URL.createObjectURL(f),
    });
  }

  async function onMask(f: File) {
    const bmp = await createImageBitmap(f);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const check = validateMask(data.data);
    recolorMaskForPdf(data.data);
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
    setMask({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      name: f.name,
      previewUrl: URL.createObjectURL(f),
      error: check.ok ? undefined : check.error,
    });
  }

  // Debounced regeneration on any input change.
  useEffect(() => {
    if (blocked) return;
    let stale = false;
    const timer = setTimeout(async () => {
      setBuilding(true);
      const fonts = await fontsPromise;
      const assets: Assets = {
        fonts, logoSvg,
        texture: { bytes: texture!.bytes, kind: texture!.kind },
        maskPng: mask!.bytes,
      };
      const [art, maskPdf] = await Promise.all([
        buildArtPdf(cfg, assets), buildMaskPdf(cfg, assets),
      ]);
      if (stale) return;
      setPdfs((old) => {
        if (old) { URL.revokeObjectURL(old.art); URL.revokeObjectURL(old.mask); }
        return { art: blobUrl(art, "application/pdf"), mask: blobUrl(maskPdf, "application/pdf") };
      });
      setBuilding(false);
    }, 600);
    return () => { stale = true; clearTimeout(timer); };
  }, [cfg, texture, mask, blocked]);

  function saveConfig() {
    const url = blobUrl(
      new TextEncoder().encode(JSON.stringify(toConfigFile(cfg), null, 2)),
      "application/json",
    );
    download(url, `${cfg.beerName || "label"}-config.json`);
    URL.revokeObjectURL(url);
  }

  async function loadConfig(f: File) {
    try {
      setCfg(parseConfigFile(await f.text()));
      setLoadError("");
    } catch (err) {
      setLoadError(String(err));
    }
  }

  const preview = (kind: "art" | "mask", caption: string) => (
    <figure className="flex min-h-0 flex-1 flex-col">
      <figcaption className="mb-1 text-xs text-muted-foreground">{caption}</figcaption>
      <embed
        src={pdfs?.[kind]}
        type="application/pdf"
        className="min-h-0 w-full flex-1 rounded-md border border-border bg-input"
      />
    </figure>
  );

  return (
    <TooltipProvider>
      <main className="flex h-screen">
        <aside className="w-[430px] min-w-[380px] overflow-y-auto border-r border-border p-4">
          <h1 className="mb-3 text-base font-semibold">Lolev Label Generator</h1>
          <div className="flex gap-2">
            <FileDrop label="Texture PNG/JPG" accept="image/png,image/jpeg"
              fileName={texture?.name} previewUrl={texture?.previewUrl}
              onFile={(f) => void onTexture(f)} />
            <FileDrop label="Metallic mask PNG" accept="image/png"
              fileName={mask?.name} previewUrl={mask?.previewUrl} error={mask?.error}
              onFile={(f) => void onMask(f)} />
          </div>
          {loadError && <p className="mt-2 text-xs text-destructive">{loadError}</p>}
          <LabelForm cfg={cfg} errors={errors} update={update} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={saveConfig}>Save config</Button>
            <Button variant="secondary" size="sm" onClick={() => configInput.current?.click()}>
              Load config
            </Button>
            <input ref={configInput} type="file" accept="application/json" hidden
              onChange={(e) => e.target.files?.[0] && void loadConfig(e.target.files[0])} />
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" disabled={blocked || !pdfs}
                    onClick={() => pdfs && download(pdfs.art, `${cfg.beerName}.pdf`)}>
                    Download art
                  </Button>
                </span>
              </TooltipTrigger>
              {blocked && <TooltipContent>{blockedWhy}</TooltipContent>}
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" disabled={blocked || !pdfs}
                    onClick={() => pdfs && download(pdfs.mask, `${cfg.beerName}-mask.pdf`)}>
                    Download mask
                  </Button>
                </span>
              </TooltipTrigger>
              {blocked && <TooltipContent>{blockedWhy}</TooltipContent>}
            </Tooltip>
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col p-3">
          <div className="mb-2 flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
              <TabsList>
                <TabsTrigger value="art">Art</TabsTrigger>
                <TabsTrigger value="mask">White-ink</TabsTrigger>
                <TabsTrigger value="split">Split</TabsTrigger>
              </TabsList>
            </Tabs>
            {building && (
              <span className="animate-pulse text-xs text-muted-foreground">building…</span>
            )}
          </div>
          <div className="flex min-h-0 flex-1 gap-3">
            {view !== "mask" && preview("art", "Art")}
            {view !== "art" && preview("mask", "White-ink layer")}
          </div>
        </section>
        {/* command palette mounts here (Task 7) */}
      </main>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Verify against parity checklist**

Run: `npx tsc --noEmit && npx vite build && npx vitest run` — all clean.
Then `npx vite` and manually verify spec acceptance criteria 1-8 and 10-11 (drops + thumbnails, inline errors, tooltips on disabled buttons, color pickers, QR stroke toggle, save/load, previews with Art/White-ink/Split, building indicator).

- [ ] **Step 3: Commit**

```bash
git add src && git commit -m "App: React state, debounced generation, tabbed previews, inline errors"
```

---

### Task 7: Command palette (⌘K)

**Files:**
- Create: `src/components/CommandMenu.tsx`
- Modify: `src/App.tsx` (mount at the marker, pass actions)

**Interfaces:**
- Consumes: shadcn `CommandDialog` etc. (Task 3); App's `saveConfig`, `configInput`, `download`, `setView`, `blocked`, `pdfs`, `cfg`.
- Produces: `CommandMenu({ actions }: { actions: { label: string; run: () => void; disabled?: boolean }[] })` — opens on ⌘K / Ctrl+K.

- [ ] **Step 1: Implement**

Create `src/components/CommandMenu.tsx`:

```tsx
// CommandMenu.tsx — ⌘K palette exposing the app's actions.
import { useEffect, useState } from "react";
import {
  CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

export function CommandMenu(props: {
  actions: { label: string; run: () => void; disabled?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {props.actions.map((a) => (
          <CommandItem key={a.label} disabled={a.disabled}
            onSelect={() => { setOpen(false); a.run(); }}>
            {a.label}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
```

In `src/App.tsx`, replace the `{/* command palette mounts here (Task 7) */}` marker with:

```tsx
        <CommandMenu
          actions={[
            { label: "Download art PDF", disabled: blocked || !pdfs,
              run: () => pdfs && download(pdfs.art, `${cfg.beerName}.pdf`) },
            { label: "Download mask PDF", disabled: blocked || !pdfs,
              run: () => pdfs && download(pdfs.mask, `${cfg.beerName}-mask.pdf`) },
            { label: "Save config", run: saveConfig },
            { label: "Load config", run: () => configInput.current?.click() },
            { label: "Preview: Art", run: () => setView("art") },
            { label: "Preview: White-ink", run: () => setView("mask") },
            { label: "Preview: Split", run: () => setView("split") },
          ]}
        />
```

and add `import { CommandMenu } from "@/components/CommandMenu";`.

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npx vite build`; in `npx vite`, press ⌘K and run a preview-mode action.

```bash
git add src && git commit -m "Command palette (⌘K) for downloads, config, and preview modes"
```

---

### Task 8: Docs + final validation

**Files:**
- Modify: `README.md` (UI description, new deps, hex fills, derived QR, config migration note)
- Modify: `docs/*` if any other doc references `qrData`, gold/white/black fills, or `main.ts` (grep first)

**Interfaces:** none.

- [ ] **Step 1: Update docs**

`grep -rn "qrData\|main.ts\|style.css\|\"gold\"" README.md docs --include="*.md"` and update every hit: the UI is React + Tailwind + shadcn; fills are hex (`#rrggbb`) or `none`, edited via per-row swatch popovers; QR payload is derived (`https://lolev.beer/beer/<machine-name>`) with fill + optional stroke; legacy configs auto-migrate on load; previews are pdf.js-rendered bitmaps in an overlay-compare frame (drag the divider to reveal the white-ink layer; no embedded PDF viewer); **Export PDFs** downloads both files; ⌘K palette for all actions.

Note: Tasks 9 and 10 (below) execute BEFORE this task — this task is always last.

- [ ] **Step 2: Full validation**

Run: `npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all clean. Then run the browser smoke test against `npx vite` covering all 11 spec acceptance criteria, including loading a pre-rewrite config JSON (create one by hand-editing a saved file: add `"qrData"`, set fills back to `"gold"`/`"white"`, remove `qrFill`/`qrStroke`).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "Docs: React/shadcn UI, hex fills, derived QR"
```

---

### Task 9: Progressive disclosure — StylePopover, merged rows, collapsed template, quiet actions

**Files:**
- Create: `src/components/StylePopover.tsx`
- Modify: `src/components/LabelForm.tsx` (replace entirely with the version below)
- Modify: `src/App.tsx` (actions row only: Export PDFs primary + ghost Save/Load)
- Modify: `package.json` (via shadcn CLI)

**Interfaces:**
- Consumes: `ColorField` (Task 4, unchanged — it moves inside the popover); shadcn `Popover`, `Collapsible` (added here via CLI); existing `LabelForm({ cfg, errors, update })` contract with App (unchanged).
- Produces: `StylePopover({ fill, layer, onFill, onLayer, bold?, onBold?, stroke?, onStroke?, allowNone? })` — the single visible style control per row. `bold`/`onBold` present = bold toggle shown; `stroke`/`onStroke` present = QR stroke section shown.

- [ ] **Step 1: Add shadcn components**

Run: `npx shadcn@latest add popover collapsible --yes`

- [ ] **Step 2: StylePopover**

Create `src/components/StylePopover.tsx`:

```tsx
// StylePopover.tsx — a row's single visible style control: a swatch chip
// showing the current fill; its popover holds the full editor (ColorField,
// layer select, optional bold toggle, optional QR stroke section).
import type { Fill, Layer } from "@/types";
import { ColorField } from "./ColorField";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const CHECKER =
  "repeating-conic-gradient(#3a3d43 0% 25%, #1a1c1f 0% 50%) 0 0 / 8px 8px";

export function StylePopover(props: {
  fill: Fill;
  layer: Layer;
  onFill: (v: Fill) => void;
  onLayer: (v: Layer) => void;
  bold?: boolean;
  onBold?: (v: boolean) => void;
  stroke?: Fill;
  onStroke?: (v: Fill) => void;
  allowNone?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Style"
          className="size-6 shrink-0 cursor-pointer rounded-sm border border-border"
          style={
            props.fill === "none"
              ? { background: CHECKER }
              : { background: props.fill }
          }
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Fill</Label>
          <ColorField value={props.fill} onChange={props.onFill} allowNone={props.allowNone} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Layer</Label>
          <Select value={props.layer} onValueChange={(v) => props.onLayer(v as Layer)}>
            <SelectTrigger className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="metallic">metallic</SelectItem>
              <SelectItem value="white">white</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {props.onBold && (
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Bold</Label>
            <Checkbox checked={!!props.bold} onCheckedChange={(v) => props.onBold!(v === true)} />
          </div>
        )}
        {props.onStroke && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Stroke</Label>
              <Checkbox
                checked={props.stroke !== "none"}
                onCheckedChange={(v) => props.onStroke!(v === true ? "#FFFFFF" : "none")}
              />
            </div>
            {props.stroke !== "none" && (
              <ColorField value={props.stroke!} onChange={props.onStroke!} allowNone={false} />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: LabelForm rewrite**

Replace `src/components/LabelForm.tsx` entirely:

```tsx
// LabelForm.tsx — every LabelConfig field as calm two-control rows: a text
// input (where editable) plus ONE StylePopover swatch. Style details live in
// the popover; template rows live in a collapsed section.
import { ChevronRight, Info } from "lucide-react";
import type { Fill, LabelConfig, Layer, StyledLine } from "@/types";
import { StylePopover } from "./StylePopover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Update = (fn: (c: LabelConfig) => void) => void;

function Row(props: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5">
        <span className="w-24 shrink-0 text-muted-foreground">{props.label}</span>
        {props.children}
      </div>
      {props.error && <p className="ml-[6.375rem] text-xs text-destructive">{props.error}</p>}
    </div>
  );
}

function TextRow(props: {
  label: string; line: StyledLine; update: Update;
  get: (c: LabelConfig) => StyledLine;
}) {
  const { line, update, get } = props;
  return (
    <Row label={props.label}>
      <Input
        className="h-6 min-w-0 flex-1 text-xs"
        value={line.text}
        onChange={(e) => update((c) => { get(c).text = e.target.value; })}
      />
      <StylePopover
        fill={line.fill} layer={line.layer} bold={!!line.bold}
        onFill={(v) => update((c) => { get(c).fill = v; })}
        onLayer={(v) => update((c) => { get(c).layer = v; })}
        onBold={(v) => update((c) => { get(c).bold = v; })}
      />
    </Row>
  );
}

function Heading(props: { children?: React.ReactNode }) {
  return (
    <h2 className="mb-1.5 mt-4 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
      {props.children}
    </h2>
  );
}

export function LabelForm(props: {
  cfg: LabelConfig;
  errors: Record<string, string>;
  update: Update;
}) {
  const { cfg, errors, update } = props;
  const styleOnly = (label: string, get: (c: LabelConfig) => { fill: Fill; layer: Layer }) => (
    <Row label={label}>
      <StylePopover
        fill={get(cfg).fill} layer={get(cfg).layer}
        onFill={(v) => update((c) => { get(c).fill = v; })}
        onLayer={(v) => update((c) => { get(c).layer = v; })}
      />
    </Row>
  );
  return (
    <div>
      <Heading>Beer</Heading>
      <Row label="Name" error={errors.name}>
        <Input className="h-6 flex-1 text-xs" value={cfg.beerName}
          onChange={(e) => update((c) => { c.beerName = e.target.value; })} />
        <StylePopover
          fill={cfg.nameStyle.fill} layer={cfg.nameStyle.layer}
          onFill={(v) => update((c) => { c.nameStyle.fill = v; })}
          onLayer={(v) => update((c) => { c.nameStyle.layer = v; })}
        />
      </Row>
      <TextRow label="Subtitle" line={cfg.styleLine} update={update} get={(c) => c.styleLine} />
      <Row label="ABV %">
        <Input className="h-6 flex-1 text-xs" value={cfg.abv}
          onChange={(e) => update((c) => { c.abv = e.target.value; })} />
        <StylePopover
          fill={cfg.abvStyle.fill} layer={cfg.abvStyle.layer}
          onFill={(v) => update((c) => { c.abvStyle.fill = v; })}
          onLayer={(v) => update((c) => { c.abvStyle.layer = v; })}
        />
      </Row>
      <Row label="UPC-A" error={errors.upc}>
        <Input className="h-6 flex-1 font-mono text-xs" value={cfg.upc}
          onChange={(e) => update((c) => { c.upc = e.target.value.trim(); })} />
      </Row>
      <Row label="QR">
        <StylePopover
          fill={cfg.qrFill} layer={cfg.qrLayer} allowNone={false}
          onFill={(v) => update((c) => { c.qrFill = v; })}
          onLayer={(v) => update((c) => { c.qrLayer = v; })}
          stroke={cfg.qrStroke}
          onStroke={(v) => update((c) => { c.qrStroke = v; })}
        />
      </Row>

      <Heading>
        Description
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="size-3 cursor-help" aria-label="Description syntax" />
          </TooltipTrigger>
          <TooltipContent># header · **bold** · _white ink_ · plain = default gold</TooltipContent>
        </Tooltip>
      </Heading>
      <Textarea
        rows={7} className="font-mono text-xs" value={cfg.description}
        onChange={(e) => update((c) => { c.description = e.target.value; })}
      />

      <Collapsible>
        <CollapsibleTrigger className="group mt-4 flex w-full items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
          Template
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1.5">
          <TextRow label="Volume" line={cfg.volume} update={update} get={(c) => c.volume} />
          {styleOnly("Wordmark", (c) => c.wordmark)}
          {styleOnly("Logo", (c) => c.logo)}
          <TextRow label="Handle/addr" line={cfg.handleAddress} update={update} get={(c) => c.handleAddress} />
          {styleOnly("Warning", (c) => c.warning)}
          <TextRow label="Store cold" line={cfg.storeCold} update={update} get={(c) => c.storeCold} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
```

- [ ] **Step 4: App actions row**

In `src/App.tsx`, replace the actions `<div className="mt-4 flex flex-wrap gap-2">…</div>` (Save/Load/two download buttons + their tooltips) with:

```tsx
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" disabled={blocked || !pdfs}
                    onClick={() => {
                      if (!pdfs) return;
                      download(pdfs.art, `${cfg.beerName}.pdf`);
                      download(pdfs.mask, `${cfg.beerName}-mask.pdf`);
                    }}>
                    Export PDFs
                  </Button>
                </span>
              </TooltipTrigger>
              {blocked && <TooltipContent>{blockedWhy}</TooltipContent>}
            </Tooltip>
            <Button variant="ghost" size="sm" onClick={saveConfig}>Save config</Button>
            <Button variant="ghost" size="sm" onClick={() => configInput.current?.click()}>
              Load config
            </Button>
            <input ref={configInput} type="file" accept="application/json" hidden
              onChange={(e) => e.target.files?.[0] && void loadConfig(e.target.files[0])} />
          </div>
```

(Individual art/mask downloads remain available via ⌘K. If Task 10 has already run and `pdfs` holds `artUrl`/`maskUrl` instead of `art`/`mask`, use those names.)

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npx vite build && npx vitest run`
Expected: clean / 18 passing.

```bash
git add src package.json package-lock.json && git commit -m "Progressive disclosure: swatch popovers, merged rows, collapsed template, Export button"
```

---

### Task 10: Overlay compare preview (pdf.js bitmaps + resizable divider)

**Files:**
- Create: `src/components/PreviewCompare.tsx`
- Modify: `src/App.tsx` (pdfs state shape, previews section, palette actions)
- Modify: `package.json` (pdfjs-dist; shadcn resizable)

**Interfaces:**
- Consumes: `PAGE` from `@/layout`; shadcn `Resizable*` (added here); existing App state.
- Produces: `PreviewCompare` (forwardRef) with props `{ artBytes: Uint8Array | null; maskBytes: Uint8Array | null }` and handle `{ showArt(): void; showMask(): void }`. App's `pdfs` state becomes `{ artBytes, maskBytes, artUrl, maskUrl }` (URLs only for downloads).

- [ ] **Step 1: Dependencies**

Run: `npm i pdfjs-dist && npx shadcn@latest add resizable --yes`

- [ ] **Step 2: PreviewCompare**

Create `src/components/PreviewCompare.tsx`:

```tsx
// PreviewCompare.tsx — the single preview: both generated PDFs rendered to
// bitmaps via pdf.js and stacked; a resizable divider reveals the white-ink
// layer (left side) over the art (right side). Replaces <embed> + tabs.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PAGE } from "@/layout";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// ponytail: fixed oversample, CSS downscales; add a ResizeObserver only if
// crispness on very large screens ever matters.
const RENDER_SCALE = 2.5;

async function renderPdf(bytes: Uint8Array, canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  // pdf.js transfers the buffer to its worker — hand it a copy.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: RENDER_SCALE });
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
  } finally {
    void doc.destroy();
  }
}

export interface PreviewCompareHandle {
  showArt: () => void;
  showMask: () => void;
}

export const PreviewCompare = forwardRef<
  PreviewCompareHandle,
  { artBytes: Uint8Array | null; maskBytes: Uint8Array | null }
>(function PreviewCompare({ artBytes, maskBytes }, ref) {
  const artCanvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);
  const leftPanel = useRef<ImperativePanelHandle>(null);
  const [split, setSplit] = useState(0); // % width showing white-ink

  useImperativeHandle(ref, () => ({
    showArt: () => leftPanel.current?.resize(0),
    showMask: () => leftPanel.current?.resize(100),
  }));

  useEffect(() => { if (artBytes) void renderPdf(artBytes, artCanvas.current); }, [artBytes]);
  useEffect(() => { if (maskBytes) void renderPdf(maskBytes, maskCanvas.current); }, [maskBytes]);

  return (
    <div
      className="relative m-auto w-full max-w-[900px] overflow-hidden rounded-md border border-border bg-input"
      style={{ aspectRatio: `${PAGE.w} / ${PAGE.h}` }}
    >
      <canvas ref={artCanvas} className="absolute inset-0 h-full w-full" />
      <canvas
        ref={maskCanvas}
        className="absolute inset-0 h-full w-full"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      />
      <ResizablePanelGroup
        direction="horizontal"
        onLayout={(sizes) => setSplit(sizes[0] ?? 0)}
        className="absolute inset-0"
      >
        <ResizablePanel ref={leftPanel} defaultSize={0} minSize={0} />
        <ResizableHandle withHandle className="bg-border/60" />
        <ResizablePanel minSize={0} />
      </ResizablePanelGroup>
      <span className="pointer-events-none absolute bottom-1 left-1.5 text-[10px] text-muted-foreground">
        white-ink
      </span>
      <span className="pointer-events-none absolute bottom-1 right-1.5 text-[10px] text-muted-foreground">
        art
      </span>
    </div>
  );
});
```

- [ ] **Step 3: App integration**

In `src/App.tsx`:

1. Remove the `Tabs` imports, the `view` state, and the whole `preview(kind, caption)` helper + tabbed previews JSX.
2. Add imports: `import { PreviewCompare, type PreviewCompareHandle } from "@/components/PreviewCompare";` and `const previewRef = useRef<PreviewCompareHandle>(null);`
3. Change `pdfs` state to `{ artBytes: Uint8Array; maskBytes: Uint8Array; artUrl: string; maskUrl: string } | null`. In the debounce effect success path:

```tsx
      setPdfs((old) => {
        if (old) { URL.revokeObjectURL(old.artUrl); URL.revokeObjectURL(old.maskUrl); }
        return {
          artBytes: art, maskBytes: maskPdf,
          artUrl: blobUrl(art, "application/pdf"),
          maskUrl: blobUrl(maskPdf, "application/pdf"),
        };
      });
```

4. Update every download call site to `pdfs.artUrl` / `pdfs.maskUrl` (Export button and ⌘K actions).
5. Replace the previews `<section>` content with:

```tsx
        <section className="flex min-w-0 flex-1 flex-col p-3">
          <div className="mb-2 flex h-5 items-center gap-2">
            {building && (
              <span className="animate-pulse text-xs text-muted-foreground">building…</span>
            )}
            {buildError && <span className="text-xs text-destructive">{buildError}</span>}
            {!pdfs && !building && (
              <span className="text-xs text-muted-foreground">
                drop a texture and mask to see the label
              </span>
            )}
          </div>
          <div className="flex min-h-0 flex-1">
            <PreviewCompare ref={previewRef}
              artBytes={pdfs?.artBytes ?? null} maskBytes={pdfs?.maskBytes ?? null} />
          </div>
        </section>
```

6. ⌘K actions become: Download art PDF, Download mask PDF (both `disabled: blocked || !pdfs`, using `artUrl`/`maskUrl`), Save config, Load config, `{ label: "Preview: Art", run: () => previewRef.current?.showArt() }`, `{ label: "Preview: White-ink", run: () => previewRef.current?.showMask() }` (drop "Preview: Split").

- [ ] **Step 4: Verify + commit**

Run: `npx tsc --noEmit && npx vite build && npx vitest run`
Expected: clean / 18 passing. Boot `npx vite` and confirm no console errors on load.

```bash
git add src package.json package-lock.json && git commit -m "Preview: pdf.js bitmaps in overlay-compare frame; drop embed + tabs"
```
