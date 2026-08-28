// app-commit-rebind.test.ts — findings #15 and #18 from the master-authoring
// review, both in App.tsx's commitRebind/duplicateMaster/addAndSelectVariant.
// Round 1 of this test only exercised rebindDoc/addVariantDoc directly and
// asserted invariants about them in isolation — it never called the actual
// buggy code, so reverting either fix left it green. Fixed by hoisting the
// impure-but-React-free CORE of each App.tsx function into
// commitRebindCore/addAndSelectVariantCore (src/model/doc.ts), parameterized
// over `doc` and a functional `setDoc`, the same seam every other Doc
// transition in this repo already uses for testability. These tests drive
// those cores directly — the exact functions App.tsx's wrappers call — with
// a trivial fake `setDoc` standing in for React's state setter.
import { describe, expect, it } from "vitest";
import {
  addAndSelectVariantCore, commitRebindCore, designEditDoc, type Doc, type SetDoc,
} from "../src/model/doc";
import { composeConfig } from "../src/model/document";
import { lolevMaster } from "../src/model/lolev";
import type { Master } from "../src/model/types";

function plainDoc(): Doc {
  const master = lolevMaster();
  const cfg = composeConfig(master, [], {}, undefined).config;
  return { cfg, enabledVariants: [], master };
}

/** A trivial store + functional setDoc, the same contract React's setState
 *  (and useHistory's `set`) give a caller: the updater always sees whatever
 *  the store's doc actually is AT THE TIME IT RUNS, applied synchronously
 *  here purely so a test can inspect the result immediately after. */
function fakeStore(doc: Doc): { get: () => Doc; setDoc: SetDoc } {
  let current = doc;
  return { get: () => current, setDoc: (fn) => { current = fn(current); } };
}

describe("commitRebindCore's stale-doc guard (finding #18)", () => {
  it("a doc change landing between the probe and the commit (an intervening `await`) is not clobbered", () => {
    const captured = plainDoc(); // what the caller (commitRebind) sees before its `await`
    const store = fakeStore(captured);
    // The await: a concurrent edit lands in the store while the file picker
    // (or file.text()) is in flight — captured no longer matches store.get().
    store.setDoc((d) => designEditDoc(d, "master", (c) => { c.abv = "9.9"; }));
    expect(store.get()).not.toBe(captured); // the race actually happened

    const target: Master = { ...lolevMaster(), id: "master-other", name: "Other" };
    commitRebindCore(captured, target, store.setDoc, { current: captured.master });

    expect(store.get().master.id).toBe("master-other"); // the rebind itself landed
    expect(store.get().cfg.abv).toBe("9.9"); // AND the concurrent edit survived
  });

  it("with no concurrent edit, the probe applies as-is", () => {
    const doc = plainDoc();
    const store = fakeStore(doc);
    const target: Master = { ...lolevMaster(), id: "master-other", name: "Other" };
    commitRebindCore(doc, target, store.setDoc, { current: doc.master });
    expect(store.get().master.id).toBe("master-other");
  });
});

describe("addAndSelectVariantCore's stale-doc guard (finding #18)", () => {
  it("a doc change landing before the commit is not clobbered, and the created variant still exists", () => {
    const captured = plainDoc();
    const store = fakeStore(captured);
    store.setDoc((d) => designEditDoc(d, "master", (c) => { c.abv = "9.9"; }));
    expect(store.get()).not.toBe(captured);

    const { id } = addAndSelectVariantCore(captured, "Winter", store.setDoc);

    expect(store.get().master.variants.some((v) => v.id === id)).toBe(true);
    expect(store.get().cfg.abv).toBe("9.9");
  });
});

describe("commitRebindCore's `clean` flag (finding #15)", () => {
  it("Duplicate as new master (clean=false): pristineMaster stays at its old baseline, so the clone reads dirty", () => {
    const doc = plainDoc();
    const store = fakeStore(doc);
    const clone: Master = { ...doc.master, id: "master-abc123", name: "Copy" };
    const pristineMaster = { current: doc.master };

    commitRebindCore(doc, clone, store.setDoc, pristineMaster, false);

    expect(store.get().master.id).toBe("master-abc123"); // the doc points at the clone
    expect(store.get().master).not.toBe(pristineMaster.current); // masterDirty === true
  });

  it("Open Master / the library picker's Continue (clean=true, the default): pristineMaster adopts the target, so it reads clean", () => {
    const doc = plainDoc();
    const store = fakeStore(doc);
    const opened: Master = { ...doc.master, id: "master-xyz789", name: "Opened" };
    const pristineMaster = { current: doc.master };

    commitRebindCore(doc, opened, store.setDoc, pristineMaster);

    expect(store.get().master.id).toBe("master-xyz789");
    expect(store.get().master).toBe(pristineMaster.current); // masterDirty === false
  });
});
