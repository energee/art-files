// src/masters.ts — the master library index: {id -> {name, path, lastSeen}}.
// A RESOLVER CACHE ONLY — .master files on disk are the source of truth
// (spec: Library index). resolveMasterById always consults the index (and a
// trusted hint) first, so a registered .master on disk wins even when its id
// is the shipped id; the built-in Lolev fixture is used only as a last-resort
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
import { cacheMaster, cachedMaster, dropCachedMaster } from "@/masterCache";

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
  // Guarded like retireIndexRow: Save Master's commit awaits this after the
  // file is already written, and Open Master / library picks / readMasterAt
  // await it mid-flow, so a full or missing localStorage must not fail any of
  // them (#407). The index is a resolver cache; losing one write only costs a
  // re-locate later. Each write has its own guard: the index can outgrow the
  // quota while the short LAST_KEY still fits, and the last-applied master
  // should stay pinned for the next launch.
  try {
    localStorage.setItem(KEY, JSON.stringify(idx));
  } catch { /* no localStorage / quota exceeded — same fallback as masterIndex */ }
  if (applied) {
    try {
      localStorage.setItem(LAST_KEY, m.id);
    } catch { /* no localStorage / quota exceeded */ }
  }
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

/** Folder of a native path with `/` separators; "" for a bare name. */
const folderOf = (p: string): string => {
  const n = p.replace(/\\/g, "/");
  return n.slice(0, Math.max(n.lastIndexOf("/"), 0));
};

/** Whether a `.label`'s masterHint may be read. A .label is shared, so the
 *  hint is untrusted: it is read only when it sits lexically inside the
 *  label's own folder (`labelPath`) or the folder of a master already in the
 *  library — no `..` segments, either separator. Anything else falls through
 *  to the cache and the shipped fixture. */
export function hintTrusted(hint: string, labelPath?: string): boolean {
  const h = hint.replace(/\\/g, "/");
  if (h.split("/").includes("..")) return false;
  const roots = Object.values(masterIndex()).map((e) => folderOf(e.path));
  if (labelPath) roots.push(folderOf(labelPath));
  return roots.some((root) => root !== "" && h.startsWith(root + "/"));
}

/** Take `id` off this computer's library. The .master file is left where it
 *  is; the index row and the remembered bytes are dropped. A new tab stops
 *  reopening this id: it reopens `replacementId` when the file at its path now
 *  holds that id (Save Master As over the same path), otherwise nothing. */
export async function forgetMaster(id: string, replacementId?: string): Promise<void> {
  retireIndexRow(id, replacementId);
  await dropCachedMaster(id);
}

/** forgetMaster without the remembered bytes: drops the index row and repoints
 *  the last-master key. */
function retireIndexRow(id: string, replacementId?: string): void {
  try {
    const idx = masterIndex();
    if (idx[id]) {
      delete idx[id];
      localStorage.setItem(KEY, JSON.stringify(idx));
    }
    if (localStorage.getItem(LAST_KEY) === id) {
      if (replacementId) localStorage.setItem(LAST_KEY, replacementId);
      else localStorage.removeItem(LAST_KEY);
    }
  } catch { /* no localStorage — same fallback as masterIndex */ }
}

/** `labelPath` is the native path of the .label being opened, when there is
 *  one — it widens where `hint` may be read (hintTrusted).
 *
 *  `followReplacement`: a label open. The file at the hint (or, when that is
 *  the indexed path, the file the index named) wins even when its id changed.
 *  When no such file can be read, the remembered copy of the id stands in. A
 *  library pick passes false and gets null instead of a different master. */
async function resolveMaster(
  id: string, hint: string | undefined, labelPath: string | undefined, followReplacement: boolean,
): Promise<ResolvedMaster | null> {
  const indexPath = masterIndex()[id]?.path ?? "";
  const indexFile = indexPath ? await readMasterAt(indexPath) : null;
  if (indexFile?.master.id === id) return indexFile;

  const hintPath = hint && hintTrusted(hint, labelPath) && hint !== indexPath ? hint : "";
  const hintFile = hintPath ? await readMasterAt(hintPath) : null;
  if (hintFile?.master.id === id) return hintFile;

  // Any file read here holds a different id: the early returns took the match.
  // A label open follows the file it named. Otherwise the remembered bytes
  // stand in for a file that could not be read (a browser has no path, a
  // desktop read can fail: scope, a moved file) — without this a reload
  // swapped the template for the shipped fixture. They outlive the
  // stale index row that is retired. A library pick does not
  // fall back once a file was read: the cache would be the previous copy of
  // the id that file replaced.
  const named = followReplacement ? hintFile ?? (!hint || hint === indexPath ? indexFile : null) : null;
  const held = !named && (followReplacement || (!indexFile && !hintFile)) ? await cachedMaster(id) : null;
  // A remembered copy is about to stand in, so it stays for the next open.
  if (indexFile) await (held ? retireIndexRow : forgetMaster)(id, indexFile.master.id);
  if (named) return named;
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

export function resolveMasterById(id: string, hint?: string, labelPath?: string): Promise<ResolvedMaster | null> {
  return resolveMaster(id, hint, labelPath, false);
}

/** The master a `.label` opens against. Same as resolveMasterById when the
 *  file's id still matches. When that file was saved again under a new id,
 *  follow the file so the label keeps the template that is on disk. */
export function resolveLabelMaster(id: string, hint?: string, labelPath?: string): Promise<ResolvedMaster | null> {
  return resolveMaster(id, hint, labelPath, true);
}

/** The last-applied master an untitled tab starts from, before
 *  structureOnlyMaster drops fill values and raster art. Follows the file when
 *  it was saved again under a new id, so a restart shows the master on disk.
 *  Falls back to the shipped fixture when the last-applied id cannot be
 *  resolved. */
export async function resolveDefaultMaster(): Promise<ResolvedMaster> {
  return (await resolveLabelMaster(lastMasterId())) ?? { master: lolevMaster(), assets: {} };
}
