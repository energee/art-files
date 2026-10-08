// settings.ts — per-operator settings that outlive a session on this machine:
// the Document Settings render knobs (die-cut corner radius, foil-edge
// softness, export DPI, bleed) and the saved color swatches. Both persist in
// localStorage, like the view toggles (App.tsx) and the master index
// (masters.ts): they describe this operator's press and habits rather than any
// one label, so none of it enters a .label file or the config history. The
// reusable style/barcode library that used to sit beside them is gone — a
// master is the saved style, and a barcode value is filled on its layer.
import { useSyncExternalStore } from "react";
import { DESIGN_DPI, LABEL_SHORT_IN } from "@/layout";
import { decimalsOf } from "@/numeric";

/** The Document Settings layer's 3D-view knobs. One saved set, not a library:
 *  they describe how this shop's labels are die-cut and rendered, so there is
 *  nothing to pick between. Percentages, each of a different thing — the
 *  inspector shows them all in inches (see InchField) and stores them in the
 *  form canScene consumes:
 *    cornerRadius — % of the label's short side
 *    edgeSoftness — foil-edge blur, % of the label's width */
export interface RenderSettings {
  cornerRadius: number;
  edgeSoftness: number;
  /** Resolution the PSD is rastered at, in real DPI — not a percentage like
   *  the two above, because a press specifies resolution in DPI and there is
   *  nothing useful for it to be a percentage OF. Design values saved in px
   *  (stroke widths) go on converting at DESIGN_DPI, so changing this resizes
   *  the exported file without altering a single label's ink. */
  dpi: number;
  /** Bleed per side, in inches — a real length like the DPI above, not a
   *  percentage: a press specifies bleed in inches (or millimetres) and there
   *  is nothing useful for it to be a percentage OF. It grows the PAGE around
   *  a fixed 8x5in die, so it changes the exported page size without moving a
   *  single element relative to the trim. */
  bleedIn: number;
}

// There is no labelSize/labelWidth here: how big the label sits on the can is
// the trim's size over the can's, which layout.ts derives
// (LABEL_HEIGHT_RATIO / LABEL_WRAP_RATIO).
export const DEFAULT_RENDER: RenderSettings = {
  // 1/16" of die-cut radius, the house die — stated in inches and converted,
  // since the stored value is a percentage of the label's short side.
  cornerRadius: (0.0625 / LABEL_SHORT_IN) * 100,
  edgeSoftness: 0.1,
  // Ships at DESIGN_DPI, so the shipped default rasters exactly as it always
  // has and the knob is a no-op until someone moves it.
  dpi: DESIGN_DPI,
  // A round 0.0635in per side, by decision — the number the artboard has always
  // been quoted at, since the toolbar reads the page as 8.127 x 5.127in and
  // (8.127 - 8) / 2 is 0.0635.
  //
  // The Photoshop-era page was actually built at 4.56pt = 0.063333...in (see
  // layout.SHIPPED_BLEED_IN, which is still what the position constants are
  // measured against). Shipping the rounded figure grows the page by 0.024pt
  // in total and leaves BLEED_SHIFT at 0.012 rather than 0.
  //
  // That is safe, and it is the whole reason the shift mechanism exists: the
  // shift is applied uniformly at every output boundary, so every element holds
  // its exact distance from the TRIM — the edge the label is actually cut on.
  // Only the page around it changes size. Nothing on the die moves.
  bleedIn: 0.0635,
};

/** Typing granularity of the bleed field, in inches — and so the
 *  precision a committed value snaps to, and the precision it is displayed at.
 *  Four decimals, because a bleed is quoted in ten-thousandths of an inch
 *  (0.0625 is the house 1/16" die, 0.0635 the shipped page) and three would
 *  collapse those onto 0.063 and 0.064. */
export const BLEED_STEP_IN = 0.0005;
/** Drag and arrow-key granularity — a finger-friendly increment, coarser than
 *  the typed one. ScrubField takes the two separately for exactly this case: dragging in
 *  ten-thousandths would make the field's full range about 1000px of travel. */
export const BLEED_DRAG_STEP_IN = 0.005;
const BLEED_DECIMALS = decimalsOf(BLEED_STEP_IN);

