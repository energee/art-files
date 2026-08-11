# AGENTS.md

This `.agents/` directory holds the working memory for agents improving this repo.
Read this file first; follow the pointers below only when you need them.

## About this repo

Lolev beer label generator: a local Vite + TypeScript web app (with a Node headless
harness, `npm run generate`) that turns a rock texture PNG, a metallic mask PNG, and
beer info into two print-ready 600-DPI PDFs — label art plus a white-ink layer where
blue = white ink and white = knockout. Node ecosystem, no UI framework on `main`
(vanilla DOM; a shadcn/React rewrite is planned in `docs/superpowers/plans/`).
Small: 26 files, ~4.1k lines including docs and bundled fonts.

- Build: `npm run build`
- Test: `npm test`
- Typecheck: `npx tsc --noEmit`
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
owns it. Binary-impacting changes require a new synchronized version and a matching
`CHANGELOG.md` entry in the same change. Release tooling, tags, and workflow dispatches
remain opt-in operations and are never performed merely because metadata was prepared.

## Worktrees

Create improvement worktrees under `.agents/worktrees/<slug>/`; they are gitignored.
