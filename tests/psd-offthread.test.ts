// psd-offthread.test.ts — issue #415: the PSD build runs in a module worker
// so a full-resolution export no longer freezes the UI. The worker is a
// separate realm, so the job must carry the document geometry (bleed, DPI)
// the main thread set on layout.ts, and its bytes must match a main-thread
// build exactly. With no Worker (Node, a constructor that throws, or a
// worker script that fails to load) the build falls back to the main
// thread, still at the job's geometry; a build that throws inside the worker
// still rejects with its own message. A job posts only once the worker says
// it loaded, because a transfer empties the job here: a load failure still
// falls back, and a crash after a transfer rejects (#723).
import { afterEach, describe, expect, it } from "vitest";
import { readPsd } from "ag-psd";
import * as L from "../src/layout";
import { buildPsd } from "../src/psd/build";
import type { BuildReply, BuildWorker } from "../src/offThread";
import { buildPsdOffThread, runPsdJob, type PsdJob } from "../src/psd/offThread";
import { lolevLayers, lolevPlan, psdAssets } from "./fixtures";

const SHIPPED = { bleedIn: L.SHIPPED_BLEED_IN, dpi: L.DESIGN_DPI };
afterEach(() => { L.setBleed(SHIPPED.bleedIn); L.setOutputDpi(SHIPPED.dpi); });

