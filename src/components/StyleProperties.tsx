// StyleProperties.tsx — the contextual style panel. Photoshop's model: it
// exists only while an element is selected, so the gold/metallic defaults
// stay silent everywhere else. Controls mirror StylePopover's (fill, layer,
// bold, outer stroke) in a persistent panel instead of a popover, since only
// one element is ever selected at a time — no per-row id prefixing needed
// beyond what's already here for label/control association.
import { X } from "lucide-react";
import type { LabelConfig, Layer, StyledLine } from "@/types";
import { applyStyle, elementById, isDefaultStyle, type ElementId } from "@/elements";
import { defaultConfig } from "@/defaults";
import { ColorField } from "./ColorField";
import { machineName } from "@/qr";
import { DEFAULT_STROKE_PX } from "@/layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function StyleProperties(props: {
  id: ElementId;
  cfg: LabelConfig;
  update: (fn: (c: LabelConfig) => void) => void;
  onClose: () => void;
}) {
  const el = elementById(props.id);
  const s = el.style(props.cfg);
  // `s` is declared Style, but for hasBold elements the live object backing
  // it is actually a StyledLine (see elements.ts's ELEMENTS/applyStyle
  // comments) — the cast only ever runs when hasBold confirms that shape.
  const bold = el.hasBold ? ((s as StyledLine).bold ?? false) : false;
  const set = (patch: Partial<StyledLine>) =>
    props.update((c) => applyStyle(c, props.id, patch));
  const strokeOn = !!s.stroke && s.stroke !== "none";
  const fid = machineName(el.label); // prefixes this panel's control ids

  // Restores this element's shipped appearance — read from defaultConfig(),
  // not a hardcoded gold/metallic/none triple, so elements that ship with a
  // deliberate deviation (the logo's dark keyline) reset to THEIR default
  // rather than losing it.
  const reset = () => {
    const d = el.style(defaultConfig());
    set({
      fill: d.fill,
      layer: d.layer,
      stroke: d.stroke ?? "none",
      strokeWidth: d.strokeWidth,
      ...(el.hasBold ? { bold: (d as StyledLine).bold ?? false } : {}),
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{el.label}</span>
        <div className="flex items-center gap-1">
          {!isDefaultStyle(s) && (
            <Button
              variant="ghost" size="sm" className="h-6 px-2 text-[11px]"
              onClick={reset}
            >
              Reset
            </Button>
          )}
          <Button
            variant="ghost" size="icon" className="size-6"
            aria-label="Close" onClick={props.onClose}
          >
            <X className="size-3" />
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${fid}-fill`} className="text-xs text-muted-foreground">Fill</Label>
        <ColorField
          id={`${fid}-fill`} value={s.fill} onChange={(v) => set({ fill: v })}
          allowNone={el.allowNone}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor={`${fid}-layer`} className="text-xs text-muted-foreground">Layer</Label>
        <Select value={s.layer} onValueChange={(v) => set({ layer: v as Layer })}>
          <SelectTrigger id={`${fid}-layer`} className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="metallic">metallic</SelectItem>
            <SelectItem value="white">white</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {el.hasBold && (
        <div className="flex items-center justify-between">
          <Label htmlFor={`${fid}-bold`} className="text-xs text-muted-foreground">Bold</Label>
          <Checkbox
            id={`${fid}-bold`}
            checked={bold}
            onCheckedChange={(v) => set({ bold: v === true })}
          />
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${fid}-stroke`} className="text-xs text-muted-foreground">Outer stroke</Label>
          <Checkbox
            id={`${fid}-stroke`}
            checked={strokeOn}
            onCheckedChange={(v) => set({ stroke: v === true ? "#FFFFFF" : "none" })}
          />
        </div>
        {strokeOn && (
          <div className="flex items-center gap-1">
            <ColorField id={`${fid}-stroke-color`} value={s.stroke!} onChange={(v) => set({ stroke: v })} allowNone={false} />
            <Input
              type="number" min={1} max={60}
              id={`${fid}-stroke-width`}
              aria-label="Stroke width (px at 600dpi)"
              className="h-6 w-14 text-xs"
              value={s.strokeWidth ?? DEFAULT_STROKE_PX}
              onChange={(e) =>
                // Clamp BOTH ends: `max` on a number input does not stop a
                // typed value, and each extra px adds stroke draw calls.
                set({ strokeWidth: Math.min(60, Math.max(1, Number(e.target.value) || DEFAULT_STROKE_PX)) })}
            />
            <span className="text-[10px] text-muted-foreground">px</span>
          </div>
        )}
      </div>
    </div>
  );
}