/** What the bleed field SHOWS for a stored value. Same precision the field
 *  COMMITS at, so every value it can display it can also be typed back —
 *  which is what keeps commitBleedIn below a narrow guard rather than a
 *  routine correction. */
export const displayBleedIn = (bleedIn: number): number =>
  Number(bleedIn.toFixed(BLEED_DECIMALS));

/** Resolve a bleed edit coming back OUT of that field.
 *
 *  At BLEED_STEP_IN the field can express every value it displays, so this only
 *  bites for a stored value finer than four decimals — the measured
 *  0.063333...in, or anything hand-edited into storage. Such a value shows as
 *  0.0633 and would commit as 0.0633, and letting that land changes the
 *  document for nothing: the page moves and every element shifts, because a
 *  field was focused rather than because anyone asked for a different bleed.
 *
 *  So a commit that merely echoes what is already on screen keeps the stored
 *  value; anything else passes through untouched.
 *
 *  The trade is confined to that case: typing 0.0633 over a stored
 *  0.063333... does nothing, which is honest — they are the same number at this
 *  field's precision, and 0.00003in of bleed is not a distinction any press can
 *  hold. Every value the field can actually express echoes back unchanged, so
 *  no reachable setting is ever stuck. */
export const commitBleedIn = (current: number, typed: number): number =>
  typed === displayBleedIn(current) ? current : typed;

/** Add a hex to the swatch list, lowercased so #B58B3C and #b58b3c are one
 *  entry. Returns the list unchanged when the color is already saved. */
export function addColor(list: string[], hex: string): string[] {
  const h = hex.toLowerCase();
  return list.includes(h) ? list : [...list, h];
}

// ---------------------------------------------------------------------------
// Persistence. Two keys rather than one blob, so a swatch save never has to
// read-modify-write the render knobs (or vice versa). Reads are guarded — a
// hand-mangled entry, or a test without localStorage, falls back to the
// defaults rather than crashing boot — while writes are plain: like
// masters.ts, there is nothing useful to do about a failed localStorage write.
// ---------------------------------------------------------------------------

const RENDER_KEY = "labellab.render";
const SWATCHES_KEY = "labellab.swatches";

/** A guarded JSON read of one localStorage key: null when the key is absent,
 *  mangled, or localStorage is missing. Shared with masters.ts. */
export function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

/** The saved render knobs, with per-key defaults: an entry written before a
 *  knob existed still gets that knob's default instead of NaN. */
export function loadRenderSettings(): RenderSettings {
  const raw = readJson(RENDER_KEY);
  const stored = raw && typeof raw === "object" ? raw as Partial<RenderSettings> : {};
  const out = { ...DEFAULT_RENDER };
  for (const k of Object.keys(DEFAULT_RENDER) as (keyof RenderSettings)[]) {
    if (typeof stored[k] === "number" && Number.isFinite(stored[k])) out[k] = stored[k];
  }
  return out;
}

export function saveRenderSettings(render: RenderSettings): void {
  localStorage.setItem(RENDER_KEY, JSON.stringify(render));
}

function loadSwatches(): string[] {
  const raw = readJson(SWATCHES_KEY);
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : [];
}

// One shared copy of the swatch list: every ColorField reads it, so a color
// saved in one field is offered by every other the moment it lands. Loaded
// lazily on first subscribe so importing this module never touches storage.
let swatches: string[] | null = null;
const listeners = new Set<() => void>();

function currentSwatches(): string[] {
  swatches ??= loadSwatches();
  return swatches;
}

function subscribeSwatches(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Replace the swatch list, persist it, and re-render every subscriber. */
export function setSwatches(update: (current: string[]) => string[]): void {
  const next = update(currentSwatches());
  if (next === swatches) return; // addColor's "already saved" — nothing to write
  swatches = next;
  localStorage.setItem(SWATCHES_KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

/** Subscribe a component to the saved swatches. The snapshot is stable
 *  between writes, as useSyncExternalStore requires. */
export function useSwatches(): string[] {
  return useSyncExternalStore(subscribeSwatches, currentSwatches);
}
