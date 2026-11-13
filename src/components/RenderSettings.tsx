// RenderSettings.tsx — the fields on the Settings page, in the groups the
// sidebar lists (SETTINGS_GROUPS): Language, Output (what gets built) and
// Can preview (how the 3D can presents it). The theme lives in
// View → Appearance and the ⌘K palette.
import { LABEL_SHORT_IN, LABEL_WIDE_IN } from "@/layout";
import { BLEED_DRAG_STEP_IN, BLEED_STEP_IN, displayBleedIn, SETTINGS_GROUPS, type RenderSettings as Settings } from "@/settings";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScrubField } from "./ScrubField";
import { useTranslation } from "@/i18n";
import { languages, useLanguage, type LanguagePreference } from "@/i18n";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

/** `id` is a SETTINGS_GROUPS id: the sidebar scrolls to `#settings-<id>`. */
function Group({ id, title, children }: { id: (typeof SETTINGS_GROUPS)[number]["id"]; title: string; children: React.ReactNode }) {
  return <fieldset id={`settings-${id}`} className="scroll-mt-4 space-y-3">
    <legend className="mb-2 text-xs font-medium text-foreground">{title}</legend>
    {children}
  </fieldset>;
}

export function RenderSettings({ value, onChange }: { value: Settings; onChange: (v: Settings) => void }) {
  const { t } = useTranslation();
  const { preference, setLanguage } = useLanguage();
  const languageItems = [{ value: "system", label: t("Use system language") }, ...languages];
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  // Quiet fields: a box shows only on the one you point at or are in.
  const quiet = "[&_[data-slot=input-group]:not(:hover,:focus-within)]:border-transparent [&_[data-slot=input-group]:not(:hover,:focus-within)]:bg-transparent!"
    + " [&_[data-slot=select-trigger]:not(:hover,:focus-visible)]:border-transparent [&_[data-slot=select-trigger]:not(:hover,:focus-visible)]:bg-transparent!";
  return <div className={`flex flex-col gap-6 ${quiet}`}>
    <Group id="language" title={t("Language")}>
      <Select items={languageItems} value={preference}
        onValueChange={(language) => { if (language) void setLanguage(language as LanguagePreference); }}>
        <SelectTrigger aria-label={t("Language")} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {languageItems.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Group>
    <Group id="output" title={t("Output")}>
      <ScrubField id="doc-dpi" label={t("PSD resolution")} unit="dpi" value={value.dpi}
        min={72} max={1200} step={50} dragStep={10} onChange={(dpi) => set({ dpi })} />
      <ScrubField id="doc-bleed" label={t("Bleed")} unit={'"'} value={displayBleedIn(value.bleedIn)}
        min={0} max={0.5} step={BLEED_STEP_IN} dragStep={BLEED_DRAG_STEP_IN}
        onChange={(bleedIn) => set({ bleedIn })} />
      {/* Both outcomes are named, so nobody has to work out what "on"
          means. Stored as twoFilePdfExport, as the switch it replaced was. */}
      <div className="flex items-center justify-between gap-3 touch:min-h-tap">
        <span id="export-as" className="text-xs text-muted-foreground">{t("Export as")}</span>
        <ToggleGroup aria-labelledby="export-as" spacing={0} variant="outline"
          value={[value.twoFilePdfExport ? "pair" : "one"]}
          onValueChange={(side) => { if (side[0]) set({ twoFilePdfExport: side[0] === "pair" }); }}>
          <ToggleGroupItem value="one" size="sm">{t("One file")}</ToggleGroupItem>
          <ToggleGroupItem value="pair" size="sm">{t("Art + mask")}</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </Group>
    <Group id="can-preview" title={t("Can preview")}>
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
