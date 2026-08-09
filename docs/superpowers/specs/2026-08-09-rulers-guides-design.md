# Rulers and guides design

Date: 2026-08-09  
Status: approved in conversation

## Goal

Add Photoshop/Sketch-style measurement chrome to the 2D label preview without
changing the generated PDFs, PSDs, saved label configuration, or 3D views.

## Rulers

- **View > Rulers** toggles a fixed horizontal ruler at the top of the preview
  pane and a fixed vertical ruler at its left edge. The rulers are visible only
  in Standard/Mask (2D) view and retain their toggle state while another view is
  active.
- Rulers are screen-space chrome: their text and strokes remain the same CSS
  size while the page underneath zooms and pans.
- Measurements use the existing PDF-point page geometry. The trim box's
  top-left (`ART.x`, `ART.y`) is `0, 0`; the page bleed therefore has negative
  ruler values.
- Inches are the default. A single-select segmented tab group in the ruler
  corner switches among inches, points, and 600-DPI deliverable pixels (not
  CSS screen pixels). Tick density adapts to the current page scale so labels
  never pile up.
- Moving the pointer through the 2D pane draws a marker in each ruler at the
  pointer's current position.

## Layout guides

Layout guides are derived from the trimmed 8 x 5 inch `ART` box and cannot be
dragged or deleted individually:

- Four **margin guides**, inset from the trim box. The default inset is 0.25in
  (18pt), adjustable from the ruler corner control.
- A vertical **center** guide at `ART.x + ART.w / 2`.
- A horizontal **middle** guide at `ART.y + ART.h / 2`.

The View menu independently toggles Margin Guides and Center Guides. Layout
guides remain meaningful with rulers hidden, so their toggles do not depend on
the Rulers toggle.

## Manual guides

- Dragging from the horizontal ruler creates a horizontal guide; dragging from
  the vertical ruler creates a vertical guide.
- Manual positions are stored in PDF points so they stay registered through
  zoom, pan, and pane resizing.
- A manual guide can be dragged to a new position. Dragging it back over either
  ruler removes it. A focused guide can also be removed with Delete or
  Backspace. **View > Clear Manual Guides** removes all manual guides.
- Manual guides are session state. They do not enter `LabelConfig`, history,
  presets, config JSON, PDF output, or PSD output.
- Guide snapping is not part of this feature. It should be introduced with
  direct canvas element movement, when there is an object that can use it.

## Interaction and appearance

- Ruler strips are 20 CSS pixels and use the existing sidebar/background,
  border, foreground, muted-foreground, and primary theme tokens.
- Guide lines are one screen pixel at every zoom. Layout guides use a muted
  cyan; manual guides use the primary accent. They span the visible preview
  pane and are clipped by it.
- Only the ruler strips and manual guide hit areas accept pointer events. The
  rest of the overlay passes clicks through to preview selection and the
  art/mask comparison divider.
- Menu toggles provide keyboard-accessible control of every non-pointer-only
  view state. Manual dragging is an enhancement and does not modify document
  content.

## Architecture

- `src/rulers.ts`: pure conversions, adaptive tick generation, and derived
  layout-guide positions.
- `src/components/Rulers.tsx`: SVG rulers, cursor markers, layout guides, and
  manual-guide drag interaction.
- `PreviewCompareHandle` exposes the exact transformed page rectangle. Its
  `getBoundingClientRect()` already reflects App's CSS zoom/pan, keeping ruler
  and hit-test coordinate mapping on the same physical box.
- `App.tsx` owns the session state and View-menu commands and renders the ruler
  overlay as a sibling of the transformed preview.

## Acceptance

At 100%, 150%, and 250% zoom, including after panning and resizing sidebars:

- 0in tracks the trim top/left, 8in tracks the trim right, and 5in tracks the
  trim bottom.
- Default margins read 0.25in, 7.75in, 0.25in, and 4.75in.
- Center guides read 4in horizontally and 2.5in vertically.
- Ruler labels and guide strokes do not scale.
- Preview selection, divider dragging, bleed lines, and 3D navigation retain
  their current behavior.
- Exported bytes are unaffected because the feature has no renderer input.
