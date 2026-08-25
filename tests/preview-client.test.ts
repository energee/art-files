// preview-client.test.ts — the client half of the preview worker's byte-cache
// protocol (see src/pdf/client.ts): bytes attach on first send, and re-attach
// after a request that omitted their id — the multi-tab "Preview asset bytes
// were not sent to the worker" regression. Stubbed Worker records postMessage.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LabelConfig } from "../src/types";
import type { WorkerRequest } from "../src/pdf/client";

const messages: WorkerRequest[] = [];

class FakeWorker {
  postMessage(message: WorkerRequest) { messages.push(message); }
}

vi.stubGlobal("Worker", FakeWorker);

const cfg = {} as LabelConfig;
const plates = { art: true, mask: false };

describe("buildPreviewPdfs byte-cache tracking", () => {
  let build: typeof import("../src/pdf/client").buildPreviewPdfs;

  beforeEach(async () => {
    vi.resetModules();
    messages.length = 0;
    build = (await import("../src/pdf/client")).buildPreviewPdfs;
  });

  const texture = (bytes: Uint8Array) => ({ texture: { kind: "png" as const, bytes } });

  it("attaches bytes on first send, id-only on an immediate resend", () => {
    const a = new Uint8Array([1]);
    void build(cfg, texture(a), plates, 0);
    void build(cfg, texture(a), plates, 0);
    expect(messages[0].assets.texture?.ref.bytes).toBe(a);
    expect(messages[1].assets.texture?.ref.bytes).toBeUndefined();
  });

  it("re-attaches bytes the worker evicted while another document built", () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    void build(cfg, texture(a), plates, 0); // worker caches a
    void build(cfg, texture(b), plates, 0); // worker evicts a, caches b
    void build(cfg, texture(a), plates, 0); // worker no longer holds a
    expect(messages[2].assets.texture?.ref.bytes).toBe(a);
  });
});
