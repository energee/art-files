// src/model/path.ts — dot-path read/write over plain objects. The two halves
// of one contract: `getPath(o, "a.b")` reads what `setPath(o, "a.b", v)`
// wrote, creating intermediate objects on the way down.

export function getPath(obj: unknown, path: string): unknown {
  let at: unknown = obj;
  for (const k of path.split(".")) {
    if (!at || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[k];
  }
  return at;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let at = obj;
  for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  at[keys[keys.length - 1]] = value;
}
