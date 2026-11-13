// pdf-offthread.test.ts — issue #713: the PDF builds run in a module worker.
// The worker is a separate realm that never saw the app's Settings, so each
// build must apply the job's geometry itself, and what crosses the boundary
// must build the same bytes as a main-thread build. The hand-off's fallbacks
// are shared with the PSD and pinned in psd-offthread.test.ts.
import { afterEach, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import * as L from "../src/layout";
import type { BuildReply, BuildWorker } from "../src/offThread";
import { buildPdfOffThread, runPdfJob, type PdfJob } from "../src/pdf/offThread";
import { assets, lolevPlan, onePxPng } from "./fixtures";

const SHIPPED = { bleedIn: L.SHIPPED_BLEED_IN, dpi: L.DESIGN_DPI };
const WIDE = { bleedIn: 0.25, dpi: 300 };
afterEach(() => { L.setBleed(SHIPPED.bleedIn); L.setOutputDpi(SHIPPED.dpi); });

/** A Worker stand-in: it says it loaded, the job crosses through a real
 *  structured clone, and `run` builds it. */
function fakeWorker(run: (job: PdfJob) => Promise<Uint8Array> = runPdfJob) {
  let onmessage: BuildWorker<PdfJob>["onmessage"] = null;
  const w: BuildWorker<PdfJob> = {
    get onmessage() { return onmessage; },
    set onmessage(handler) {
      onmessage = handler;
      queueMicrotask(() => handler?.({ data: { ready: true } }));
    },
    onerror: null,
    postMessage(job) {
      run(structuredClone(job)).then((bytes) => w.onmessage?.({ data: { bytes } satisfies BuildReply }));
    },
    terminate() {},
  };
  return w;
}

const job = async (plate: PdfJob["plate"], geometry = SHIPPED): Promise<PdfJob> => ({
  plate, items: await lolevPlan(), assets: {
    ...assets, title: "T", geometry,
    // The app's shape: the master's family is the same pack as `fonts`, which
    // newDoc spots by identity to embed it once. A clone must keep that.
    fontFamilies: { poppins: assets.fonts },
    images: { art: { kind: "png", bytes: onePxPng } },
  },
});

it.each(["print", "art", "mask"] as const)("a worker's %s PDF is the main thread's, byte for byte", async (plate) => {
  const j = await job(plate);
  const main = await runPdfJob(j);
  const off = await buildPdfOffThread(j, () => fakeWorker());
  expect(Buffer.from(off).equals(Buffer.from(main))).toBe(true);
});

it("builds at the job's geometry in a realm whose layout never moved", async () => {
  // This realm stands for the worker: its layout is still the shipped one.
  const off = await buildPdfOffThread(await job("print", WIDE), () => fakeWorker());
  const [page] = (await PDFDocument.load(off)).getPages();
  expect(page.getWidth()).toBeCloseTo(L.TRIM.w + 2 * WIDE.bleedIn * 72);
  expect(L.PAGE.w).toBe(L.TRIM.w + 2 * SHIPPED.bleedIn * 72); // and leaves it alone
});

it("a fallback builds the worker's bytes at the job's geometry, whatever the live layout", async () => {
  const j = await job("print", WIDE);
  const inWorker = await buildPdfOffThread(j, () => fakeWorker());
  L.setBleed(0.125);
  const off = await buildPdfOffThread(j); // no Worker in Node
  expect(Buffer.from(off).equals(Buffer.from(inWorker))).toBe(true);
});

it("hands a print job's mask pixels to the worker instead of copying them (#780)", async () => {
  const j = await job("print");
  j.assets.maskPixels = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  const buffer = j.assets.maskPixels.data.buffer as ArrayBuffer;
  const posted: Transferable[][] = [];
  const worker = fakeWorker(async () => new Uint8Array([1]));
  const post = worker.postMessage;
  worker.postMessage = (msg, transfer) => { posted.push(transfer); post(msg, transfer); };
  await buildPdfOffThread(j, () => worker, [buffer]);
  expect(posted).toEqual([[buffer]]);
});
