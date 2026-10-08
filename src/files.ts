import { isTauri } from "@tauri-apps/api/core";
import { isAbort, openPicker, savePicker, writeHandle } from "./filePickers";
// files.ts — native desktop file-dialog and file I/O boundary. All
// @tauri-apps/plugin-* imports stay here so the app's native surface is
// visible in one place. Open and save both live here; the capability
// scope allows reading and writing .label and .master paths.

/** Read a file's bytes through Tauri's fs plugin — the read half of this
 *  boundary. The capability scope (src-tauri/capabilities/default.json)
 *  limits reads to .label and .master paths (including inside hidden folders:
 *  tauri.conf.json sets plugins.fs.requireLiteralLeadingDot false). */
export async function readNativeFile(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return readFile(path);
}

/** Open a native file dialog and return the selected path. Null is an
 *  ordinary cancellation, matching saveThrough. */
export async function openNativeFile(
  options: { filter: { name: string; extensions: string[] } },
): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, filters: [options.filter] });
  return typeof selected === "string" ? selected : null;
}

/** A reusable save destination; downloads deliberately have no destination. */
export type FileTarget = { path: string } | { handle: FileSystemFileHandle };
type FileOptions = {
  filter: { name: string; extensions: string[] };
  types: { description: string; accept: Record<string, string[]> }[];
};

/** Null means cancelled; undefined means use the caller's file-input fallback. */
export async function openThrough(options: FileOptions): Promise<FileTarget | null | undefined> {
  try {
    if (isTauri()) {
      const path = await openNativeFile(options);
      return path ? { path } : null;
    }
    const pick = openPicker();
    if (!pick) return undefined;
    const [handle] = await pick({ types: options.types });
    return handle ? { handle } : null;
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** Choose once, build bytes with the chosen name, and write once. Cancellation
 *  is null; a browser picker that fails to open downloads instead, but write
 *  failures always propagate rather than becoming downloads.
 *  On desktop a dialog-chosen path is writable because the dialog plugin adds
 *  it to the runtime scope; a reused `target.path` (Finder/argv opens,
 *  remembered masters) is writable only through the .label/.master globs in
 *  src-tauri/capabilities/default.json. Dynamic imports keep both plugins out
 *  of the browser's initial chunk. */
export async function saveThrough(
  content: Uint8Array | ((name: string) => Uint8Array),
  options: FileOptions & { name: string; type: string; target?: FileTarget | null },
  download: (bytes: Uint8Array, name: string, type: string) => void,
): Promise<{ name: string; bytes: Uint8Array; target?: FileTarget } | null> {
  try {
    let target: FileTarget | undefined;
    let name = options.name;
    if (isTauri()) {
      const path = options.target && "path" in options.target ? options.target.path
        : await (await import("@tauri-apps/plugin-dialog")).save({ defaultPath: name, filters: [options.filter] });
      if (!path) return null;
      target = { path }; name = path;
    } else {
      const pick = savePicker();
      const existing = options.target && "handle" in options.target ? options.target.handle : undefined;
      // A picker that refuses for any reason but cancel (e.g. SecurityError
      // once a long export build outlives Chrome's user-activation window)
      // falls through to a download, as the old export path did.
      const handle = existing ?? await pick?.({ suggestedName: name, types: options.types })
        .catch((error: unknown) => { if (isAbort(error)) throw error; });
      if (handle) { target = { handle }; name = handle.name; }
    }
    const bytes = typeof content === "function" ? content(name) : content;
    if (target && "path" in target) await writeNativeAtomic(target.path, bytes);
    else if (target && "handle" in target) await writeHandle(target.handle, bytes);
    else download(bytes, name, options.type);
    return { name, bytes, target };
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** Write `bytes` beside `path` as `<stem>.saving-<random>.<ext>`, then rename it over
 *  `path`, so a crash, power loss or full disk mid-write never truncates the
 *  only copy. The temp keeps the extension so the .label/.master capability
 *  globs cover it; the random suffix plus `createNew` (O_EXCL) means a pre-planted
 *  file or symlink at the temp path fails the write instead of being followed. A failed write removes the temp (best effort) and rethrows. */
async function writeNativeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const { writeFile, rename, remove } = await import("@tauri-apps/plugin-fs");
  const temp = path.replace(/(\.[^./\\]+)?$/, `.saving-${crypto.randomUUID()}$1`);
  try {
    await writeFile(temp, bytes, { createNew: true });
  } catch (error) {
    try { await remove(temp); } catch { /* temp may not exist */ }
    throw error;
  }
  await rename(temp, path);
}
