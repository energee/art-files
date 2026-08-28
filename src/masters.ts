// src/masters.ts — the master library index: {id -> {name, path, lastSeen}}.
// A RESOLVER CACHE ONLY — .master files on disk are the source of truth
// (spec: Library index). resolveMasterById always consults the index (and
// hint) first, so a registered .master on disk wins even when its id is the
// shipped id; the built-in Lolev fixture is used only as a last-resort
// fallback when nothing on disk resolves, guaranteeing a fresh install with
// an empty index still works. localStorage (per-operator app state, like the
// view toggles), not presets.json: the index describes this machine's
// filesystem.
import { isTauri } from "@tauri-apps/api/core";
import { strFromU8 } from "fflate";
import type { Master } from "@/model/types";
import { parseMaster } from "@/model/types";
import { lolevMaster } from "@/model/lolev";
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

async function readMasterAt(path: string): Promise<Master | null> {
  if (!isTauri()) return null; // browser: no filesystem paths to read
  try {
    const m = parseMaster(JSON.parse(strFromU8(await readNativeFile(path))));
    rememberMaster(m, path); // self-healing: a good read refreshes the index
    return m;
  } catch {
    return null; // moved/deleted/corrupt — caller falls through to the hint
  }
}

export async function resolveMasterById(id: string, hint?: string): Promise<Master | null> {
  const entry = masterIndex()[id];
  if (entry) {
    const m = await readMasterAt(entry.path);
    if (m?.id === id) return m;
  }
  if (hint) {
    const m = await readMasterAt(hint);
    if (m?.id === id) return m;
  }
  // Fall back to the built-in fixture only when nothing on disk resolved —
  // guarantees a fresh install with an empty index still works, without
  // letting the shipped id short-circuit a registered .master on disk.
  if (id === SHIPPED_MASTER_ID) return lolevMaster();
  return null;
}
