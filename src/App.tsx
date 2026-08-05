// App.tsx — owns all state: LabelConfig, texture/mask assets (full-res +
// preview-res pairs), validation, debounced preview-resolution PDF builds,
// overlay-compare preview, and on-demand full-resolution exports. Mirrors
// the old main.ts wiring, componentized.
import { useEffect, useMemo, useRef, useState } from "react";
import type { LabelConfig } from "@/types";
import type { ElementId } from "@/elements";
import type { Measure } from "@/hittest";
import { defaultConfig, parseConfigFile, toConfigFile } from "@/defaults";
import { validateUpc } from "@/upc";
import { validateMask, recolorMaskForPdf } from "@/maskimage";
import { buildArtPdf, buildMaskPdf, type Assets } from "@/pdf/build";
import { buildPsd, PSD_DOC, type PsdAssets } from "@/psd/build";
import { LabelForm } from "@/components/LabelForm";
import { StyleProperties } from "@/components/StyleProperties";
import { FileDrop } from "@/components/FileDrop";
import { CommandMenu } from "@/components/CommandMenu";
import { PreviewCompare, type PreviewCompareHandle } from "@/components/PreviewCompare";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  // Which element's contextual style panel is open — Photoshop's model, one
  // at a time, driven by whichever row in LabelForm (or now, PreviewCompare
  // itself) last got focus/click.
  const [selected, setSelected] = useState<ElementId | null>(null);
  // Open state for the sidebar's Export popover, closed explicitly by each
  // menu item's onClick (Base UI Popover doesn't close on its own here since
  // the items aren't Popover.Close — see the two exportOpen(false) below).
  const [exportOpen, setExportOpen] = useState(false);
  // Real glyph widths for PreviewCompare's click-to-select hit-testing (see
  // hittest.ts's Measure type) — null until the one-time font embed below
  // resolves; PreviewCompare skips hit-testing rather than guess with it.
  const [measure, setMeasure] = useState<Measure | null>(null);
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

  // Builds the real Measure hitTest needs, once: embed the faces into a
  // throwaway pdf-lib doc purely to read widthOfTextAtSize (never saved/
  // rendered). hitTest's `bold` flag can't tell one call site from another —
  // it's a single boolean, not a per-element hint — so it has to pick one
  // face to mean "true" for every caller. Reading src/pdf/build.ts's
  // drawElements: the wordmark and beer name always draw in the real Bold
  // face (font: fonts.bold, overriding line.bold entirely), but every other
  // bold-flagged element resolves to SemiBold — drawLine picks
  // fonts.semibold when line.bold (volume, a bold description line, the
  // style line), and drawRotated's handleAddress/storeCold calls hardcode
  // fonts.semibold outright, regardless of any style field. In the shipped
  // default config that's 4 semibold calls (volume, the "# HOPS" header,
  // handleAddress, storeCold) against 2 Bold calls (wordmark, name), and
  // Poppins SemiBold vs Bold widths differ by under 2.5% at every size this
  // label uses (measured with widthOfTextAtSize directly) — so `bold` here
  // backs SemiBold. That undermeasures the wordmark/name by a percent or
  // two, split evenly on both edges since both are centered; backing it
  // with Bold instead would OVERmeasure every left- or baseline-anchored
  // bold line (volume, handleAddress, storeCold, a bold description line)
  // on one side only, which is the worse failure mode for a click target.
  useEffect(() => {
    void (async () => {
      const { PDFDocument } = await import("pdf-lib");
      const fontkit = (await import("@pdf-lib/fontkit")).default;
      const fonts = await fontsPromise;
      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      const regular = await doc.embedFont(fonts.regular);
      const semibold = await doc.embedFont(fonts.semibold);
      setMeasure(() => (text: string, size: number, bold: boolean) =>
        (bold ? semibold : regular).widthOfTextAtSize(text, size));
    })();
  }, []);

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

  // Revoking immediately can abort a large download, so each URL lives until
  // the next export replaces it — a timer would instead pin a full Blob copy
  // of every export (tens of MB for the PSD) for its whole duration.
  const lastSaved = useRef<string | null>(null);
  function saveBytes(bytes: Uint8Array, name: string, type = "application/pdf") {
    if (lastSaved.current) URL.revokeObjectURL(lastSaved.current);
    const url = blobUrl(bytes, type);
    lastSaved.current = url;
    download(url, name);
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

  /** The PSD's texture layer needs raw RGBA at document size — PSD layers
   *  hold pixels 1:1, so the cover-fit happens here rather than in the
   *  builder. Only run on an explicit export, never in the preview loop:
   *  the full-size ImageData is ~60MB. */
  async function texturePixels(): Promise<PsdAssets["texture"]> {
    if (!texture) return undefined;
    const bmp = await createImageBitmap(new Blob([texture.bytes as unknown as BlobPart]));
    const canvas = document.createElement("canvas");
    canvas.width = PSD_DOC.w;
    canvas.height = PSD_DOC.h;
    const ctx = canvas.getContext("2d")!;
    const s = Math.max(canvas.width / bmp.width, canvas.height / bmp.height);
    const w = bmp.width * s;
    const h = bmp.height * s;
    ctx.drawImage(bmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    bmp.close();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: new Uint8Array(img.data.buffer), width: img.width, height: img.height };
  }

  /** Layered Photoshop file: editable type layers, vector logo/QR/barcode.
   *  Built full-resolution on demand, like the PDF exports. */
  async function exportPsd() {
    setBuilding(true);
    try {
      const fonts = await fontsPromise;
      const psd = await buildPsd(cfg, {
        fonts, logoSvg,
        texture: await texturePixels(),
      });
      saveBytes(psd, `${cfg.beerName}.psd`, "image/vnd.adobe.photoshop");
      setBuildError("");
    } catch (err) {
      setBuildError(String(err));
    } finally {
      setBuilding(false);
    }
  }

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
          <LabelForm cfg={cfg} errors={errors} update={update} selected={selected} onSelect={setSelected} />
          {selected && (
            <div className="mt-3">
              <StyleProperties id={selected} cfg={cfg} update={update} onClose={() => setSelected(null)} />
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  // span wrapper: a disabled button swallows the hover events
                  // the tooltip needs.
                  <span>
                    <Popover open={exportOpen} onOpenChange={setExportOpen}>
                      {/* Trigger disabled exactly when neither menu item below
                          could do anything (blocked); a mid-build !pdfs still
                          leaves PSD export usable, so it doesn't gate the menu
                          itself, only the PDF item. */}
                      <PopoverTrigger render={<Button size="sm" disabled={blocked}>Export</Button>} />
                      <PopoverContent align="start" className="w-56 gap-1 p-1">
                        <Button variant="ghost" size="sm" className="w-full justify-start"
                          disabled={blocked || !pdfs}
                          onClick={() => { setExportOpen(false); exportPdfs(); }}>
                          Print PDFs (art + mask)
                        </Button>
                        <Button variant="ghost" size="sm" className="w-full justify-start"
                          disabled={blocked}
                          onClick={() => { setExportOpen(false); void exportPsd(); }}>
                          Photoshop PSD
                        </Button>
                      </PopoverContent>
                    </Popover>
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
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-3 animate-spin rounded-full border border-muted-foreground/40 border-t-foreground" />
                rendering preview…
              </span>
            )}
            {buildError && <span className="text-xs text-destructive">{buildError}</span>}
            {!texture && !building && (
              <span className="text-xs text-muted-foreground">
                drop a texture to fill the background
              </span>
            )}
          </div>
          <div className="relative flex min-h-0 flex-1">
            <PreviewCompare ref={previewRef}
              artBytes={pdfs?.artBytes ?? null} maskBytes={pdfs?.maskBytes ?? null}
              cfg={cfg} measure={measure} selected={selected} onPick={setSelected} />
            {/* First-load state: until the first debounced build lands there is
                nothing on the canvases, so fill the empty frame with a spinner
                instead of a bare box. Later rebuilds keep the previous render
                visible and only show the small strip spinner above. */}
            {!pdfs && !buildError && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <span className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  <span className="text-xs">rendering label…</span>
                </div>
              </div>
            )}
          </div>
        </section>
        <CommandMenu
          actions={[
            { label: "Export PDFs (art + mask)", disabled: blocked || !pdfs, run: exportPdfs },
            { label: "Download art PDF", disabled: blocked || !pdfs, run: downloadArt },
            { label: "Download mask PDF", disabled: blocked || !pdfs, run: downloadMask },
            { label: "Export layered PSD", disabled: blocked, run: () => void exportPsd() },
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
