# Layer copy and paste between files

Select layers in one tab, press ⌘C, switch to another tab (or window, or app
launch), and press ⌘V. The layers appear in that label, with their text,
images and fonts, and they are saved in its `.label`.

Branch `energee/layer-issues`, worktree `.agents/worktrees/layer-issues/`,
on top of f56a7777 (Add layer → label). No database changes.

## What exists

- **Edit menu.** Copy, Paste and Cut are native menu roles
  (`src/components/AppMenu.tsx:101`). They fire the webview's `copy`/`paste`
  events. Today nothing listens for them outside text fields.
- **Label-only layers** (#264, and now Add layer): a whole layer stored in
  `label.overrides[id]` with `kind`. Pasted layers go here, so ⌘S keeps them.
  `addLabelLayer` (`src/model/editLayers.ts`) already mints ids that don't
  collide.
- **Images.** `onLayerImage` (`src/App.tsx`) reads a file with
  `readCustomImage`, mints an id with `mintCustomAssetId`, and stores it in
  `customImages`. A pasted image goes through the same path.
- **Fonts.** `importedFontBundle(ids)` and `registerImportedFont(id, font)`
  (`src/fonts.ts`) already carry fonts in and out of files.
- **Removal gate.** The Delete key handler (`src/App.tsx`, "Delete /
  Backspace removes the selected layers") decides when a key belongs to the
  canvas rather than a field. Copy and paste use the same gate.

## Proposed defaults (confirm or change at approval)

- **Paste in place.** Pasted layers keep their x/y, so a layer copied between
  two labels on the same master lands in the same spot.
- **Always into the label**, even while switched to a variant. That matches
  Add layer's base behaviour and keeps the paste in ⌘S.
- **Bindings.** A binding to another pasted layer is re-pointed at its new id.
  A binding to a layer that wasn't copied is detached, and the layer stays
  where it was drawn (the same rule `unbindPatch` uses on removal).
- **Contents travel.** The copy holds the layers as they resolve, with their
  text or image filled in. A pasted layer looks exactly like the one you
  copied, not like an empty template.
- **Cut** = copy, then the existing Remove.
- **Out of scope:** pasting into the master, and promoting a pasted
  (label-only) layer to the master. The Save Master review skips label-only
  layers today (`masterChanges`). Pasting images from Finder or other apps is
  out of scope too.

## Clipboard payload

One JSON document on the clipboard under `application/x-label-lab-layers`,
also written as `text/plain` because WebKit can drop custom types across
windows. It's recognised by its `format` field and validated before anything
is used. The clipboard is a trust boundary.

```ts
// src/model/clipboard.ts
export interface LayerClipboard {
  format: "label-lab/layers@1";
  layers: Layer[];                       // resolved, contents filled, in draw order
  boxes: Record<string, Box>;            // measured, for detaching bindings
  images: Record<string, { name: string; base64: string }>; // keyed by asset id
  fonts?: Record<ImportedFontId, ImportedFont>;
}
```

## Tasks

Each task starts by writing its named test and watching it fail.

1. **Copy payload.** Test `tests/model-clipboard.test.ts` ("copyLayers").
   `copyLayers(layers: Layer[], ids: string[], boxes): Omit<LayerClipboard, "images" | "fonts">`
   in `src/model/clipboard.ts`: picks the selected resolved layers in draw
   order. Accept: `vitest` passes and the result keeps each layer's filled
   text. Depends on nothing.
2. **Paste into a doc.** Same test file ("pasteLayers").
   `pasteLayers(doc: Doc, clip: LayerClipboard): { doc: Doc; ids: string[] }`:
   fresh ids where taken (reuses `mintLayerId` and `allIds` via
   `addLabelLayer`'s rule), bindings re-pointed or detached, and each layer
   written to `label.overrides`. Accept: after a paste, `resolveLayers` on the
   untouched master returns the pasted layers with no warnings, and
   `checkLabelBindings` passes. Depends on 1.
3. **Encode and decode.** Same test file ("readClipboard").
   `writeClipboard(clip): string` and
   `readClipboard(text: string): LayerClipboard | null`. Decoding rejects a
   wrong `format`, a non-array `layers`, or a layer `parseMaster` refuses
   (validated by parsing a synthetic master made of the pasted layers).
   Accept: round trip is lossless, and each malformed case returns null.
   Parallel with 2.
4. **Asset carry.** Test `tests/model-clipboard.test.ts` ("clipboard
   assets"). Copy side: base64 of each referenced `customImages` entry's
   bytes, plus `importedFontBundle` of the fonts the layers reference
   (`referencedFontIds`). Paste side: a pure step that re-keys image ids
   with `mintCustomAssetId` and rewrites `asset` on the pasted image layers.
   Accept: a pasted image layer points at a fresh id that is present in the
   returned image map. Depends on 2 and 3.
5. **App wiring.** Test `tests/layer-clipboard-dom.test.tsx`. Add
   `copy`/`cut`/`paste` listeners on `document` in `src/App.tsx`, gated like
   the Delete handler: a field, an open dialog, or a focused toast keeps the
   event. Paste decodes the clipboard, registers images (`readCustomImage` on
   a `File` from the bytes) and fonts, then makes one `edit(pasteLayers)` (one
   undo step) and selects the pasted layers. Accept: in two mounted editors,
   a ClipboardEvent copy in the first and a paste in the second adds the
   layer to the second's label. ⌘Z removes it. Saving and reopening keeps it.
   Depends on 4.
6. **Menu labels.** Test `tests/app-ux-commands-dom.test.tsx`. Add Layer-menu
   entries "Copy Layers" and "Paste Layers" that run the same code, so the ⌘K
   palette and phones (no keyboard) can use them. Phones read the clipboard
   with `navigator.clipboard.readText()` on tap. Add all eight locales.
   Accept: the command list test passes with the locale key parity check.
   Depends on 5.
7. **Docs and changelog.** `docs-site/content/docs/(authoring)/layers.mdx`
   gets a "Copy and paste" paragraph. Add an `[Unreleased]` Added bullet to
   `CHANGELOG.md` and a ledger entry. Accept: `node scripts/check-release.mjs
   origin/main`. Depends on 5.

Parallel: 2 ∥ 3, then 4. Tasks 5, 6 and 7 run in order. Final gate:
`npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, then a real
copy and paste between two tabs in the dev app, plus one in the packaged
desktop build. The desktop check confirms the native Edit menu's Copy/Paste
reach the listener.
