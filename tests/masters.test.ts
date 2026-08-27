import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { masterIndex, rememberMaster, resolveMasterById, SHIPPED_MASTER_ID } from "../src/masters";
import { lolevMaster } from "../src/model/lolev";
import { parseMasterFile, serializeMaster } from "../src/model/masterfile";

const stored = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  clear: () => stored.clear(),
};

beforeEach(() => {
  stored.clear();
  vi.resetModules();
  vi.stubGlobal("localStorage", fakeLocalStorage);
});
afterEach(() => vi.unstubAllGlobals());

describe("master library index", () => {
  it("resolves the shipped master with an empty index", async () => {
    expect(await resolveMasterById(SHIPPED_MASTER_ID)).toEqual(lolevMaster());
  });
  it("remembers and lists a master", () => {
    rememberMaster(lolevMaster(), "/tmp/lolev.master");
    const idx = masterIndex();
    expect(idx[SHIPPED_MASTER_ID].path).toBe("/tmp/lolev.master");
    expect(idx[SHIPPED_MASTER_ID].name).toBe("Lolev");
  });
  it("unknown id with no hint resolves null", async () => {
    expect(await resolveMasterById("nope")).toBeNull();
  });
  it("survives a mangled index entry", () => {
    localStorage.setItem("labellab.masters", "{not json");
    expect(masterIndex()).toEqual({});
  });
  // Task 4's save/open round trip: a saved-then-reparsed master registers
  // under its own id, exactly as a freshly authored one would. This passes
  // unchanged because rememberMaster itself didn't change — the real work of
  // Task 4 is App.tsx's save/open wiring, which has no automated harness
  // (see task-4-report.md).
  it("a saved master registers in the library index under its own id", () => {
    const m = parseMasterFile(serializeMaster(lolevMaster()));
    rememberMaster(m, "/tmp/lolev.master");
    expect(masterIndex()[m.id]).toMatchObject({ name: "Lolev", path: "/tmp/lolev.master" });
  });
});
