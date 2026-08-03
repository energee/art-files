// StylePopover.tsx — a row's single visible style control: a swatch chip
// showing the current fill; its popover holds the full editor (ColorField,
// layer select, optional bold toggle, optional QR stroke section).
import type { Fill, Layer } from "@/types";
import { CHECKER, ColorField } from "./ColorField";
import { DEFAULT_STROKE_PX } from "@/layout";
import { machineName } from "@/qr";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function StylePopover(props: {
  label: string;
  fill: Fill;
  layer: Layer;
  onFill: (v: Fill) => void;
  onLayer: (v: Layer) => void;
  bold?: boolean;
  onBold?: (v: boolean) => void;
  stroke?: Fill;
  onStroke?: (v: Fill) => void;
  strokeWidth?: number;
  onStrokeWidth?: (v: number) => void;
  allowNone?: boolean;
  /** id for the trigger chip, so a row Label can point at it. */
  id?: string;
}) {
  const strokeOn = !!props.stroke && props.stroke !== "none";
  const fid = machineName(props.label); // per-row prefix for control ids
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            id={props.id}
            aria-label={`${props.label} style`}
            className="size-6 shrink-0 rounded-sm"
            style={
              props.fill === "none"
                ? { background: CHECKER }
                : { background: props.fill }
            }
          />
        }
      />
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        <div className="space-y-1">
          <Label htmlFor={`${fid}-fill`} className="text-xs text-muted-foreground">Fill</Label>
          <ColorField id={`${fid}-fill`} value={props.fill} onChange={props.onFill} allowNone={props.allowNone} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor={`${fid}-layer`} className="text-xs text-muted-foreground">Layer</Label>
          <Select value={props.layer} onValueChange={(v) => props.onLayer(v as Layer)}>
            <SelectTrigger id={`${fid}-layer`} className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="metallic">metallic</SelectItem>
              <SelectItem value="white">white</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {props.onBold && (
          <div className="flex items-center justify-between">
            <Label htmlFor={`${fid}-bold`} className="text-xs text-muted-foreground">Bold</Label>
            <Checkbox id={`${fid}-bold`} checked={!!props.bold} onCheckedChange={(v) => props.onBold!(v === true)} />
          </div>
        )}
        {props.onStroke && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${fid}-stroke`} className="text-xs text-muted-foreground">Outer stroke</Label>
              <Checkbox
                id={`${fid}-stroke`}
                checked={strokeOn}
                onCheckedChange={(v) => props.onStroke!(v === true ? "#FFFFFF" : "none")}
              />
            </div>
            {strokeOn && (
              <div className="flex items-center gap-1">
                <ColorField id={`${fid}-stroke-color`} value={props.stroke!} onChange={props.onStroke!} allowNone={false} />
                <Input
                  type="number" min={1} max={60}
                  id={`${fid}-stroke-width`}
                  aria-label="Stroke width (px at 600dpi)"
                  className="h-6 w-14 text-xs"
                  value={props.strokeWidth ?? DEFAULT_STROKE_PX}
                  onChange={(e) =>
                    props.onStrokeWidth?.(Math.max(1, Number(e.target.value) || DEFAULT_STROKE_PX))}
                />
                <span className="text-[10px] text-muted-foreground">px</span>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
