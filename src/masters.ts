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
import type { Master } from "@/model/types";
import { lolevMaster } from "@/model/lolev";
import { unpackMaster, type MasterAssets } from "@/model/masterfile";
import { readNativeFile } from "@/files";

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

export function rememberMaster(m: Master, path: string): void {
  const idx = masterIndex();
  idx[m.id] = { name: m.name, path, lastSeen: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(idx));
}

/** A resolved master with its template assets — what unpackMaster returns
 *  (a legacy JSON master resolves with empty assets). */
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
  // Fall back to the built-in fixture only when nothing on disk resolved —
  // guarantees a fresh install with an empty index still works, without
  // letting the shipped id short-circuit a registered .master on disk.
  if (id === SHIPPED_MASTER_ID) return { master: lolevMaster(), assets: {} };
  return null;
}
