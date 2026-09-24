# Release steward

The release steward is the final owner of desktop release metadata. Run this gate
after implementation and before handoff, even when the task did not mention releases.

## 1. Classify the diff

A change is **binary-impacting** when an installed Label Lab application must be
rebuilt for a user to receive it. This includes changes to:

- application code or bundled assets under `src/`, `public/`, or `src-tauri/`;
- `index.html`, build configuration, or runtime dependencies and their
  lockfiles; and
- updater configuration or another input that is compiled or packaged into the app.

Documentation, tests, agent memory, CI-only configuration, and release notes do not
require a new binary unless they also change a build input. When the classification
is genuinely ambiguous, treat the change as binary-impacting and record why in the
handoff.

## 2. Record binary-impacting changes (no bump)

Fixes ride a release train: a binary-impacting PR does **not** bump the version.

1. Add concise, user-facing bullets under `## [Unreleased]` at the top of
   `CHANGELOG.md` (create the section, with `### Fixed` / `### Added` /
   `### Changed` subsections, if it is missing). Describe behavior, fixes and upgrade
   caveats — not filenames or implementation details.
2. Leave the five version fields alone.
3. Run `node scripts/check-release.mjs <base-ref>` with the task's normal tests and
   build. It passes when a binary-impacting diff queues `[Unreleased]` bullets. The
   pre-push hook (`.githooks/pre-push`, activated by `npm install` via the `prepare`
   script) runs the same check against each pushed commit in a clean temporary
   worktree, but do not rely on it alone. For a PR, `<base-ref>` is the target branch
   (a stacked branch's parent — see AGENTS.md "Stacked PRs").
4. Report the classification and the bullets you queued in the handoff.

Because nothing bumps, parallel and stacked PRs no longer collide on versions;
`[Unreleased]` bullets merge like any other text.

## 3. Decide when a release is warranted

Cutting a release is a separate, deliberate decision — the steward recommends, the
user decides. Recommend cutting one when any of these hold:

- **Wrong output or lost work is fixed** — print/PDF/PSD correctness, a barcode or
  QR that scans wrong, data loss, a crash — ship it promptly, even alone.
- **Security or updater fixes** — ship promptly.
- **A coherent batch has accumulated** — several user-visible fixes or a finished
  feature; a release every few days of steady work is healthier than one per PR.
- **The user asks.**

Hold off when `[Unreleased]` holds only internal or cosmetic changes, when a
related fix is still in flight and would ship half-done, or when `main` is
mid-refactor. Say which applies when you recommend.

To cut a release, open one PR that:

1. Chooses a SemVer increment — patch by default; minor or major only when the
   product change warrants it.
2. Sets that version identically in `package.json`, the root entries in
   `package-lock.json`, `src-tauri/Cargo.toml`, the `label-lab` entry in
   `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
3. Renames `## [Unreleased]` to `## [<version>] - <YYYY-MM-DD>` (tidying bullets is
   fine). The checker rejects a bump that leaves an `[Unreleased]` section behind,
   and any numbered section newer than the last release that is not this version —
   `release-notes.mjs` publishes exactly one section.
4. Passes `node scripts/check-release.mjs <base-ref>` and, against the latest tag,
   `node scripts/check-release.mjs --release <label-lab-vX.Y.Z>` — the check
   release.yml runs.

## 4. Preserve the release boundary

Preparing a release PR does not authorize publishing. A version change merged to
`main` automatically dispatches `.github/workflows/release.yml`, which creates the tag,
GitHub Release, signed artifacts, and public update feed. Do not merge that change,
manually dispatch the workflow, create or push a tag, upload artifacts, or edit an
existing GitHub Release unless the user explicitly requests that release operation.
