# Principles — condensed rubric

Use these to spot and rank code-quality findings. Every finding uses this format:

`[<principle>/<severity high|med|low>] <file:line> — <what> — <smallest fix>`

Severity anchors — grade against these, not against how expensive the fix looks:

- **high** — breaks correctness, blocks a contributor from building/testing/shipping,
  or names an absent evidence base that should exist (no tests, no runnable build).
- **med** — costs maintenance across the repo (duplication with several copies, a
  seam several modules depend on), or a wrong fact in a README, doc, or report.
- **low** — localized or cosmetic: one file, one call site, no reader misled.

Where two anchors both fit, the higher one wins: a doc naming a command that does not
exist is a wrong fact *and* blocks a contributor from testing — grade it high.

## Guard precedence — governs every rubric and lens

A **guard** is code whose job is to survive something going wrong: input validation or
sanitization, an authorization check, an error branch that changes control flow on
failure, a timeout, a bound, a cleanup path, a transaction wrapper, a version pin.

An error branch that *discards* the failure is not one of them. An empty or comment-only
catch changes no control flow — it resumes with a wrong value — so deleting it is the
fail-fast rubric's highest-yield finding, not a guard removal: not a FAIL under
`playbooks/verify.md` step 4, and never `parked(authority)`. Removing the branch that
*handles* a failure is a guard removal; removing the one that *hides* it is the fix.
Without this distinction the two sections collide, and the single most valuable
fail-fast fix would park every time.

Where a rubric below — or a lens in `lenses/` — would flag a guard *for removal*, it
stays silent. "It has one
caller", "it has no caller", "it adds a branch or nesting", and "it is a
single-implementation indirection" are never sufficient reason to remove one — a
guard invoked by a framework, a decorator, or a route registration has no in-tree
callers by construction, and that is not evidence it is dead. **Removal at a boundary
requires showing the boundary is gone, not that the symbol is uncalled.** A guard that is
genuinely too complex gets extracted into a named function, never dropped.

The rule runs both ways, or it becomes a license for defensive bloat: a timeout on an
in-process call, a retry wrapper around something that cannot fail transiently, a
compatibility shim for a version never shipped — machinery for a failure the boundary
cannot produce is still YAGNI's to flag. Handling a failure that can actually happen:
keep. Machinery for one nobody has seen: flag.

This rubric does not find *missing* guards. A repo with no validation anywhere audits
clean here; silence is not a clean bill of health.

## DRY — one authoritative home per piece of knowledge

Spot it:
- A block of 5+ contiguous lines appearing near-identically in 2+ files.
- Parallel switch/if chains branching on the same discriminant in multiple places.
- Copy-pasted test setup across 3+ test files.
- The same literal (magic number, URL, threshold, error string) hardcoded in 2+ places.

Do NOT apply when:
- The duplication is incidental — alike today, but encoding unrelated rules that will
  diverge; merging couples things that should change independently.
- Repeated inline test setup keeps each test readable top-to-bottom.
- It's under 3-4 lines, or appears only twice with no sign of a third occurrence —
  unless the copies are near-identical and encode one rule the sites must agree on, in
  which case silent divergence is the defect and two copies already justify one home.

## KISS — simplest solution that meets the real requirement

Spot it:
- Functions over ~50 lines, or nesting 4+ deep.
- Cyclomatic complexity noticeably above sibling functions in the same file.
- Cleverness where a plain loop/branch would work: bit tricks, metaprogramming,
  one-liners that need two readings.
- Indirection layers (wrapper, factory, adapter) with exactly one caller and one
  implementation.

Do NOT apply when:
- The "complexity" is input validation, error handling, or edge-case branches —
  those are requirements.
- Flattening a state machine or parser would lose correctness on malformed input.
- The longer version reads linearly and the short one doesn't — line count is a
  heuristic, not the goal.

## SOLID — independently changeable, testable units (SRP and DIP catch the most)

Spot it:
- SRP: one file/class with 2+ distinct reasons to change — persistence +
  presentation + business-logic imports together, or methods splitting into two
  groups that never call each other.
- DIP: domain logic directly importing a concrete IO/framework dependency (DB
  client, HTTP client, filesystem, ORM) instead of an injected interface/port.
- OCP/LSP/ISP: flag only when concrete and cheap — a new case forcing edits to
  scattered switch chains; an override that throws/no-ops; a fat interface whose
  consumers use 1-2 members and stub the rest.

Do NOT apply when:
- The interface has a single implementation and exists only "for testability" or
  "for the future". Precedence rule: if the seam is exercised by an actual test
  today, treat it as DIP (keep it, don't flag); if untested, it's YAGNI (flag it).
- The class is merely long but cohesive — SRP is about reasons to change, not lines.
- It's a small internal helper; DIP matters at architectural seams, not everywhere.

## YAGNI — build for today's requirement, not a possible one

Spot it:
- Unused exports, params, or feature flags — zero non-definition references repo-wide.
- Config options with exactly one value ever set across all environments.
- Abstractions with a single implementation and no committed second one.
- "For future use" / "will be needed when" comments on code with no current caller.
- Feature flags parked at 100% or 0% with no in-progress migration.

Do NOT apply when:
- It's validation/sanitization at a trust boundary — the boundary is the
  requirement, not the caller count.
- It's a calibration knob or hardware/sensor config — variance across units is a
  real, current requirement even with one value set today.
- It's an accessibility affordance — its users don't show up in call-site greps.
- It's a single-implementation test seam exercised by an actual test today — that's
  DIP, keep it (same precedence rule as under SOLID).
- It backs persisted data — a column, table, migration, or serialized field.
  Unreferenced is never sufficient here; rows outlive the code that reads them.

## Fail fast — an operation that cannot do its job says so immediately

Spot it:
- Empty or comment-only catch: `catch {}`, `except: pass`, `rescue nil`,
  `if err != nil { }`. Highest-yield single grep.
- Overbroad catch (`except Exception:`, `catch (Throwable)`) around a block where one
  call can realistically fail.
- Log-and-continue where the code cannot actually continue correctly.
- Errors flattened to sentinels — `null`/`nil`/`-1`/`""` where the caller cannot tell
  "no result" from "it broke".
- Required config read with a silent default (`getenv("API_KEY", "")`, `?? ""`); the
  missing credential surfaces as a 401 three layers away.
- Validation deferred past a trust boundary; async results never awaited or joined.

Do NOT apply when:
- A retry loop, supervisor, or event pump must survive one failure — provided the error
  is recorded and retries are bounded.
- It's a top-level handler turning an exception into a response or exit code. That is
  where propagation is supposed to stop.
- The feature is genuinely optional and the system still meets its contract without it
  (analytics key, cache). The test is the contract, not the presence of a default.
- It's cleanup in `finally`/`defer` — suppressing there to preserve the original
  failure is correct.
- The sentinel is the language idiom and the caller must check it: Go's `(T, error)` is
  fail-fast unless the error is discarded with `_`.

