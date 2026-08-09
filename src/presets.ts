import { useSyncExternalStore } from "react";
import { DESIGN_DPI, LABEL_SHORT_IN, MAX_WRAP_RATIO } from "@/layout";

// presets.ts — the reusable style and barcode library, read from and written
// back to presets.json at the repo root through the dev server's
// /api/presets endpoint (see vite.config.ts). Deliberately NOT localStorage:
// presets have to survive a cleared browser profile, and a file in git can be
// reviewed, diffed, and restored.
export interface BarcodePreset {
  /** Optional human label ("House IPA"). Absent = show the digits, which are
   *  the only thing that identifies an unnamed barcode. */
  name?: string;
  upc: string;
}

/** The Document Settings layer's 3D-view knobs. One saved set, not a library:
 *  they describe how this shop's labels are die-cut and rendered, so there is
 *  nothing to pick between. Percentages, each of a different thing — the
 *  inspector shows them all in inches (see InchField) and stores them in the
 *  form canScene consumes:
 *    cornerRadius — % of the label's short side
 *    labelSize    — label height, % of the can's height
 *    labelWidth   — how far it wraps, % of the can's circumference
 *    edgeSoftness — foil-edge blur, % of the label's width */
export interface RenderSettings {
  cornerRadius: number;
  labelSize: number;
  labelWidth: number;
  edgeSoftness: number;
  /** Resolution the PSD is rastered at, in real DPI — not a percentage like
   *  the four above, because a press specifies resolution in DPI and there is
   *  nothing useful for it to be a percentage OF. Design values saved in px
   *  (stroke widths) go on converting at DESIGN_DPI, so changing this resizes
   *  the exported file without altering a single label's ink. */
  dpi: number;
}

// labelWidth ships at the renderer's ceiling (MAX_WRAP_RATIO): the 8in art
// almost exactly covers the can's 8.17in circumference, and that is also
// where the aspect-derived wrap landed before the knob existed — so a library
// saved without one opens looking the same (normalizePresets' spread fills it
// in). Stated as the cap rather than 98 so the knob's readout matches what is
// actually drawn instead of promising a wrap the scene clamps away.
export const DEFAULT_RENDER: RenderSettings = {
  // 1/16" of die-cut radius, the house die — stated in inches and converted,
  // since the stored value is a percentage of the label's short side.
  cornerRadius: (0.0625 / LABEL_SHORT_IN) * 100,
  labelSize: 82, labelWidth: MAX_WRAP_RATIO * 100, edgeSoftness: 0.1,
  // Ships at DESIGN_DPI, so the shipped default rasters exactly as it always
  // has and the knob is a no-op until someone moves it.
  dpi: DESIGN_DPI,
};

export interface Presets {
  /** Beer styles ("Hazy IPA", "Pilsner") for the Style line. The text is its
   *  own label, so these are plain strings. */
  styles: string[];
  barcodes: BarcodePreset[];
  /** Saved hex fills ("#b58b3c"), lowercased. Shared by every color element —
   *  a swatch saved from the wordmark's fill shows up under the barcode's. */
  colors: string[];
  /** Die-cut / 3D-render knobs. Single set, see RenderSettings. */
  render: RenderSettings;
}

export const EMPTY_PRESETS: Presets = {
  styles: [], barcodes: [], colors: [], render: DEFAULT_RENDER,
};

/** Add a hex to the swatch library, lowercased so #B58B3C and #b58b3c are one
 *  entry. Returns the list unchanged when the color is already saved. */
export function addColor(list: string[], hex: string): string[] {
  const h = hex.toLowerCase();
  return list.includes(h) ? list : [...list, h];
}

/** Fill in every key a parsed presets file may be missing, so one place owns
 *  the shape. Used by both the loader and the import path. */
export function normalizePresets(raw: Partial<Presets>): Presets {
  return {
    styles: raw.styles ?? [],
    barcodes: raw.barcodes ?? [],
    colors: raw.colors ?? [],
    // Per-key defaults: a presets.json written before a knob existed still
    // gets that knob's default instead of NaN.
    render: { ...DEFAULT_RENDER, ...raw.render },
  };
}

