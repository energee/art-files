# Learnings

Lessons from past sessions in this repo. One line each, in this format:

```
- [seen:<n>] <lesson> (evidence: <file/commit>)
```

Increment `seen` when a session re-confirms a lesson rather than adding a duplicate.

Rules:

- Promotion: a lesson seen 2+ times gets copied into `conventions.md` or `AGENTS.md`,
  whichever fits — it has graduated from observation to convention.
- Append-only, like `ledger.md`. A lesson that never repeats is evidence too: it
  records what one session hit and no other did. Nothing here is pruned or rewritten;
  a lesson that turns out to be wrong earns a correcting line, not a deletion.

---

- [seen:1] Tauri's default native drag/drop handler suppresses the DOM events used by both react-dropzone and the window asset overlay; keep `dragDropEnabled: false` while those frontend handlers own file drops. (evidence: `src-tauri/tauri.conf.json`, `tests/filedrop.test.ts`)
- [seen:1] Tauri's webview does not provide the browser File System Access API used by Save As; route desktop saves through the dialog/fs plugins and preserve the selected native path for later Save calls. (evidence: `src/files.ts`, `src/App.tsx`)
- [seen:1] macOS delivers Finder file-opens as Apple events, not argv: fileAssociations alone launches the app but the file never arrives — handle RunEvent::Opened in Rust, hold the path for the webview (it can beat the frontend load), and scope fs read for non-dialog paths. (evidence: src-tauri/src/main.rs, src-tauri/capabilities/default.json)
- [seen:1] Version bumps span FIVE files (package.json, package-lock.json root entries, Cargo.toml, Cargo.lock label-lab entry, tauri.conf.json); use `npm version X --no-git-tag-version` for the npm pair and ALWAYS run `node scripts/check-release.mjs <base-ref>` locally before push — release-steward.md steps 2 and 4 already say so, and skipping the checker put lockfile drift into a PR. (evidence: release-metadata CI failure on PR #24)
- [seen:1] Vitest's default discovery traverses ignored nested worktrees in this checkout, so vitest's scan must stay rooted at `tests/` — set in vite.config.ts's `test.dir` so watch mode and IDE runners are scoped too, not just `npm test` — or stale worktree suites can fail against another tree's source. (evidence: vite.config.ts)
- [seen:1] pdf.js's `disableFontFace` path renderer can leave white cavities inside wide text strokes even when Poppler renders the same true PDF stroke correctly; keep the true stroke for print geometry and add only a bounded, live-width interior bridge for preview compatibility. (evidence: src/pdf/build.ts)
- [seen:1] Never `pkill -f vite` (or any name-pattern kill) to tear down a dev server — parallel Claude sessions run their own vite instances on this machine and a pattern kill takes them all down; kill only the PID you started. (evidence: Phase 2 canvas-backend session, Task 6 teardown killed servers on :5173/:5183)
- [seen:1] Parallelizing pdf-lib embedPng/embedJpg with Promise.all registers XObjects in completion order, making built PDF bytes nondeterministic; keep embeds sequential when output determinism matters. (evidence: /simplify adjudication, docs/superpowers/plans/2026-08-25-canvas-backend-phase2.md)
- [seen:1] When swapping out a rendering call, port its guard OPTIONS too, not just the happy path — renderPdfPage's scaleCap carried a maxEdge memory cap the canvas swap silently dropped (backing store hit 5040px past the 4876 budget); grep the deleted call's option object for limits before declaring the swap complete. (evidence: Phase 3 final review, src/components/PreviewCompare.tsx PREVIEW_RASTER_MAX_EDGE clamp)
- [seen:1] Browser-automation dispatched MouseEvents don't move real focus, so autoFocus-dependent flows (the in-place editor) look broken under synthetic dblclicks — call element.focus() explicitly before typing; it's a harness artifact, not an app bug. (evidence: Phase 3 Task 5 verification)
- [seen:1] Tauri `fs:allow-read-file` must include every extension the app re-reads by path; a `.label`-only glob made Open Master register a basename and a reload fall back to the shipped master fixture. Use `dialog.open()` for Open Master so the index stores a real path, and cache the file bytes as a second source. (evidence: src-tauri/capabilities/default.json, src/masters.ts, src/App.tsx openMasterPicker)
- [seen:1] The predefined macOS Quit menu item sends NSApp `terminate:`; tao has no `applicationShouldTerminate:`, so it goes straight to `RunEvent::Exit` with no window CloseRequested and no preventable `ExitRequested`. Anything that must run before quit (the unsaved-tabs prompt) needs a custom Quit item that calls `window.close()`. Dock → Quit / logout / AppleScript still send `terminate:`; those are caught by adding `applicationShouldTerminate:` to tao's delegate class with class_addMethod (never replaces; src-tauri/src/terminate.rs, #151). (evidence: muda-0.19.3 macos/mod.rs, tao-0.35.3 app_delegate.rs, src/components/AppMenu.tsx macApplicationMenu)
