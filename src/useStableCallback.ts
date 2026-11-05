// useStableCallback.ts — a handler whose identity never changes but which
// always runs the latest render's closure. App hands these to its memoized
// panels (Layers list, rulers), so a keystroke that only rebuilt a closure
// does not re-render them (#605).
import { useCallback, useLayoutEffect, useRef } from "react";

/** `fn`, behind one identity for the component's life. Call it from events
 *  and effects, not during render: it runs the closure of the last commit. */
export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const latest = useRef(fn);
  useLayoutEffect(() => { latest.current = fn; });
  return useCallback(((...args) => latest.current(...args)) as T, []);
}
