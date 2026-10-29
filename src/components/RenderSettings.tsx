// RenderSettings.tsx — the retained press controls, opened from Settings, in
// two groups: Output (what gets built) and Can preview (how the 3D can
// presents it). The theme lives in View → Appearance and the ⌘K palette.
import { LABEL_SHORT_IN, LABEL_WIDE_IN } from "@/layout";
import { BLEED_DRAG_STEP_IN, BLEED_STEP_IN, displayBleedIn, type RenderSettings as Settings } from "@/settings";
import { Switch } from "@/components/ui/switch";
import { ScrubField } from "./ScrubField";
import { useTranslation } from "@/i18n";
import { languages, useLanguage, type LanguagePreference } from "@/i18n";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <fieldset className="space-y-3">
    <legend className="mb-2 text-xs font-medium text-foreground">{title}</legend>
    {children}
  </fieldset>;
}

export function RenderSettings({ value, onChange }: { value: Settings; onChange: (v: Settings) => void }) {
  const { t } = useTranslation();
  const { preference, setLanguage } = useLanguage();
  const languageItems = [{ value: "system", label: t("Use system language") }, ...languages];
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  return <div className="flex flex-col gap-4">
    <Group title={t("Language")}>
      <Select items={languageItems} value={preference}
        onValueChange={(language) => { if (language) setLanguage(language as LanguagePreference); }}>
        <SelectTrigger aria-label={t("Language")} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {languageItems.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{t("Only the app interface changes. Your label stays as it is.")}</p>
    </Group>
    <Group title={t("Output")}>
      <ScrubField id="doc-dpi" label={t("PSD resolution")} unit="dpi" value={value.dpi}
        min={72} max={1200} step={50} dragStep={10} onChange={(dpi) => set({ dpi })} />
      <ScrubField id="doc-bleed" label={t("Bleed")} unit={'"'} value={displayBleedIn(value.bleedIn)}
        min={0} max={0.5} step={BLEED_STEP_IN} dragStep={BLEED_DRAG_STEP_IN}
        onChange={(bleedIn) => set({ bleedIn })} />
      <div className="flex items-start justify-between gap-3">
        <label htmlFor="two-file-pdf" className="flex flex-col gap-1">
          <span>{t("Two-file export (art + mask)")}</span>
          <span className="text-xs text-muted-foreground">{t("⌘E and ⇧⌘E save the art and mask as separate files, instead of one file with White Ink inside.")}</span>
        </label>
        <Switch id="two-file-pdf" nativeButton render={<button type="button" />}
          aria-label={t("Two-file export (art + mask)")} checked={value.twoFilePdfExport}
          onCheckedChange={(twoFilePdfExport) => set({ twoFilePdfExport: twoFilePdfExport === true })} />
      </div>
    </Group>
    <Group title={t("Can preview")}>
      <ScrubField id="doc-corner-radius" label={t("Corner radius")} unit={'"'}
        value={Number((value.cornerRadius * LABEL_SHORT_IN / 100).toFixed(4))}
        min={0} max={LABEL_SHORT_IN * 0.05} step={0.0625}
        onChange={(v) => set({ cornerRadius: v / LABEL_SHORT_IN * 100 })} />
      <ScrubField id="doc-edge-softness" label={t("Edge softness")} unit={'"'}
        value={Number((value.edgeSoftness * LABEL_WIDE_IN / 100).toFixed(3))}
        min={0} max={LABEL_WIDE_IN * 0.01} step={0.001}
        onChange={(v) => set({ edgeSoftness: v / LABEL_WIDE_IN * 100 })} />
    </Group>
  </div>;
}
