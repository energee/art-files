// App.tsx — owns all state: LabelConfig, texture/mask assets, validation,
// debounced PDF generation, preview mode, and downloads. Mirrors the old
// main.ts wiring, componentized.
import { useEffect, useMemo, useRef, useState } from "react";
import type { LabelConfig } from "@/types";
import { defaultConfig, parseConfigFile, toConfigFile } from "@/defaults";
import { validateUpc } from "@/upc";
import { validateMask, recolorMaskForPdf } from "@/maskimage";
import { buildArtPdf, buildMaskPdf, type Assets } from "@/pdf/build";
import { LabelForm } from "@/components/LabelForm";
import { FileDrop } from "@/components/FileDrop";
import { CommandMenu } from "@/components/CommandMenu";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import poppinsRegular from "@/assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "@/assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "@/assets/fonts/Poppins-Bold.ttf?url";
import logoSvg from "@/assets/logo2025.svg?raw";

type Loaded = { bytes: Uint8Array; name: string; previewUrl: string };

const fontsPromise = (async () => {
  const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const [regular, semibold, bold] = await Promise.all([
    get(poppinsRegular), get(poppinsSemiBold), get(poppinsBold),
  ]);
  return { regular, semibold, bold };
})();

const blobUrl = (bytes: Uint8Array, type: string) =>
  URL.createObjectURL(new Blob([bytes.slice() as unknown as BlobPart], { type }));

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
  const [pdfs, setPdfs] = useState<{ art: string; mask: string } | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<"art" | "mask" | "split">("split");
  const configInput = useRef<HTMLInputElement>(null);

  const update = (fn: (c: LabelConfig) => void) =>
    setCfg((c) => { const n = structuredClone(c); fn(n); return n; });

  const upc = useMemo(() => validateUpc(cfg.upc), [cfg.upc]);
  const errors: Record<string, string> = {};
  if (!upc.ok) errors.upc = upc.error!;
  if (!cfg.beerName.trim()) errors.name = "Beer name is required.";
  const blocked = !texture || !mask || !!mask.error || !upc.ok || !cfg.beerName.trim();
  const blockedWhy = [
    !texture && "drop a texture image",
    !mask && "drop a metallic mask PNG",
    mask?.error, errors.upc, errors.name,
  ].filter(Boolean).join(" · ");

  async function onTexture(f: File) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const previewUrl = URL.createObjectURL(f);
    setTexture((old) => {
      if (old) URL.revokeObjectURL(old.previewUrl);
      return {
        bytes, name: f.name, kind: /\.jpe?g$/i.test(f.name) ? "jpg" : "png",
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
    const previewUrl = URL.createObjectURL(f);
    setMask((old) => {
      if (old) URL.revokeObjectURL(old.previewUrl);
      return {
        bytes,
        name: f.name,
        previewUrl,
        error: check.ok ? undefined : check.error,
      };
    });
  }

  // Debounced regeneration on any input change.
  useEffect(() => {
    if (blocked) return;
    let stale = false;
    const timer = setTimeout(async () => {
      setBuilding(true);
      try {
        const fonts = await fontsPromise;
        const assets: Assets = {
          fonts, logoSvg,
          texture: { bytes: texture!.bytes, kind: texture!.kind },
          maskPng: mask!.bytes,
        };
        const [art, maskPdf] = await Promise.all([
          buildArtPdf(cfg, assets), buildMaskPdf(cfg, assets),
        ]);
        if (stale) return;
        setPdfs((old) => {
          if (old) { URL.revokeObjectURL(old.art); URL.revokeObjectURL(old.mask); }
          return { art: blobUrl(art, "application/pdf"), mask: blobUrl(maskPdf, "application/pdf") };
        });
        setBuildError("");
      } catch (err) {
        if (!stale) setBuildError(String(err));
      } finally {
        if (!stale) setBuilding(false);
      }
    }, 600);
    return () => { stale = true; clearTimeout(timer); };
  }, [cfg, texture, mask, blocked]);

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

  const preview = (kind: "art" | "mask", caption: string) => (
    <figure className="flex min-h-0 flex-1 flex-col">
      <figcaption className="mb-1 text-xs text-muted-foreground">{caption}</figcaption>
      <embed
        src={pdfs?.[kind]}
        type="application/pdf"
        className="min-h-0 w-full flex-1 rounded-md border border-border bg-input"
      />
    </figure>
  );

  return (
    <TooltipProvider>
      <main className="flex h-screen">
        <aside className="w-[430px] min-w-[380px] overflow-y-auto border-r border-border p-4">
          <h1 className="mb-3 text-base font-semibold">Lolev Label Generator</h1>
          <div className="flex gap-2">
            <FileDrop label="Texture PNG/JPG" accept="image/png,image/jpeg"
              fileName={texture?.name} previewUrl={texture?.previewUrl}
              onFile={(f) => void onTexture(f)} />
            <FileDrop label="Metallic mask PNG" accept="image/png"
              fileName={mask?.name} previewUrl={mask?.previewUrl} error={mask?.error}
              onFile={(f) => void onMask(f)} />
          </div>
          {loadError && <p className="mt-2 text-xs text-destructive">{loadError}</p>}
          <LabelForm cfg={cfg} errors={errors} update={update} />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" disabled={blocked || !pdfs}
                    onClick={() => {
                      if (!pdfs) return;
                      download(pdfs.art, `${cfg.beerName}.pdf`);
                      download(pdfs.mask, `${cfg.beerName}-mask.pdf`);
                    }}>
                    Export PDFs
                  </Button>
                </span>
              </TooltipTrigger>
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
          <div className="mb-2 flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
              <TabsList>
                <TabsTrigger value="art">Art</TabsTrigger>
                <TabsTrigger value="mask">White-ink</TabsTrigger>
                <TabsTrigger value="split">Split</TabsTrigger>
              </TabsList>
            </Tabs>
            {building && (
              <span className="animate-pulse text-xs text-muted-foreground">building…</span>
            )}
            {buildError && <span className="text-xs text-destructive">{buildError}</span>}
          </div>
          <div className="flex min-h-0 flex-1 gap-3">
            {view !== "mask" && preview("art", "Art")}
            {view !== "art" && preview("mask", "White-ink layer")}
          </div>
        </section>
        <CommandMenu
          actions={[
            { label: "Download art PDF", disabled: blocked || !pdfs,
              run: () => pdfs && download(pdfs.art, `${cfg.beerName}.pdf`) },
            { label: "Download mask PDF", disabled: blocked || !pdfs,
              run: () => pdfs && download(pdfs.mask, `${cfg.beerName}-mask.pdf`) },
            { label: "Save config", run: saveConfig },
            { label: "Load config", run: () => configInput.current?.click() },
            { label: "Preview: Art", run: () => setView("art") },
            { label: "Preview: White-ink", run: () => setView("mask") },
            { label: "Preview: Split", run: () => setView("split") },
          ]}
        />
      </main>
    </TooltipProvider>
  );
}
