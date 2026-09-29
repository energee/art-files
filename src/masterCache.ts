// src/masterCache.ts — the browser's stand-in for the filesystem: the bytes of
// every .master this operator saved or opened, keyed by master id.
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
// blocked degrades to exactly the old behaviour.
const DB = "labellab";
const STORE = "masters";

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

/** Keep the bytes of a .master this operator saved or opened. */
export async function cacheMaster(id: string, bytes: Uint8Array): Promise<void> {
  await run("readwrite", (s) => s.put(bytes, id));
}

/** The cached bytes for a master id, or null when nothing is held. */
export async function cachedMaster(id: string): Promise<Uint8Array | null> {
  const held = await run<unknown>("readonly", (s) => s.get(id) as IDBRequest<unknown>);
  return held instanceof Uint8Array ? held
    : held instanceof ArrayBuffer ? new Uint8Array(held) : null;
}

/** Drop a cached master. The file at its path now holds a different id, so
 *  these bytes are an older copy and must not resolve in its place. */
export async function dropCachedMaster(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}
