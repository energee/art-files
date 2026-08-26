// fonts.ts — the three faces every build needs for a given family, fetched
// once per context. URLs come from fonts.ts's FONT_URLS (the ?url side of
// the catalog, shared with the DOM gate so the two never drift). Consumers
// are the full-resolution export builds and the dev-only parity harness
// (src/dev/parity.ts); each gets its own module instance, so each fetches
// once per family.
import { FONT_URLS } from "../fonts";
import type { FontFamilyId } from "../fontCatalog";
import type { Assets } from "./build";

const fontsPromises = new Map<FontFamilyId, Promise<Assets["fonts"]>>();

/** Memoized per family. A failed load clears that family's memo so the next
 *  build retries rather than replaying the rejection forever. */
export function loadFonts(id: FontFamilyId = "poppins"): Promise<Assets["fonts"]> {
  const cached = fontsPromises.get(id);
  if (cached) return cached;
  const urls = FONT_URLS[id];
  const get = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const p = Promise.all([get(urls.regular), get(urls.semibold), get(urls.bold)])
    .then(([regular, semibold, bold]) => ({ regular, semibold, bold }))
    .catch((error) => {
      fontsPromises.delete(id);
      throw error;
    });
  fontsPromises.set(id, p);
  return p;
}
