// usePhoneLayout — whether the editor should use its phone layout.
// `narrow`: under 768px wide; the inspector moves to the bottom.
// `phone`: narrow, or under 500px tall; Layers becomes an overlay. The height
// test catches a phone held sideways (about 844x390), which is wide enough for
// the desktop layout but too short for it (spec, Phase 2). The Tauri window's
// minimum size (1024x700) keeps both false in the desktop app.
import { useCallback, useSyncExternalStore } from "react";

const NARROW = "(max-width: 767px)";
const SHORT = "(max-height: 499px)";
/** A finger is the primary pointer: a touch screen. */
export const COARSE = "(pointer: coarse)";

/** Whether `query` matches now; re-renders when it starts or stops matching. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export function usePhoneLayout(): { phone: boolean; narrow: boolean } {
  const narrow = useMedia(NARROW);
  const short = useMedia(SHORT);
  return { phone: narrow || short, narrow };
}
