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

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // no IndexedDB at all (a locked-down browser, a test)
    }
  });
}

function run<T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then((db) => db && new Promise<T | null>((resolve) => {
    // Close the connection on the way out, whichever way it goes: `open`
    // makes a fresh one per call, and a leaked one both holds memory and
    // blocks any later version upgrade indefinitely.
    const done = (v: T | null) => { try { db.close(); } catch { /* already gone */ } resolve(v); };
    try {
      const tx = db.transaction(STORE, mode);
      const req = act(tx.objectStore(STORE));
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
  // Make room in its own transaction: a put that fails on a full quota aborts
  // its transaction, and an eviction riding in it would roll back too, leaving
  // a store that was already full stuck full. If the put then fails, the id
  // holds a recency slot with no bytes until it ages out; reads return null.
  await run("readwrite", (s) => touch(s, id));
  const ok = await run("readwrite", (s) => s.put(bytes, id));
  if (ok === null) console.warn(`Could not cache master ${id}; the browser store may be full.`);
}

/** Move id to the head of the recency order and evict every id past the
 *  bound. Returns the recency read so `run` has a request to settle on. */
function touch(s: IDBObjectStore, id: string): IDBRequest {
  const order = s.get(RECENCY);
  order.onsuccess = () => {
    if (Array.isArray(order.result)) return promote(s, id, order.result);
    // No record yet: a cache from before the bound. Its existing ids rank
    // behind this one, in key order (an older build kept no age), so the
    // overflow they already caused is evicted now.
    const all = s.getAllKeys();
    all.onsuccess = () => promote(s, id, all.result);
  };
  return order;
}

/** Put id at the head of the recency order, drop every id past the bound and
 *  store what remains. */
function promote(s: IDBObjectStore, id: string, prev: unknown[]): void {
  const order = [id, ...prev.filter((k) => k !== id && k !== RECENCY)];
  for (const old of order.slice(MAX_CACHED_MASTERS)) s.delete(old as IDBValidKey);
  s.put(order.slice(0, MAX_CACHED_MASTERS), RECENCY);
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
  if (bytes) await run("readwrite", (s) => touch(s, id));
  return bytes;
}

/** Drop a cached master. The file at its path now holds a different id, so
 *  these bytes are an older copy and must not resolve in its place. */
export async function dropCachedMaster(id: string): Promise<void> {
  await run("readwrite", (s) => {
    const order = s.get(RECENCY);
    // Off the recency list too, so the dropped id stops holding a slot.
    order.onsuccess = () => {
      if (Array.isArray(order.result)) s.put(order.result.filter((k) => k !== id), RECENCY);
    };
    return s.delete(id);
  });
}
