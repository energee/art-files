// filePickers.ts — the browser File System Access surface, typed once.
// Absent on Safari/Firefox, so every caller branches on these and keeps a
// download/input fallback. The fiddly parts (the window casts, the
// ArrayBuffer cast, abort detection) live here so save/export/open can't
// drift apart. Lives outside App.tsx so that module exports only React
// components and Fast Refresh keeps working (a mixed export forces Vite
// into full-reload HMR).
import { LABEL_EXT } from "@/labelfile";

/** The .label file picker option, shared by open and save dialogs.
 *  TabsShell hosts File → Open now (an open must be able to target a new
 *  tab), and its picker must match Save's typing. */
export const LABEL_TYPES = [
  { description: "Label project", accept: { "application/zip": [LABEL_EXT] } },
];

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
