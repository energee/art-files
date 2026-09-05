// RenderSettings.tsx — the retained press and appearance controls, opened from Settings.
import { LABEL_SHORT_IN, LABEL_WIDE_IN } from "@/layout";
import { BLEED_DRAG_STEP_IN, BLEED_STEP_IN, displayBleedIn, type RenderSettings as Settings } from "@/settings";
import { ScrubField } from "./ScrubField";
import { ThemeSwitch } from "./ThemeSwitch";

export function RenderSettings({ value, onChange }: { value: Settings; onChange: (v: Settings) => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  return <div className="space-y-3">
    <ScrubField id="doc-corner-radius" label="Corner radius" unit={'"'}
      value={Number((value.cornerRadius * LABEL_SHORT_IN / 100).toFixed(4))}
      min={0} max={LABEL_SHORT_IN * 0.05} step={0.0625}
      onChange={(v) => set({ cornerRadius: v / LABEL_SHORT_IN * 100 })} />
    <ScrubField id="doc-edge-softness" label="Edge softness" unit={'"'}
      value={Number((value.edgeSoftness * LABEL_WIDE_IN / 100).toFixed(3))}
      min={0} max={LABEL_WIDE_IN * 0.01} step={0.001}
      onChange={(v) => set({ edgeSoftness: v / LABEL_WIDE_IN * 100 })} />
    <ScrubField id="doc-dpi" label="Resolution" unit="dpi" value={value.dpi}
      min={72} max={1200} step={50} dragStep={10} onChange={(dpi) => set({ dpi })} />
    <ScrubField id="doc-bleed" label="Bleed" unit={'"'} value={displayBleedIn(value.bleedIn)}
      min={0} max={0.5} step={BLEED_STEP_IN} dragStep={BLEED_DRAG_STEP_IN}
      onChange={(bleedIn) => set({ bleedIn })} />
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">Appearance</span><ThemeSwitch />
    </div>
  </div>;
}
