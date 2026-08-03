// StylePopover.tsx — a row's single visible style control: a swatch chip
// showing the current fill; its popover holds the full editor (ColorField,
// layer select, optional bold toggle, optional QR stroke section).
import type { Fill, Layer } from "@/types";
import { CHECKER, ColorField } from "./ColorField";
import { DEFAULT_STROKE_PX } from "@/layout";
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
}) {
  const strokeOn = !!props.stroke && props.stroke !== "none";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${props.label} style`}
          className="size-6 shrink-0 cursor-pointer rounded-sm border border-border"
          style={
            props.fill === "none"
              ? { background: CHECKER }
              : { background: props.fill }
          }
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Fill</Label>
          <ColorField value={props.fill} onChange={props.onFill} allowNone={props.allowNone} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Layer</Label>
          <Select value={props.layer} onValueChange={(v) => props.onLayer(v as Layer)}>
            <SelectTrigger className="h-6 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="metallic">metallic</SelectItem>
              <SelectItem value="white">white</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {props.onBold && (
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Bold</Label>
            <Checkbox checked={!!props.bold} onCheckedChange={(v) => props.onBold!(v === true)} />
          </div>
        )}
        {props.onStroke && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Outer stroke</Label>
              <Checkbox
                checked={strokeOn}
                onCheckedChange={(v) => props.onStroke!(v === true ? "#FFFFFF" : "none")}
              />
            </div>
            {strokeOn && (
              <div className="flex items-center gap-1">
                <ColorField value={props.stroke!} onChange={props.onStroke!} allowNone={false} />
                <Input
                  type="number" min={1} max={60}
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
