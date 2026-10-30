// reveal.ts — the "Show in Finder" toast action for an exported file. On the
// desktop it asks the opener plugin to reveal the file in the OS file manager;
// in the browser there is no path to reveal, so it offers nothing. The label
// uses the platform's own name for its file manager. A reveal that fails (the
// file was moved or deleted since it was saved) is reported as an error toast:
// Sonner does not await an action's onClick, so a rejection that escaped would
// reach UncaughtErrors, which claims the last action may not have finished.
import { isTauri } from "@tauri-apps/api/core";
import { t } from "@/i18n";
import { isMacOS } from "@/keys";
import { baseName, errMsg } from "@/lib/utils";
import { notify, type ToastAction } from "@/notify";

/** "Show in Finder" on macOS, "Show in File Explorer" on Windows, else "Show in Folder". */
export function revealLabel(): string {
  if (isMacOS()) return t("Show in Finder");
  return navigator.userAgent.includes("Windows") ? t("Show in File Explorer") : t("Show in Folder");
}

/** A toast action that reveals `path` in the OS file manager; undefined in the
 *  browser or without a path. A failure becomes an error toast naming the file
 *  (baseName: the whole path when it ends in a separator).
 *  Needs `opener:allow-reveal-item-in-dir`. */
export function revealAction(path: string | undefined): ToastAction | undefined {
  if (!isTauri() || !path) return undefined;
  return {
    label: revealLabel(),
    onClick: () => {
      void import("@tauri-apps/plugin-opener")
        .then(({ revealItemInDir }) => revealItemInDir(path))
        .catch((err: unknown) => {
          notify.error(t("Couldn't show {{file}}", { file: baseName(path) }), { description: errMsg(err) });
        });
    },
  };
}
