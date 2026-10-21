// src/recovery.ts — crash recovery for unsaved tabs (#394). Each editor with
// unsaved work keeps a packed .label snapshot here (IndexedDB, via
// masterCache's store helper), keyed `<launch id>:<tab id>`. A clean save
// or a tab close drops its snapshot; a crash, a WebView kill or a forced
// quit leaves it behind, and the next launch offers it back (TabsShell).
// A desktop snapshot also records the file its tab was bound to, and that
// file's mtime when the tab bound or saved it, which canRebind checks before
// the restored tab may take the file back.
// Best-effort like masterCache: a failed write just means nothing to offer.
import { RECOVERY_STORE, run } from "@/masterCache";

/** `filePath`: the desktop file the tab was bound to, if any. Optional
 *  because snapshots written before it, and every browser snapshot, have none.
 *  `fileModifiedAt`: that file's mtime when the tab last bound or saved it —
 *  the baseline canRebind compares against. */
export type RecoverySnapshot = {
  name: string; bytes: Uint8Array; savedAt: number; filePath?: string; fileModifiedAt?: number;
};
/** A snapshot an earlier launch left, with the key that drops it. */
export type Recoverable = RecoverySnapshot & { key: string };

/** This launch's id: snapshots under any other id are from an earlier run. */
export const LAUNCH_ID = crypto.randomUUID();

export const recoveryKey = (tabId: number) => `${LAUNCH_ID}:${tabId}`;

// Every launch holds a Web Lock named for its id until its page goes away,
// so a second window of the browser build (same IndexedDB) can tell a live
// window's snapshots from ones a crashed launch left. The desktop app is
// single-instance; there the lock only ever covers this launch.
const LOCK_PREFIX = "labellab-launch:";
void navigator.locks?.request(LOCK_PREFIX + LAUNCH_ID, () => new Promise<never>(() => {}))
  .catch(() => {});

/** Keys whose launch is not live — the ones worth offering back. */
export const fromEarlierLaunch = (keys: readonly string[], live: readonly string[] = [LAUNCH_ID]) =>
  keys.filter((k) => !live.includes(k.slice(0, k.indexOf(":"))));

/** Launch ids still running: this one plus any window holding its lock. */
async function liveLaunches(): Promise<string[]> {
  const held = (await navigator.locks?.query().catch(() => undefined))?.held ?? [];
  return [LAUNCH_ID, ...held.flatMap((l) =>
    l.name?.startsWith(LOCK_PREFIX) ? [l.name.slice(LOCK_PREFIX.length)] : [])];
}

// Writes run one at a time, in call order: each opens its own connection,
// so without this a snapshot still in flight could land after the drop a
// save just issued and be offered back as unsaved work.
let writes: Promise<unknown> = Promise.resolve();
const write = <T>(act: (s: IDBObjectStore) => IDBRequest<T>) => {
  const done = writes.then(() => run("readwrite", act, RECOVERY_STORE));
  writes = done;
  return done;
};

/** Store a snapshot; false when it could not be written. */
export async function keepRecovery(key: string, snap: RecoverySnapshot): Promise<boolean> {
  return (await write((s) => s.put(snap, key))) !== null;
}

export async function dropRecovery(key: string): Promise<void> {
  await write((s) => s.delete(key));
}

/** Snapshots an earlier launch left behind, oldest first. */
export async function earlierSnapshots(): Promise<Recoverable[]> {
  const keys = (await run("readonly", (s) => s.getAllKeys(), RECOVERY_STORE)) ?? [];
  const live = await liveLaunches();
  const snaps = await Promise.all(fromEarlierLaunch(keys.map(String), live).map(async (key) => {
    const snap = await run<RecoverySnapshot>("readonly", (s) => s.get(key), RECOVERY_STORE);
    return snap?.bytes ? { ...snap, key } : null;
  }));
  return snaps.filter((s) => s !== null).sort((a, b) => a.savedAt - b.savedAt);
}

/** Whether a restored tab may take its file back, so Save writes there
 *  instead of asking where. Only when that cannot overwrite newer work: the
 *  file still exists (`modifiedAt` is null when it is gone), still has the
 *  mtime the tab recorded when it bound or saved it — so nothing wrote it
 *  since, even before the snapshot — and no open tab holds it (`openPaths`).
 *  A snapshot without that baseline never rebinds. */
export const canRebind = (snap: RecoverySnapshot, modifiedAt: number | null, openPaths: readonly string[]) =>
  !!snap.filePath && snap.fileModifiedAt !== undefined && modifiedAt === snap.fileModifiedAt
  && !openPaths.includes(snap.filePath);
