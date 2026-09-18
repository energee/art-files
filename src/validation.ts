// validation.ts — the one result shape every validator returns. A union,
// not `{ ok: boolean; error?: string }`: `!r.ok` narrows to the branch that
// carries the message, so no caller ever writes `r.error!`.
export type Validation = { ok: true } | { ok: false; error: string };
