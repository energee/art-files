// useViewPrefs.ts — the saved view preferences: the rulers/guides toggles,
// the one length unit (rulers, inspector lengths, drag readout, margin
// inset) and the 3D light angle. View state, not label content: none of it
// enters history or exports. Moved out of App.tsx with no behavior change.
import { useEffect, useState } from "react";
import { LENGTH_UNITS, type LengthUnit } from "@/rulers";

/** Where the preferences persist: localStorage, like every other
 *  per-operator setting (settings.ts, masters.ts). Only the known keys are
 *  read, so an entry written by an earlier build sheds its extras on the
 *  next write instead of leaking them in. Reads and writes are both guarded:
 *  storage can be missing or full, and a view preference is never worth an
 *  error. The key predates the app's name; renaming it would reset every
 *  saved view. */
export const VIEW_KEY = "lolev-view";

type ViewPrefs = { showRulers: boolean; showGuides: boolean; unit: LengthUnit; lightDeg: number };

export function loadViewPrefs(): ViewPrefs {
  const prefs: ViewPrefs = { showRulers: true, showGuides: true, unit: "in", lightDeg: 0 };
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Record<string, unknown>;
    if (typeof stored.showRulers === "boolean") prefs.showRulers = stored.showRulers;
    if (typeof stored.showGuides === "boolean") prefs.showGuides = stored.showGuides;
    if (LENGTH_UNITS.includes(stored.unit as LengthUnit)) prefs.unit = stored.unit as LengthUnit;
    if (typeof stored.lightDeg === "number" && Math.abs(stored.lightDeg) <= 180) prefs.lightDeg = stored.lightDeg;
  } catch {
    // a hand-mangled entry falls back to the defaults rather than crashing boot
  }
  return prefs;
}

/** The preferences as state, written back on every change. `lightDeg` is
 *  the 3D light rig's angle in degrees (0 = the default rig): set in the Can
 *  view, it lights the Rendered view too. */
export function useViewPrefs() {
  const [initial] = useState(loadViewPrefs);
  const [showRulers, setShowRulers] = useState(initial.showRulers);
  const [unit, setUnit] = useState(initial.unit);
  const [showGuides, setShowGuides] = useState(initial.showGuides);
  const [lightDeg, setLightDeg] = useState(initial.lightDeg);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ showRulers, showGuides, unit, lightDeg }));
    } catch {
      // full or missing storage: the preference lasts this session only
    }
  }, [showRulers, showGuides, unit, lightDeg]);
  return { showRulers, setShowRulers, showGuides, setShowGuides, unit, setUnit, lightDeg, setLightDeg };
}
