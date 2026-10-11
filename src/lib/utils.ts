// utils.ts — shadcn's class combiner, errMsg: the one spelling of
// "which text do I show for whatever was thrown?", and shortDate.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Readable text for whatever was thrown or rejected with: an Error's
 *  message, else the value as a string (Tauri invoke rejects with strings). */
export const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** "Oct 11, 2026" in the operator's locale; "" for an unparsable date. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : SHORT_DATE.format(d);
}
