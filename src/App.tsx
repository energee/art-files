// App.tsx — owns all state: LabelConfig, texture/mask assets (full-res +
// preview-res pairs), validation, debounced preview-resolution PDF builds,
// overlay-compare preview, and on-demand full-resolution exports. Mirrors
// the old main.ts wiring, componentized.
import { useEffect, useMemo, useRef, useState } from "react";
import type { LabelConfig } from "@/types";
import { defaultConfig, parseConfigFile, toConfigFile } from "@/defaults";
import { validateUpc } from "@/upc";
import { validateMask, recolorMaskForPdf } from "@/maskimage";
import { buildArtPdf, buildMaskPdf, type Assets } from "@/pdf/build";
import { LabelForm } from "@/components/LabelForm";
import { FileDrop } from "@/components/FileDrop";
import { CommandMenu } from "@/components/CommandMenu";
import { PreviewCompare, type PreviewCompareHandle } from "@/components/PreviewCompare";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import poppinsRegular from "@/assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "@/assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "@/assets/fonts/Poppins-Bold.ttf?url";
import logoSvg from "@/assets/logo2025.svg?raw";

/** bytes = full print resolution (exports); previewBytes = downscaled PNG the
 *  debounced preview builds use, so keystroke-driven rebuilds never churn the
 *  print-size image (a burst of those OOMs the tab). */
type Loaded = { bytes: Uint8Array; previewBytes: Uint8Array; name: string; previewUrl: string };

/** Longest preview-texture edge in px — covers PreviewCompare's canvas at its
 *  2.5x oversample while keeping each preview rebuild a few MB. */
const PREVIEW_PX = 1600;

