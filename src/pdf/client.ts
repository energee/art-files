// client.ts — lightweight main-thread client for preview PDF generation.
//
// Byte payloads (texture/mask preview PNGs, raster collab logos) are sent to
// the worker ONCE per distinct Uint8Array and cached there by id: a typing
// session rebuilds the preview every debounce tick, and re-cloning the same
// few-MB PNGs into the worker each tick was the largest avoidable per-build
// cost. The config (small) still travels with every request.
import type { LabelConfig } from "../types";
import type { Assets, CollabImage } from "./build";

type PreviewAssets = Omit<Assets, "fonts" | "logoSvg">;

/** A byte payload by cache id; `bytes` rides along only the first time this
 *  array is sent to the current worker instance. */
export type ByteRef = { id: number; bytes?: Uint8Array };

export type WireImage =
  | { kind: "svg"; svg: string }
  | { kind: "png" | "jpg"; ref: ByteRef };

export type WireAssets = {
  texture?: { kind: "png" | "jpg"; ref: ByteRef };
  maskPng?: ByteRef;
  collabLeft?: WireImage | null;
  collabCenter?: WireImage | null;
  hidden?: PreviewAssets["hidden"];
};

export type WorkerRequest = {
  id: number;
  cfg: LabelConfig;
  assets: WireAssets;
};

export type WorkerResponse =
  | { id: number; art: ArrayBuffer; mask: ArrayBuffer }
  | { id: number; error: string };

type Pending = {
  resolve: (value: { art: Uint8Array; mask: Uint8Array }) => void;
  reject: (reason: Error) => void;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

// Identity of each byte array, stable across builds; a new upload is a new
// Uint8Array and gets a fresh id. WeakMap lets replaced uploads collect.
let nextByteId = 0;
const byteIds = new WeakMap<Uint8Array, number>();
// Ids the CURRENT worker instance holds — cleared whenever the worker is
// torn down, so a respawned worker gets the bytes again.
let workerHas = new Set<number>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  workerHas = new Set();
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if ("error" in message) request.reject(new Error(message.error));
    else request.resolve({ art: new Uint8Array(message.art), mask: new Uint8Array(message.mask) });
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "The PDF preview worker stopped unexpectedly.");
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
    workerHas = new Set();
  };
  return worker;
}

/** Reference `bytes` for the wire, attaching the payload only if the current
 *  worker hasn't received it yet. Collects the tentatively-attached ids so a
 *  failed postMessage can roll them back (see buildPreviewPdfs). */
function ref(bytes: Uint8Array, attached: number[]): ByteRef {
  let id = byteIds.get(bytes);
  if (id === undefined) byteIds.set(bytes, (id = ++nextByteId));
  if (workerHas.has(id)) return { id };
  attached.push(id);
  return { id, bytes };
}

function wireImage(img: CollabImage | null | undefined, attached: number[]): WireImage | null {
  if (!img) return null;
  if (img.kind === "svg") return img;
  return { kind: img.kind, ref: ref(img.bytes, attached) };
}

export function buildPreviewPdfs(
  cfg: LabelConfig,
  assets: PreviewAssets,
): Promise<{ art: Uint8Array; mask: Uint8Array }> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      const w = ensureWorker();
      const attached: number[] = [];
      const request: WorkerRequest = {
        id,
        cfg,
        assets: {
          texture: assets.texture && {
            kind: assets.texture.kind, ref: ref(assets.texture.bytes, attached),
          },
          maskPng: assets.maskPng && ref(assets.maskPng, attached),
          collabLeft: wireImage(assets.collabLeft, attached),
          collabCenter: wireImage(assets.collabCenter, attached),
          hidden: assets.hidden,
        },
      };
      w.postMessage(request);
      // Only now is delivery guaranteed (message order is FIFO): a throwing
      // postMessage must not leave ids marked as held by the worker.
      attached.forEach((byteId) => workerHas.add(byteId));
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function disposePreviewWorker(): void {
  worker?.terminate();
  worker = null;
  workerHas = new Set();
  const error = new Error("The PDF preview worker was disposed.");
  pending.forEach(({ reject }) => reject(error));
  pending.clear();
}
