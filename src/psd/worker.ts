// worker.ts — module-worker entry for the PSD build (#415): one job in, the
// file's bytes (transferred, not copied) or the error message out. Spawned
// and torn down per job by offThread.ts's buildPsdOffThread.
import { runPsdJob, type PsdJob, type PsdWorkerReply } from "./offThread";

self.onmessage = async ({ data }: MessageEvent<PsdJob>) => {
  try {
    const bytes = await runPsdJob(data);
    self.postMessage({ bytes } satisfies PsdWorkerReply, { transfer: [bytes.buffer] });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) } satisfies PsdWorkerReply);
  }
};
