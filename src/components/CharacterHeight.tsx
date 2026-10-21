// CharacterHeight.tsx — editable minimum and maximum printed character heights,
// characters per inch (what they measure sits behind an info button), and a
// warning naming any character the layer's font cannot print.
import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { TextLayer } from "@/model/layers";
import type { FontFamilyId } from "@/fontCatalog";
import type * as Heights from "@/textheight";
import { errMsg } from "@/lib/utils";
import { ScrubField } from "./ScrubField";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** What the heights and CPI measure, behind the info button. */
const HEIGHT_ABOUT = "Highest line average, estimated. Counts letters, numbers and punctuation; spaces contribute width. "
  + "Letters and numbers at print size, excluding outlines. Updates when text changes.";

export function CharacterHeight({ layer, family, onChange }: {
  layer: TextLayer; family: FontFamilyId; onChange: (size: number) => void;
}) {
  const [loaded, setLoaded] = useState<Heights.TextChecks & {
    sizeForMinimum: typeof Heights.sizeForMinimum; describeCodepoints: typeof Heights.describeCodepoints;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError("");
    void import("@/textheight").then(async (module) => ({
      ...await module.loadTextChecks(family),
      sizeForMinimum: module.sizeForMinimum, describeCodepoints: module.describeCodepoints,
    })).then((result) => { if (!cancelled) setLoaded(result); })
      .catch((reason) => { if (!cancelled) setError(errMsg(reason)); });
    return () => { cancelled = true; };
  }, [family]);
  let range: Heights.CharacterHeights | null = null;
  let message = error;
  let missing: number[] = [];
  if (loaded) {
    try { missing = loaded.missingGlyphs(layer); range = loaded.measure(layer); }
    catch (reason) { message = errMsg(reason); }
  }
  // Export refuses these characters; say so while the text is being typed.
  const glyphWarning = loaded && missing.length > 0 && <p role="alert" className="text-xs text-warning-text">
    This font cannot print {loaded.describeCodepoints(missing)}. Replace them or choose another font.
  </p>;
  if (message) return <>{glyphWarning}<p role="status" className="text-xs text-warning-text">Character height unavailable: {message}</p></>;
  if (!loaded) return <p role="status" className="text-xs text-muted-foreground">Measuring character height…</p>;
  if (!range) return <>{glyphWarning}<p className="text-xs text-muted-foreground">Add letters or numbers to measure their printed height.</p></>;
  return <div className="space-y-1">
    {glyphWarning}
    <ScrubField id={`${layer.id}-min-character-height`} label="Minimum height" unit="mm"
      unitTitle="Character height is always millimetres"
      value={Math.floor((range.min + 1e-9) * 100) / 100}
      min={0.01} max={Math.max(0.01, Math.floor(range.min / layer.size * 300 * 100) / 100)}
      step={0.01} dragStep={0.01}
      onChange={(mm) => onChange(loaded.sizeForMinimum(layer.size, range.min, mm))} />
    <p className="text-[11px] text-muted-foreground">
      Tallest character: {(Math.ceil((range.max - 1e-9) * 100) / 100).toFixed(2)} mm
    </p>
    <p className="flex items-center gap-1 text-xs">Characters per inch: <strong>{range.cpi.toFixed(1)}</strong>
      {/* The explanation behind an info button, announced through
          aria-describedby (a bare `title` is not reliably read out). The
          sr-only span is the one accessible copy; the tooltip is visual only. */}
      <Tooltip>
        <TooltipTrigger render={
          <button type="button" aria-label="About character height" aria-describedby={`${layer.id}-height-about`}
            className="inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Info className="size-3" aria-hidden="true" />
          </button>} />
        <TooltipContent className="block" aria-hidden="true">{HEIGHT_ABOUT}</TooltipContent>
      </Tooltip>
    </p>
    <span id={`${layer.id}-height-about`} className="sr-only">{HEIGHT_ABOUT}</span>
  </div>;
}
