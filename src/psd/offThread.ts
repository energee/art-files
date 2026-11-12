// offThread.ts — runs buildPsd in a module worker so a full-resolution PSD
// export (raster resampling plus ag-psd's channel packing, seconds of CPU at
// 600dpi) no longer freezes the UI (#415). buildPsd is DOM-free, so the
// worker runs the very same code; this file is only the hand-off.
//
// The worker is a separate realm with its own copy of layout.ts, so the job
// carries the document geometry (bleed, output DPI) the export started with,
// and runPsdJob builds at it. Anything else module-level that buildPsd reads
// must travel the same way.
//
// No Worker (Node, tests), a Worker constructor that throws (WebKit throws a
// SecurityError for a worker CSP blocks) or a worker script that fails to
// load falls back to runPsdJob on the main thread — slower, never broken. A build
// that throws inside the worker rejects with its own message, like the in-thread call.
import { buildPsd, type PsdAssets, type PsdMode, type PsdOpts } from "./build";
import type { PlacedLayer } from "../planLayers";
import { withGeometry, type Geometry } from "../layout";

/** One buildPsd call, as plain structured-cloneable data. */
export interface PsdJob {
  items: readonly PlacedLayer[];
  assets: PsdAssets;
  mode: PsdMode;
  opts: PsdOpts;
  /** The export's snapshot of the bleed and DPI (useExport's startRun). */
  geometry: Geometry;
}

/** What the worker posts back: the file, or the build's error message. */
export type PsdWorkerReply = { bytes: Uint8Array } | { error: string };

/** The slice of Worker this file uses — a seam for tests. */
export interface PsdWorkerLike {
  onmessage: ((e: { data: PsdWorkerReply }) => void) | null;
  onerror: ((e: Event) => void) | null;
  postMessage(job: PsdJob): void;
  terminate(): void;
}

/** Build at the job's geometry, in whichever realm this runs: the worker
 *  (see worker.ts) or, on a fallback, the main thread, whose live layout may
 *  have moved since the export started (#710). withGeometry needs a
 *  synchronous read, and buildPsd is: async only in its signature, with no
 *  await in its body. */
export function runPsdJob(job: PsdJob): Promise<Uint8Array> {
  return withGeometry(job.geometry, () => buildPsd(job.items, job.assets, job.mode, job.opts));
}

const spawn = (): PsdWorkerLike | null => typeof Worker === "undefined" ? null
  : new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as PsdWorkerLike;

/** buildPsd in a fresh worker, terminated when the job settles. `create`
 *  is the test seam; returning null or throwing means "no worker", build
 *  in-thread. */
export function buildPsdOffThread(
  job: PsdJob, create: () => PsdWorkerLike | null = spawn,
): Promise<Uint8Array> {
  const inThread = () => runPsdJob(job);
  let worker: PsdWorkerLike | null = null;
  try { worker = create(); } catch { /* blocked worker: build in-thread */ }
  if (!worker) return inThread();
  return new Promise<Uint8Array>((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.bytes);
    };
    // Load failure (CSP, missing chunk) or a crash the worker couldn't
    // report: build here instead of failing the export.
    const fallBack = () => {
      worker.terminate();
      inThread().then(resolve, reject);
    };
    worker.onerror = fallBack;
    // A job that can't be cloned (DataCloneError) builds here too, and the
    // idle worker is torn down rather than leaked.
    try { worker.postMessage(job); } catch { fallBack(); }
  });
}
