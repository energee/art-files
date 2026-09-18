// files.ts — native desktop file-dialog and file I/O boundary. All
// @tauri-apps/plugin-* imports stay here so the app's native surface is
// visible in one place. Open and save both live here; the capability
// scope allows reading .label and .master paths.

export type NativeSaveOptions = {
  /** Dialog window title (desktop only) — "Export 1 of 2: Artwork PDF". */
  title?: string;
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
      ...(options.title ? { title: options.title } : {}),
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
 *  limits reads to .label and .master paths. */
export async function readNativeFile(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return readFile(path);
}

/** Open a native file dialog and return the selected path. Null is an
 *  ordinary cancellation, matching saveNativeFile. */
export async function openNativeFile(
  options: { filter: { name: string; extensions: string[] } },
): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, filters: [options.filter] });
  return typeof selected === "string" ? selected : null;
}
