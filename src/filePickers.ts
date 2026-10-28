// filePickers.ts — the .label and .master dialog surface: the browser File
// System Access helpers, typed once, plus the Tauri-native dialog filter they
// must stay in sync with. The FS Access API is absent on Safari/Firefox, so
// every caller branches on these and keeps a download/input fallback —
// after checking isTauri() first: the desktop webview has no FS Access API
// and uses the native dialogs in src/files.ts with these filters instead. The
// fiddly parts (the window casts, the bytes cast, abort detection) live
// here so save/export/open can't drift apart; bytesPart is also the one
// spelling of that cast for the asset I/O's Blob and File construction
// (assets/io.ts, #417).
// Lives outside App.tsx so that module exports only React components and
// Fast Refresh keeps working (a mixed export forces Vite into full-reload
// HMR).
import { LABEL_EXT } from "@/labelfile";
import { MASTER_EXT } from "@/model/files";
import { t } from "@/i18n";

/** Localized picker options are created immediately before opening the dialog,
 * so their native UI follows a language switch. */
export const labelTypes = () => [
  { description: t("Label"), accept: { "application/zip": [LABEL_EXT] } },
];
export const labelFilter = () => ({ name: t("Label"), extensions: [LABEL_EXT.slice(1)] });

/** The .master file picker option — a ZIP like .label since the 2026-08-29
 * spec amendment (legacy JSON-only files still open by extension). */
export const masterTypes = () => [
  { description: t("Label master"), accept: { "application/zip": [MASTER_EXT] } },
];
export const masterFilter = () => ({ name: t("Label master"), extensions: [MASTER_EXT.slice(1)] });

export const savePicker = () => (window as {
  showSaveFilePicker?: (opts: object) => Promise<FileSystemFileHandle>;
}).showSaveFilePicker;
export const openPicker = () => (window as {
  showOpenFilePicker?: (opts: object) => Promise<FileSystemFileHandle[]>;
}).showOpenFilePicker;

/** A dismissed picker dialog — "no thanks", never an error. */
export const isAbort = (err: unknown) =>
  err instanceof DOMException && err.name === "AbortError";

/** Bytes as a Blob/File part or FS Access write chunk. The DOM types want an
 *  ArrayBuffer-backed view; our Uint8Arrays are typed ArrayBufferLike (they
 *  could be shared), so this is the one place that asserts they aren't. */
export const bytesPart = (bytes: Uint8Array) => bytes as Uint8Array<ArrayBuffer>;

export async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array) {
  const writable = await handle.createWritable();
  await writable.write(bytesPart(bytes));
  await writable.close();
}
