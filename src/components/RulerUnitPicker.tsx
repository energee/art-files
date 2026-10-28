// RulerUnitPicker.tsx — the Inches / Millimetres / Points / Pixels toggle for
// the app's one length unit (rulers.ts LengthUnit), shown in the ruler-corner
// settings (Rulers.tsx). View → Units offers the same four choices over the
// same state when the rulers are hidden. Kept out of Rulers.tsx because App's
// DOM suites mock that module down to `Rulers` alone.
import type { LengthUnit } from "@/rulers";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTranslation } from "@/i18n";

export function RulerUnitPicker(props: { unit: LengthUnit; onUnitChange: (unit: LengthUnit) => void }) {
  const { t } = useTranslation();
  return (
    <ToggleGroup value={[props.unit]} spacing={0} variant="outline"
      className="w-full" aria-label={t("Units")}
      onValueChange={(value) => {
        if (value[0]) props.onUnitChange(value[0] as LengthUnit);
      }}>
      <ToggleGroupItem value="in" size="sm" className="min-w-0 flex-1">{t("Inches")}</ToggleGroupItem>
      <ToggleGroupItem value="mm" size="sm" className="min-w-0 flex-1">{t("Millimetres")}</ToggleGroupItem>
      <ToggleGroupItem value="pt" size="sm" className="min-w-0 flex-1">{t("Points")}</ToggleGroupItem>
      <ToggleGroupItem value="px" size="sm" className="min-w-0 flex-1">{t("Pixels")}</ToggleGroupItem>
    </ToggleGroup>
  );
}
