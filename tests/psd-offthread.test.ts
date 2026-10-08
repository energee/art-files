// psd-offthread.test.ts — issue #415: the PSD build runs in a module worker
// so a full-resolution export no longer freezes the UI. The worker is a
// separate realm, so the job must carry the document geometry (bleed, DPI)
// the main thread set on layout.ts, and its bytes must match a main-thread
// build exactly. With no Worker (Node, a constructor that throws, or a
// worker script that fails to load) the build falls back to the main
// thread; a build that throws inside the worker still rejects with its own
// message.
import { afterEach, describe, expect, it } from "vitest";
import { readPsd } from "ag-psd";
import * as L from "../src/layout";
import { buildPsd } from "../src/psd/build";
import {
  buildPsdOffThread, runPsdJob, type PsdJob, type PsdWorkerLike, type PsdWorkerReply,
} from "../src/psd/offThread";
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

/** A Worker stand-in that behaves like the real one: the message is
 *  structured-cloned across the boundary and the job runs in runPsdJob. */
type FakeWorker = PsdWorkerLike & { terminated: boolean };
function fakeWorker(run: (job: PsdJob) => Promise<Uint8Array> = runPsdJob): FakeWorker {
  const w: FakeWorker = {
    onmessage: null, onerror: null, terminated: false,
    postMessage(msg: PsdJob) {
      const cloned = structuredClone(msg);
      run(cloned).then(
        (bytes) => w.onmessage?.({ data: { bytes } satisfies PsdWorkerReply }),
        (err: Error) => w.onmessage?.({ data: { error: err.message } satisfies PsdWorkerReply }),
      );
    },
    terminate() { w.terminated = true; },
  };
  return w;
}

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
    const off = await buildPsdOffThread(j, () => w);
    expect(Buffer.from(off).equals(Buffer.from(main))).toBe(true);
    expect(w.terminated).toBe(true);
  });

  it("falls back to the main thread when no Worker is available", async () => {
    const j = await job();
    const main = await buildPsd(j.items, j.assets, j.mode, j.opts);
    const off = await buildPsdOffThread(j, () => null);
    expect(Buffer.from(off).equals(Buffer.from(main))).toBe(true);
  });

  it("falls back to the main thread when the worker script fails to load", async () => {
    const j = await job();
    const w: FakeWorker = {
      onmessage: null, onerror: null, terminated: false,
      postMessage() { queueMicrotask(() => w.onerror?.(new Event("error"))); },
      terminate() { w.terminated = true; },
    };
    const off = await buildPsdOffThread(j, () => w);
    expect(size(off)).toEqual([L.PSD_DOC.w, L.PSD_DOC.h]);
    expect(w.terminated).toBe(true);
  });

  it("falls back to the main thread when the Worker constructor throws", async () => {
    // WebKit (the Tauri webview) throws a SecurityError for a CSP-blocked worker.
    const j = await job();
    const off = await buildPsdOffThread(j, () => { throw new DOMException("blocked", "SecurityError"); });
    expect(size(off)).toEqual([L.PSD_DOC.w, L.PSD_DOC.h]);
  });

  it("terminates the worker and builds here when the job can't be posted", async () => {
    const j = await job();
    const w: FakeWorker = {
      onmessage: null, onerror: null, terminated: false,
      postMessage() { throw new DOMException("uncloneable", "DataCloneError"); },
      terminate() { w.terminated = true; },
    };
    const off = await buildPsdOffThread(j, () => w);
    expect(size(off)).toEqual([L.PSD_DOC.w, L.PSD_DOC.h]);
    expect(w.terminated).toBe(true);
  });

  it("rejects with the worker's own message when the build throws", async () => {
    const w = fakeWorker(async () => { throw new Error("PSD: boom"); });
    await expect(buildPsdOffThread(await job(), () => w)).rejects.toThrow("PSD: boom");
    expect(w.terminated).toBe(true);
  });
});
