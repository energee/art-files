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

const LEGACY = MAX_CACHED_MASTERS + 5;

/** Fill the store directly, as a build from before the bound did: no recency
 *  record, more masters than the bound. */
async function seedLegacyStore(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const req = indexedDB.open("labellab", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("masters");
    req.onsuccess = () => resolve(req.result);
  });
  const tx = db.transaction("masters", "readwrite");
  for (let i = 0; i < LEGACY; i++) tx.objectStore("masters").put(bytes(i), `old${i}`);
  await new Promise((r) => { tx.oncomplete = r; });
  db.close();
}

/** How many of seedLegacyStore's masters are still cached. */
async function legacyLeft(): Promise<number> {
  const left = await Promise.all(Array.from({ length: LEGACY }, (_, i) => cachedMaster(`old${i}`)));
  return left.filter(Boolean).length;
}

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
    await seedLegacyStore();
    await cacheMaster("new", bytes(9));
    expect(await cachedMaster("new")).toEqual(bytes(9));
    expect(await legacyLeft()).toBe(MAX_CACHED_MASTERS - 1);
  });

  it("a store already full still evicts, even though the new put fails", async () => {
    // The quota was hit before the bound shipped. Eviction must not ride in
    // the same transaction as the put, or the put's abort rolls it back and
    // the store stays full for good.
    await seedLegacyStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, v: unknown, k?: IDBValidKey) {
      if (v instanceof Uint8Array) throw new DOMException("full", "QuotaExceededError");
      return realPut.call(this, v, k);
    });
    await cacheMaster("new", bytes(9));
    vi.restoreAllMocks();
    expect(await legacyLeft()).toBe(MAX_CACHED_MASTERS - 1);
  });

  it("reading a cached master back counts as using it", async () => {
    // A reload's default master is read every launch but cached only once;
    // without this, twenty label opens later it was the first evicted.
    for (let i = 0; i < MAX_CACHED_MASTERS; i++) await cacheMaster(`m${i}`, bytes(i));
    expect(await cachedMaster("m0")).toEqual(bytes(0));
    await cacheMaster("new", bytes(7));
    expect(await cachedMaster("m0")).toEqual(bytes(0));
    expect(await cachedMaster("m1")).toBeNull();
  });

  it("a read on a cache from before the bound keeps that master over the rest", async () => {
    // The first thing a browser reload does is read its last master. With no
    // recency record the others rank by key, where "old9" sorts last and
    // would otherwise be among the first evicted.
    await seedLegacyStore();
    expect(await cachedMaster("old9")).toEqual(bytes(9));
    await cacheMaster("new", bytes(1));
    expect(await cachedMaster("old9")).toEqual(bytes(9));
    expect(await legacyLeft()).toBe(MAX_CACHED_MASTERS - 1);
  });

  it("bytes the recency record does not list are still evicted", async () => {
    // A touch that failed while its put landed leaves bytes the record never
    // names; without reconciling against the store they escape the bound.
    for (let i = 0; i < MAX_CACHED_MASTERS; i++) await cacheMaster(`m${i}`, bytes(i));
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("labellab");
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction("masters", "readwrite");
    tx.objectStore("masters").put(bytes(99), "orphan");
    await new Promise((r) => { tx.oncomplete = r; });
    db.close();
    await cacheMaster("new", bytes(7));
    expect(await cachedMaster("orphan")).toBeNull();
    expect(await cachedMaster("m1")).toEqual(bytes(1));
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
