// filePickers.ts — the .label and .master dialog surface: the browser File
// System Access helpers, typed once, plus the Tauri-native dialog filter they
// must stay in sync with. The FS Access API is absent on Safari/Firefox, so
// every caller branches on these and keeps a download/input fallback. The
// fiddly parts (the window casts, the ArrayBuffer cast, abort detection) live
// here so save/export/open can't drift apart. Lives outside App.tsx so that
// module exports only React components and Fast Refresh keeps working (a
// mixed export forces Vite into full-reload HMR).
import { LABEL_EXT } from "@/labelfile";
import { MASTER_EXT } from "@/model/masterfile";

/** One spelling of the dialog's file-type name, so the browser picker and
 *  the Tauri-native dialog can't drift apart. */
const LABEL_DESC = "Label project";
const MASTER_DESC = "Label master";

/** The .label file picker option, shared by open and save dialogs. */
export const LABEL_TYPES = [
  { description: LABEL_DESC, accept: { "application/zip": [LABEL_EXT] } },
];
/** LABEL_TYPES' Tauri-native twin, for the desktop save dialog. */
export const LABEL_FILTER = { name: LABEL_DESC, extensions: [LABEL_EXT.slice(1)] };

/** The .master file picker option — a ZIP like .label since the 2026-08-29
 *  spec amendment (legacy JSON-only files still open by extension).
 *  Shared by Save Master / Save Master As / Open Master. */
export const MASTER_TYPES = [
  { description: MASTER_DESC, accept: { "application/zip": [MASTER_EXT] } },
];
/** MASTER_TYPES' Tauri-native twin, for the desktop save dialog. */
export const MASTER_FILTER = { name: MASTER_DESC, extensions: [MASTER_EXT.slice(1)] };

export const savePicker = () => (window as {
  showSaveFilePicker?: (opts: object) => Promise<FileSystemFileHandle>;
}).showSaveFilePicker;
export const openPicker = () => (window as {
  showOpenFilePicker?: (opts: object) => Promise<FileSystemFileHandle[]>;
}).showOpenFilePicker;

/** A dismissed picker dialog — "no thanks", never an error. */
export const isAbort = (err: unknown) =>
  err instanceof DOMException && err.name === "AbortError";

export async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array) {
  const writable = await handle.createWritable();
  await writable.write(bytes as unknown as ArrayBuffer);
  await writable.close();
}
