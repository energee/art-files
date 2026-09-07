// master-cache.test.ts — the browser's stand-in for the filesystem
// (src/masterCache.ts). A browser tab has no path to re-read a .master from,
// so resolveMasterById used to fall all the way back to the shipped fixture
// and silently swap the operator's own template for it on every reload.
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lolevMaster } from "../src/model/lolevLayers";
import { packMaster } from "../src/model/files";

const cache = new Map<string, Uint8Array>();
const cacheGate = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock("../src/masterCache", () => ({
  cacheMaster: async (id: string, bytes: Uint8Array) => {
    if (cacheGate.hold) await cacheGate.hold;
    cache.set(id, bytes);
  },
  cachedMaster: async (id: string) => cache.get(id) ?? null,
}));
// A browser: no filesystem paths to read (the Tauri branch is the desktop's).
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

const { rememberMaster, resolveMasterById, resolveDefaultMaster, SHIPPED_MASTER_ID } = await import("../src/masters");

const mine = (): ReturnType<typeof lolevMaster> =>
  ({ ...lolevMaster(), id: "master-mine", name: "Mine" });

beforeEach(() => { cache.clear(); localStorage.clear(); cacheGate.hold = null; });

describe("resolveMasterById in a browser", () => {
  it("resolves a saved master from its cached bytes", async () => {
    const m = mine();
    await rememberMaster(m, "mine.master", packMaster(m, {}));
    const r = await resolveMasterById(m.id);
    expect(r?.master.id).toBe("master-mine");
    expect(r?.master.name).toBe("Mine");
  });

  // The bug: an edited SHIPPED master resolved to the fixture, not the file.
  it("prefers the cached bytes over the shipped fixture", async () => {
    const m = { ...lolevMaster(), name: "Lolev (edited)" };
    await rememberMaster(m, "lolev.master", packMaster(m, {}));
    expect((await resolveMasterById(SHIPPED_MASTER_ID))?.master.name).toBe("Lolev (edited)");
  });

  it("still falls back to the fixture with nothing cached", async () => {
    expect((await resolveMasterById(SHIPPED_MASTER_ID))?.master.id).toBe(SHIPPED_MASTER_ID);
    expect(await resolveMasterById("master-nowhere")).toBeNull();
  });
});

describe("resolveDefaultMaster", () => {
  it("is the shipped fixture on a fresh install", async () => {
    const r = await resolveDefaultMaster();
    expect(r.master.id).toBe(SHIPPED_MASTER_ID);
    expect(r.master.name).toBe("Lolev");
  });

  it("reloads the last master that was applied, not the shipped fixture", async () => {
    const m = mine();
    await rememberMaster(m, "mine.master", packMaster(m, {}));
    const r = await resolveDefaultMaster();
    expect(r.master.id).toBe("master-mine");
    expect(r.master.name).toBe("Mine");
  });

  it("reloads an edited shipped master instead of the hardcoded fixture", async () => {
    await rememberMaster({ ...lolevMaster(), name: "Lolev (edited)" }, "lolev.master", packMaster({ ...lolevMaster(), name: "Lolev (edited)" }, {}));
    expect((await resolveDefaultMaster()).master.name).toBe("Lolev (edited)");
  });

  it("uses the most recently remembered index entry when no last-applied id is stored yet", async () => {
    const m = mine();
    localStorage.setItem("labellab.masters", JSON.stringify({
      [m.id]: { name: m.name, path: "mine.master", lastSeen: "2026-09-06T12:00:00.000Z" },
    }));
    cache.set(m.id, packMaster(m, {}));
    const r = await resolveDefaultMaster();
    expect(r.master.id).toBe("master-mine");
  });

  it("resolving a .label's master does not steal the last-applied default", async () => {
    const a = mine();
    await rememberMaster(a, "mine.master", packMaster(a, {}));
    const other = { ...lolevMaster(), id: "master-other", name: "Other" };
    await rememberMaster(other, "other.master", packMaster(other, {}), { applied: false });
    expect((await resolveDefaultMaster()).master.id).toBe("master-mine");
  });

  it("does not settle rememberMaster before the applied bytes are cached", async () => {
    let release!: () => void;
    cacheGate.hold = new Promise<void>((r) => { release = r; });
    const m = mine();
    const done = Promise.resolve(rememberMaster(m, "mine.master", packMaster(m, {})));
    let settled = false;
    void done.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect((await resolveDefaultMaster()).master.id).toBe(SHIPPED_MASTER_ID);
    release();
    await done;
    expect((await resolveDefaultMaster()).master.id).toBe("master-mine");
  });

  it("a resolve-only index entry cannot win the lastSeen fallback", async () => {
    const a = mine();
    localStorage.setItem("labellab.masters", JSON.stringify({
      [a.id]: { name: a.name, path: "mine.master", lastSeen: "2026-09-06T12:00:00.000Z" },
    }));
    cache.set(a.id, packMaster(a, {}));
    const other = { ...lolevMaster(), id: "master-other", name: "Other" };
    await rememberMaster(other, "other.master", packMaster(other, {}), { applied: false });
    expect((await resolveDefaultMaster()).master.id).toBe("master-mine");
  });
});
