// PreviewCompare.tsx — the single preview: both generated PDFs rendered to
// bitmaps via pdf.js and stacked; a resizable divider reveals the white-ink
// layer (left side) over the art (right side). Replaces <embed> + tabs.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import { PAGE } from "@/layout";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// ponytail: fixed oversample, CSS downscales; add a ResizeObserver only if
// crispness on very large screens ever matters.
const RENDER_SCALE = 2.5;

// The installed react-resizable-panels major (Group/Panel/Separator, with
// panelRef instead of a forwarded ref, and onLayoutChange reporting a
// {[panelId]: percent} map instead of a sizes array) postdates the classic
// PanelGroup/Panel/ImperativePanelHandle API; the left panel needs a fixed
// id so its percentage can be read out of that map by key.
const WHITE_INK_PANEL_ID = "white-ink";

async function renderPdf(bytes: Uint8Array, canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  // pdf.js transfers the buffer to its worker — hand it a copy. destroy()
  // lives on the loading task (not the resolved PDFDocumentProxy) in this
  // pdfjs-dist major, so the task is kept around for cleanup.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: RENDER_SCALE });
    canvas.width = vp.width;
    canvas.height = vp.height;
    // `canvas` (not the legacy `canvasContext`) is the required render target.
    await page.render({ canvas, viewport: vp }).promise;
  } finally {
    void task.destroy();
  }
}

export interface PreviewCompareHandle {
  showArt: () => void;
  showMask: () => void;
}

export const PreviewCompare = forwardRef<
  PreviewCompareHandle,
  { artBytes: Uint8Array | null; maskBytes: Uint8Array | null }
>(function PreviewCompare({ artBytes, maskBytes }, ref) {
  const artCanvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);
  const leftPanel = useRef<PanelImperativeHandle>(null);
  const [split, setSplit] = useState(0); // % width showing white-ink

  useImperativeHandle(ref, () => ({
    // Numbers in resize() are pixels, not percent — units must be explicit.
    showArt: () => leftPanel.current?.resize("0%"),
    showMask: () => leftPanel.current?.resize("100%"),
  }));

  useEffect(() => { if (artBytes) void renderPdf(artBytes, artCanvas.current); }, [artBytes]);
  useEffect(() => { if (maskBytes) void renderPdf(maskBytes, maskCanvas.current); }, [maskBytes]);

  return (
    <div
      className="relative m-auto w-full max-w-[900px] overflow-hidden rounded-md border border-border bg-input"
      style={{ aspectRatio: `${PAGE.w} / ${PAGE.h}` }}
    >
      <canvas ref={artCanvas} className="absolute inset-0 h-full w-full" />
      <canvas
        ref={maskCanvas}
        className="absolute inset-0 h-full w-full"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      />
      <ResizablePanelGroup
        orientation="horizontal"
        onLayoutChange={(layout) => setSplit(layout[WHITE_INK_PANEL_ID] ?? 0)}
        className="absolute inset-0"
      >
        <ResizablePanel id={WHITE_INK_PANEL_ID} panelRef={leftPanel} defaultSize="0%" minSize="0%" />
        <ResizableHandle withHandle className="bg-border/60" />
        <ResizablePanel minSize="0%" />
      </ResizablePanelGroup>
      <span className="pointer-events-none absolute bottom-1 left-1.5 text-[10px] text-muted-foreground">
        white-ink
      </span>
      <span className="pointer-events-none absolute bottom-1 right-1.5 text-[10px] text-muted-foreground">
        art
      </span>
    </div>
  );
});
