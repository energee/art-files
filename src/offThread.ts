// offThread.ts — hands one export build to a module worker, so a
// full-resolution file no longer freezes the UI (#415, #713). pdf/ and psd/
// each own a worker and a job type; the hand-off is this one. Their builders
// are DOM-free, so a worker runs the very same code.
//
// A worker is a separate realm with its own copy of layout.ts, so a job
// carries the document geometry the export started with. Anything else
// module-level that a builder reads must travel the same way.
//
// No Worker (Node, tests), a Worker constructor that throws (WebKit throws a
// SecurityError for a worker CSP blocks) or a worker script that fails to
// load falls back to building on the main thread: slower, never broken. A
// build that throws inside the worker rejects with its own message, like the
// in-thread call.
//
// A job's pixels can transfer rather than copy (#723). That empties them here,
// so a job posts only once the worker says it loaded: a load failure still
// has its pixels to fall back on. A worker that dies after a transfer has
// nothing left to build from, so that export fails.
import { t } from "@/i18n";
import { errMsg } from "@/lib/utils";

/** What a worker posts: that it loaded, then the file or the build's error message. */
export type BuildReply = { ready: true } | { bytes: Uint8Array } | { error: string };

/** The slice of Worker this file uses — a seam for tests. */
export interface BuildWorker<Job> {
  onmessage: ((e: { data: BuildReply }) => void) | null;
  onerror: ((e: Event) => void) | null;
  postMessage(job: Job, transfer: Transferable[]): void;
  terminate(): void;
}

/** `run(job)` in the fresh worker `create` spawns, terminated when the job
 *  settles, or here if `create` throws. `transfer` names buffers in the job
 *  that nothing reads afterwards, which leave this realm rather than copy. */
export function buildOffThread<Job>(
  job: Job, run: (job: Job) => Promise<Uint8Array>, create: () => BuildWorker<Job>, transfer: ArrayBuffer[] = [],
): Promise<Uint8Array> {
  let worker: BuildWorker<Job>;
  try { worker = create(); } catch { return run(job); }
  return new Promise<Uint8Array>((resolve, reject) => {
    let transferred = false;
    const fallBack = () => {
      worker.terminate();
      run(job).then(resolve, reject);
    };
    worker.onmessage = ({ data }) => {
      if ("ready" in data) {
        // A job that can't be cloned (DataCloneError) builds here too: a post
        // that throws has moved nothing, and the idle worker is torn down
        // rather than leaked.
        try { worker.postMessage(job, transfer); } catch { fallBack(); return; }
        transferred = transfer.length > 0;
        return;
      }
      worker.terminate();
      if ("error" in data) reject(new Error(data.error));
      else resolve(data.bytes);
    };
    // Load failure (CSP, missing chunk) or a crash the worker couldn't
    // report: build here instead of failing the export, unless the job's
    // pixels already left.
    worker.onerror = () => {
      if (!transferred) return fallBack();
      worker.terminate();
      reject(new Error(t("The export stopped unexpectedly. Export again.")));
    };
  });
}

/** A worker entry's whole job: say it loaded, then take one job in and send
 *  the file's bytes (transferred, not copied) or the error message out. */
export function serveBuild<Job>(run: (job: Job) => Promise<Uint8Array>) {
  self.onmessage = async ({ data }: MessageEvent<Job>) => {
    try {
      const bytes = await run(data);
      self.postMessage({ bytes } satisfies BuildReply, { transfer: [bytes.buffer as ArrayBuffer] });
    } catch (err) {
      self.postMessage({ error: errMsg(err) } satisfies BuildReply);
    }
  };
  self.postMessage({ ready: true } satisfies BuildReply);
}
