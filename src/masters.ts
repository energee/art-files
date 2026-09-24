// src/masters.ts — the master library index: {id -> {name, path, lastSeen}}.
// A RESOLVER CACHE ONLY — .master files on disk are the source of truth
// (spec: Library index). resolveMasterById always consults the index (and
// hint) first, so a registered .master on disk wins even when its id is the
// shipped id; the built-in Lolev fixture is used only as a last-resort
// fallback when nothing on disk resolves, guaranteeing a fresh install with
// an empty index still works. localStorage (per-operator app state, like the
// view toggles and settings.ts): the index describes this machine's
// filesystem. Untitled tabs call resolveDefaultMaster, then drop fill values
// and raster art in structureOnlyMaster (model/edit.ts).
import { isTauri } from "@tauri-apps/api/core";
import type { Master } from "@/model/layers";
import { lolevMaster } from "@/model/lolevLayers";
import { unpackMaster, type MasterAssets } from "@/model/files";
import { readNativeFile } from "@/files";
import { cacheMaster, cachedMaster } from "@/masterCache";

export const SHIPPED_MASTER_ID = lolevMaster().id;
const KEY = "labellab.masters";
const LAST_KEY = "labellab.lastMaster";

export interface MasterIndexEntry { name: string; path: string; lastSeen: string }

export function masterIndex(): Record<string, MasterIndexEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, MasterIndexEntry>;
  } catch {
    return {}; // a mangled entry falls back rather than crashing open
  }
}

/** A Save Master target — a native path or an FS-Access handle — tagged
 *  with the id of the master it was opened from or saved as. */
export interface MasterSaveTarget<T> { id: string; target: T }

/** The bound target, but only when it was bound for `masterId`. The binding
 *  lives outside undo history, so undo past Open Master / a library pick /
 *  Save Master As puts another master back in the document while the binding
 *  still names the newer file — reusing it would overwrite that master's file
 *  (#78). A mismatch returns null, so Save Master asks where to write. */
export function saveTargetFor<T>(bound: MasterSaveTarget<T> | null, masterId: string): T | null {
  return bound && bound.id === masterId ? bound.target : null;
}

/** Register a master in the library index — and, when the caller has the
 *  file's `bytes`, keep them in the browser's master cache so a reload can
 *  resolve this master without a filesystem path (masterCache.ts). */
export async function rememberMaster(m: Master, path: string, bytes?: Uint8Array, opts?: { applied?: boolean }): Promise<void> {
  const applied = opts?.applied !== false;
  // Bytes first: LAST_KEY / lastSeen must not claim this master until a
  // reload can actually resolve it (void cacheMaster used to return while
  // IndexedDB was still empty, and the next launch fell back to Lolev).
  if (bytes) await cacheMaster(m.id, bytes);
  const idx = masterIndex();
  const cur = idx[m.id];
  // An apply that has no filesystem path (a library pick of the shipped
  // master, a browser handle whose name we already stored) must not wipe a
  // real path from an earlier Open/Save. Resolving a .label is not an apply:
  // keep lastSeen so it cannot steal the next untitled document.
  idx[m.id] = {
    name: m.name,
    path: path || cur?.path || "",
    lastSeen: applied ? new Date().toISOString() : (cur?.lastSeen ?? ""),
  };
  localStorage.setItem(KEY, JSON.stringify(idx));
  if (applied) localStorage.setItem(LAST_KEY, m.id);
}

/** The master this operator last opened, saved, or picked — LAST_KEY when
 *  this session has applied one, otherwise the index entry with the latest
 *  lastSeen (so a library built before LAST_KEY still restores). Fresh
 *  install: the shipped id. */
function lastMasterId(): string {
  try {
    const stored = localStorage.getItem(LAST_KEY);
    if (stored) return stored;
  } catch { /* no localStorage — same fallback as masterIndex */ }
  let bestId = "";
  let bestSeen = "";
  for (const [id, e] of Object.entries(masterIndex())) {
    if (e.lastSeen > bestSeen) {
      bestSeen = e.lastSeen;
      bestId = id;
    }
  }
  // No pin needed: a resolve-only rememberMaster never bumps lastSeen, so
  // this fallback is stable until the next apply writes LAST_KEY.
  return bestId || SHIPPED_MASTER_ID;
}

/** A resolved master with its template assets — what unpackMaster returns
 *  (a legacy JSON master resolves with empty assets; a v1 file is converted
 *  on the way in, see model/files.ts). */
export type ResolvedMaster = { master: Master; assets: MasterAssets };

async function readMasterAt(path: string): Promise<ResolvedMaster | null> {
  if (!isTauri()) return null; // browser: no filesystem paths to read
  try {
    const bytes = await readNativeFile(path); // ZIP or legacy JSON
    const r = unpackMaster(bytes);
    await rememberMaster(r.master, path, bytes, { applied: false });
    return r;
  } catch {
    return null; // moved/deleted/corrupt — caller falls through to the hint
  }
}

export async function resolveMasterById(id: string, hint?: string): Promise<ResolvedMaster | null> {
  const entry = masterIndex()[id];
  if (entry?.path) {
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

/** The last-applied master an untitled tab starts from, before
 *  structureOnlyMaster drops fill values and raster art. Falls back to the
 *  shipped fixture when the last-applied id cannot be resolved. */
export async function resolveDefaultMaster(): Promise<ResolvedMaster> {
  return (await resolveMasterById(lastMasterId())) ?? { master: lolevMaster(), assets: {} };
}
