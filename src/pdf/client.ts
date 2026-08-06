// client.ts — lightweight main-thread client for preview PDF generation.
import type { LabelConfig } from "../types";
import type { Assets } from "./build";

export type PreviewAssets = Omit<Assets, "fonts" | "logoSvg">;

type WorkerRequest = {
  id: number;
  cfg: LabelConfig;
  assets: PreviewAssets;
};

type WorkerResponse =
  | { id: number; art: ArrayBuffer; mask: ArrayBuffer }
  | { id: number; error: string };

type Pending = {
  resolve: (value: { art: Uint8Array; mask: Uint8Array }) => void;
  reject: (reason: Error) => void;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
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
  };
  return worker;
}

export function buildPreviewPdfs(
  cfg: LabelConfig,
  assets: PreviewAssets,
): Promise<{ art: Uint8Array; mask: Uint8Array }> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: WorkerRequest = { id, cfg: structuredClone(cfg), assets };
    try {
      ensureWorker().postMessage(request);
    } catch (error) {
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function disposePreviewWorker(): void {
  worker?.terminate();
  worker = null;
  const error = new Error("The PDF preview worker was disposed.");
  pending.forEach(({ reject }) => reject(error));
  pending.clear();
}
