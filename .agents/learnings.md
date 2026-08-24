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
