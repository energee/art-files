// useProjectSave.ts — File → Save / Save As… for a .label, split out of
// App.tsx (#416): the file the document is bound to (a native path on
// desktop, a File System Access handle in the browser, or none) and the
// three-way platform save that writes to it. What is written (pack) and what
// a completed save means for the dirty flags (onSaved) stay with the editor
// state that owns them.
import { useRef, useState } from "react";
import { saveThrough } from "@/files";
import { LABEL_FILTER, LABEL_TYPES } from "@/filePickers";
import { LABEL_EXT } from "@/labelfile";
import { errMsg } from "@/lib/utils";

export type ProjectSaveInputs = {
  /** This document as .label bytes (App.tsx packProject). */
  pack: () => Uint8Array;
  /** The suggested file name, without the extension. */
  exportBase: string;
  /** Marks the document saved; returns whether it was unchanged during the
   *  write — the close-tab caller must not close over edits made meanwhile. */
  onSaved: () => boolean;
  setLoadError: (error: string) => void;
  /** useExport's download batch, shared with every other save. */
  startSaveBatch: () => void;
  saveBytes: (bytes: Uint8Array, name: string, type?: string) => void;
};

export function useProjectSave({
  pack, exportBase, onSaved, setLoadError, startSaveBatch, saveBytes,
}: ProjectSaveInputs) {
  /** The file Save rewrites in place: set by Save As and picker-based Open.
   *  Null until then, so plain Save falls through to the Save As dialog. */
  const projectHandle = useRef<FileSystemFileHandle | null>(null);
  /** Tauri's equivalent of projectHandle. */
  const projectPath = useRef<string | null>(null);
  /** State mirror of projectPath (a ref, which can't drive onMeta). */
  const [filePath, setFilePath] = useState<string | null>(null);

  /** Bind Save to a file an Open read from disk (desktop). */
  function bindPath(path: string) {
    projectPath.current = path;
    setFilePath(path);
  }
  /** Bind Save to a file an Open picked through File System Access. */
  function bindHandle(handle: FileSystemFileHandle) {
    projectHandle.current = handle;
  }
  /** Drop the binding: the next Save asks where, like Save As. */
  function forgetProjectFile() {
    projectHandle.current = null;
    projectPath.current = null;
    setFilePath(null);
  }

  /** File → Save / Save As…: the v3 label plus its embedded art, zipped as
   *  <name-slug>.label (model/files.ts). Resolves false when the user
   *  cancels the dialog or the write fails. */
  async function saveProject(as = false): Promise<boolean> {
    const zip = pack();
    try {
      startSaveBatch();
      const saved = await saveThrough(zip, {
        name: exportBase + LABEL_EXT, type: "application/zip", filter: LABEL_FILTER, types: LABEL_TYPES,
        target: as ? null : projectPath.current ? { path: projectPath.current }
          : projectHandle.current ? { handle: projectHandle.current } : null,
      }, saveBytes);
      if (!saved) return false;
      if (saved.target && "path" in saved.target) bindPath(saved.target.path);
      else if (saved.target && "handle" in saved.target) bindHandle(saved.target.handle);
      return onSaved();
    } catch (err) {
      setLoadError(`Could not save project: ${errMsg(err)}`);
      return false;
    }
  }

  return { filePath, bindPath, bindHandle, forgetProjectFile, saveProject };
}
