// Variant-override merge: plain recursive object merge, patch wins, arrays
// and scalars replace wholesale. Stacked variants get last-enabled-wins by
// simply merging in enable order (spec: Resolution step 2).
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-clones plain objects/arrays so a stored patch value is never the same
 *  reference as the caller's — otherwise resolve's setPath could mutate the
 *  patch (e.g. a Variant's overrides) through the merged result. */
function clone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : clone(v);
  }
  return out as T;
}