async function previewPng(src: ImageBitmap | HTMLCanvasElement): Promise<Uint8Array> {
  const scale = Math.min(1, PREVIEW_PX / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

const fontsPromise = (async () => {
  const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const [regular, semibold, bold] = await Promise.all([
    get(poppinsRegular), get(poppinsSemiBold), get(poppinsBold),
  ]);
  return { regular, semibold, bold };
})();

// Blob snapshots the bytes at construction (no transfer), so no copy needed —
// unlike pdf.js, which neuters the buffer it's handed (see PreviewCompare).
const blobUrl = (bytes: Uint8Array, type: string) =>
  URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

export default function App() {
  const [cfg, setCfg] = useState<LabelConfig>(defaultConfig);
  const [texture, setTexture] = useState<(Loaded & { kind: "png" | "jpg" }) | null>(null);
  const [mask, setMask] = useState<(Loaded & { error?: string }) | null>(null);
  // Preview-resolution PDFs for the on-screen compare only; downloads always
  // rebuild at full resolution (see buildFull).
  const [pdfs, setPdfs] = useState<{ artBytes: Uint8Array; maskBytes: Uint8Array } | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [loadError, setLoadError] = useState("");
  const configInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<PreviewCompareHandle>(null);

  const update = (fn: (c: LabelConfig) => void) =>
    setCfg((c) => { const n = structuredClone(c); fn(n); return n; });

  const upc = useMemo(() => validateUpc(cfg.upc), [cfg.upc]);
  const errors: Record<string, string> = {};
  if (!upc.ok) errors.upc = upc.error!;
  if (!cfg.beerName.trim()) errors.name = "Beer name is required.";
  // Texture and mask are both optional — the label renders on bare stock
  // until they are dropped, so the text is previewable straight away. Only
  // a loaded-but-invalid mask or bad label data blocks.
  const blocked = !!mask?.error || !upc.ok || !cfg.beerName.trim();
  const blockedWhy = [mask?.error, errors.upc, errors.name].filter(Boolean).join(" · ");

  async function onTexture(f: File) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const bmp = await createImageBitmap(f);
    const previewBytes = await previewPng(bmp);
    bmp.close();
    const previewUrl = URL.createObjectURL(f);
    setTexture((old) => {
      if (old) URL.revokeObjectURL(old.previewUrl);
      return {
        bytes, previewBytes, name: f.name,
        kind: /\.jpe?g$/i.test(f.name) ? "jpg" : "png",
        previewUrl,
      };
    });
  }

  async function onMask(f: File) {
    const bmp = await createImageBitmap(f);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const check = validateMask(data.data);
    recolorMaskForPdf(data.data);
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const previewBytes = await previewPng(canvas); // recolored canvas, downscaled
    const previewUrl = URL.createObjectURL(f);
    setMask((old) => {
      if (old) URL.revokeObjectURL(old.previewUrl);
      return {
        bytes,
        previewBytes,
        name: f.name,
        previewUrl,
        error: check.ok ? undefined : check.error,
      };
    });
  }

  // Debounced preview regeneration on any input change, at preview resolution
  // (Loaded.previewBytes). Two guards keep keystroke bursts from OOMing the
  // tab: builds are serialized through buildChain (the debounce alone can't
  // stop overlap once a build outlasts the typing gap), and superseded builds
  // bail before allocating anything.
  const buildChain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (blocked) return;
    let stale = false;
    const timer = setTimeout(() => {
      buildChain.current = buildChain.current.then(async () => {
        if (stale) return; // a newer edit is queued behind us — skip entirely
        setBuilding(true);
        try {
          const fonts = await fontsPromise;
          const assets: Assets = {
            fonts, logoSvg,
            texture: texture ? { bytes: texture.previewBytes, kind: "png" } : undefined,
            maskPng: mask?.previewBytes,
          };
          // Sequential, not Promise.all — halves the transient memory peak.
          const art = await buildArtPdf(cfg, assets);
          if (stale) return;
          const maskPdf = await buildMaskPdf(cfg, assets);
          if (stale) return;
          setPdfs({ artBytes: art, maskBytes: maskPdf });
          setBuildError("");
        } catch (err) {
          if (!stale) setBuildError(String(err));
        } finally {
          if (!stale) setBuilding(false);
        }
      });
    }, 600);
    return () => { stale = true; clearTimeout(timer); };
  }, [cfg, texture, mask, blocked]);

  function saveBytes(bytes: Uint8Array, name: string) {
    const url = blobUrl(bytes, "application/pdf");
    download(url, name);
    // Revoke once the download has had time to start — revoking immediately
    // can abort a large download.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Downloads rebuild from the full-resolution assets on demand — the
   *  preview PDFs on screen are deliberately low-res (see Loaded). */
  async function buildFull(which: "art" | "mask" | "both") {
    setBuilding(true);
    try {
      const fonts = await fontsPromise;
      const assets: Assets = {
        fonts, logoSvg,
        texture: texture ? { bytes: texture.bytes, kind: texture.kind } : undefined,
        maskPng: mask?.bytes,
      };
      if (which !== "mask") saveBytes(await buildArtPdf(cfg, assets), `${cfg.beerName}.pdf`);
      if (which !== "art") saveBytes(await buildMaskPdf(cfg, assets), `${cfg.beerName}-mask.pdf`);
    } catch (err) {
      setBuildError(String(err));
    } finally {
      setBuilding(false);
    }
  }
  const downloadArt = () => void buildFull("art");
  const downloadMask = () => void buildFull("mask");
  // Shared by the sidebar "Export PDFs" button and the ⌘K palette action.
  const exportPdfs = () => void buildFull("both");

  function saveConfig() {
    const url = blobUrl(
      new TextEncoder().encode(JSON.stringify(toConfigFile(cfg), null, 2)),
      "application/json",
    );
    download(url, `${cfg.beerName || "label"}-config.json`);
    URL.revokeObjectURL(url);
  }

  async function loadConfig(f: File) {
    try {
      setCfg(parseConfigFile(await f.text()));
      setLoadError("");
    } catch (err) {
      setLoadError(String(err));
    }
  }

  return (
    <TooltipProvider>
      <main className="flex h-screen">
        <aside className="w-[430px] min-w-[380px] overflow-y-auto border-r border-border p-4">
          <h1 className="mb-3 text-base font-semibold">Lolev Label Generator</h1>
          <div className="flex gap-2">
            <FileDrop label="Texture PNG/JPG"
              accept={{ "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] }}
              fileName={texture?.name} previewUrl={texture?.previewUrl}
              onFile={(f) => void onTexture(f)} />
            <FileDrop label="Metallic mask PNG (optional)" accept={{ "image/png": [".png"] }}
              fileName={mask?.name} previewUrl={mask?.previewUrl} error={mask?.error}
              onFile={(f) => void onMask(f)} />
          </div>
          {loadError && <p className="mt-2 text-xs text-destructive">{loadError}</p>}
          <LabelForm cfg={cfg} errors={errors} update={update} />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  // span wrapper: a disabled button swallows the hover events
                  // the tooltip needs.
                  <span>
                    <Button size="sm" disabled={blocked || !pdfs} onClick={exportPdfs}>
                      Export PDFs
                    </Button>
                  </span>
                }
              />
              {blocked && <TooltipContent>{blockedWhy}</TooltipContent>}
            </Tooltip>
            <Button variant="ghost" size="sm" onClick={saveConfig}>Save config</Button>
            <Button variant="ghost" size="sm" onClick={() => configInput.current?.click()}>
              Load config
            </Button>
            <input ref={configInput} type="file" accept="application/json" hidden
              onChange={(e) => e.target.files?.[0] && void loadConfig(e.target.files[0])} />
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col p-3">
          <div className="mb-2 flex h-5 items-center gap-2">
            {building && (
              <span className="animate-pulse text-xs text-muted-foreground">building…</span>
            )}
            {buildError && <span className="text-xs text-destructive">{buildError}</span>}
            {!texture && !building && (
              <span className="text-xs text-muted-foreground">
                drop a texture to fill the background
              </span>
            )}
          </div>
          <div className="flex min-h-0 flex-1">
            <PreviewCompare ref={previewRef}
              artBytes={pdfs?.artBytes ?? null} maskBytes={pdfs?.maskBytes ?? null} />
          </div>
        </section>
        <CommandMenu
          actions={[
            { label: "Export PDFs (art + mask)", disabled: blocked || !pdfs, run: exportPdfs },
            { label: "Download art PDF", disabled: blocked || !pdfs, run: downloadArt },
            { label: "Download mask PDF", disabled: blocked || !pdfs, run: downloadMask },
            { label: "Save config", run: saveConfig },
            { label: "Load config", run: () => configInput.current?.click() },
            { label: "Preview: Art", run: () => previewRef.current?.showArt() },
            { label: "Preview: White-ink", run: () => previewRef.current?.showMask() },
          ]}
        />
      </main>
    </TooltipProvider>
  );
}
