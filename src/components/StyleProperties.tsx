// StyleProperties.tsx — the contextual style panel. Photoshop's model: it
// exists only while an element is selected, so the shipped defaults stay
// silent everywhere else. Fill, layer, bold and outer stroke live in this one
// persistent panel rather than a per-row popover, since only one element is
// ever selected at a time — no per-row id prefixing needed beyond what's
// already here for label/control association.
import { X } from "lucide-react";
import type { LabelConfig, Layer, StyledLine } from "@/types";
import { applyStyle, elementById, isDefaultStyle, type ElementId } from "@/elements";
import { defaultConfig } from "@/defaults";
import { ColorField } from "./ColorField";
import { ScrubField } from "./ScrubField";
import { machineName } from "@/qr";
import { DEFAULT_STROKE_PX } from "@/layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  // The element's shipped stroke colour, for the toggle below. "none" would
  // make switching it on a no-op, so fall back to the keyline black.
  const shipped = el.style(defaultConfig()).stroke;
  const shippedStroke = !shipped || shipped === "none" ? "#000000" : shipped;
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
      letterSpacing: d.letterSpacing,
      ...(el.hasBold ? { bold: (d as StyledLine).bold ?? false } : {}),
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{el.label}</span>
        <div className="flex items-center gap-1">
          {!isDefaultStyle(props.id, s) && (
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

      {el.isText && (
        // Clamped both ends by ScrubField: tracking wide enough to overrun
        // the label reads as a broken line, not a style.
        <ScrubField
          id={`${fid}-tracking`} label="Tracking" unit="pt"
          value={s.letterSpacing ?? 0} min={-2} max={20} step={0.01} dragStep={0.1}
          onChange={(v) => set({ letterSpacing: v })}
        />
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${fid}-stroke`} className="text-xs text-muted-foreground">Outer stroke</Label>
          <Checkbox
            id={`${fid}-stroke`}
            checked={strokeOn}
            // Switching a stroke on starts at whatever THIS element ships
            // with — black for everything keylined, the barcode's white halo
            // for the barcode — so defaults.ts stays the only place that
            // decides, and a new element needs no case here.
            onCheckedChange={(v) => set({ stroke: v === true ? shippedStroke : "none" })}
          />
        </div>
        {strokeOn && (
          <>
            <ColorField id={`${fid}-stroke-color`} value={s.stroke!} onChange={(v) => set({ stroke: v })} allowNone={false} />
            {/* Clamped at 60px by ScrubField: each extra px adds stroke draw
                calls, and ring()'s sample ceiling is sized for that limit. */}
            <ScrubField
              id={`${fid}-stroke-width`} label="Width" unit="px"
              value={s.strokeWidth ?? DEFAULT_STROKE_PX} min={1} max={60} step={1}
              onChange={(v) => set({ strokeWidth: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}
