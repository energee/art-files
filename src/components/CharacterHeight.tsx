// CharacterHeight.tsx — editable minimum and maximum printed character heights.
import { useEffect, useState } from "react";
import type { TextLayer } from "@/model/layers";
import type { FontFamilyId } from "@/fontCatalog";
import type * as Heights from "@/textheight";
import { ScrubField } from "./ScrubField";

export function CharacterHeight({ layer, family, onChange }: {
  layer: TextLayer; family: FontFamilyId; onChange: (size: number) => void;
}) {
  const [loaded, setLoaded] = useState<{ measure: Heights.HeightMeasure; sizeForMinimum: typeof Heights.sizeForMinimum } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError("");
    void import("@/textheight").then(async (module) => ({
      measure: await module.loadHeightMeasure(family), sizeForMinimum: module.sizeForMinimum,
    })).then((result) => { if (!cancelled) setLoaded(result); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [family]);
  let range: Heights.CharacterHeights | null = null;
  let message = error;
  if (loaded) {
    try { range = loaded.measure(layer); }
    catch (reason) { message = String(reason); }
  }
  if (message) return <p role="status" className="text-xs text-warning-text">Character height unavailable: {message}</p>;
  if (!loaded) return <p role="status" className="text-xs text-muted-foreground">Measuring character height…</p>;
  if (!range) return <p className="text-xs text-muted-foreground">Add letters or numbers to measure their printed height.</p>;
  return <div className="space-y-1">
    <ScrubField id={`${layer.id}-min-character-height`} label="Minimum height" unit="mm"
      value={Math.floor((range.min + 1e-9) * 100) / 100}
      min={0.01} max={Math.max(0.01, Math.floor(range.min / layer.size * 300 * 100) / 100)}
      step={0.01} dragStep={0.01}
      onChange={(mm) => onChange(loaded.sizeForMinimum(layer.size, range.min, mm))} />
    <p className="text-[11px] text-muted-foreground">
      Tallest character: {(Math.ceil((range.max - 1e-9) * 100) / 100).toFixed(2)} mm
    </p>
    <p className="text-xs">Characters per inch: <strong>{range.cpi.toFixed(1)}</strong></p>
    <p className="text-[11px] text-muted-foreground">Highest line average, estimated. Counts letters, numbers and punctuation; spaces contribute width.</p>
    <p className="text-[11px] text-muted-foreground">Letters and numbers at print size, excluding outlines. Updates when text changes.</p>
  </div>;
}
