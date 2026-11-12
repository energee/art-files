// useViewPrefs.ts — the saved view preferences: the rulers/guides toggles,
// the one length unit (rulers, inspector lengths, drag readout, margin
// inset), the 3D light angle and which inspector sections have their More
// rows open. View state, not label content: none of it enters history or
// exports.
import { useSyncExternalStore, type SetStateAction } from "react";
import { LENGTH_UNITS, type LengthUnit } from "@/rulers";

/** Where the preferences persist: localStorage, like every other
 *  per-operator setting (settings.ts, masters.ts). Only the known keys are
 *  read, so an entry written by an earlier build sheds its extras on the
 *  next write instead of leaking them in. Reads and writes are both guarded:
 *  storage can be missing or full, and a view preference is never worth an
 *  error. The key predates the app's name; renaming it would reset every
 *  saved view. */
export const VIEW_KEY = "lolev-view";

type ViewPrefs = {
  showRulers: boolean; showGuides: boolean; unit: LengthUnit; lightDeg: number;
  moreTypography: boolean; morePosition: boolean;
};

export function loadViewPrefs(): ViewPrefs {
  const prefs: ViewPrefs = {
    showRulers: true, showGuides: true, unit: "in", lightDeg: 0, moreTypography: false, morePosition: false,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Record<string, unknown>;
    if (typeof stored.showRulers === "boolean") prefs.showRulers = stored.showRulers;
    if (typeof stored.showGuides === "boolean") prefs.showGuides = stored.showGuides;
    if (LENGTH_UNITS.includes(stored.unit as LengthUnit)) prefs.unit = stored.unit as LengthUnit;
    if (typeof stored.lightDeg === "number" && Math.abs(stored.lightDeg) <= 180) prefs.lightDeg = stored.lightDeg;
    if (typeof stored.moreTypography === "boolean") prefs.moreTypography = stored.moreTypography;
    if (typeof stored.morePosition === "boolean") prefs.morePosition = stored.morePosition;
  } catch {
    // a hand-mangled entry falls back to the defaults rather than crashing boot
  }
  return prefs;
}

// One shared set for every tab, like the swatches in settings.ts: a per-editor
// copy let a tab write its stale values over another tab's choice (#700).
// `raw` is the entry the copy was parsed from, so an entry changed behind it
// (another browser window, a test) is picked up on the next read. After a
// failed write `raw` still names the old entry and `prefs` holds the new value.
let shared: { raw: string | null; prefs: ViewPrefs } | null = null;
const listeners = new Set<() => void>();

function storedRaw(): string | null {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

function currentPrefs(): ViewPrefs {
  const raw = storedRaw();
  if (shared?.raw !== raw) shared = { raw, prefs: loadViewPrefs() };
  return shared.prefs;
}

function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const skipSubscribe = () => () => {};

/** A stable setter for one preference, taking a value or an updater like
 *  useState's. */
const setterFor = <K extends keyof ViewPrefs>(key: K) => (value: SetStateAction<ViewPrefs[K]>) => {
  const prefs = currentPrefs();
  const next = {
    ...prefs,
    [key]: typeof value === "function" ? (value as (old: ViewPrefs[K]) => ViewPrefs[K])(prefs[key]) : value,
  };
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(next));
  } catch {
    // full or missing storage: the preference lasts this session only
  }
  shared = { raw: storedRaw(), prefs: next };
  for (const listener of listeners) listener();
};

const setters = {
  setShowRulers: setterFor("showRulers"), setShowGuides: setterFor("showGuides"), setUnit: setterFor("unit"),
  setLightDeg: setterFor("lightDeg"), setMoreTypography: setterFor("moreTypography"),
  setMorePosition: setterFor("morePosition"),
};

/** The preferences as state, written back on every change. `lightDeg` is
 *  the 3D light rig's angle in degrees (0 = the default rig): set in the Can
 *  view, it lights the Rendered view too. `moreTypography`/`morePosition`
 *  open the inspector's Typography and Position More rows, one setting per
 *  section for every layer (not per layer). A hidden tab does not subscribe,
 *  so a slider drag never re-runs it; it reads the current set on activation. */
export function useViewPrefs(active: boolean) {
  const prefs = useSyncExternalStore(active ? subscribePrefs : skipSubscribe, currentPrefs);
  return { ...prefs, ...setters };
}
