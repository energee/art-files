// useProjectSave.ts — File → Save / Save As… for a .label, split out of
// App.tsx (#416): the file the document is bound to (a native path on
// desktop, a File System Access handle in the browser, or none) and the
// three-way platform save that writes to it. What is written (pack) and what
// a completed save means for the dirty flags (onSaved) stay with the editor
// state that owns them.
import { useRef, useState } from "react";
import { nativeModifiedAt, saveThrough } from "@/files";
import { labelFilter, labelTypes } from "@/filePickers";
import { LABEL_EXT } from "@/labelfile";
import { errMsg } from "@/lib/utils";
import { t } from "@/i18n";

type ProjectSaveInputs = {
  /** This document as .label bytes (App.tsx packProject), for the file at
   *  `labelPath` — the native path on desktop, a bare file name in a browser
   *  — so the master hint can be written relative to it (#428). Called with
   *  the bound path (or nothing) before any dialog, to fail an oversized
   *  label early; those bytes are written only when that is the target. */
  pack: (labelPath?: string) => Uint8Array;
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
  /** projectPath's mtime when this tab last opened or saved it: the baseline
   *  crash recovery snapshots, so a restore rebinds only a file nothing else
   *  has written since (recovery.ts canRebind). Undefined until the stat
   *  lands, or when it fails — a snapshot without it never rebinds. */
  const modifiedAt = useRef<number | undefined>(undefined);

  /** Bind Save to a file an Open read or a Save wrote (desktop), recording
   *  its mtime — `known` when the caller already has it (a restore cleared
   *  to rebind), otherwise stat'ed now. */
  function bindPath(path: string, known?: number) {
    projectPath.current = path;
    setFilePath(path);
    modifiedAt.current = known;
    if (known !== undefined) return;
    void nativeModifiedAt(path).then((t) => {
      if (projectPath.current === path) modifiedAt.current = t ?? undefined;
    }, () => {});
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
    modifiedAt.current = undefined;
  }

  /** File → Save / Save As…: the v3 label plus its embedded art, zipped as
   *  <name-slug>.label (model/files.ts). Resolves false when the user
   *  cancels the dialog or the write fails. */
  async function saveProject(as = false): Promise<boolean> {
    try {
      // Inside the try: packing throws past the archive size caps, and a
      // rejection would leave the close-tab Save neither closing nor
      // cancelling. Packed before any dialog, so an oversized label fails
      // first; packed again for a newly chosen destination, because the
      // master hint is written relative to the file actually saved.
      const bound = projectPath.current ?? undefined;
      const zip = pack(bound);
      startSaveBatch();
      const saved = await saveThrough((name) => name === bound ? zip : pack(name), {
        name: exportBase + LABEL_EXT, type: "application/zip", filter: labelFilter(), types: labelTypes(),
        target: as ? null : projectPath.current ? { path: projectPath.current }
          : projectHandle.current ? { handle: projectHandle.current } : null,
      }, saveBytes);
      if (!saved) return false;
      if (saved.target && "path" in saved.target) bindPath(saved.target.path);
      else if (saved.target && "handle" in saved.target) bindHandle(saved.target.handle);
      return onSaved();
    } catch (err) {
      setLoadError(t("Could not save label: {{error}}", { error: errMsg(err) }));
      return false;
    }
  }

  return {
    filePath, bindPath, bindHandle, forgetProjectFile, saveProject,
    boundModifiedAt: () => modifiedAt.current,
  };
}
