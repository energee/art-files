// lru.ts — the bound the plan's memo caches share (logo.ts, qr.ts). A Map
// keeps insertion order, so re-inserting every hit makes its first key the
// least recently used.

/** `map[key]`, built by `make` on a miss, keeping only the `limit` most
 *  recently used entries. A `make` that throws leaves the map as it was. */
export function lruGet<K, V>(map: Map<K, V>, key: K, limit: number, make: () => V): V {
  const value = map.has(key) ? map.get(key)! : make();
  map.delete(key);
  map.set(key, value);
  if (map.size > limit) map.delete(map.keys().next().value!);
  return value;
}
