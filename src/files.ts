// files.ts — native desktop save-dialog and file-write boundary.

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
