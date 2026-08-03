// StylePopover.tsx — a row's single visible style control: a swatch chip
// showing the current fill; its popover holds the full editor (ColorField,
// layer select, optional bold toggle, optional QR stroke section).
import type { Fill, Layer } from "@/types";
import { CHECKER, ColorField } from "./ColorField";
import { Checkbox } from "@/components/ui/checkbox";
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
  allowNone?: boolean;
}) {
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
              <Label className="text-xs text-muted-foreground">Stroke</Label>
              <Checkbox
                checked={props.stroke !== "none"}
                onCheckedChange={(v) => props.onStroke!(v === true ? "#FFFFFF" : "none")}
              />
            </div>
            {props.stroke !== "none" && (
              <ColorField value={props.stroke!} onChange={props.onStroke!} allowNone={false} />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
