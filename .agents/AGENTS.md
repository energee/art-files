# AGENTS.md

This `.agents/` directory holds the working memory for agents improving this repo.
Read this file first; follow the pointers below only when you need them.

## About this repo

Lolev beer label generator: a local Vite + TypeScript web app (with a Node headless
harness, `npm run generate`, that fills a `.master` from layer-id JSON — the old
texture/mask/config argv still works) turning art and beer info into print-ready
PDFs — one print file with artwork and an overprinting `White Ink` spot layer,
or an optional art/mask pair (blue = white ink, white = knockout). Operator guide is the Fumadocs site in
`docs-site/`. Node ecosystem, React + shadcn/ui editor.

- Build: `npm run build`
- Test: `npm test`
- Typecheck: `npx tsc --noEmit`
- Lint: `npm run lint` (rules-of-hooks + exhaustive-deps + unused vars; zero warnings)
- Dependency audit (CI `audit` job): `npm audit --omit=dev --audit-level=high`, and
  `cargo audit` in `src-tauri` (install with `cargo install cargo-audit --locked`)
- Dead code: `npx knip@6.38.0` (not a devDependency; knip runs in CI after the tests and fails on any finding; config in `knip.json`). `src/components/ui/**` is ignored because shadcn scaffolding carries unused variants; delete a whole ui component once nothing imports it.
- Docs: `npm run dev --prefix docs-site` (the Fumadocs site has its own
  `package.json`; there is no root `docs:dev` script)
- Release metadata: `node scripts/check-release.mjs <base-ref>`
- Node version: `.nvmrc` is the one pin; every workflow's setup-node reads it
  (`node-version-file`), and it must satisfy `engines` in `package.json`.

Validation results belong in `ledger.md` with the revision or branch tested;
there is no blanket verification stamp for commands that changed independently.

## Conventions

Repo-specific conventions live in `conventions.md`. They were recorded from
observation of this codebase — match them before inventing your own.

## Principles

`principles.md` is the condensed rubric (DRY, KISS, SOLID, YAGNI, fail-fast, plus the guard
precedence that governs every rubric and lens) used to spot and rank code-quality
findings here. Read it before auditing or improving anything.

## Lenses

`lenses/` holds conditional rubrics that fired against this repo at seed time. They
apply here alongside `principles.md`, with the same severity anchors and the lens name
in the principle slot. Which fired, and on what evidence:

- a11y — authored controls in `src/components/FileDrop.tsx`,
  `src/components/LayerInspector*.tsx` (the shell and its Controls, Sections and
  Template parts), and `src/components/LayerList.tsx`:
  file targets, form inputs, and keyboard-operated action buttons.

## Ongoing work

`ledger.md` tracks findings and their status across sessions. Read it before starting
work so you don't redo or collide with existing entries; update it as you go. Its
optional typed fields record dependencies, write scope, acceptance, and verification
provenance. When using Ultraharness, run
`bash <ultraharness>/scripts/ledger-graph.sh .agents/ledger.md` to inspect ready work and
conflicts; a serial-fallback report keeps legacy entries in their existing
one-at-a-time flow.
Closed entries older than 30 days move verbatim to `ledger-archive.md` (rule under the
ledger's Standing rules); search it only when you need older history.
`learnings.md` holds lessons from past sessions — check it for known traps.

## Release steward

`release-steward.md` is a mandatory handoff gate for every repository change.
Before an agent finishes a task, it must classify whether the diff changes the
installed Label Lab application or its packaged runtime. In a multi-agent run,
assign one agent the release-steward role; in a single-agent run, the active agent
owns it. Binary-impacting changes queue user-facing bullets under `## [Unreleased]`
in `CHANGELOG.md` without bumping the version; cutting a release (the version bump)
is a separate decision the steward recommends and the user makes. Merging a version
change to `main` publishes that release automatically, so agents must not merge, manually dispatch the release
workflow, or manipulate release tags and artifacts without explicit user authorization.

## Worktrees

Create improvement worktrees under `.agents/worktrees/<slug>/`; they are gitignored.

Never use `git stash`: the stash list is shared by every worktree and every
parallel session, so a pop or apply can take another agent's changes. Set work
aside with a WIP commit on your own branch, or `git diff > <scratch>.patch`.
(On the maintainer's machine a global Claude Code hook blocks it outright.)

## Stacked PRs

When a fix builds on, or touches the same code as, another open PR, stack it
instead of branching from `main`:

1. `git worktree add -b <branch> .agents/worktrees/<slug> origin/<parent>`
2. `git config branch.<branch>.stack-parent <parent>` — the pre-push hook then
   checks release metadata against the parent, as CI does against the PR base.
3. Add your bullets under `## [Unreleased]` in `CHANGELOG.md`; don't bump the
   version (see release-steward.md).
4. `gh pr create --base <parent>`.

Merge a stack bottom-up. Before deleting a merged parent branch, retarget its
children with `gh pr edit <child> --base main` — `git push --delete` of a PR's base
branch closes the child PR instead of retargeting it (only GitHub's own
delete-on-merge retargets). Then rebase the child onto
`main` with `git rebase --onto origin/main <old parent tip>`, drop the
`stack-parent` config, and re-run `node scripts/check-release.mjs origin/main`.
