// src/masters.ts — the master library index: {id -> {name, path, lastSeen}}.
// A RESOLVER CACHE ONLY — .master files on disk are the source of truth
// (spec: Library index). The shipped Lolev master is built-in and needs no
// path. localStorage (per-operator app state, like the view toggles), not
// presets.json: the index describes this machine's filesystem.
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
  if (id === SHIPPED_MASTER_ID) return lolevMaster();
  const entry = masterIndex()[id];
  if (entry) {
    const m = await readMasterAt(entry.path);
    if (m?.id === id) return m;
  }
  if (hint) {
    const m = await readMasterAt(hint);
    if (m?.id === id) return m;
  }
  return null;
}