const job = async (geometry = SHIPPED): Promise<PsdJob> => ({
  items: await lolevPlan(), assets: psdAssets, mode: "art",
  opts: { layers: lolevLayers() }, geometry,
});
const size = (bytes: Uint8Array) => {
  const psd = readPsd(Buffer.from(bytes).buffer as ArrayBuffer,
    { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
  return [psd.width, psd.height];
};

/** A Worker stand-in that behaves like the real one: it says it loaded, the
 *  message crosses the boundary through a real structured clone (so a
 *  transfer really empties the sender's buffers), and the job runs in runPsdJob. */
type FakeWorker = BuildWorker<PsdJob> & { terminated: boolean };
function fakeWorker(run: (job: PsdJob) => Promise<Uint8Array> = runPsdJob): FakeWorker {
  let onmessage: BuildWorker<PsdJob>["onmessage"] = null;
  const w: FakeWorker = {
    get onmessage() { return onmessage; },
    set onmessage(handler) {
      onmessage = handler;
      queueMicrotask(() => handler?.({ data: { ready: true } }));
    },
    onerror: null, terminated: false,
    postMessage(msg: PsdJob, transfer: Transferable[] = []) {
      const cloned = structuredClone(msg, { transfer });
      run(cloned).then(
        (bytes) => w.onmessage?.({ data: { bytes } satisfies BuildReply }),
        (err: Error) => w.onmessage?.({ data: { error: err.message } satisfies BuildReply }),
      );
    },
    terminate() { w.terminated = true; },
  };
  return w;
}

/** A worker whose script never loads: it errors and never says it is ready. */
function unloadedWorker(): FakeWorker {
  let onerror: BuildWorker<PsdJob>["onerror"] = null;
  const w: FakeWorker = {
    onmessage: null, terminated: false,
    get onerror() { return onerror; },
    set onerror(handler) {
      onerror = handler;
      queueMicrotask(() => handler?.(new Event("error")));
    },
    postMessage() { throw new Error("nothing posts to a worker that never loaded"); },
    terminate() { w.terminated = true; },
  };
  return w;
}

/** A job carrying its own pixels, as the print PSD's does. */
const pixelJob = async (): Promise<PsdJob> => {
  const j = await job();
  const { w, h } = { w: L.PSD_DOC.w, h: L.PSD_DOC.h };
  const composite = { data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h };
  return { ...j, opts: { ...j.opts, composite } };
};
const buffersOf = (j: PsdJob) => [j.opts.composite!.data.buffer as ArrayBuffer];

describe("PSD build off the main thread (#415)", () => {
  it("runPsdJob applies the job's geometry (bleed and DPI) before building", async () => {
    const bytes = await runPsdJob(await job({ bleedIn: 0.125, dpi: 300 }));
    const side = (trim: number) => Math.round(((trim + 2 * 0.125 * 72) / 72) * 300);
    expect(size(bytes)).toEqual([side(L.TRIM.w), side(L.TRIM.h)]);
  });

  it("a worker build returns the same bytes as a main-thread build", async () => {
    const j = await job();
    const main = await buildPsd(j.items, j.assets, j.mode, j.opts);
    const w = fakeWorker();
    const off = await buildPsdOffThread(j, [], () => w);
    expect(Buffer.from(off).equals(Buffer.from(main))).toBe(true);
    expect(w.terminated).toBe(true);
  });

  it("falls back to the main thread when no Worker is available", async () => {
    const j = await job();
    const main = await buildPsd(j.items, j.assets, j.mode, j.opts);
    const off = await buildPsdOffThread(j);
    expect(Buffer.from(off).equals(Buffer.from(main))).toBe(true);
  });

  it("falls back to the main thread when the worker script fails to load", async () => {
    const j = await job();
    const w = unloadedWorker();
    const off = await buildPsdOffThread(j, [], () => w);
    expect(size(off)).toEqual([L.PSD_DOC.w, L.PSD_DOC.h]);
    expect(w.terminated).toBe(true);
  });

  it("transfers the job's buffers and still builds the same bytes (#723)", async () => {
    const j = await pixelJob();
    const main = await buildPsd(j.items, j.assets, j.mode, j.opts);
    const [buffer] = buffersOf(j);
    const off = await buildPsdOffThread(j, [buffer], () => fakeWorker());
    expect(buffer.byteLength).toBe(0); // detached
    expect(Buffer.from(off).equals(Buffer.from(main))).toBe(true);
  });

  it("keeps a transfer's pixels when the worker fails to load, and builds here (#723)", async () => {
    const j = await pixelJob();
    const main = await buildPsd(j.items, j.assets, j.mode, j.opts);
    const [buffer] = buffersOf(j);
    const off = await buildPsdOffThread(j, [buffer], unloadedWorker);
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(off).equals(Buffer.from(main))).toBe(true);
  });

  it("rejects, rather than build from emptied buffers, when a worker dies after a transfer (#723)", async () => {
    const j = await pixelJob();
    const w = fakeWorker(() => {
      queueMicrotask(() => w.onerror?.(new Event("error")));
      return new Promise(() => {});
    });
    await expect(buildPsdOffThread(j, buffersOf(j), () => w)).rejects.toThrow("The export stopped");
    expect(w.terminated).toBe(true);
  });

  it("still builds here when a worker dies after a job with no transfer", async () => {
    const j = await job();
    const w = fakeWorker(() => {
      queueMicrotask(() => w.onerror?.(new Event("error")));
      return new Promise(() => {});
    });
    const off = await buildPsdOffThread(j, [], () => w);
    expect(size(off)).toEqual([L.PSD_DOC.w, L.PSD_DOC.h]);
  });

  it("falls back to the main thread when the Worker constructor throws", async () => {
    // WebKit (the Tauri webview) throws a SecurityError for a CSP-blocked worker.
    const j = await job();
    const off = await buildPsdOffThread(j, [], () => { throw new DOMException("blocked", "SecurityError"); });
    expect(size(off)).toEqual([L.PSD_DOC.w, L.PSD_DOC.h]);
  });

  it("terminates the worker and builds here when the job can't be posted", async () => {
    const j = await job();
    const w = fakeWorker();
    w.postMessage = () => { throw new DOMException("uncloneable", "DataCloneError"); };
    const off = await buildPsdOffThread(j, [], () => w);
    expect(size(off)).toEqual([L.PSD_DOC.w, L.PSD_DOC.h]);
    expect(w.terminated).toBe(true);
  });

  it("a fallback builds at the job's geometry, and leaves the live layout alone (#710)", async () => {
    const j = await job({ bleedIn: 0.125, dpi: 300 });
    const inWorker = await runPsdJob(j);
    L.setBleed(0.25);
    L.setOutputDpi(150);
    const live = { ...L.PSD_DOC };
    for (const create of [undefined, unloadedWorker]) {
      const off = await buildPsdOffThread(j, [], create);
      expect(Buffer.from(off).equals(Buffer.from(inWorker))).toBe(true);
      expect(L.PSD_DOC).toEqual(live);
    }
  });

  it("rejects with the worker's own message when the build throws", async () => {
    const w = fakeWorker(async () => { throw new Error("PSD: boom"); });
    await expect(buildPsdOffThread(await job(), [], () => w)).rejects.toThrow("PSD: boom");
    expect(w.terminated).toBe(true);
  });
});
