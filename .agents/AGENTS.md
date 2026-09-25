# AGENTS.md

This `.agents/` directory holds the working memory for agents improving this repo.
Read this file first; follow the pointers below only when you need them.

## About this repo

Lolev beer label generator: a local Vite + TypeScript web app (with a Node headless
harness, `npm run generate`, that fills a `.master` from layer-id JSON — the old
texture/mask/config argv still works) turning art and beer info into print-ready
600-DPI PDFs — label art plus a white-ink layer where
blue = white ink and white = knockout. Operator guide is the Fumadocs site in
`docs-site/`. Node ecosystem, React + shadcn/ui editor.

- Build: `npm run build`
- Test: `npm test`
- Typecheck: `npx tsc --noEmit`
- Docs: `npm run dev --prefix docs-site` (the Fumadocs site has its own
  `package.json`; there is no root `docs:dev` script)
- Verified at: `d10cddf` — the commit these commands were last *run* against.
  A command recorded here ran at that revision; it is not a promise about now. If one
  fails to run today, that is a finding, not a reason to guess a replacement.

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

- a11y — fired on authored UI markup (evidence: `index.html`; confirmed real
  construct: file-drop labels, form inputs, and action buttons in `index.html`).

## Ongoing work

`ledger.md` tracks findings and their status across sessions. Read it before starting
work so you don't redo or collide with existing entries; update it as you go. Its
optional typed fields record dependencies, write scope, acceptance, and verification
provenance. When using Ultraharness, run
`bash <ultraharness>/scripts/ledger-graph.sh .agents/ledger.md` to inspect ready work and
conflicts; a serial-fallback report keeps legacy entries in their existing
one-at-a-time flow.
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
