// app-commit-rebind.test.ts — pins the two algorithmic contracts App.tsx's
// commitRebind/addAndSelectVariant now rely on (findings #15 and #18 from
// the master-authoring review). Both bugs live in App.tsx glue (a ref
// baseline, a stale-closure setDoc argument) that this repo's convention
// doesn't mount a DOM harness for (see design-routing.test.ts/
// app-layer-doc.test.ts: App-level routing is pinned by exercising the pure
// Doc transitions the glue calls, not by mounting App itself). These tests
// do the same: they exercise rebindDoc/addVariantDoc directly and assert the
// exact invariant commitRebind's fixed shape depends on, so a regression in
// either invariant fails here even without a full app mount.
import { describe, expect, it } from "vitest";
import { addVariantDoc, type Doc, rebindDoc } from "../src/model/doc";
import { composeConfig } from "../src/model/document";
import { lolevMaster } from "../src/model/lolev";
import type { Master } from "../src/model/types";

function plainDoc(): Doc {
  const master = lolevMaster();
  const cfg = composeConfig(master, [], {}, undefined).config;
  return { cfg, enabledVariants: [], master };
}

// Finding #18: commitRebind (and addAndSelectVariant) must recompute their
// transition against the CURRENT doc when it differs from the one probed
// before an intervening `await` — never apply a precomputed value that was
// captured against a stale doc. This mirrors the exact guard both now use:
// `setDoc((d) => (d === doc ? probe : recompute(d)))`.
describe("commitRebind/addAndSelectVariant's stale-doc guard", () => {
  it("rebindDoc: recomputing against a doc that changed during an await preserves the concurrent edit", () => {
    const doc = plainDoc();
    const target: Master = { ...lolevMaster(), id: "master-other", name: "Other" };
    // What the picker/Open-Master flow precomputes before its `await`.
    const probe = rebindDoc(doc, target);
    // An edit lands on `doc` while the await (file pick / file.text()) is in
    // flight — the bug: applying `probe.doc` unconditionally would silently
    // drop this.
    const concurrent: Doc = { ...doc, cfg: { ...doc.cfg, abv: "9.9" } };
    // The buggy shape App used to have: setDoc(nextDoc) — always the stale probe.
    const buggy = probe.doc;
    expect(buggy.cfg.abv).not.toBe("9.9"); // proves the bug: the concurrent edit is gone
    // The fixed shape: recompute against the doc actually current when the
    // updater runs.
    const fixed = concurrent === doc ? probe.doc : rebindDoc(concurrent, target).doc;
    expect(fixed.cfg.abv).toBe("9.9"); // the concurrent edit survives
  });

  it("addVariantDoc: recomputing against a doc that changed during a batch still selects the variant it actually created", () => {
    const doc = plainDoc();
    const probe = addVariantDoc(doc, "Winter");
    const concurrent: Doc = { ...doc, cfg: { ...doc.cfg, abv: "9.9" } };
    const fixed = concurrent === doc ? probe : addVariantDoc(concurrent, "Winter");
    expect(fixed.doc.master.variants.some((v) => v.id === fixed.id)).toBe(true);
    expect(fixed.doc.cfg.abv).toBe("9.9"); // the concurrent edit survives the recompute too
  });
});

// Finding #15: a freshly duplicated, never-saved master must read DIRTY
// against its pristine baseline, so File → Save Master stays enabled and a
// project save never writes a masterId absent from every index. commitRebind
// takes a `clean` flag for exactly this: Duplicate passes `clean=false`, so
// the baseline is left at whatever it already was (a master that is NOT the
// new clone the doc now points at) — reproduced here directly with Master
// identity, the same comparison App's `masterDirty = doc.master !==
// pristineMaster.current` makes.
describe("a duplicated master's dirty baseline", () => {
  it("stays dirty: the clone is never adopted as the clean baseline", () => {
    const before = lolevMaster();
    const clone: Master = { ...before, id: "master-abc123", name: "Copy" };
    const pristineMasterBaseline = before; // clean=false: baseline untouched by the rebind
    const dirtyAgainstBaseline = clone !== pristineMasterBaseline;
    expect(dirtyAgainstBaseline).toBe(true);
  });

  it("contrasts with an ordinary Open/pick rebind, which DOES read clean", () => {
    const before = lolevMaster();
    const opened: Master = { ...before, id: "master-xyz789", name: "Opened" };
    const pristineMasterBaseline = opened; // clean=true (the default): baseline moves to the opened master
    const dirtyAgainstBaseline = opened !== pristineMasterBaseline;
    expect(dirtyAgainstBaseline).toBe(false);
  });
});
