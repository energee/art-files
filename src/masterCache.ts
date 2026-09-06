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
    try {
      const req = act(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
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
