// utils.ts — shadcn's class combiner, plus errMsg: the one spelling of
// "which text do I show for whatever was thrown?".
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Readable text for whatever was thrown or rejected with: an Error's
 *  message, else the value as a string (Tauri invoke rejects with strings). */
export const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
