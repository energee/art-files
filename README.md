# Label Lab

You fill a master. Label Lab writes the two PDFs the printer wants: the art,
and a white-ink plate where **blue = white ink** and **white = knockout**.
It also exports editable Photoshop files.

**How to use the whole app:** [`docs-site/content/docs`](docs-site/content/docs),
or run the Fumadocs site:

```bash
npm install --prefix docs-site
npm run dev --prefix docs-site   # http://localhost:3000
```

## Develop

```bash
npm install
npm run dev            # browser editor
npm run desktop:dev    # Label Lab native window (needs a stable Rust toolchain)
npm test               # vitest
npx tsc --noEmit
npm run lint           # eslint: react-hooks rules, zero warnings
```

`npm run strokecap` opens the dev-only stroke magnifier, `tools/strokecap.html`,
through the Vite dev server (the page needs it; opening the file directly fails).

`npm run desktop:build` writes the platform installer under
`src-tauri/target/release/bundle/`. Release process (version lockstep,
changelog, updater keys, GitHub Release) is `.agents/release-steward.md`.

## Headless generate

```bash
npm run generate -- beer.master values.json ./out
npm run -s generate -- beer.master --inspect
```

Full flags, batch JSON, and the legacy texture/mask/config argv:
[Headless generate](docs-site/content/docs/(reference)/generate.mdx).

## CMYK for the printer

The app outputs RGB. Before sending to the printer:

```bash
brew install ghostscript   # once
tools/to-cmyk.sh LABRADORITE.pdf LABRADORITE-mask.pdf
```

## Layout

Page, trim and bleed geometry live in `src/layout.ts`. Layer positions and
anchors live in each master. `src/planLayers.ts` plans one display list that
the PDF, canvas and PSD backends draw for both plates, keeping art and mask
registered. Static assets (fonts, the 2025 laurel) are bundled in `src/assets/`.

## Design docs

Specs and implementation plans live under `docs/superpowers/`. They are
engineering history, not the operator guide.
