// src/recovery.ts — crash recovery for unsaved tabs (#394). Each editor with
// unsaved work keeps a packed .label snapshot here (IndexedDB, via
// masterCache's store helper), keyed `<launch id>:<tab id>`. A clean save
// or a tab close drops its snapshot; a crash, a WebView kill or a forced
// quit leaves it behind, and the next launch offers it back (TabsShell).
// Best-effort like masterCache: a failed write just means nothing to offer.
import { RECOVERY_STORE, run } from "@/masterCache";

export type RecoverySnapshot = { name: string; bytes: Uint8Array; savedAt: number };
/** A snapshot an earlier launch left, with the key that drops it. */
export type Recoverable = RecoverySnapshot & { key: string };

/** This launch's id: snapshots under any other id are from an earlier run. */
export const LAUNCH_ID = crypto.randomUUID();

export const recoveryKey = (tabId: number) => `${LAUNCH_ID}:${tabId}`;

/** Keys left by an earlier launch — the ones worth offering back. */
export const fromEarlierLaunch = (keys: readonly string[], launch: string = LAUNCH_ID) =>
  keys.filter((k) => !k.startsWith(`${launch}:`));

export async function keepRecovery(key: string, snap: RecoverySnapshot): Promise<void> {
  await run("readwrite", (s) => s.put(snap, key), RECOVERY_STORE);
}

export async function dropRecovery(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key), RECOVERY_STORE);
}

/** Snapshots an earlier launch left behind, oldest first. */
export async function earlierSnapshots(): Promise<Recoverable[]> {
  const keys = (await run("readonly", (s) => s.getAllKeys(), RECOVERY_STORE)) ?? [];
  const snaps = await Promise.all(fromEarlierLaunch(keys.map(String)).map(async (key) => {
    const snap = await run<RecoverySnapshot>("readonly", (s) => s.get(key), RECOVERY_STORE);
    return snap?.bytes ? { ...snap, key } : null;
  }));
  return snaps.filter((s) => s !== null).sort((a, b) => a.savedAt - b.savedAt);
}
