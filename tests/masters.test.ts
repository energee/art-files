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
    expect(await resolveMasterById(SHIPPED_MASTER_ID)).toEqual({ master: lolevMaster(), assets: {} });
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

  // Finding #6: a registered .master on disk whose id is the shipped id must
  // win over the built-in fixture — resolveMasterById must consult the
  // index/hint BEFORE falling back to lolevMaster().
  it("a registered .master on disk for the shipped id wins over the built-in fixture", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const edited = { ...lolevMaster(), defaults: { ...lolevMaster().defaults, beerName: "ZZZ-EDITED" } };
    vi.doMock("@/files", () => ({
      readNativeFile: async () => new TextEncoder().encode(JSON.stringify(edited)),
    }));
    const mod = await import("../src/masters");
    mod.rememberMaster(edited, "/tmp/lolev.master");
    const resolved = await mod.resolveMasterById(mod.SHIPPED_MASTER_ID);
    // Legacy JSON bytes resolve through unpackMaster's '{' sniff, asset-less.
    expect(resolved?.master.defaults.beerName).toBe("ZZZ-EDITED");
    expect(resolved?.assets).toEqual({});
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });

  it("an empty/broken index still yields the built-in fixture for the shipped id", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    vi.doMock("@/files", () => ({
      readNativeFile: async () => { throw new Error("not found"); },
    }));
    const mod = await import("../src/masters");
    const resolved = await mod.resolveMasterById(mod.SHIPPED_MASTER_ID);
    expect(resolved).toEqual({ master: lolevMaster(), assets: {} });
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });

  // Minor (Wave B fix round): the file at the index's path parses fine, but
  // holds a DIFFERENT master's id than requested — a stale index entry
  // (moved/reused path) or a corrupt hint. readMasterAt's own `m.id === id`
  // check must reject it rather than handing back the wrong master.
  it("a file that parses but whose id doesn't match the requested id is rejected, not returned", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const wrongMaster = { ...lolevMaster(), id: "master-someone-else" };
    vi.doMock("@/files", () => ({
      readNativeFile: async () => new TextEncoder().encode(JSON.stringify(wrongMaster)),
    }));
    const mod = await import("../src/masters");
    // Index entry claims to hold "master-requested", but the file at its
    // path is actually "master-someone-else".
    localStorage.setItem("labellab.masters", JSON.stringify({
      "master-requested": { name: "Stale", path: "/tmp/stale.master", lastSeen: new Date().toISOString() },
    }));
    expect(await mod.resolveMasterById("master-requested")).toBeNull();
    // Same mismatch via the hint path (no index entry at all).
    expect(await mod.resolveMasterById("master-requested", "/tmp/stale.master")).toBeNull();
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });
});
