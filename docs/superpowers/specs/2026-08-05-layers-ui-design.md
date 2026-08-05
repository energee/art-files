# Layers UI: Figma-style layout for the label editor

2026-08-05. Approved via brainstorm (visual companion mockups in
`.superpowers/brainstorm/92284-1785948440/content/`).

## Goal

Replace the single 430px everything-sidebar with a three-region,
Figma-style layout: a collapsible left **Layers** panel, the preview
canvas center, and a right **Inspector** showing everything about the
selected layer. Everything that can take fill/stroke/etc. is a layer —
including the texture (Background) and mask (Mask), whose file drops move
onto their layers.

**Scope: UI-only.** No renderer, config-schema, or type changes.
Background/Mask expose Color overlay / Outer stroke switches *disabled*;
render support arrives later, per layer.

## Layout (App.tsx)

- shadcn `SidebarProvider` wrapping the main split.
- Left: shadcn `Sidebar` (`collapsible="offcanvas"`), toggled by a
  `SidebarTrigger` in the menubar row and ⌘B, holding the Layers panel.
- Center: existing `PreviewCompare`, unchanged.
- Right: fixed-width inspector column — a plain bordered column (the
  `Sidebar` component is reserved for the left panel). Collapsed while no
  layer is selected; its header X clears the selection to collapse it.
- Existing menubar stays as top chrome, gains the trigger. Save/load,
  undo/redo, exports, ⌘K palette untouched.

## Layers panel (new `src/components/LayersPanel.tsx`)

- shadcn `SidebarGroup` / `SidebarMenu` / `SidebarMenuItem` /
  `SidebarMenuButton`; lucide type icons.
- Groups, in order:
  - **This beer**: Beer Name, Style, ABV, Description, Barcode, QR,
    Collab lead-in, Collab logo (left), Collab logo (center)
  - **Template**: Volume, Wordmark, Logo, Info, Warning, Store Cold
  - **Document**: Background, Mask
- Row = icon + name + eye toggle. Eye truly hides the layer: the renderer
  (`Assets.hidden`, `src/pdf/build.ts`) skips its ink, stroke and mask
  footprint in both plates, previews and PDF exports alike. Session state,
  never written into saved configs; PSD exports keep every layer. (An
  earlier draft used fill `"none"`, but in this renderer that means "white
  ink", not hidden.) Every element row has an eye, QR/Barcode included —
  hiding is a temporary skip, unlike the ink-less styling their allowNone
  forbids. Background/Mask rows have no eye for now.
- Selecting a row sets the same `selected: ElementId` state the preview's
  click-to-select uses; the two stay in sync. Background/Mask get new
  selectable ids (UI-level only, not `ElementId`s in the renderer sense).
- Collab rows render dimmed while `collabEnabled` is off.

## Inspector (rework of `src/components/StyleProperties.tsx`)

One panel shaped by the selection:

1. Header: layer icon + name.
2. **Content** section — whatever the layer is made of:
   - Text layers: `Input` (Beer Name, Style, Volume, Info, Store Cold…);
     ABV's numeric input; Description's markdown editor; Barcode's UPC
     digits; QR shows its derived URL read-only.
   - Collab logo layers: their `FileDrop`, scale/offset/tint controls, and
     the collab on/off `Switch`.
   - Background/Mask: their `FileDrop` (moved from the old sidebar top).
3. **Style** section — the shared stack reused from today's
   StyleProperties: fill hex + plate select, Outer stroke `Switch` with
   color/width, letter spacing where applicable.
   - Background/Mask: disabled "Color overlay" and "Outer stroke"
     switches as placeholders.
4. No selection: the whole inspector column collapses (no empty state).

## Removals

- The 430px sidebar and `LabelForm`'s monolithic layout; its field
  components are reused inside the inspector. Validation errors (name,
  ABV, UPC) surface in the inspector next to their fields; the
  export-blocked reason stays in the menubar.

## Testing

Existing tests are renderer-level and unaffected. UI verified in-app;
`tsc --noEmit` and the full vitest suite must stay green.
