// fonts.ts — the three Poppins faces every build needs, fetched once per
// context. Consumers are the full-resolution export builds and the dev-only
// parity harness (src/dev/parity.ts); each gets its own module instance, so
// each fetches once.
import poppinsRegular from "../assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "../assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "../assets/fonts/Poppins-Bold.ttf?url";
import type { Assets } from "./build";

let fontsPromise: Promise<Assets["fonts"]> | null = null;

/** Memoized. A failed load clears the memo so the next build retries rather
 *  than replaying the rejection forever. */
export function loadFonts(): Promise<Assets["fonts"]> {
  if (fontsPromise) return fontsPromise;
  const get = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  fontsPromise = Promise.all([get(poppinsRegular), get(poppinsSemiBold), get(poppinsBold)])
    .then(([regular, semibold, bold]) => ({ regular, semibold, bold }))
    .catch((error) => {
      fontsPromise = null;
      throw error;
    });
  return fontsPromise;
}
