// LabelForm.tsx — every LabelConfig field as calm two-control rows: a text
// input (where editable) plus ONE StylePopover swatch, in one flat list —
// template rows included. Style details (fill, layer, bold, outer stroke)
// live in the popover; the description block gets the same swatch on its
// heading (base style + stroke for its markdown lines).
import { Info } from "lucide-react";
import type { LabelConfig, Style, StyledLine } from "@/types";
import { machineName } from "@/qr";
import { StylePopover } from "./StylePopover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Update = (fn: (c: LabelConfig) => void) => void;

function Row(props: {
  label: string; htmlFor?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor={props.htmlFor}
          className="w-24 shrink-0 text-[13px] font-normal text-muted-foreground"
        >
          {props.label}
        </Label>
        {props.children}
      </div>
      {props.error && <p className="ml-[6.375rem] text-xs text-destructive">{props.error}</p>}
    </div>
  );
}

function TextRow(props: {
  label: string; line: StyledLine; update: Update;
  get: (c: LabelConfig) => StyledLine;
}) {
  const { line, update, get } = props;
  const id = machineName(props.label);
  return (
    <Row label={props.label} htmlFor={id}>
      <Input
        id={id}
        className="h-6 min-w-0 flex-1 text-xs"
        value={line.text}
        onChange={(e) => update((c) => { get(c).text = e.target.value; })}
      />
      <StylePopover
        label={props.label}
        fill={line.fill} layer={line.layer} bold={!!line.bold}
        stroke={line.stroke} strokeWidth={line.strokeWidth}
        onFill={(v) => update((c) => { get(c).fill = v; })}
        onLayer={(v) => update((c) => { get(c).layer = v; })}
        onBold={(v) => update((c) => { get(c).bold = v; })}
        onStroke={(v) => update((c) => { get(c).stroke = v; })}
        onStrokeWidth={(v) => update((c) => { get(c).strokeWidth = v; })}
      />
    </Row>
  );
}

function Heading(props: { children?: React.ReactNode }) {
  return (
    <h2 className="mb-1.5 mt-4 flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
      {props.children}
    </h2>
  );
}

export function LabelForm(props: {
  cfg: LabelConfig;
  errors: Record<string, string>;
  update: Update;
}) {
  const { cfg, errors, update } = props;
  const styleOnly = (label: string, get: (c: LabelConfig) => Style) => (
    <Row label={label} htmlFor={`${machineName(label)}-style`}>
      <StylePopover
        id={`${machineName(label)}-style`}
        label={label}
        fill={get(cfg).fill} layer={get(cfg).layer}
        stroke={get(cfg).stroke} strokeWidth={get(cfg).strokeWidth}
        onFill={(v) => update((c) => { get(c).fill = v; })}
        onLayer={(v) => update((c) => { get(c).layer = v; })}
        onStroke={(v) => update((c) => { get(c).stroke = v; })}
        onStrokeWidth={(v) => update((c) => { get(c).strokeWidth = v; })}
      />
    </Row>
  );
  return (
    <div>
      <Heading>Label</Heading>
      <Row label="Name" htmlFor="beer-name" error={errors.name}>
        <Input id="beer-name" className="h-6 flex-1 text-xs" value={cfg.beerName}
          onChange={(e) => update((c) => { c.beerName = e.target.value; })} />
        <StylePopover
          label="Name"
          fill={cfg.nameStyle.fill} layer={cfg.nameStyle.layer}
          stroke={cfg.nameStyle.stroke} strokeWidth={cfg.nameStyle.strokeWidth}
          onFill={(v) => update((c) => { c.nameStyle.fill = v; })}
          onLayer={(v) => update((c) => { c.nameStyle.layer = v; })}
          onStroke={(v) => update((c) => { c.nameStyle.stroke = v; })}
          onStrokeWidth={(v) => update((c) => { c.nameStyle.strokeWidth = v; })}
        />
      </Row>
      <TextRow label="Subtitle" line={cfg.styleLine} update={update} get={(c) => c.styleLine} />
      <Row label="ABV %" htmlFor="abv">
        <Input id="abv" className="h-6 flex-1 text-xs" value={cfg.abv}
          onChange={(e) => update((c) => { c.abv = e.target.value; })} />
        <StylePopover
          label="ABV"
          fill={cfg.abvStyle.fill} layer={cfg.abvStyle.layer}
          stroke={cfg.abvStyle.stroke} strokeWidth={cfg.abvStyle.strokeWidth}
          onFill={(v) => update((c) => { c.abvStyle.fill = v; })}
          onLayer={(v) => update((c) => { c.abvStyle.layer = v; })}
          onStroke={(v) => update((c) => { c.abvStyle.stroke = v; })}
          onStrokeWidth={(v) => update((c) => { c.abvStyle.strokeWidth = v; })}
        />
      </Row>
      <Row label="UPC-A" htmlFor="upc-a" error={errors.upc}>
        <Input id="upc-a" className="h-6 flex-1 font-mono text-xs" value={cfg.upc}
          onChange={(e) => update((c) => { c.upc = e.target.value.trim(); })} />
      </Row>
      <Row label="QR" htmlFor="qr-style">
        <StylePopover
          id="qr-style"
          label="QR"
          fill={cfg.qrFill} layer={cfg.qrLayer} allowNone={false}
          onFill={(v) => update((c) => { c.qrFill = v; })}
          onLayer={(v) => update((c) => { c.qrLayer = v; })}
          stroke={cfg.qrStroke} strokeWidth={cfg.qrStrokeWidth}
          onStroke={(v) => update((c) => { c.qrStroke = v; })}
          onStrokeWidth={(v) => update((c) => { c.qrStrokeWidth = v; })}
        />
      </Row>

      <TextRow label="Volume" line={cfg.volume} update={update} get={(c) => c.volume} />
      {styleOnly("Wordmark", (c) => c.wordmark)}
      {styleOnly("Logo", (c) => c.logo)}
      <TextRow label="Handle/addr" line={cfg.handleAddress} update={update} get={(c) => c.handleAddress} />
      {styleOnly("Warning", (c) => c.warning)}
      <TextRow label="Store cold" line={cfg.storeCold} update={update} get={(c) => c.storeCold} />

      <Heading>
        Description
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="size-3 cursor-help" aria-label="Description syntax" />
          </TooltipTrigger>
          <TooltipContent># header · **bold** · _white ink_ · plain = the swatch's style</TooltipContent>
        </Tooltip>
        <StylePopover
          label="Description"
          fill={cfg.descStyle.fill} layer={cfg.descStyle.layer}
          stroke={cfg.descStyle.stroke} strokeWidth={cfg.descStyle.strokeWidth}
          onFill={(v) => update((c) => { c.descStyle.fill = v; })}
          onLayer={(v) => update((c) => { c.descStyle.layer = v; })}
          onStroke={(v) => update((c) => { c.descStyle.stroke = v; })}
          onStrokeWidth={(v) => update((c) => { c.descStyle.strokeWidth = v; })}
        />
      </Heading>
      <Textarea
        rows={7} aria-label="Description" className="font-mono text-xs" value={cfg.description}
        onChange={(e) => update((c) => { c.description = e.target.value; })}
      />
    </div>
  );
}
