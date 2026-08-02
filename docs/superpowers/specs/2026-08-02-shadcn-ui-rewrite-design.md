# Spec: React + Tailwind + shadcn/ui rewrite of the label-generator UI

Date: 2026-08-02
Status: approved

## Goal

Replace the vanilla-TS frontend (`index.html` + `src/main.ts` + `src/style.css`)
with a React app styled with Tailwind CSS v4 and shadcn/ui, using a full
Linear-style neutral dark theme (no gold accent). UI-only rewrite: behavior is
identical to the current app.

## Stack

- Vite + React 19 (`react`, `react-dom`, `@vitejs/plugin-react`)
- Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`)
- shadcn/ui, new-york style, neutral base color; components added via the CLI
  (`Button`, `Input`, `Select`, `Checkbox`, `Textarea`, `Label`)
- shadcn runtime deps: `class-variance-authority`, `clsx`, `tailwind-merge`,
  Radix primitives, `lucide-react`

## Untouched

All label logic and its tests: `src/types.ts`, `src/defaults.ts`, `src/upc.ts`,
`src/maskimage.ts`, `src/qr.ts`, `src/description.ts`, `src/layout.ts`,
`src/pdf/build.ts`, `scripts/generate.ts`, `tests/*`.

## Replaced

- `src/main.ts`, `src/style.css` — deleted
- `index.html` — slims to a `#root` mount + script tag
- New files:
  - `src/main.tsx` — React entry
  - `src/App.tsx` — owns all state (`LabelConfig`, texture, mask, errors,
    PDF blob URLs); 600 ms debounced regenerate; two-pane layout
    (fixed-width form sidebar left, previews filling the rest)
  - `src/components/LabelForm.tsx` — form rows built from shadcn primitives
  - `src/components/FileDrop.tsx` — drag-and-drop file targets
  - `src/components/ui/*` — shadcn-generated primitives
  - `src/index.css` — Tailwind entry + theme tokens

## Theme

Linear neutral dark: near-black background, zinc grays, muted indigo accent,
13 px base font, tight (~28 px) row heights, 1 px subtle borders, uppercase
micro-headings for form sections. No gold anywhere.

## Behavior parity (acceptance criteria)

1. Texture and mask file drops accept click or drag, show the file name, and
   show a drag-over highlight.
2. Mask files are validated (`validateMask`) and recolored
   (`recolorMaskForPdf`) exactly as today.
3. Every form row (beer fields, styled lines with bold checkbox + fill/layer
   selects, QR layer, description textarea with markdown legend, template
   elements) writes into the same `LabelConfig` shape.
4. Validation errors (UPC, mask, missing name/files) are listed; both download
   buttons are disabled until generation is unblocked.
5. Save config downloads `<name>-config.json` via `toConfigFile`; load config
   parses via `parseConfigFile`, re-renders the form, and regenerates.
6. Both PDF previews (`art`, white-ink mask) live-update via embedded blob
   URLs, with old URLs revoked.
7. Downloads are named `<beerName>.pdf` and `<beerName>-mask.pdf`.

## Validation

`tsc --noEmit` clean, `vite build` succeeds, `vitest run` passes, and a
browser smoke test of the dev server exercising the parity checklist.
