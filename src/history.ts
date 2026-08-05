// history.ts — undo/redo state for the label config.
//
// A drop-in replacement for useState: the setter accepts the same value-or-
// updater argument, and every accepted change pushes the previous value onto
// an undo stack. Only the config goes through here — loaded texture/mask
// files and the transient preview state are deliberately outside it, so undo
// never re-runs an image decode.
import { useCallback, useRef, useState } from "react";

// Consecutive edits closer together than this collapse into one undo step, so
// a drag on a ScrubField is one ⌘Z rather than sixty.
const COALESCE_MS = 500;
// Cap on stack depth. Each entry is a full LabelConfig clone; a hundred of
// them is nothing next to the embedded fonts, and it bounds a long session.
const LIMIT = 100;

export type Stacks<T> = { past: T[]; present: T; future: T[] };

// The three transitions, pure and exported so the stack behaviour is testable
// without a DOM renderer. `coalesce` folds the new value into the current
// step instead of opening a new one; the caller owns the timing decision.
export function pushed<T>(s: Stacks<T>, value: T, coalesce: boolean): Stacks<T> {
  if (Object.is(value, s.present)) return s;
  // Coalescing keeps `past` as-is, which discards the intermediate value and
  // leaves the pre-drag config on top of the stack.
  const past = coalesce && s.past.length > 0 ? s.past : [...s.past, s.present].slice(-LIMIT);
  return { past, present: value, future: [] };
}

export function undone<T>(s: Stacks<T>): Stacks<T> {
  if (s.past.length === 0) return s;
  return {
    past: s.past.slice(0, -1),
    present: s.past[s.past.length - 1],
    future: [s.present, ...s.future],
  };
}

export function redone<T>(s: Stacks<T>): Stacks<T> {
  if (s.future.length === 0) return s;
  return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) };
}

// `initial` takes a value or a lazy initializer, same as useState.
export function useHistory<T>(initial: T | (() => T)) {
  const [h, setH] = useState<Stacks<T>>(() => ({
    past: [],
    present: typeof initial === "function" ? (initial as () => T)() : initial,
    future: [],
  }));
  // Timestamp of the last accepted edit, for the coalescing window above.
  const lastEdit = useRef(0);

  const set = useCallback((next: T | ((current: T) => T)) => {
    setH((s) => {
      const value = typeof next === "function" ? (next as (c: T) => T)(s.present) : next;
      // ponytail: reading the clock inside the updater is impure, but the
      // only cost of a double-invoke under StrictMode is one coalesced step.
      const now = performance.now();
      const coalesce = now - lastEdit.current < COALESCE_MS;
      if (!Object.is(value, s.present)) lastEdit.current = now;
      return pushed(s, value, coalesce);
    });
  }, []);

  const undo = useCallback(() => {
    // Break the coalescing window: the next edit after an undo must start a
    // fresh step, never merge into the one we just stepped back over.
    lastEdit.current = 0;
    setH(undone);
  }, []);

  const redo = useCallback(() => {
    lastEdit.current = 0;
    setH(redone);
  }, []);

  return {
    value: h.present,
    set,
    undo,
    redo,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}
