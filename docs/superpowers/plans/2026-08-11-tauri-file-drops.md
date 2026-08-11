# Tauri file drops implementation plan

1. Disable Tauri's native webview drag/drop handler and add a regression test
   for the packaged configuration.
2. Mark field drop zones and refactor the full-window overlay into a visual-only
   surface whose window listener yields to fields.
3. Test global image classification and left/right routing, document the
   restored behavior, and add it to the pending `0.1.1` release notes.
4. Run focused and full tests, typechecking, web/Tauri builds as practical, and
   the release metadata gate.

