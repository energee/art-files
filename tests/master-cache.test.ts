// master-cache.test.ts — the browser's stand-in for the filesystem
// (src/masterCache.ts). A browser tab has no path to re-read a .master from,
// so resolveMasterById used to fall all the way back to the shipped fixture
// and silently swap the operator's own template for it on every reload.
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lolevMaster } from "../src/model/lolevLayers";
import { packMaster } from "../src/model/files";

const cache = new Map<string, Uint8Array>();
vi.mock("../src/masterCache", () => ({
  cacheMaster: async (id: string, bytes: Uint8Array) => { cache.set(id, bytes); },
  cachedMaster: async (id: string) => cache.get(id) ?? null,
}));
// A browser: no filesystem paths to read (the Tauri branch is the desktop's).
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));

const { rememberMaster, resolveMasterById, SHIPPED_MASTER_ID } = await import("../src/masters");

const mine = (): ReturnType<typeof lolevMaster> =>
  ({ ...lolevMaster(), id: "master-mine", name: "Mine" });

beforeEach(() => { cache.clear(); localStorage.clear(); });

describe("resolveMasterById in a browser", () => {
  it("resolves a saved master from its cached bytes", async () => {
    const m = mine();
    rememberMaster(m, "mine.master", packMaster(m, {}));
    const r = await resolveMasterById(m.id);
    expect(r?.master.id).toBe("master-mine");
    expect(r?.master.name).toBe("Mine");
  });

  // The bug: an edited SHIPPED master resolved to the fixture, not the file.
  it("prefers the cached bytes over the shipped fixture", async () => {
    const m = { ...lolevMaster(), name: "Lolev (edited)" };
    rememberMaster(m, "lolev.master", packMaster(m, {}));
    expect((await resolveMasterById(SHIPPED_MASTER_ID))?.master.name).toBe("Lolev (edited)");
  });

  it("still falls back to the fixture with nothing cached", async () => {
    expect((await resolveMasterById(SHIPPED_MASTER_ID))?.master.id).toBe(SHIPPED_MASTER_ID);
    expect(await resolveMasterById("master-nowhere")).toBeNull();
  });
});
