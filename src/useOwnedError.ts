// useOwnedError.ts — the editor header's message slots (buildError, loadError)
// and one writer to a slot that clears only the message it set itself, so its
// next success never wipes an error some other source put there (#511 asset
// assembly; exports, #473, now keep a toast of their own: useExport.ts).
import { useMemo, useRef, type Dispatch, type SetStateAction } from "react";

/** A header message. `note` marks a warning (amber) rather than an error;
 *  it is set where the message is made, never read back from its text. */
export type HeaderMessage = { text: string; note?: boolean };
export const NO_MESSAGE: HeaderMessage = { text: "" };

export function useOwnedError(setError: Dispatch<SetStateAction<HeaderMessage>>): {
  set: (text: string, note?: boolean) => void;
  clear: () => void;
} {
  const last = useRef<HeaderMessage | null>(null);
  return useMemo(() => ({
    set(text: string, note?: boolean) {
      const message = { text, note };
      last.current = message;
      setError(message);
    },
    clear() {
      const own = last.current;
      last.current = null;
      setError((current) => (current === own ? NO_MESSAGE : current));
    },
  }), [setError]);
}
