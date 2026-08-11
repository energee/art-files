# Tauri file drops — design

2026-08-11 · branch `main`

## Goal

Restore the app's existing HTML file-drop behavior inside the packaged Tauri
window: dropping a PNG/JPEG anywhere opens the background/mask chooser, while
dropping directly on an inspector image field loads that field.

## Design

- Disable Tauri's native drag/drop interception for the main webview. Label Lab
  does not consume Tauri path events; its `AssetDropOverlay` and `react-dropzone`
  fields require standard `DataTransfer` files and DOM drag events.
- Mark each `FileDrop` root as a specific target. The window-wide handler yields
  when the pointer is over one of those roots, allowing texture, mask, and
  collaboration-art fields to apply their own accepted file types.
- Make the full-window chooser visual-only (`pointer-events: none`) and route
  background/mask drops from the window listener using the pointer's half of
  the viewport. This lets a drag move freely between the global chooser and a
  specific image field without the overlay covering or stealing the field.
- Preserve the existing rule: PNG on the right becomes the metallic mask;
  JPEG always becomes the texture, including on the right half.

## Verification

- Unit-test the viewport routing and accepted global image types.
- Pin `dragDropEnabled: false` in a configuration test so a future Tauri config
  rewrite cannot silently re-enable interception.
- Build both the web bundle and Tauri metadata; manually smoke-test the packaged
  app when desktop UI control is available.

