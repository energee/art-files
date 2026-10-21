// useOwnedError.ts — one writer to a shared error slot (the editor's header
// buildError) that clears only the message it set itself, so its next success
// never wipes an error some other source put there (#473 exports, #511 asset
// assembly).
import { useMemo, useRef, type Dispatch, type SetStateAction } from "react";

export function useOwnedError(setError: Dispatch<SetStateAction<string>>): {
  set: (message: string) => void;
  clear: () => void;
} {
  const last = useRef("");
  return useMemo(() => ({
    set(message: string) {
      last.current = message;
      setError(message);
    },
    clear() {
      const own = last.current;
      last.current = "";
      setError((current) => (current === own ? "" : current));
    },
  }), [setError]);
}
