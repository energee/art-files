# Label Lab

You fill a master. Label Lab writes one print PDF with artwork and an
overprinting **White Ink** spot layer, and an editable Photoshop file with a
**White Ink** spot channel. An optional two-file export writes art/mask
pairs instead (**blue = white ink**, **white = knockout**).

Installers for macOS, Windows and Linux are on
[GitHub Releases](https://github.com/energee/art-files/releases).

**How to use the whole app:** [`docs-site/content/docs`](docs-site/content/docs),
or run the Fumadocs site:

```bash
npm ci --prefix docs-site        # always ci: a drifted install can fail the build
npm run dev --prefix docs-site   # http://localhost:3000
```

## Develop

Node.js 24 (`.nvmrc`, so `nvm use` picks it). The desktop window also needs a
stable Rust toolchain (`rustup toolchain install stable`), plus
`xcode-select --install` on macOS or the WebKitGTK dev packages on Linux.

```bash
npm ci
npm run dev            # browser editor
npm run desktop:dev    # Label Lab native window (needs a stable Rust toolchain)
npm test               # vitest
npx tsc --noEmit
npm run lint           # eslint: react-hooks rules, zero warnings
npx knip@6.38.0        # dead code (CI runs it after the tests)
npm run build          # production bundle (vite build)
```

PDF regression tests require Poppler and Ghostscript (`brew install poppler
ghostscript` on macOS). CI installs both before running the suite.

`npm run strokecap` opens the dev-only stroke magnifier, `tools/strokecap.html`,
through the Vite dev server (the page needs it; opening the file directly fails).

The browser editor is always at http://localhost:5173. If something else holds
that port, Vite stops instead of moving, because the desktop window only looks
at 5173. Run a second browser-only copy with `npx vite --port 5174`.

`npm run desktop:build` writes the platform installer under
`src-tauri/target/release/bundle/`: a `.app` and DMG on macOS, an NSIS
`setup.exe` on Windows, an AppImage on Linux (Debian 13 "trixie" and newer).
Local Mac builds are ad-hoc signed. The release workflow signs and notarizes
for macOS and signs the Windows installer once its signing secrets are set
(see `.github/workflows/release.yml`); until then published Mac builds are
ad-hoc signed and Windows builds unsigned. Release process (version lockstep,
changelog, updater keys, GitHub Release) is `.agents/release-steward.md`.

## Headless generate

```bash
npm run generate -- beer.master values.json ./out
npm run -s generate -- beer.master --inspect
```

Full flags and batch JSON:
[Headless generate](docs-site/content/docs/(reference)/generate.mdx). The legacy
texture/mask/config argv, kept for golden re-baselines, is in
[`docs/goldens.md`](docs/goldens.md).

## CMYK for the printer

The print PDF is PDF/X-4 with an sRGB output intent, which the printer
accepts as is. A fill typed as `cmyk(c,m,y,k)` prints exactly those inks.
For a CMYK-only printer, `tools/to-cmyk.sh LUPULA.pdf` (Ghostscript)
still converts an export.

## Layout

Page, trim and bleed geometry live in `src/layout.ts`. Layer positions and
anchors live in each master. `src/planLayers.ts` plans one display list that
the PDF, canvas and PSD backends draw for both plates, keeping art and mask
registered. Static assets (fonts, the 2025 laurel) are bundled in `src/assets/`.

## Design docs

Specs and implementation plans live under `docs/superpowers/`. They are
engineering history, not the operator guide.