/** Read the library. Returns empty rather than throwing when the endpoint is
 *  missing (a production build carries no dev middleware), so the pickers
 *  show nothing instead of breaking the inspector. */
export async function loadPresets(): Promise<Presets> {
  try {
    const res = await fetch("/api/presets");
    if (!res.ok) return EMPTY_PRESETS;
    return normalizePresets((await res.json()) as Partial<Presets>);
  } catch {
    return EMPTY_PRESETS;
  }
}

/** Write the whole library back. Throws with a message the caller can show:
 *  a silently dropped save looks identical to a successful one. */
export async function savePresets(presets: Presets): Promise<void> {
  const res = await fetch("/api/presets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(presets, null, 2),
  });
  if (!res.ok) throw new Error(`presets save failed (${res.status})`);
}

// ---------------------------------------------------------------------------
// One shared copy of the library.
//
// Every consumer used to run its own load/save: two preset bars, a ColorField
// per color control, and App's render settings. Each held a snapshot taken at
// mount and wrote the WHOLE file back, so saving a swatch reverted whatever
// another panel had saved since. One store, and a write that re-reads before
// merging, removes both the duplicate fetches and the lost updates.
// ---------------------------------------------------------------------------

/** The whole store, published as one object so subscribers re-render on any
 *  part of it. `loaded` is its own flag rather than an "is it still the empty
 *  library?" check: a missing endpoint (a production build carries no dev
 *  middleware) legitimately resolves to EMPTY_PRESETS, and a caller waiting on
 *  identity would wait forever. `error` is shared, so a failed write surfaces
 *  wherever the user is looking, not only in the panel that triggered it. */
export interface PresetsStore {
  presets: Presets;
  loaded: boolean;
  error: string;
}

let store: PresetsStore = { presets: EMPTY_PRESETS, loaded: false, error: "" };
let loading: Promise<Presets> | null = null;
const listeners = new Set<() => void>();

function publish(next: Partial<PresetsStore>) {
  store = { ...store, ...next };
  for (const l of listeners) l();
}

/** Current store snapshot. Stable between publishes, as useSyncExternalStore
 *  requires. */
export function getPresets(): PresetsStore {
  return store;
}

export function subscribePresets(listener: () => void): () => void {
  listeners.add(listener);
  // First subscriber triggers the one shared read; later ones reuse it.
  loading ??= loadPresets().then((p) => {
    publish({ presets: p, loaded: true });
    return p;
  });
  return () => { listeners.delete(listener); };
}

/** Read-modify-write the library: re-reads the file, applies `patch` to what
 *  is actually on disk, writes it back. Concurrent edits from another panel
 *  survive because the merge happens against fresh state, not a snapshot.
 *  A failed write lands in the store's `error`: dropping it silently would
 *  look identical to a successful save. */
export async function mutatePresets(patch: (current: Presets) => Presets): Promise<void> {
  const next = patch(await loadPresets());
  // Optimistic: the UI shows the edit while the PUT is in flight.
  publish({ presets: next, loaded: true, error: "" });
  try {
    await savePresets(next);
  } catch (e) {
    publish({ error: (e as Error).message });
  }
}

/** Subscribe a component to the library. Every consumer sees the same copy,
 *  so a swatch saved in one panel shows up in the others without a refetch.
 *  `commit`'s patch receives the library as it is on disk, not a snapshot. */
export function usePresets() {
  const { presets, loaded, error } = useSyncExternalStore(subscribePresets, getPresets);
  return {
    presets, loaded, error,
    commit: (patch: (current: Presets) => Presets) => void mutatePresets(patch),
  };
}

/** Replace the entry with the same identity, else append — saving twice
 *  updates rather than growing a pile of duplicates. Styles are identified by
 *  name, barcodes by their digits (the label is optional and re-namable). */
export function upsertBy<T>(list: T[], item: T, key: (x: T) => string): T[] {
  const at = list.findIndex((p) => key(p) === key(item));
  if (at === -1) return [...list, item];
  return list.map((p, i) => (i === at ? item : p));
}

/** What a barcode preset shows in the picker. */
export const barcodeLabel = (b: BarcodePreset) =>
  b.name ? `${b.name} — ${b.upc}` : b.upc;
