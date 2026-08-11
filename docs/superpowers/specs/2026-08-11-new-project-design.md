# New Project — design

2026-08-11 · branch `main`

## Goal

Let an operator leave the current label and start from Label Lab's shipped
defaults without reloading the application.

## Interaction

- File → **New Project** and the command palette expose the action with the
  standard ⌘N / Ctrl+N shortcut.
- If the current project is dirty, the action opens an in-app confirmation
  dialog. Cancel preserves the current project; **Discard and Create** starts
  the new one. A clean project resets immediately.
- Creating the project restores `defaultConfig()`, clears all four embedded
  assets, clears the active layer selection and transient errors, and detaches
  the current file handle so the next Save asks for a filename.
- Undo/redo history does not cross the project boundary. View and shop state
  (preview mode, rulers/guides, zoom, hidden-layer eyes, render presets) stay as
  the operator left them because they are not stored in a `.label` project.
- The fresh project is unsaved, so Save remains available and behaves as Save
  As. The old rendered preview is removed immediately while the default label
  is rebuilt.

## Guardrails

- Use the existing shadcn Dialog; do not use a browser-native confirmation.
- Revoke object URLs while clearing assets, exactly as existing replacement
  and open-project paths do.
- Opening a saved project also establishes a fresh undo/redo history, so Undo
  cannot restore content from the previously open project.

