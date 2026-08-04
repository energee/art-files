# Authoring UX redesign

Date: 2026-08-04
Status: design, awaiting review

## Problem

The sidebar presents eleven rows at equal visual weight, each carrying a
swatch chip that hides four controls (fill, layer, bold, outer stroke). That
is ~44 latent decisions on screen at all times.

Two facts make this the wrong shape:

1. **The rows are two different kinds of thing.** `Name`, `Subtitle`, `ABV`,
   `UPC` and the description change every beer. `Wordmark`, `Logo`,
   `Handle/addr`, `Warning` and `Store cold` are brand template, set once.
   They currently look identical.
2. **The style defaults are near-certain.** Gold is the default fill. White
   ink versus metallic is driven by the texture and mask upload, not chosen
   per element — text is usually metallic. So of those 44 decisions, roughly
   two get touched per beer.

Usage is *one new beer, occasionally*. Between sessions there is no muscle
memory, so the interface has to re-teach itself. That rules out hidden
syntax (the description's markdown) and argues for correct-by-default with
deviation available, rather than every option presented as an open question.

## Design

### Structure

The sidebar becomes two bands plus a contextual panel.

**This beer** — only what changes, in fill-in order:

- Texture, and optional metallic mask. These come first because they drive
  the ink decisions.
- Name
- Subtitle
- ABV and UPC paired on one row (both short)
- Hops list

No style swatches in this band.

**Brand template** — collapsed, with a count badge so it reads as populated
without opening: Wordmark, Logo, Handle/addr, Warning, Store cold.
Capability unchanged from today.

This re-collapses what was deliberately flattened earlier. The justification
is the set-once/per-beer split above; if the original objection was to
disclosure triangles as such, the same hierarchy can be achieved with visual
de-emphasis on one continuous page instead.

### Contextual styling (the core change)

Modelled on Photoshop's properties panel: **style controls appear only for
the element currently being edited.** Gold and metallic apply silently
everywhere else.

- Focusing a text field, or clicking an element in the preview, selects that
  element.
- A properties panel then shows that element's fill, layer, bold and outer
  stroke — the same controls `StylePopover` has today.
- Deselecting hides it. There is no permanent swatch column.

Nothing is removed: every element remains fully stylable. The change is that
the control surface is summoned by selection rather than always resident.

Two affordances keep the uncommon case cheap:

- **Deviation marker.** An element whose style differs from the
  gold/metallic default carries a marker in its row and a one-click reset,
  so a beer's changes stay visible without a permanent swatch grid.
- **Apply to all text.** When a beer's whole palette shifts (copper rather
  than gold) that is one decision, not eleven. Offered from the fill picker.

### Preview selection

Clicking an element in the preview selects it, highlights its row, and opens
its properties. Hit-testing maps click coordinates to label points using the
existing `src/layout.ts` geometry plus font metrics for text extents; the
same box data already drives both renderers.

This is where direct manipulation earns its cost — colour is a judgement
about how an element reads against a particular texture, so it should be
adjustable on the thing you are looking at. It is in scope for this change,
not deferred: without it the contextual panel is only reachable by hunting
for the right field, which is the problem being solved.

### Description input

The description's markdown subset (`# header`, `**bold**`, `_white ink_`)
is a language that has to be relearned every session. It stays a **single
multiline field**, but becomes WYSIWYG: the syntax disappears and the
styling becomes visible.

- A `contenteditable` region, one block element per label line — so it still
  reads and behaves as one multiline field, not a stack of separate inputs.
- Each line renders in its actual appearance: Poppins, gold `#D0B070` for
  metallic lines, white for white-ink lines, semibold when bold, larger for
  the header. The dark sidebar means both gold and white lines are legible
  as themselves, so the field previews the label rather than describing it.
- Bold and white-ink are **toggles acting on the caret's line** (or every
  line in the selection), following the same contextual rule as the rest of
  the redesign — they appear when the field has focus.
- Paste is coerced to plain text, so pasting a hop list from elsewhere
  cannot import foreign markup.
- An "edit as text" escape hatch exposes the raw markdown for power use.

**Storage is unchanged.** `LabelConfig.description` stays the markdown
string, so saved configs round-trip and both renderers keep working.
`parseDescription` already reads it; this adds the serialiser.

### Export

Four flat buttons (`Export PDFs`, `Export PSD`, `Save config`, `Load config`)
become one primary **Export** with a menu — Print PDFs (art + mask), and
Photoshop PSD. Save/Load config demote to a quieter control; they are file
management, not the main act.

## Out of scope

- Autosaving work to `localStorage`. Valuable for occasional use, but it
  interacts badly with changing defaults in code (a stale saved config
  silently overriding a new default has already caused confusion once) and
  needs a deliberate "new label" reset. Separate change.
- Undo/redo.
- Any change to the renderers, the layout constants, or the config schema.

## Success criteria

- The primary surface drops from 11 rows to 6 fields, with no capability
  removed — every element remains fully stylable.
- Styling an arbitrary element takes at most two actions from a cold start
  (select it, adjust), reachable either from its field or from the preview.
- No syntax has to be remembered to author the description; its styling is
  visible in the field as you type.
- Existing saved config JSON loads unchanged.
