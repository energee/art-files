// Variation-override merge: plain recursive object merge, patch wins, arrays
// and scalars replace wholesale. Stacked variations get last-enabled-wins by
// simply merging in enable order (spec: Resolution step 2).
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out as T;
}
