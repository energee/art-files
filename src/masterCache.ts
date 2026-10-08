// src/masterCache.ts — the browser's stand-in for the filesystem: the bytes of
// the .master files this operator most recently saved, opened or used, keyed
// by master id.
//
// On the desktop, .master files on disk are the source of truth and
// masters.ts resolves a label's master by path. A browser tab has no path to
// re-read, so before this cache a reload fell all the way back to the shipped
// fixture and the operator's own template vanished (masters.ts's last-resort
// branch). IndexedDB rather than localStorage because a master is a ZIP with
// image assets in it — megabytes, not the few KB localStorage promises.
//
// Best-effort by construction: every call resolves to null/undefined rather
// than throwing, so a private window, a full disk or a browser with the store
// blocked degrades to exactly the old behaviour. A put that fails is logged.
//
// Bounded (#406): every open and save caches, and each Save As mints a new id,
// so the store keeps only the MAX_CACHED_MASTERS most recently cached or read
// ids. Their order lives in one RECENCY record in the same store, newest first.
const DB = "labellab";
const STORE = "masters";
const RECENCY = "labellab:recency";
/** How many masters' bytes the cache holds before it evicts the oldest. */
export const MAX_CACHED_MASTERS = 20;
/** Crash-recovery snapshots of unsaved tabs (recovery.ts) share this DB. */
export const RECOVERY_STORE = "recovery";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      // v2 added the recovery store; create whichever store is missing.
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => {
        for (const name of [STORE, RECOVERY_STORE])
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // no IndexedDB at all (a locked-down browser, a test)
    }
  });
}

/** One request against one store of the app's IndexedDB; null on any failure. */
export function run<T>(
  mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>, store = STORE,
): Promise<T | null> {
  return open().then((db) => db && new Promise<T | null>((resolve) => {
    // Close the connection on the way out, whichever way it goes: `open`
    // makes a fresh one per call, and a leaked one both holds memory and
    // blocks any later version upgrade indefinitely.
    const done = (v: T | null) => { try { db.close(); } catch { /* already gone */ } resolve(v); };
    try {
      const tx = db.transaction(store, mode);
      const req = act(tx.objectStore(store));
      // For a write the request settles before the transaction commits, so
      // the close waits on the transaction; for a read either is enough.
      tx.oncomplete = () => done(req.result ?? null);
      tx.onerror = tx.onabort = () => done(null);
      req.onerror = () => done(null);
    } catch {
      done(null);
    }
  }));
}

/** Keep the bytes of a .master this operator saved or opened, as the newest
 *  entry; the oldest beyond MAX_CACHED_MASTERS are dropped first. A failed
 *  write (a full quota) is logged, not thrown. */
export async function cacheMaster(id: string, bytes: Uint8Array): Promise<void> {
  // Make room before the put, in its own transaction: a put that fails on a
  // full quota aborts its transaction, and an eviction riding in it would
  // roll back too, leaving a store that was already full stuck full. If the
  // put then fails, the id holds its slot with no bytes until it ages out.
  await reorder((ids) => [id, ...ids.filter((k) => k !== id)]);
  const ok = await run("readwrite", (s) => s.put(bytes, id));
  if (ok === null) console.warn(`Could not cache master ${id}; the browser store may be full or unavailable.`);
}

/** Rewrite the recency order with `edit` and evict every id past the bound.
 *  The recency put can itself fail on a full quota and take the evicting
 *  deletes down with it, so a failed write is followed by an eviction alone. */
async function reorder(edit: (ids: IDBValidKey[]) => IDBValidKey[]): Promise<void> {
  if (await run("readwrite", (s) => rerank(s, edit, true)) === null) {
    await run("readwrite", (s) => rerank(s, edit, false));
  }
}

/** One reorder pass inside a transaction. Bytes the order does not list (a
 *  cache from before the bound, a recency write that failed) rank behind the
 *  listed ids in key order, so nothing escapes the bound. A listed id with no
 *  bytes keeps its place: another tab's put may still be on its way. Returns
 *  the key read, which always has a result, so `run` reports success. */
function rerank(s: IDBObjectStore, edit: (ids: IDBValidKey[]) => IDBValidKey[], record: boolean): IDBRequest {
  const all = s.getAllKeys();
  const order = s.get(RECENCY);
  order.onsuccess = () => {
    const listed: IDBValidKey[] = Array.isArray(order.result) ? order.result : [];
    const known = new Set(listed);
    const ranked = edit([...listed, ...all.result.filter((k) => k !== RECENCY && !known.has(k))]);
    for (const old of ranked.slice(MAX_CACHED_MASTERS)) s.delete(old);
    if (record) s.put(ranked.slice(0, MAX_CACHED_MASTERS), RECENCY);
  };
  return all;
}

/** The cached bytes for a master id, or null when nothing is held. A hit
 *  counts as a use: a browser reload resolves its master from here without
 *  caching it again, so without the touch the master the operator works in
 *  every day would be the first evicted. */
export async function cachedMaster(id: string): Promise<Uint8Array | null> {
  const held = await run<unknown>("readonly", (s) => s.get(id) as IDBRequest<unknown>);
  const bytes = held instanceof Uint8Array ? held
    : held instanceof ArrayBuffer ? new Uint8Array(held) : null;
  // A separate write: a failed touch (a full quota) must not lose the read.
  if (bytes) await reorder((ids) => [id, ...ids.filter((k) => k !== id)]);
  return bytes;
}

/** Drop a cached master. The file at its path now holds a different id, so
 *  these bytes are an older copy and must not resolve in its place. */
export async function dropCachedMaster(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
  // Then free its slot in the order; a listed id with no bytes would hold it.
  await reorder((ids) => ids.filter((k) => k !== id));
}
