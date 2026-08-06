// worker.ts — preview-resolution PDF builds off the browser's UI thread.
import type { LabelConfig } from "../types";
import { buildArtPdf, buildMaskPdf, type Assets } from "./build";
import type { PreviewAssets } from "./client";
import poppinsRegular from "../assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "../assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "../assets/fonts/Poppins-Bold.ttf?url";
import logoSvg from "../assets/logo2025.svg?raw";

type WorkerRequest = { id: number; cfg: LabelConfig; assets: PreviewAssets };
type WorkerResponse =
  | { id: number; art: ArrayBuffer; mask: ArrayBuffer }
  | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

let fontsPromise: Promise<Assets["fonts"]> | null = null;
function loadFonts(): Promise<Assets["fonts"]> {
  if (!fontsPromise) {
    const get = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
    fontsPromise = Promise.all([get(poppinsRegular), get(poppinsSemiBold), get(poppinsBold)])
      .then(([regular, semibold, bold]) => ({ regular, semibold, bold }))
      .catch((error) => {
        fontsPromise = null;
        throw error;
      });
  }
  return fontsPromise;
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
  const { id, cfg, assets: supplied } = event.data;
  void (async () => {
    try {
      const assets: Assets = { ...supplied, fonts: await loadFonts(), logoSvg };
      // Sequential builds keep the worker's transient image memory bounded.
      const art = await buildArtPdf(cfg, assets);
      const mask = await buildMaskPdf(cfg, assets);
      const artBuffer = ownBuffer(art);
      const maskBuffer = ownBuffer(mask);
      scope.postMessage({ id, art: artBuffer, mask: maskBuffer }, [artBuffer, maskBuffer]);
    } catch (error) {
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  })();
};
