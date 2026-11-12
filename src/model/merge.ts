// Variant-override merge: plain recursive object merge, patch wins, arrays
// and scalars replace wholesale. Stacked variants get last-enabled-wins by
// simply merging in enable order (spec: Resolution step 2). Also the
// dot-path read and structural equality the edit model compares diffs with.
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : structuredClone(v);
  }
  return out as T;
}

/** A dotted path no walk may follow. Paths come from parsed .label/.master
 *  JSON, where JSON.parse keeps "__proto__" as an own key; following it (or
 *  constructor.prototype) reaches Object.prototype, so a write or delete
 *  there would pollute every object. */
export const unsafePath = (path: string): boolean =>
  path.split(".").some((k) => k === "__proto__" || k === "constructor" || k === "prototype");

/** Dot-path read; undefined when the path doesn't resolve or is unsafe. */
export function getPath(obj: unknown, path: string): unknown {
  if (unsafePath(path)) return undefined;
  let at: unknown = obj;
  for (const k of path.split(".")) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[k];
  }
  return at;
}

/** Structural equality; a key holding `undefined` counts as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  // isPlain lets these through, and with no keys any two would compare equal.
  if (a instanceof Set || b instanceof Set || a instanceof Map || b instanceof Map) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}
