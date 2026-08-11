# New Project implementation plan

1. Extend the history hook with a tested reset transition that replaces the
   present value and clears both stacks.
2. Add the New Project command and File-menu entry, including ⌘N / Ctrl+N.
3. Add the dirty-project confirmation dialog and reset the project-owned App
   state, asset URLs, preview, save handle, selection, and errors.
4. Document the user workflow, update binary release metadata, and run tests,
   typechecking, build, release validation where available, and a browser smoke
   test of menu, confirmation, cancellation, reset, and shortcut behavior.

