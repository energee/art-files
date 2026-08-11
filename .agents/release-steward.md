# Release steward

The release steward is the final owner of desktop release metadata. Run this gate
after implementation and before handoff, even when the task did not mention releases.

## 1. Classify the diff

A change is **binary-impacting** when an installed Label Lab application must be
rebuilt for a user to receive it. This includes changes to:

- application code or bundled assets under `src/`, `public/`, or `src-tauri/`;
- `index.html`, `presets.json`, build configuration, or runtime dependencies and
  their lockfiles; and
- updater configuration or another input that is compiled or packaged into the app.

Documentation, tests, agent memory, CI-only configuration, and release notes do not
require a new binary unless they also change a build input. When the classification
is genuinely ambiguous, treat the change as binary-impacting and record why in the
handoff.

## 2. Prepare binary-impacting changes

1. Choose a SemVer increment. Use a patch by default for compatible fixes and small
   features; use minor or major only when the product change warrants it.
2. Keep the version identical in `package.json`, the root entries in
   `package-lock.json`, `src-tauri/Cargo.toml`, the `label-lab` package entry in
   `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`.
3. Add a dated `CHANGELOG.md` section named for that exact version. Write concise,
   user-facing bullets about behavior, fixes, and any upgrade caveats; do not use a
   list of filenames or internal implementation details as release notes.
4. Run `node scripts/check-release.mjs <base-ref>` along with the task's normal tests
   and build. For a pull request, `<base-ref>` is the target branch or its merge-base.
5. Report the classification, selected version, release-note heading, and validation
   result in the handoff.

Two branches may independently choose the same next version. After rebasing or
merging another binary-impacting change, re-run the gate and increment again if the
base now carries that version.

## 3. Preserve the release boundary

Preparing metadata does not authorize publishing. Do not create or push a tag,
dispatch `.github/workflows/release.yml`, upload artifacts, or edit an existing
GitHub Release unless the user explicitly requests that release operation.
