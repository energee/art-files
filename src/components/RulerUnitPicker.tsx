// RulerUnitPicker.tsx — the Inches / Points / Pixels toggle for the ruler
// unit, shared by the ruler-corner settings (Rulers.tsx) and the status-bar
// size readout's menu (App.tsx), so both offer the same explicit choice over
// one unit state. Kept out of Rulers.tsx because App's DOM suites mock that
// module down to `Rulers` alone.
import type { RulerUnit } from "@/rulers";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function RulerUnitPicker(props: { unit: RulerUnit; onUnitChange: (unit: RulerUnit) => void }) {
  return (
    <ToggleGroup value={[props.unit]} spacing={0} variant="outline"
      className="w-full" aria-label="Ruler measurement units"
      onValueChange={(value) => {
        if (value[0]) props.onUnitChange(value[0] as RulerUnit);
      }}>
      <ToggleGroupItem value="in" size="sm" className="min-w-0 flex-1">Inches</ToggleGroupItem>
      <ToggleGroupItem value="pt" size="sm" className="min-w-0 flex-1">Points</ToggleGroupItem>
      <ToggleGroupItem value="px" size="sm" className="min-w-0 flex-1">Pixels</ToggleGroupItem>
    </ToggleGroup>
  );
}
