// utils.ts — shadcn's class combiner, errMsg: the one spelling of
// "which text do I show for whatever was thrown?", baseName, and shortDate.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getLanguage } from "@/i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Readable text for whatever was thrown or rejected with: an Error's
 *  message, else the value as a string (Tauri invoke rejects with strings). */
export const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A file path's last segment, split on either separator (desktop paths come
 *  as "/Users/x/Lupula.pdf" or "C:\\x\\Lupula.pdf"); a bare name stays as it is.
 *  Synchronous, unlike Tauri's basename(), which is an IPC call. */
export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** "Oct 11, 2026" in the selected UI language, in the operator's own region
 *  of it when the system lists one (en-GB gets "11 Oct 2026"); "" for an
 *  unparsable date. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const language = getLanguage();
  const regional = (typeof navigator === "undefined" ? [] : navigator.languages ?? [])
    .find((tag) => tag.toLowerCase().split(/[-_]/)[0] === language);
  return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(regional ?? language, {
    month: "short", day: "numeric", year: "numeric",
  }).format(d);
}
