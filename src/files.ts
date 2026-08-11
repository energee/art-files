// files.ts — native desktop file-dialog and file I/O boundary. All
// @tauri-apps/plugin-* imports stay here so the app's native surface is
// visible in one place.

export type NativeSaveOptions = {
  defaultPath: string;
  filter: { name: string; extensions: string[] };
  /** Reuse a path from an earlier Save As instead of prompting again. */
  path?: string;
};

/** Save bytes through Tauri's native APIs. Dynamic imports keep both plugins
 *  out of the browser's initial chunk. A null result is an ordinary dialog
 *  cancellation; plugin and write errors propagate to the app's Alert. */
export async function saveNativeFile(
  bytes: Uint8Array,
  options: NativeSaveOptions,
): Promise<string | null> {
  let path = options.path;
  if (!path) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    path = await save({
      defaultPath: options.defaultPath,
      filters: [options.filter],
    }) ?? undefined;
  }
  if (!path) return null;

  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, bytes);
  return path;
}

/** Read a file's bytes through Tauri's fs plugin — the read half of this
 *  boundary. The capability scope (src-tauri/capabilities/default.json)
 *  limits reads to .label paths, which is all the app ever reads by path. */
export async function readNativeFile(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return readFile(path);
}
