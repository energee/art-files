// RenderSettings.tsx — the retained press controls, opened from Settings, in
// two groups: Output (what gets built) and Can preview (how the 3D can
// presents it). The theme lives in View → Appearance and the ⌘K palette.
import { LABEL_SHORT_IN, LABEL_WIDE_IN } from "@/layout";
import { BLEED_DRAG_STEP_IN, BLEED_STEP_IN, displayBleedIn, type RenderSettings as Settings } from "@/settings";
import { Switch } from "@/components/ui/switch";
import { ScrubField } from "./ScrubField";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <fieldset className="space-y-3">
    <legend className="mb-2 text-xs font-medium text-foreground">{title}</legend>
    {children}
  </fieldset>;
}

export function RenderSettings({ value, onChange }: { value: Settings; onChange: (v: Settings) => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  return <div className="space-y-4">
    <Group title="Output">
      <ScrubField id="doc-dpi" label="PSD resolution" unit="dpi" value={value.dpi}
        min={72} max={1200} step={50} dragStep={10} onChange={(dpi) => set({ dpi })} />
      <ScrubField id="doc-bleed" label="Bleed" unit={'"'} value={displayBleedIn(value.bleedIn)}
        min={0} max={0.5} step={BLEED_STEP_IN} dragStep={BLEED_DRAG_STEP_IN}
        onChange={(bleedIn) => set({ bleedIn })} />
      <div className="flex items-start justify-between gap-3">
        <label htmlFor="two-file-pdf" className="flex flex-col gap-1">
          <span>Two-file PDF export (art + mask)</span>
          <span className="text-xs text-muted-foreground">Show the legacy separate art and mask PDF exports.</span>
        </label>
        <Switch id="two-file-pdf" nativeButton render={<button type="button" />}
          aria-label="Two-file PDF export (art + mask)" checked={value.twoFilePdfExport}
          onCheckedChange={(twoFilePdfExport) => set({ twoFilePdfExport: twoFilePdfExport === true })} />
      </div>
    </Group>
    <Group title="Can preview">
      <ScrubField id="doc-corner-radius" label="Corner radius" unit={'"'}
        value={Number((value.cornerRadius * LABEL_SHORT_IN / 100).toFixed(4))}
        min={0} max={LABEL_SHORT_IN * 0.05} step={0.0625}
        onChange={(v) => set({ cornerRadius: v / LABEL_SHORT_IN * 100 })} />
      <ScrubField id="doc-edge-softness" label="Edge softness" unit={'"'}
        value={Number((value.edgeSoftness * LABEL_WIDE_IN / 100).toFixed(3))}
        min={0} max={LABEL_WIDE_IN * 0.01} step={0.001}
        onChange={(v) => set({ edgeSoftness: v / LABEL_WIDE_IN * 100 })} />
    </Group>
  </div>;
}
