// PresetBar.tsx — the inspector's preset controls: pick a saved style or
// barcode, or save the current one. Backed by presets.json through
// src/presets.ts, so a saved preset outlives the browser profile.
//
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import {
  barcodeLabel, loadPresets, savePresets, upsertBy,
  EMPTY_PRESETS, type BarcodePreset, type Presets,
} from "@/presets";

/** Loads presets.json once and exposes a writer that persists the whole
 *  library. A failed write surfaces as a message: silently dropping it would
 *  look identical to a successful save. `reload` re-reads the file so a second
 *  copy of the hook (ColorField's swatches) picks up what another copy just
 *  saved, without a remount. */
export function usePresets() {
  const [presets, setPresets] = React.useState<Presets>(EMPTY_PRESETS);
  const [error, setError] = React.useState("");
  const reload = React.useCallback(() => { void loadPresets().then(setPresets); }, []);
  React.useEffect(reload, [reload]);

  const commit = (next: Presets) => {
    setPresets(next);
    savePresets(next).then(() => setError(""), (e: Error) => setError(e.message));
  };
  return { presets, commit, error, reload };
}

/** The pickers are action lists, not fields: they never display a selection
 *  (the element's own controls are the state), so the trigger carries fixed
 *  prompt text and `value` is pinned to null. */
function PresetSelect(props: {
  prompt: string;
  values: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  return (
    <Select value={null} onValueChange={(v) => { if (v) props.onPick(String(v)); }}>
      <SelectTrigger size="sm" aria-label={props.prompt}
        className="h-6 w-full justify-between text-xs">
        <span className="text-muted-foreground">{props.prompt}</span>
      </SelectTrigger>
      <SelectContent>
        {props.values.map((v) => (
          <SelectItem key={v.value} value={v.value} className="text-xs">
            {v.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Beer-style presets for the Style line ("Hazy IPA", "Pilsner"). The text is
 *  its own label, so Save takes what's already in the field — there is
 *  nothing extra to name. */
export function BeerStylePresetBar(props: {
  current: string;
  onApply: (text: string) => void;
}) {
  const { presets, commit, error } = usePresets();
  const text = props.current.trim();
  const saved = presets.styles.includes(text);

  const save = () => {
    if (!text || saved) return;
    commit({ ...presets, styles: [...presets.styles, text] });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <PresetSelect
          prompt="Saved styles…"
          values={presets.styles.map((s) => ({ value: s, label: s }))}
          onPick={props.onApply}
        />
        {/* Disabled once this exact text is in the library: a second save
            would be a no-op, and a dead button says so up front. */}
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]"
          disabled={!text || saved} onClick={save}>
          Save
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Barcode presets. The label is optional — the digits identify the entry, so
 *  an unnamed barcode is still savable and still findable. */
export function BarcodePresetBar(props: {
  upc: string;
  onApply: (upc: string) => void;
}) {
  const { presets, commit, error } = usePresets();
  const [name, setName] = React.useState("");

  const save = () => {
    if (!props.upc) return;
    const trimmed = name.trim();
    const item: BarcodePreset = trimmed
      ? { name: trimmed, upc: props.upc }
      : { upc: props.upc };
    commit({ ...presets, barcodes: upsertBy(presets.barcodes, item, (b) => b.upc) });
    setName("");
  };

  return (
    <div className="space-y-1">
      <PresetSelect
        prompt="Saved barcodes…"
        values={presets.barcodes.map((b) => ({ value: b.upc, label: barcodeLabel(b) }))}
        onPick={props.onApply}
      />
      <div className="flex items-center gap-1">
        <Input
          className="h-6 min-w-0 flex-1 text-xs" placeholder="Label (optional)"
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]"
          disabled={!props.upc} onClick={save}>
          Save
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
