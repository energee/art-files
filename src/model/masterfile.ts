// src/model/masterfile.ts — .master file serialization. A .master file is
// the Master JSON, pretty-printed — the same shape parseMaster validates.
// Files on disk are the source of truth; the library index (src/masters.ts)
// is only a resolver cache built from them, never the other way around.
import type { Master } from "./types";
import { parseMaster } from "./types";

export const MASTER_EXT = ".master";

export function serializeMaster(m: Master): string {
  return JSON.stringify(m, null, 2);
}

export function parseMasterFile(json: string): Master {
  return parseMaster(JSON.parse(json));
}
