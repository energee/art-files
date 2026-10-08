// master-cache-bound.test.ts — the browser master cache (src/masterCache.ts)
// stays bounded (#406). Every open and save caches the master's bytes and each
// Save As mints a new id, so without eviction the store grew until the quota
// filled and every later put failed without a word. Runs against a real
// IndexedDB implementation (fake-indexeddb), not a mock of the module.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CACHED_MASTERS, cacheMaster, cachedMaster, dropCachedMaster } from "../src/masterCache";

const bytes = (n: number) => new Uint8Array([n, n, n]);

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("master cache bound (#406)", () => {
  it("keeps only the most recently cached masters", async () => {
    for (let i = 0; i <= MAX_CACHED_MASTERS; i++) await cacheMaster(`m${i}`, bytes(i));
    expect(await cachedMaster("m0")).toBeNull();
    expect(await cachedMaster("m1")).toEqual(bytes(1));
    expect(await cachedMaster(`m${MAX_CACHED_MASTERS}`)).toEqual(bytes(MAX_CACHED_MASTERS));
  });

  it("caching a master again makes it the newest, so it survives", async () => {
    for (let i = 0; i < MAX_CACHED_MASTERS; i++) await cacheMaster(`m${i}`, bytes(i));
    await cacheMaster("m0", bytes(42));
    await cacheMaster("new", bytes(7));
    expect(await cachedMaster("m0")).toEqual(bytes(42));
    expect(await cachedMaster("m1")).toBeNull();
  });

  it("a dropped master frees its slot", async () => {
    await cacheMaster("kept", bytes(1));
    await cacheMaster("gone", bytes(2));
    await dropCachedMaster("gone");
    for (let i = 1; i < MAX_CACHED_MASTERS; i++) await cacheMaster(`m${i}`, bytes(i));
    expect(await cachedMaster("kept")).toEqual(bytes(1));
  });

  it("a cache from before the bound is trimmed on the next write", async () => {
    // Fill the store directly, as an older build did: no recency record.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("labellab", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("masters");
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction("masters", "readwrite");
    for (let i = 0; i < MAX_CACHED_MASTERS + 5; i++) tx.objectStore("masters").put(bytes(i), `old${i}`);
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
    await cacheMaster("new", bytes(9));
    expect(await cachedMaster("new")).toEqual(bytes(9));
    const left = await Promise.all(
      Array.from({ length: MAX_CACHED_MASTERS + 5 }, (_, i) => cachedMaster(`old${i}`)),
    );
    expect(left.filter(Boolean)).toHaveLength(MAX_CACHED_MASTERS - 1);
  });

  it("logs a put that fails instead of failing silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await cacheMaster("big", bytes(1));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("big"));
  });
});
