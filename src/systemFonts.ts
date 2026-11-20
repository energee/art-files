// systemFonts.ts — the installed fonts the desktop Font menu offers (font
// import task 14). Lists them through the Rust list_system_fonts command,
// grouped by family, and imports a picked family exactly like Import Font…:
// its faces nearest regular, semibold and bold are read through
// read_system_font and checked by readImportedFont, so the font travels in
// the file. Desktop only: callers check isTauri() first.
import { invoke } from "@tauri-apps/api/core";
import { placeFaces, readImportedFont } from "./fontImport";
import { baseName } from "./lib/utils";

/** One installed face, as the Rust list gives it. */
type SystemFace = { postscript: string; weight: number; path: string };
/** One installed family and its upright single-font faces. */
export type SystemFamily = { family: string; faces: SystemFace[] };

let listing: Promise<SystemFamily[]> | undefined;

/** The installed families, in the Rust list's order (sorted by family). One
 *  scan a session: the first call's list is kept, and Rust's allow-list for
 *  read_system_font stays set from that scan. A failed scan is not kept, so
 *  the next call tries again. */
export function listSystemFonts(): Promise<SystemFamily[]> {
  listing ??= invoke<(SystemFace & { family: string })[]>("list_system_fonts").then((fonts) => {
    const families = new Map<string, SystemFace[]>();
    for (const { family, ...face } of fonts) families.set(family, [...families.get(family) ?? [], face]);
    return [...families].map(([family, faces]) => ({ family, faces }));
  });
  listing.catch(() => { listing = undefined; });
  return listing;
}

/** Import one installed family: read the (at most three) faces placeFaces
 *  puts on regular, semibold and bold, each named by its file's base name,
 *  then readImportedFont them as one font. Rejects with Rust's refusal of a
 *  read or readImportedFont's refusal of a file. */
export async function importSystemFamily(family: SystemFamily) {
  const faces = [...new Set(Object.values(placeFaces(family.faces)))];
  const files = await Promise.all(faces.map(async ({ path }) => ({
    name: baseName(path),
    bytes: new Uint8Array(await invoke<ArrayBuffer>("read_system_font", { path })),
  })));
  return readImportedFont(files);
}
