// bitmapCache.ts — the preview's decoded bitmaps, one per source bytes
// object (#413). The render-source assembly in App.tsx re-runs whenever any
// asset input changes; asking this cache instead of createImageBitmap means
// only new or changed bytes decode, and `retain` closes just the bitmaps the
// new generation no longer uses (bitmaps aren't GC'd on their own).

export interface BitmapCache {
  /** The bitmap for these exact bytes (by identity), decoding on first ask.
   *  A failed decode isn't remembered, so the next ask retries. */
  get(bytes: Uint8Array): Promise<ImageBitmap>;
  /** Close and forget every bitmap whose bytes aren't in `keep` — one still
   *  decoding is closed when it lands. `retain([])` empties the cache. */
  retain(keep: Iterable<Uint8Array>): void;
}

export function createBitmapCache(): BitmapCache {
  const byBytes = new Map<Uint8Array, Promise<ImageBitmap>>();
  return {
    get(bytes) {
      let p = byBytes.get(bytes);
      if (!p) {
        p = createImageBitmap(new Blob([bytes as BlobPart]));
        byBytes.set(bytes, p);
        p.catch(() => { if (byBytes.get(bytes) === p) byBytes.delete(bytes); });
      }
      return p;
    },
    retain(keep) {
      const kept = new Set(keep);
      for (const [bytes, p] of byBytes) {
        if (kept.has(bytes)) continue;
        byBytes.delete(bytes);
        p.then((b) => b.close(), () => {});
      }
    },
  };
}
