# Lolev Label Generator

Local web app that turns a rock texture + optional metallic mask (from the `label-gen`
repo) plus beer info into the two print-ready 600-DPI PDFs sent to the label
printer:

- `{Beer Name}.pdf` — label art (8x5 in + 0.0633 in bleed, 585.12 x 369.12 pt)
- `{Beer Name}-mask.pdf` — white-ink layer: **blue = white ink, white =
  knockout** (silver stock shows through), same convention as the
  `label-gen/Rocks` mask PNGs. Uploaded masks are embedded as-authored — no
  recoloring or binarization; the printer accepts these plates as delivered.
  (The 3D preview classifies pixels by brightness for its metalness map:
  bright/unsaturated = foil, any ink color = matte white ink.)
  Without an uploaded mask, the plate floods
  full blue (white ink everywhere) rather than knocking out — "no mask"
  means "print as a white label" — and metallic elements still knock back
  out to bare stock on top of the flood.

Every text element — and each description line individually — has a **fill**
(a hex color like `#F3CD80`, or `none` for no ink, drawn in the art PDF) and
a **layer** (`metallic` knocks out of the white layer; `white` gets a
white-ink underlay). Outer strokes have their own independent layer using the
same two choices; all strokes default to `white`/non-metallic, including in
older saved projects that predate the setting. The description block is
authored as a markdown
subset, one label line per line: `# text` = header, `**text**` = bold,
`_text_` = white ink, combinable; plain lines are gold metallic (parsed by
`src/description.ts`). The barcode reproduces JsBarcode's UPC-A rendering,
so it matches the `barcode-qr` app at any scale: all of its geometry is
authored in modules (bars 15, digits 10, text gap 4, guards 24, quiet zone
8 — the module counts that app's options produce) and scaled by one
`UPC_MOD` in `src/layout.ts`. Digits are Poppins Regular in a column right
of the bars, with the number-system and check digits printed outside the
symbol in the quiet zones. It is a stylable element like everything else
(fill, layer, outer stroke), shipping as near-black bars inside a white
halo over white ink. Contrast comes from that halo plus the white ink the
mask lays under the true printed shape — an outset rect per bar plus a pill
per digit group, unioned rather than one bounding rect, so the white ink
doesn't fall short between bars or around the digits — sized from the same
resolved stroke width the art draws, so the two plates stay registered at
any setting. Its stroke ships at 20px (600dpi); configs from
before it was stylable keep their measured ~1.8-module halo. Every halo shape
draws before any bar — interleaving the two distorted the module widths
enough to stop it decoding. The QR code's payload is
derived from the beer name (`https://lolev.beer/beer/<machine-name>`) with
a pickable fill color and optional stroke; the sidebar's QR row shows the
derived URL next to its label, so what gets encoded is visible without
scanning it — there is no separate QR data
field. Design doc:
`docs/superpowers/specs/2026-08-02-label-pdf-generator-design.md`; the UI
rewrite to React + Tailwind + shadcn/ui is documented in
`docs/superpowers/specs/2026-08-02-shadcn-ui-rewrite-design.md`.

Collab labels sit behind a **Collab** switch in the form — with it off nothing
collab draws and its fields stay hidden, which is every non-collab release. On,
it takes up to two logo uploads (SVG, PNG or JPG): the **left** one prints in
the left column under the description, below an automatic bold "A collaborative
project with"; the **center** one prints under the laurel. Each scales to fit
its slot, with a size knob (1 = fit), and each is a stylable element like any
other — an SVG logo takes its slot's fill/layer/stroke, while raster art prints
as-is and gets a white-ink underlay in the mask so it doesn't sit on the
metallic texture.

## Usage

The UI is built with React 19, Tailwind v4, and shadcn/ui (Linear-style
neutral dark theme). The sidebar splits fields by how often they change: **This beer** holds
what's edited every release (name, subtitle, ABV, UPC, QR, description) —
each input doubles as its element's row, so focusing UPC opens the
barcode's style panel the way focusing Name opens the beer name's;
**Brand template** collects the six set-once elements (volume, wordmark,
logo, handle/addr, warning, store cold) behind a collapsed disclosure
with a count badge, since their gold/metallic defaults are correct
almost every time. There are no more per-row swatch chips — a small dot
next to a row's label is the only per-row style signal, flagging a style
that deviates from the shipped gold/metallic default. Selecting an
element — by focusing or clicking its row in the form, or clicking it
directly in the preview, which doubles as a click target and draws a
selection outline around whatever's picked — opens one contextual style
panel below the form (Photoshop's model: only one element's panel is
ever open at a time). Its Fill (color picker with a screen eyedropper on
Chromium/hex field/no-ink toggle),
Layer select, and outer-stroke toggle (its own color, white/metallic layer,
and width in px at the 600dpi deliverable, default 15px ≈ 1.8pt) are on every element's panel —
except that the QR and the barcode omit the no-ink option, since neither
scans without ink, and the barcode's stroke defaults to 20px rather than
the global 15px. Every text element also gets a Tracking field —
letter-spacing in points to two decimals, default 0 — which the PDF applies as a `Tc`
text-state operator, the PSD as Photoshop tracking (1/1000 em), and which
widens centred lines, justified warning columns and click targets alike;
the logo and the two codes omit it, having no glyphs of their own to
space. Tracking and stroke width are scrubby numbers — drag the field's
label to change the value (shift for coarse, alt for fine), or click in
and type. A
Bold checkbox shows for the elements that have one, and a Reset button
(back to that element's shipped default) once a style deviates from it.
The description block's panel sets the base fill/layer for its plain
lines and the header plus an outer stroke for all its lines; the
`_white_` marker moves a line to the white-ink layer per line and leaves
its fill alone; the logo's classic
dark keyline is just this stroke, on by default. Clicking empty
background in the preview clears the selection.

PNG/JPEG files can be dropped anywhere in the browser or packaged Tauri
window to open the background/mask chooser. Dropping directly on an inspector
image field takes precedence and loads that field instead; clicking a field
still opens its file picker.

The description itself is a WYSIWYG multiline field now, not a
raw-markdown textarea: each line renders in its real appearance
(gold/white ink, bold, larger header) instead of `#`/`**`/`_`
punctuation, a toolbar toggles Header/Bold/White ink for whichever
line(s) the caret or selection touches, and "Edit as text" is an escape
hatch back to the raw markdown — storage is unchanged, still the same
markdown-subset string parsed by `src/description.ts`. Markers also apply
INLINE: selecting part of a line and hitting Bold or White ink wraps just
that span, and both renderers split the line into runs (`parseRuns`) and
draw each in its own face and plate. The PSD export carries them as
Photoshop style runs (`{length, style}` overrides on the text layer), so a
mixed line stays ONE editable layer with its faces intact. Inline markers
stay visible as typed characters in the field, which paints per line, not
per run. The **Info** row
(the rotated handle/address line, stored as `handleAddress`) uses that same
editor and the same markers, via `parseInfoLine`: `**bold**` and `_white
ink_` apply over the row's own style. It draws one rotated line, so a
header collapses to bold and only the first line is kept. Plain text
parses to itself, so configs written before this render unchanged. The preview is a single frame: both PDFs
render to bitmaps via pdf.js and stack there, and a draggable divider
reveals the white-ink layer over the art in place — no embedded PDF
viewer, no tabs. Scrolling or pinching over the 2D preview zooms it about
the pointer, up to 2.5x (the oversample the bitmaps are rendered at, past
which zooming would magnify blur rather than detail), and a two-finger —
i.e. right-button — drag pans, under a grabbing cursor. That mapping is
deliberately the one OrbitControls gives the 3D views, so the same habits
work in all four, and it is why the browser's own pinch-zoom and context
menu are suppressed over the pane. The percentage in the toolbar under
the pane reads the zoom in every view and is also how you set it — type a
figure over it, 100 being the way back, so there is no separate reset
button. In 2D it drives the CSS transform, in the 3D views the camera
dolly measured against how that mode frames itself, so 100% means "as
framed" and 200% means twice as close whichever view is up. Typing 100
into a 3D view restores the framing distance but leaves the orbit alone —
the angle is the operator's work, the dolly isn't. 100% is one size, not one number: each 3D view frames so
its label reads the same on-screen height as the 2D sheet, measured to
the label's near face rather than the can's axis, so switching views
changes the subject and not the scale. The can then runs off the top and
bottom of the frame, which is intended — the label is what is being
looked at. The flat view takes its height from the can's own label height
too, rather than the constant it used to carry, so the Settings height
knob moves all four views together. While a rebuild is in flight the stale
render blurs, so what is on screen reads as being replaced rather than
current. The 2D View menu also controls trim-relative rulers and preview-only
guides. Ruler zero sits at the trimmed art's top-left (so bleed reads
negative). The full ruler-corner button displays the current unit and opens a
popover that switches inches/points/600-DPI pixels and edits the safe margin
inset. `npx tsx scripts/check-margins.mts` reports every rotated element's
drawn extent against those guides and solves for the constants that make a run
span them exactly — it counts what `hittest.ts` does not (real glyph ink rather
than the em box, the per-run face, letter-spacing, and the outer stroke, which
paints beyond the ink at both ends), which is what the layout was squared to.
Locked margin and center guides derive
from the 8x5in trim box; drag from either ruler to add a manual guide, drag one
back into a ruler to remove it, press Delete while it is focused, or clear them
from View. The Guides toggle hides or restores all guide types together without
forgetting their individual settings. These are session-only overlays: they
never enter a config or export. Live previews build against a downscaled copy of the
texture/mask (print-size images made every keystroke-triggered rebuild
churn enough memory to crash the tab); downloads always rebuild at full
resolution when clicked. Preview PDF generation runs in a lazy Web Worker,
keeping pdf-lib/fontkit parsing and rendering off the UI thread; the
full-resolution PDF and PSD renderers load only when their export actions are
used. Every action lives in a menubar across the top of
the window, above the sidebar/preview split: **File** (New Project ⌘N — with
an unsaved-changes confirmation before replacing the current label; Open Project… ⌘O,
Save Project ⌘S, Save Project As… ⇧⌘S — the whole label, including its
texture, mask, and collab logos, zipped as a `<beer-name-slug>.label` file
(slugged like the QR URL: lowercase, punctuation to dashes), see
`src/labelfile.ts`; in Chromium these use real open/save dialogs and Save
rewrites the last-saved/opened file in place, elsewhere saving falls back
to a download; then Export PDF,
Export Mask PDF, Export PSDs — see below; the both-PDFs-at-once action lives
in the palette as "Export PDF + Mask PDF"),
**Edit** (undo, redo), and
**View** (Standard / Mask, which jump the divider to either end — the
palette lists them as "Preview: Standard" / "Preview: Mask"). Export items disable while the label is invalid, and the
reason sits in the bar next to the menus. Press <kbd>⌘K</kbd> /
<kbd>Ctrl+K</kbd> for a command palette covering the same actions.

Undo (<kbd>⌘Z</kbd>) and redo (<kbd>⇧⌘Z</kbd> or <kbd>⌘Y</kbd>) cover the
label config only — every field, style tweak, and scrub, but not the loaded
texture/mask files, so stepping back never re-decodes an image. Edits made
within half a second of each other collapse into one step, so a scrub drag
undoes as a single move. The shortcuts stay out of the way while a text
field has focus: there the browser's own per-field undo applies. See
`src/history.ts`.

```bash
npm install
npm run dev        # open the app: the label previews immediately (text on bare
                   # stock), drop a texture + optional mask to fill it in,
                   # previews update live, download both PDFs
```

### Label Lab for macOS

The same editor is available as the **Label Lab** desktop app. Building it
requires the Apple command-line tools and a stable Rust toolchain in addition
to Node.js:

```bash
xcode-select --install       # once per Mac
rustup toolchain install stable
npm run desktop:dev          # run Label Lab in a native development window
npm run desktop:build        # create both Label Lab.app and a DMG installer
```

Release artifacts are written under `src-tauri/target/release/bundle/`. Local
builds receive an ad-hoc signature; distributing the app to other Macs without
security warnings requires authenticated Apple signing and notarization.
The browser build keeps its in-window File/Edit/View menu; the desktop build
removes that duplicate chrome and installs the same actions in the macOS menu
bar, including live checkmarks and disabled states.

#### Automatic updates

Published desktop builds check the latest GitHub Release shortly after launch.
When a signed update is available, Label Lab shows its release notes and asks
before downloading, installing, and restarting. **Label Lab → Check for
Updates…** runs the same check manually. Local development builds skip the
automatic check because they intentionally contain no release key.

One updater signing keypair is required before the first release. Keep the
private key and its password backed up: Tauri cannot update existing installs
if that key is lost.

```bash
npm run tauri -- signer generate -w ~/.tauri/label-lab.key
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/label-lab.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
gh secret set TAURI_UPDATER_PUBLIC_KEY < ~/.tauri/label-lab.key.pub
```

The key generator prompts for the password used by the second secret. To ship
a release, follow the release-steward checklist in `.agents/release-steward.md`:
bump the synchronized application version, add that version's user-facing notes
to `CHANGELOG.md`, and run the metadata check against the latest release tag.
Once that change passes the required metadata check and merges to `main`, the
**Release Label Lab** workflow starts automatically. It validates the version
and notes again, uses that changelog section as the GitHub Release body, builds
Intel and Apple Silicon apps, and creates a `label-lab-v<version>` release on
this (private) repo with the DMGs for manual install. A manual workflow dispatch
remains available for release recovery. Because installed apps cannot read a
private repo, the workflow then copies only the update feed — `latest.json`, the
updater archives, and their signatures — to the repo's public GitHub Pages site
(`https://energ.ee/art-files/`, via the account's custom domain), which is what
the in-app updater
polls. The source and release page stay private; only those update artifacts
are served publicly. Pages must be enabled once with "GitHub Actions" as the
source (Settings → Pages), and publishing Pages from a private repo requires a
paid GitHub plan. The normal `npm run desktop:build` remains a keyless,
ad-hoc-signed local build with updater checks disabled.

### Layered PSD

`src/psd/build.ts` is a second renderer over the same `LabelConfig` and the
same `src/layout.ts` geometry, for handing artwork to a designer. Text
elements become editable Photoshop type layers; the logo and QR become
vector shape layers with real bezier knots. Every element carrying an outer
stroke gets it as an editable **layer effect** (outside, in the stroke's own
colour) — the PDF has to fake a text stroke as a ring of offset copies,
Photoshop has the real thing. The description is ONE type layer holding the
whole block: per-line faces and fills ride along as Photoshop style runs,
and the PDF's line advance becomes the layer's leading. The warning is
likewise one justified, rotated layer whose lines are the columns, wrapped
by the same `wrapWarning` measure the PDF uses. The barcode is one merged shape
layer instead — bars and digit glyph outlines together, bezier — with its
white halo as the same stroke layer effect every other element uses
(omitted when the stroke is `none`); the barcode's digits are not editable
type, a deliberate tradeoff for a single print-ready shape. The texture is
the one raster layer. Layers are grouped as Texture / Left column / Center /
Right column / Codes. Photoshop prompts to update text layers on open
because ag-psd writes the text data without a rendered bitmap — choose
**Update**. The PDFs remain the printer deliverable; the PSD is the editable
handoff.

"Export PSDs" writes the pair: `{Name}.psd` (art) and `{Name}-mask.psd`, the
white-ink plate. The mask PSD mirrors `buildMaskPdf` with the same layers and
geometry (`buildPsd(cfg, assets, "mask")`): a white "Knockout base" flood,
then the recolored mask raster (or, with no mask loaded, a solid white-ink
blue flood — "no mask" means "print as a white label"), then every element
repainted by its layer — metallic knocks out in white, white-layer prints
mask blue, per-run for inline `_white ink_` spans. Every enabled stroke is
repainted the same way from its own layer assignment, as an editable outside
effect beneath the fill. The barcode follows that same independent
stroke/fill composition, exactly like the mask PDF.

Headless (same renderer, used for iteration/batches):

```bash
npm run generate -- <texture.png|none> <mask.png|none> <outDir> [config.json] \
  [--collab-left=<logo.svg|png|jpg>] [--collab-center=<...>]
# writes {Name}.pdf, {Name}-mask.pdf, {Name}.psd and {Name}-mask.psd
```

The Save/Load config buttons round-trip the whole form as JSON (`{version: 1,
...LabelConfig}`, see `src/types.ts`). Config files saved by the pre-rewrite
vanilla-TS UI (named fills like `"gold"`/`"white"`/`"black"`, a `qrData`
field) are auto-migrated on load: `gold` → the current default gold (`#F3CD80`), `black` → `#000000`,
`white` → `none`, and `qrData` is dropped in favor of the derived QR
payload. Configs saved before the barcode carried a style of its own pick
up the colors the renderer used to hardcode, and leave its stroke width
unset so the measured halo is preserved — those files print exactly as
they always have. Configs saved before stroke layers existed acquire a
`white`/non-metallic stroke layer on every element. The app entry point is
`src/main.tsx` (the old
`src/main.ts` / `src/style.css` vanilla-TS UI is gone).

## CMYK for the printer

The app outputs RGB. Before sending to the printer, convert:

```bash
brew install ghostscript   # once
tools/to-cmyk.sh LABRADORITE.pdf LABRADORITE-mask.pdf
```

## Layout

All geometry lives in `src/layout.ts` (points, top-left origin), tuned by
visual comparison against the Photoshop-era `Labradorite.pdf` /
`Labradorite-mask.pdf` reference pair. `src/pdf/build.ts` draws both PDFs from
that single geometry source, so art and mask stay registered. Static assets
(Poppins, the 2025 laurel logo) are bundled in `src/assets/`.

## Tests

```bash
npm test    # vitest: UPC-A encode/validate, QR geometry, mask polarity,
            # config round-trip
```
