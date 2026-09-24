// master-save-target.test.ts — saveTargetFor (src/masters.ts): Save Master
// reuses a bound .master path/handle only for the master id it was bound to.
// Undo past Open Master / a library pick / Save Master As swaps the document's
// master back without touching the binding, and a plain Save Master then
// overwrote the OTHER master's file with no dialog (issue #78).
import { describe, expect, it } from "vitest";
import { saveTargetFor } from "../src/masters";

describe("saveTargetFor", () => {
  it("reuses the target bound for the current master id", () => {
    expect(saveTargetFor({ id: "master-a", target: "/m/a.master" }, "master-a")).toBe("/m/a.master");
  });

  it("refuses a target bound for another master (undo past Open Master B)", () => {
    // Tab on A → Open Master B binds B's path → ⌘Z puts A back in the doc.
    expect(saveTargetFor({ id: "master-b", target: "/m/b.master" }, "master-a")).toBeNull();
  });

  it("refuses a Save Master As fork's handle after undo back to the original", () => {
    const handle = { name: "fork.master" };
    expect(saveTargetFor({ id: "master-fork", target: handle }, "master-a")).toBeNull();
  });

  it("has nothing to reuse when nothing is bound", () => {
    expect(saveTargetFor(null, "master-a")).toBeNull();
  });
});
