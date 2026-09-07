// src/masters.ts — the master library index: {id -> {name, path, lastSeen}}.
// A RESOLVER CACHE ONLY — .master files on disk are the source of truth
// (spec: Library index). resolveMasterById always consults the index (and
// hint) first, so a registered .master on disk wins even when its id is the
// shipped id; the built-in Lolev fixture is used only as a last-resort
// fallback when nothing on disk resolves, guaranteeing a fresh install with
// an empty index still works. localStorage (per-operator app state, like the
// view toggles and settings.ts): the index describes this machine's
// filesystem.
import { isTauri } from "@tauri-apps/api/core";
import type { Master } from "@/model/layers";
import { lolevMaster } from "@/model/lolevLayers";
import { unpackMaster, type MasterAssets } from "@/model/files";
import { readNativeFile } from "@/files";
import { cacheMaster, cachedMaster } from "@/masterCache";

export const SHIPPED_MASTER_ID = lolevMaster().id;
const KEY = "labellab.masters";

export interface MasterIndexEntry { name: string; path: string; lastSeen: string }

export function masterIndex(): Record<string, MasterIndexEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, MasterIndexEntry>;
  } catch {
    return {}; // a mangled entry falls back rather than crashing open
  }
}

/** Register a master in the library index — and, when the caller has the
 *  file's `bytes`, keep them in the browser's master cache so a reload can
 *  resolve this master without a filesystem path (masterCache.ts). */
export function rememberMaster(m: Master, path: string, bytes?: Uint8Array): void {
  const idx = masterIndex();
  idx[m.id] = { name: m.name, path, lastSeen: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(idx));
  if (bytes) void cacheMaster(m.id, bytes);
}

/** A resolved master with its template assets — what unpackMaster returns
 *  (a legacy JSON master resolves with empty assets; a v1 file is converted
 *  on the way in, see model/files.ts). */
export type ResolvedMaster = { master: Master; assets: MasterAssets };

async function readMasterAt(path: string): Promise<ResolvedMaster | null> {
  if (!isTauri()) return null; // browser: no filesystem paths to read
  try {
    const r = unpackMaster(await readNativeFile(path)); // ZIP or legacy JSON
    rememberMaster(r.master, path); // self-healing: a good read refreshes the index
    return r;
  } catch {
    return null; // moved/deleted/corrupt — caller falls through to the hint
  }
}

export async function resolveMasterById(id: string, hint?: string): Promise<ResolvedMaster | null> {
  const entry = masterIndex()[id];
  if (entry) {
    const r = await readMasterAt(entry.path);
    if (r?.master.id === id) return r;
  }
  if (hint) {
    const r = await readMasterAt(hint);
    if (r?.master.id === id) return r;
  }
  // Nothing on disk: in a browser there never is (readMasterAt bails), so the
  // cached bytes of the master this operator last saved or opened stand in for
  // the file — without this a reload silently swapped their template for the
  // shipped fixture.
  const held = await cachedMaster(id);
  if (held) {
    try {
      const r = unpackMaster(held);
      if (r.master.id === id) return r;
    } catch { /* a stale or truncated entry falls through to the fixture */ }
  }
  // Fall back to the built-in fixture only when nothing on disk resolved —
  // guarantees a fresh install with an empty index still works, without
  // letting the shipped id short-circuit a registered .master on disk.
  if (id === SHIPPED_MASTER_ID) return { master: lolevMaster(), assets: {} };
  return null;
}
