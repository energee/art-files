// worker.ts — preview-resolution PDF builds off the browser's UI thread.
// Byte payloads arrive at most once per upload and are cached here by id
// (see client.ts's ByteRef); each request references them by id alone.
import { buildArtPdf, buildMaskPdf, type Assets, type CollabImage } from "./build";
import type { ByteRef, WireAssets, WireImage, WorkerRequest, WorkerResponse } from "./client";
import logoSvg from "../assets/logo2025.svg?raw";
import { loadFonts } from "./fonts";
import { setBleed } from "../layout";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

// Byte payloads by client-assigned id. Entries not referenced by the current
// request are dropped after each build, so a replaced upload's preview PNG
// doesn't linger for the whole session.
const bytesById = new Map<number, Uint8Array>();

function deref(r: ByteRef, used: Set<number>): Uint8Array {
  if (r.bytes) bytesById.set(r.id, r.bytes);
  const bytes = bytesById.get(r.id);
  // Only reachable if the client's sent-tracking broke (it rolls back on a
  // failed postMessage); failing loudly beats silently building without the
  // texture the user dropped.
  if (!bytes) throw new Error("Preview asset bytes were not sent to the worker.");
  used.add(r.id);
  return bytes;
}

function derefImage(img: WireImage | null | undefined, used: Set<number>): CollabImage | null {
  if (!img) return null;
  if (img.kind === "svg") return img;
  return { kind: img.kind, bytes: deref(img.ref, used) };
}

function derefAssets(wire: WireAssets, fonts: Assets["fonts"]): Assets {
  const used = new Set<number>();
  const assets: Assets = {
    fonts,
    logoSvg,
    texture: wire.texture && { kind: wire.texture.kind, bytes: deref(wire.texture.ref, used) },
    maskPng: wire.maskPng && deref(wire.maskPng, used),
    collabLeft: derefImage(wire.collabLeft, used),
    collabCenter: derefImage(wire.collabCenter, used),
    hidden: wire.hidden,
  };
  for (const id of bytesById.keys()) if (!used.has(id)) bytesById.delete(id);
  return assets;
}

function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) return bytes.buffer;
  return bytes.slice().buffer as ArrayBuffer;
}

scope.onmessage = (event) => {
  const { id, cfg, assets: wire, plates, bleedIn } = event.data;
  void (async () => {
    try {
      // This worker holds its OWN copy of layout.ts — a module registry per
      // thread — so the main thread's setBleed never reached it. Without this
      // line the preview would be built at the shipped bleed no matter what
      // the Settings knob says: a silently wrong page size, with the UI's own
      // readout showing the value the user asked for. Set per build, because
      // the request is the only thing that carries the value across.
      setBleed(bleedIn);
      const assets = derefAssets(wire, await loadFonts());
      // Sequential builds keep the worker's transient image memory bounded.
      // A plate the client didn't ask for is skipped and returned null.
      const art = plates.art ? ownBuffer(await buildArtPdf(cfg, assets)) : null;
      const mask = plates.mask ? ownBuffer(await buildMaskPdf(cfg, assets)) : null;
      scope.postMessage(
        { id, art, mask },
        [art, mask].filter((b): b is ArrayBuffer => b !== null),
      );
    } catch (error) {
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  })();
};
