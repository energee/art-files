// offThread.ts — runs the PDF builders in a module worker (#713): embedding a
// full-size raster and saving the file are seconds of CPU, all of it on the
// main thread otherwise. This file is the PDF's job type; ../offThread.ts owns
// the hand-off and its fallbacks. A print job's decoded mask transfers instead
// of copying (#780); the trade-off is ../offThread.ts's: a worker that dies
// after a transfer fails the export.
import { buildOffThread, type BuildWorker } from "../offThread";
import { buildArtPdf, buildMaskPdf, buildPrintPdf, type Assets } from "./build";
import type { PlacedLayer } from "../planLayers";
import type { Geometry } from "../layout";

/** One PDF build, as plain structured-cloneable data. `geometry` is required
 *  here, where Assets leaves it optional: a worker's layout never saw the
 *  app's Settings, so a job without it would build at the shipped bleed. */
export interface PdfJob {
  plate: "print" | "art" | "mask";
  items: readonly PlacedLayer[];
  assets: Assets & { geometry: Geometry };
}

const BUILDERS = { print: buildPrintPdf, art: buildArtPdf, mask: buildMaskPdf };

/** The job's builder, in whichever realm this runs: the worker (see worker.ts)
 *  or, on a fallback, the main thread. The builders apply `assets.geometry`
 *  themselves, around each synchronous stretch (build.ts atGeometry). */
export const runPdfJob = (job: PdfJob): Promise<Uint8Array> => BUILDERS[job.plate](job.items, job.assets);

const spawn = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as BuildWorker<PdfJob>;

/** A PDF build in a fresh worker. `create` is the test seam. `transfer` names
 *  buffers in the job that nothing else reads, which move rather than copy. */
export function buildPdfOffThread(
  job: PdfJob, create: () => BuildWorker<PdfJob> = spawn, transfer: ArrayBuffer[] = [],
): Promise<Uint8Array> {
  return buildOffThread(job, runPdfJob, create, transfer);
}
