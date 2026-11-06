// useProjectSave.ts — File → Save / Save As… for a .label, split out of
// App.tsx (#416): the file the document is bound to (a native path on
// desktop, a File System Access handle in the browser, or none) and the
// three-way platform save that writes to it. What is written (pack) and what
// a completed save means for the dirty flags (onSaved) stay with the editor
// state that owns them.
import { useRef, useState } from "react";
import { confirmOverwrite, nativeModifiedAt, saveThrough } from "@/files";
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
  /** Reports a failed save (App.tsx passes notify.error). */
  onError: (error: string) => void;
  /** useExport's download batch, shared with every other save. */
  startSaveBatch: () => void;
  saveBytes: (bytes: Uint8Array, name: string, type?: string) => void;
};

/** A bound desktop file's mtime when this tab last opened or saved it: what
 *  confirmOverwrite compares against and crash recovery snapshots. `at()` is
 *  undefined until the stat lands, or when it fails. */
export function useFileBaseline() {
  const seen = useRef<{ at?: number }>({});
  /** Start from `path` — `known` when the caller already has its mtime,
   *  otherwise stat'ed now. A later record supersedes a stat still running. */
  function record(path: string | null, known?: number) {
    const entry: { at?: number } = { at: known };
    seen.current = entry;
    if (!path || known !== undefined) return;
    void nativeModifiedAt(path).then((t) => { entry.at = t ?? undefined; }, () => {});
  }
  return { record, at: () => seen.current.at };
}

/** `save`, one call at a time, in call order: a later Save can't finish
 *  before an earlier one and leave the older bytes on disk (#690). A turn runs
 *  the latest render's `save`, so a Save queued behind a write writes what the
 *  document holds when its turn comes. A failed turn doesn't stop the next. */
export function useSaveTurns<A extends unknown[]>(save: (...args: A) => Promise<boolean>) {
  const latest = useRef(save);
  latest.current = save;
  const last = useRef<Promise<boolean>>(Promise.resolve(true));
  return (...args: A) => {
    const turn = () => latest.current(...args);
    last.current = last.current.then(turn, turn);
    return last.current;
  };
}

export function useProjectSave({
  pack, exportBase, onSaved, onError, startSaveBatch, saveBytes,
}: ProjectSaveInputs) {
  /** The file Save rewrites in place: set by Save As and picker-based Open.
   *  Null until then, so plain Save falls through to the Save As dialog. */
  const projectHandle = useRef<FileSystemFileHandle | null>(null);
  /** Tauri's equivalent of projectHandle. */
  const projectPath = useRef<string | null>(null);
  /** State mirror of projectPath (a ref, which can't drive onMeta). */
  const [filePath, setFilePath] = useState<string | null>(null);
  /** projectPath's baseline. Save checks it before rewriting the file (#682),
   *  and a restore rebinds only a file nothing else has written since
   *  (recovery.ts canRebind); a snapshot without it never rebinds. */
  const baseline = useFileBaseline();
  /** Counts bindings, so a Save can tell an Open landed while it ran. */
  const binds = useRef(0);

  /** Bind Save to a file an Open read or a Save wrote (desktop), recording
   *  its mtime — `known` when the caller already has it (a restore cleared
   *  to rebind), otherwise stat'ed now. */
  function bindPath(path: string, known?: number) {
    binds.current++;
    projectPath.current = path;
    setFilePath(path);
    baseline.record(path, known);
  }
  /** Bind Save to a file an Open picked through File System Access. */
  function bindHandle(handle: FileSystemFileHandle) {
    binds.current++;
    projectHandle.current = handle;
  }
  /** Drop the binding: the next Save asks where, like Save As. */
  function forgetProjectFile() {
    binds.current++;
    projectHandle.current = null;
    projectPath.current = null;
    setFilePath(null);
    baseline.record(null);
  }

  /** File → Save / Save As…: the v3 label plus its embedded art, zipped as
   *  <name-slug>.label (model/files.ts). Resolves false when the user
   *  cancels the dialog or the write fails, or when an Open replaced the
   *  document meanwhile. A bound file that changed since this tab last saw it
   *  stops for confirmOverwrite first. Saves take turns: see useSaveTurns. */
  const saveProject = useSaveTurns(async (as = false): Promise<boolean> => {
    const bindsAtStart = binds.current;
    try {
      if (!as && projectPath.current) {
        const choice = await confirmOverwrite(projectPath.current, baseline.at());
        if (choice === "cancel") return false;
        as = choice === "save-as";
      }
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
      // An Open reused this tab during the save (#693): the tab now holds that
      // document, and these bytes were the old one. Its binding and its clean
      // state stay, or ⌘S would send it to the wrong file.
      if (binds.current !== bindsAtStart) return false;
      if (saved.target && "path" in saved.target) bindPath(saved.target.path);
      else if (saved.target && "handle" in saved.target) bindHandle(saved.target.handle);
      return onSaved();
    } catch (err) {
      onError(t("Could not save label: {{error}}", { error: errMsg(err) }));
      return false;
    }
  });

  return {
    filePath, bindPath, bindHandle, forgetProjectFile, saveProject,
    boundModifiedAt: baseline.at,
  };
}
