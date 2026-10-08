import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetMaster, hintTrusted, masterIndex, newMasterId, rememberMaster, resolveMasterById, SHIPPED_MASTER_ID } from "../src/masters";
import { lolevMaster } from "../src/model/lolevLayers";
import { parseMasterJson, serializeMaster } from "../src/model/files";

const stored = new Map<string, string>();
const fakeLocalStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
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
  it("rejects a barcode whose solidBackground is not a boolean", () => {
    const m = lolevMaster();
    const bc = m.layers.find((l) => l.kind === "barcode")!;
    (bc as unknown as { solidBackground: unknown }).solidBackground = "false";
    expect(() => parseMasterJson(JSON.parse(serializeMaster(m)))).toThrow(/solidBackground/);
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
  it("forgets a library master and leaves the next launch unpinned from it", async () => {
    await rememberMaster(lolevMaster(), "/tmp/lolev.master");
    localStorage.setItem("labellab.lastMaster", SHIPPED_MASTER_ID);
    await forgetMaster(SHIPPED_MASTER_ID);
    expect(masterIndex()[SHIPPED_MASTER_ID]).toBeUndefined();
    expect(localStorage.getItem("labellab.lastMaster")).toBeNull();
  });

  it("a saved master registers in the library index under its own id", () => {
    const m = parseMasterJson(JSON.parse(serializeMaster(lolevMaster()))).master;
    rememberMaster(m, "/tmp/lolev.master");
    expect(masterIndex()[m.id]).toMatchObject({ name: "Lolev", path: "/tmp/lolev.master" });
  });

  // Finding #6: a registered .master on disk whose id is the shipped id must
  // win over the built-in fixture — resolveMasterById must consult the
  // index/hint BEFORE falling back to lolevMaster().
  it("a registered .master on disk for the shipped id wins over the built-in fixture", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const edited = lolevMaster();
    edited.name = "ZZZ-EDITED";
    vi.doMock("@/files", () => ({
      readNativeFile: async () => new TextEncoder().encode(JSON.stringify(edited)),
    }));
    const mod = await import("../src/masters");
    mod.rememberMaster(edited, "/tmp/lolev.master");
    const resolved = await mod.resolveMasterById(mod.SHIPPED_MASTER_ID);
    // Legacy JSON bytes resolve through unpackMaster's '{' sniff, asset-less.
    expect(resolved?.master.name).toBe("ZZZ-EDITED");
    expect(resolved?.assets).toEqual({});
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });

  // Desktop .master reads can fail (fs scope, a basename registered by the
  // hidden-input Open Master path) — the cached bytes from the last apply
  // must still win over the hardcoded fixture.
  it("cached bytes win when the desktop path cannot be read", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    vi.doMock("@/files", () => ({
      readNativeFile: async () => { throw new Error("forbidden"); },
    }));
    const held = new Map<string, Uint8Array>();
    vi.doMock("@/masterCache", () => ({
      cacheMaster: async (id: string, bytes: Uint8Array) => { held.set(id, bytes); },
      cachedMaster: async (id: string) => held.get(id) ?? null,
    }));
    const { packMaster } = await import("../src/model/files");
    const mod = await import("../src/masters");
    const edited = { ...lolevMaster(), name: "ZZZ-CACHED" };
    await mod.rememberMaster(edited, "lolev.master", packMaster(edited, {}));
    expect((await mod.resolveMasterById(mod.SHIPPED_MASTER_ID))?.master.name).toBe("ZZZ-CACHED");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
    vi.doUnmock("@/masterCache");
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
    // The index row named a file that is a different master now.
    expect(mod.masterIndex()["master-requested"]).toBeUndefined();
    // Same mismatch via the hint path (no index entry at all).
    expect(await mod.resolveMasterById("master-requested", "/tmp/stale.master")).toBeNull();
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });

  // Save Master As over the same path mints a new id. Labels still name the
  // old one, and the browser cache still holds the old bytes. Opening the
  // label follows the file; a library lookup by the old id does not revive it.
  it("a label follows the master file when that file was saved under a new id", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const onDisk = { ...lolevMaster(), id: "master-newer", name: "Newer" };
    vi.doMock("@/files", () => ({
      readNativeFile: async () => new TextEncoder().encode(JSON.stringify(onDisk)),
    }));
    const held = new Map<string, Uint8Array>();
    vi.doMock("@/masterCache", () => ({
      cacheMaster: async (id: string, bytes: Uint8Array) => { held.set(id, bytes); },
      cachedMaster: async (id: string) => held.get(id) ?? null,
      dropCachedMaster: async (id: string) => { held.delete(id); },
    }));
    const { packMaster } = await import("../src/model/files");
    const mod = await import("../src/masters");
    const old = { ...lolevMaster(), id: "master-old", name: "Old" };
    await mod.rememberMaster(old, "/tmp/lolev.master", packMaster(old, {}));
    localStorage.setItem("labellab.lastMaster", "master-old");
    expect(await mod.resolveMasterById("master-old")).toBeNull();
    expect(held.has("master-old")).toBe(false);
    expect(mod.masterIndex()["master-old"]).toBeUndefined();
    expect(localStorage.getItem("labellab.lastMaster")).toBe("master-newer");
    const followed = await mod.resolveLabelMaster("master-old", "/tmp/lolev.master", "/tmp/beer.label");
    expect(followed?.master.id).toBe("master-newer");
    expect(followed?.master.name).toBe("Newer");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
    vi.doUnmock("@/masterCache");
  });

  // A restart reopens the last master. When its file was saved again under a
  // new id (Save Master As over the same path), the untitled tab follows the
  // file instead of falling back to shipped Lolev for that launch.
  it("an untitled restart follows the master file saved under a new id", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const onDisk = { ...lolevMaster(), id: "master-newer", name: "Newer" };
    vi.doMock("@/files", () => ({
      readNativeFile: async () => new TextEncoder().encode(JSON.stringify(onDisk)),
    }));
    const mod = await import("../src/masters");
    const old = { ...lolevMaster(), id: "master-old", name: "Old" };
    await mod.rememberMaster(old, "/tmp/lolev.master");
    const resolved = await mod.resolveDefaultMaster();
    expect(resolved.master.id).toBe("master-newer");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });

  // The index path now holds some other master and the label's hint can't be
  // read: the remembered copy of the label's own master still stands in, and
  // the stale index row is retired without taking those bytes with it.
  it("a label falls back to the remembered copy when its hint is unreadable and the index file is another master", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const other = { ...lolevMaster(), id: "master-other", name: "Other" };
    vi.doMock("@/files", () => ({
      readNativeFile: async (p: string) => {
        if (p === "/tmp/indexed.master") return new TextEncoder().encode(JSON.stringify(other));
        throw new Error("forbidden");
      },
    }));
    const held = new Map<string, Uint8Array>();
    vi.doMock("@/masterCache", () => ({
      cacheMaster: async (id: string, bytes: Uint8Array) => { held.set(id, bytes); },
      cachedMaster: async (id: string) => held.get(id) ?? null,
      dropCachedMaster: async (id: string) => { held.delete(id); },
    }));
    const { packMaster } = await import("../src/model/files");
    const mod = await import("../src/masters");
    const mine = { ...lolevMaster(), id: "master-mine", name: "Mine" };
    await mod.rememberMaster(mine, "/tmp/indexed.master", packMaster(mine, {}));
    const r = await mod.resolveLabelMaster("master-mine", "/tmp/hint/mine.master", "/tmp/hint/beer.label");
    expect(r?.master.name).toBe("Mine");
    expect(mod.masterIndex()["master-mine"]).toBeUndefined();
    // The stand-in must outlive the open: the same label opens again.
    const again = await mod.resolveLabelMaster("master-mine", "/tmp/hint/mine.master", "/tmp/hint/beer.label");
    expect(again?.master.name).toBe("Mine");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
    vi.doUnmock("@/masterCache");
  });

  it("forgetting a master still drops its remembered bytes when storage refuses the write", async () => {
    const held = new Map<string, Uint8Array>([["m1", new Uint8Array([1])]]);
    vi.doMock("@/masterCache", () => ({
      cacheMaster: async () => {},
      cachedMaster: async (id: string) => held.get(id) ?? null,
      dropCachedMaster: async (id: string) => { held.delete(id); },
    }));
    const mod = await import("../src/masters");
    localStorage.setItem("labellab.masters", JSON.stringify({ m1: { name: "M", path: "/a.master", lastSeen: "" } }));
    vi.stubGlobal("localStorage", { ...fakeLocalStorage, setItem: () => { throw new Error("quota"); } });
    await expect(mod.forgetMaster("m1")).resolves.toBeUndefined();
    expect(held.has("m1")).toBe(false);
    vi.doUnmock("@/masterCache");
  });

  // A .label is shared, so its masterHint is untrusted: only a path beside
  // the label or beside an already-registered master may be read.
  it("reads a hint only when it sits beside the label or a registered master", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const reads: string[] = [];
    vi.doMock("@/files", () => ({
      readNativeFile: async (p: string) => { reads.push(p); throw new Error("not found"); },
    }));
    const mod = await import("../src/masters");
    const label = "/Users/me/beers/a.label";
    await mod.resolveMasterById("x", "/Users/me/beers/../../../etc/x.master", label);
    await mod.resolveMasterById("x", "/elsewhere/x.master", label);
    await mod.resolveMasterById("x", "/elsewhere/x.master"); // no label path, empty index
    expect(reads).toEqual([]);
    await mod.resolveMasterById("x", "/Users/me/beers/masters/x.master", label);
    localStorage.setItem("labellab.masters", JSON.stringify({
      other: { name: "Other", path: "/lib/other.master", lastSeen: "" },
    }));
    await mod.resolveMasterById("x", "/lib/x.master");
    expect(reads).toEqual(["/Users/me/beers/masters/x.master", "/lib/x.master"]);
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });
  // Two files can carry one master id: the same shipped master edited and
  // saved on two machines, or two legacy 8-hex forks that collided (#405).
  // The index holds one path per id, so a label must open the file at its own
  // trusted hint before the index's file for that id.
  it("a label opens the master at its own hint path when another file holds the same id", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const theirs = { ...lolevMaster(), id: "master-dup", name: "Theirs" };
    const ours = { ...lolevMaster(), id: "master-dup", name: "Ours" };
    const reads: string[] = [];
    vi.doMock("@/files", () => ({
      readNativeFile: async (p: string) => {
        reads.push(p);
        return new TextEncoder().encode(JSON.stringify(p === "/beers/ours.master" ? ours : theirs));
      },
    }));
    const mod = await import("../src/masters");
    localStorage.setItem("labellab.masters", JSON.stringify({
      "master-dup": { name: "Theirs", path: "/lib/theirs.master", lastSeen: "" },
    }));
    const r = await mod.resolveLabelMaster("master-dup", "/beers/ours.master", "/beers/beer.label");
    expect(r?.master.name).toBe("Ours");
    // The tab binds Save Master and its saved masterHint to this path.
    expect(r?.path).toBe("/beers/ours.master");
    expect(reads[0]).toBe("/beers/ours.master");
    // The library keeps its own file for the id: a shared label does not
    // take over the entry, so a library pick and other tabs still get it.
    expect(mod.masterIndex()["master-dup"]?.path).toBe("/lib/theirs.master");
    expect((await mod.resolveMasterById("master-dup"))?.master.name).toBe("Theirs");
    // A second label with the same id opens its own file without moving the row.
    const t = await mod.resolveLabelMaster("master-dup", "/lib/theirs.master", "/lib/b.label");
    expect(t?.master.name).toBe("Theirs");
    expect(mod.masterIndex()["master-dup"]?.path).toBe("/lib/theirs.master");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });
  // A label received from someone else, for a master this library has never
  // seen: the file beside it joins the library so later opens find it.
  it("a hinted master joins the library when the library has no file for its id", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const theirs = { ...lolevMaster(), id: "master-new", name: "New" };
    vi.doMock("@/files", () => ({
      readNativeFile: async () => new TextEncoder().encode(JSON.stringify(theirs)),
    }));
    const mod = await import("../src/masters");
    const r = await mod.resolveLabelMaster("master-new", "/beers/new.master", "/beers/beer.label");
    expect(r?.master.name).toBe("New");
    expect(mod.masterIndex()["master-new"]?.path).toBe("/beers/new.master");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });
  // "Use current" in the missing-master dialog re-resolves the tab's master
  // through the tab's own file, passed as its own trust root: the library's
  // row for the id may name a different file (#405).
  it("a file passed as its own trust root resolves over the library row for its id", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const theirs = { ...lolevMaster(), id: "master-dup", name: "Theirs" };
    const ours = { ...lolevMaster(), id: "master-dup", name: "Ours" };
    vi.doMock("@/files", () => ({
      readNativeFile: async (p: string) =>
        new TextEncoder().encode(JSON.stringify(p === "/elsewhere/ours.master" ? ours : theirs)),
    }));
    const mod = await import("../src/masters");
    localStorage.setItem("labellab.masters", JSON.stringify({
      "master-dup": { name: "Theirs", path: "/lib/theirs.master", lastSeen: "" },
    }));
    const own = "/elsewhere/ours.master";
    const r = await mod.resolveMasterById("master-dup", own, own);
    expect(r?.master.name).toBe("Ours");
    expect(r?.path).toBe(own);
    expect(mod.masterIndex()["master-dup"]?.path).toBe("/lib/theirs.master");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });
  // The library's file for the id was moved or deleted: the label's hint
  // repairs the row instead of leaving it pointing at nothing.
  it("a hinted master replaces a library row whose file is gone", async () => {
    vi.doMock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
    const moved = { ...lolevMaster(), id: "master-moved", name: "Moved" };
    vi.doMock("@/files", () => ({
      readNativeFile: async (p: string) => {
        if (p !== "/beers/moved.master") throw new Error("not found");
        return new TextEncoder().encode(JSON.stringify(moved));
      },
    }));
    const mod = await import("../src/masters");
    localStorage.setItem("labellab.masters", JSON.stringify({
      "master-moved": { name: "Moved", path: "/lib/old.master", lastSeen: "" },
    }));
    const r = await mod.resolveLabelMaster("master-moved", "/beers/moved.master", "/beers/beer.label");
    expect(r?.master.name).toBe("Moved");
    expect(mod.masterIndex()["master-moved"]?.path).toBe("/beers/moved.master");
    vi.doUnmock("@tauri-apps/api/core");
    vi.doUnmock("@/files");
  });
  // Save Master As used to mint 8 hex chars, few enough to collide (#405).
  it("mints a full UUID for a forked master", () => {
    const a = newMasterId();
    expect(a).toMatch(/^master-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newMasterId()).not.toBe(a);
  });
  it("hintTrusted is lexical and separator-agnostic", () => {
    expect(hintTrusted("/a/b/x.master", "/a/b/l.label")).toBe(true);
    expect(hintTrusted("C:\\labels\\x.master", "C:/labels/l.label")).toBe(true);
    expect(hintTrusted("/a/bc/x.master", "/a/b/l.label")).toBe(false);
    expect(hintTrusted("/a/b/../c/x.master", "/a/b/l.label")).toBe(false);
    expect(hintTrusted("x.master", "l.label")).toBe(false); // a bare name has no folder
    expect(hintTrusted("/a/b/x.master")).toBe(false);
  });
});
