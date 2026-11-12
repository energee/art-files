// offThread.ts — runs buildPsd in a module worker (#415): raster resampling
// plus ag-psd's channel packing are seconds of CPU at 600dpi. This file is
// the PSD's job type; ../offThread.ts owns the hand-off and its fallbacks.
import { buildOffThread, type BuildWorker } from "../offThread";
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

/** Build at the job's geometry, in whichever realm this runs: the worker
 *  (see worker.ts) or, on a fallback, the main thread, whose live layout may
 *  have moved since the export started (#710). withGeometry needs a
 *  synchronous read, and buildPsd is: async only in its signature, with no
 *  await in its body. */
export function runPsdJob(job: PsdJob): Promise<Uint8Array> {
  return withGeometry(job.geometry, () => buildPsd(job.items, job.assets, job.mode, job.opts));
}

const spawn = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as BuildWorker<PsdJob>;

/** buildPsd in a fresh worker. `create` is the test seam. */
export function buildPsdOffThread(
  job: PsdJob, transfer: ArrayBuffer[] = [], create: () => BuildWorker<PsdJob> = spawn,
): Promise<Uint8Array> {
  return buildOffThread(job, runPsdJob, create, transfer);
}
