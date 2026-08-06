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

export interface Presets {
  /** Beer styles ("Hazy IPA", "Pilsner") for the Style line. The text is its
   *  own label, so these are plain strings. */
  styles: string[];
  barcodes: BarcodePreset[];
}

export const EMPTY_PRESETS: Presets = { styles: [], barcodes: [] };

/** Read the library. Returns empty rather than throwing when the endpoint is
 *  missing (a production build carries no dev middleware), so the pickers
 *  show nothing instead of breaking the inspector. */
export async function loadPresets(): Promise<Presets> {
  try {
    const res = await fetch("/api/presets");
    if (!res.ok) return EMPTY_PRESETS;
    const raw = (await res.json()) as Partial<Presets>;
    return { styles: raw.styles ?? [], barcodes: raw.barcodes ?? [] };
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
