# Ledger

Findings and their status, across sessions. Append entries; newest at the bottom.

## Run state

Written by `playbooks/improve.md` at run start and read back by a resumed run. One
block, updated in place — not appended per run.

```
- base branch: <branch the entries below were worktree'd from>
```

## Entry format

```
## <date: ISO YYYY-MM-DD> <finding-slug>
- finding: [<principle>/<severity>] <file:line> — <what>
- status: open | in-progress | done | parked(<gap: context|capability|authority|proof|feedback>)
- attempts: <n>/3
- delta: <before → after evidence, e.g. "dup blocks 14 → 9; tests green">
- ruling: <parked entries only — which gap, what evidence, what would unpark it>
```

`file:line` records where the finding was **seen at audit time**, not where it lives when
someone works it. Earlier passes in the same run move code, so re-locate the finding
before fixing it: a citation that no longer resolves means the entry is a stale pointer,
never that the finding's scope is empty.

## Typed graph and provenance (optional)

Append any of these flat fields inside a finding entry. They are the canonical data
contract; existing untyped entries need no migration. Path, evidence, and learning
lines may repeat.

```
- id: <stable unique ID, using letters, digits, dot, underscore, or hyphen>
- depends-on: none | <ID>, <ID>
- read-path: none | <one repo-relative path; repeat field for more>
- write-path: none | <one repo-relative path; repeat field for more>
- acceptance: <one-sentence observable completion condition>
- observed-at: <commit where the finding was observed>
- attempted-in: <worktree path> @ <branch>
- evidence: <fresh command result or exact diff-review evidence>
- fixed-by: <commit containing the fix>
- verified-by: <verifier identity | same-context fallback> @ <commit verified>
- learning: none | <learnings.md entry or concise learning>
```

For an actionable finding to opt into graph scheduling it records `id`,
`depends-on`, at least one `read-path`, at least one `write-path`, and `acceptance`;
an omitted scheduling field means unknown, never empty, and requires serial fallback.
Use `none` as the sole path-field occurrence to state that a set is known empty; never
mix it with paths. IDs are case-sensitive, unique in the ledger, stable across status
changes, and match `[A-Za-z0-9][A-Za-z0-9._-]*`. Lowercase `none` is reserved for empty lists
and cannot be an ID. Dependency IDs remain comma-separated because their grammar excludes
commas. Each `read-path` and `write-path` contains one atomic path; repeat the field for
additional paths, so commas and spaces are preserved.

Readiness has four rules:

- An `open` or `in-progress` finding is ready only when every ID in `depends-on` is
  present and `done`. A missing ID, a parked dependency, or an open/in-progress
  dependency blocks it; missing IDs are invalid state rather than ordinary blockers.
- Dependency cycles and malformed present fields are invalid state. Stop before fix
  or merge work until `bash <ultraharness>/scripts/ledger-graph.sh <ledger>` reports `OK`.
- Only write/write overlap is a conflict. Reads are provenance and review scope:
  read/read and read/write overlap do not prevent a wave because worktrees isolate fix
  work and every candidate is updated and reverified before its serial merge.
- Write paths are lexical repository-relative paths. The analyzer removes leading
  `./`, repeated `/`, and trailing `/`; rejects absolute paths, `..`, backslashes, and
  wildcards; and treats equality or ancestor/descendant overlap as a conflict. Thus
  `config` conflicts with `config/app.yml`, while `config.yml` does not.

A finding with an `id` is typed history. Before it becomes `done`, it must carry at
least one `evidence` line, a hexadecimal `fixed-by` commit, and `verified-by` in
`<identity> @ <same commit>` form. Old done entries without an ID remain valid: their
absence of these later fields is compatibility history, not proof manufactured after
the fact.

Together the fields are the smallest provenance graph: `finding` names the governing
principle/lens and observation site; `observed-at` pins its time; `depends-on` records
causality; `attempted-in` records isolation; `fixed-by`, `evidence`, and `verified-by`
record implementation and evaluation; `delta` records measured change; `learning`
records what was revealed; and a parked status plus `ruling` records a named blocking
gap. Git history supplies the temporal sequence, so these relationships do not need a
separate event stream.

## Run stop format

Written by any playbook that stops a run early. This is a run record, not a finding:
no status, no attempts, no delta.

```
## <date: ISO YYYY-MM-DD> run-stopped
- stopped: <what stopped the run>
- unblocks: <what would clear it>
```

## Standing rules

- Never delete entries — mark them done or parked instead; the history is the point.
- Parked requires a written ruling: which gap, what evidence, what would unpark it.
- One failed run never establishes "worker limitation" — retry before concluding
  anything about capability.

---
