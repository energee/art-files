// fontImport.ts — turn the font files a user picks (one to three TTF/OTF
// files of one family) into an ImportedFont and its content-hash id, and name
// that font's faces for the app. Refuses what a label can't print: mixed
// families, collections and non-fonts, and fonts whose license (OS/2 fsType)
// forbids embedding or that are bitmap-only. Node-safe on purpose (no ?url
// imports, no DOM): the headless harness reads imported fonts too.
import { t } from "@/i18n";
import type { FontFamily, ImportedFontId } from "./fontCatalog";
import { openFont } from "./fontkit";
import type { FontAsset, ImportedFont } from "./labelfile";
import type { Face } from "./plan";

/** Each label face's target OS/2 weight, in the order the id hashes faces. */
const FACE_WEIGHTS: Record<Face, number> = { regular: 400, semibold: 600, bold: 700 };

/** OS/2 fsType bits (as fontkit names them) that stop a font being imported. */
type FsType = { noEmbedding: boolean; bitmapOnly: boolean };
/** The OS/2 and name-table fields read here, which @pdf-lib/fontkit's .d.ts
 *  leaves out (it types 'OS/2' as sFamilyClass only). */
type FontNames = {
  "OS/2"?: { usWeightClass: number; fsType: FsType };
  name: { records: { preferredFamily?: Record<string, string> } };
};

/** Whether the bytes start with a single-font sfnt tag: TrueType (0x00010000
 *  or "true") or OpenType CFF ("OTTO"). A collection ("ttcf"), WOFF, or
 *  anything else is refused before parsing. */
function isSingleFont(bytes: Uint8Array): boolean {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  return tag === "\0\x01\0\0" || tag === "true" || tag === "OTTO";
}

/** Parse one picked file into what placement needs, or throw the user-facing
 *  refusal. Family is the typographic family (name ID 16) when present, so
 *  "Poppins SemiBold" files group under "Poppins". */
function readFile(file: FontAsset): { file: FontAsset; family: string; weight: number } {
  const notAFont = () => new Error(t("{{name}} is not a TTF or OTF font file.", { name: file.name }));
  if (!isSingleFont(file.bytes)) throw notAFont();
  let font;
  try {
    font = openFont(file.bytes);
  } catch {
    throw notAFont();
  }
  const { "OS/2": os2, name } = font as unknown as FontNames;
  const family = name.records.preferredFamily?.en ?? font.familyName;
  if (!os2 || !family) throw notAFont();
  if (os2.fsType.noEmbedding) throw new Error(t("The license of {{name}} does not allow embedding it in a PDF.", { name: file.name }));
  if (os2.fsType.bitmapOnly) throw new Error(t("{{name}} is a bitmap-only font, which cannot be printed.", { name: file.name }));
  return { file, family, weight: os2.usWeightClass };
}

/** Read one to three files of one family into an ImportedFont.
 *
 *  Each face takes the file whose OS/2 weight is nearest the face's target
 *  (regular 400, semibold 600, bold 700). A tie goes to the HEAVIER file
 *  (Regular 400 + Bold 800 gives semibold the Bold), then to the earlier
 *  file. So one file fills all three faces, two files landing nearest the
 *  same face keep the closer one, and a face with no file of its own takes
 *  the nearest file given.
 *
 *  The id is importedFontId's content hash over the placed faces, so file
 *  order doesn't change it. Async only because crypto.subtle.digest is. */
export async function readImportedFont(files: FontAsset[]): Promise<{ id: ImportedFontId; font: ImportedFont }> {
  if (files.length < 1 || files.length > 3) throw new Error(t("Choose one to three font files."));
  const read = files.map(readFile);
  const other = read.find((r) => r.family !== read[0].family);
  if (other) {
    throw new Error(t("{{first}} and {{second}} are different font families. Import one family at a time.", {
      first: read[0].family, second: other.family,
    }));
  }
  const nearest = (target: number) => read.reduce((best, r) => {
    const d = Math.abs(r.weight - target) - Math.abs(best.weight - target);
    return d < 0 || (d === 0 && r.weight > best.weight) ? r : best;
  }).file;
  const faces = {
    regular: nearest(FACE_WEIGHTS.regular),
    semibold: nearest(FACE_WEIGHTS.semibold),
    bold: nearest(FACE_WEIGHTS.bold),
  };

  const font = { family: read[0].family, faces };
  return { id: await importedFontId(font), font };
}

/** A font's content id: `imported:` plus the first 12 hex digits of the
 *  SHA-256 of its face bytes in face order (regular, semibold, bold). The one
 *  spelling of the hash: readImportedFont mints ids with it, and the font gate
 *  (fonts.ts registerImportedFont) re-checks an opened file's fonts against
 *  it, so a file can't store other bytes under a font's id. */
export async function importedFontId(font: Pick<ImportedFont, "faces">): Promise<ImportedFontId> {
  const ordered = [font.faces.regular, font.faces.semibold, font.faces.bold].map((f) => f.bytes);
  const all = new Uint8Array(ordered.reduce((n, b) => n + b.length, 0));
  ordered.reduce((at, b) => (all.set(b, at), at + b.length), 0);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", all));
  const hex = Array.from(digest.subarray(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
  return `imported:${hex}`;
}

/** The family's menu label and each face's PostScript name, read from the
 *  face's own file (a file without one falls back to the family name). */
export function importedFamily(font: ImportedFont): FontFamily {
  const ps = (face: Face) => openFont(font.faces[face].bytes).postscriptName ?? font.family;
  return { label: font.family, ps: { regular: ps("regular"), semibold: ps("semibold"), bold: ps("bold") } };
}
