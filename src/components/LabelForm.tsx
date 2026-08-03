// LabelForm.tsx — every LabelConfig field as tight Linear-style rows.
// `update` clones the config, applies the mutation, and sets state upstream.
import type { Fill, LabelConfig, Layer, StyledLine } from "@/types";
import { ColorField } from "./ColorField";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type Update = (fn: (c: LabelConfig) => void) => void;

function Row(props: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5">
        <span className="w-24 shrink-0 text-muted-foreground">{props.label}</span>
        {props.children}
      </div>
      {props.error && <p className="ml-[6.375rem] text-xs text-destructive">{props.error}</p>}
    </div>
  );
}

function LayerSelect(props: { value: Layer; onChange: (v: Layer) => void }) {
  return (
    <Select value={props.value} onValueChange={(v) => props.onChange(v as Layer)}>
      <SelectTrigger className="h-6 w-24 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="metallic">metallic</SelectItem>
        <SelectItem value="white">white</SelectItem>
      </SelectContent>
    </Select>
  );
}

function StyleControls(props: {
  fill: Fill; layer: Layer;
  onFill: (v: Fill) => void; onLayer: (v: Layer) => void;
}) {
  return (
    <>
      <ColorField value={props.fill} onChange={props.onFill} />
      <LayerSelect value={props.layer} onChange={props.onLayer} />
    </>
  );
}

function TextRow(props: {
  label: string; line: StyledLine; update: Update;
  get: (c: LabelConfig) => StyledLine; editable?: boolean;
}) {
  const { line, update, get } = props;
  return (
    <Row label={props.label}>
      {props.editable !== false && (
        <Input
          className="h-6 min-w-0 flex-1 text-xs"
          value={line.text}
          onChange={(e) => update((c) => { get(c).text = e.target.value; })}
        />
      )}
      <Checkbox
        title="bold"
        checked={!!line.bold}
        onCheckedChange={(v) => update((c) => { get(c).bold = v === true; })}
      />
      <StyleControls
        fill={line.fill} layer={line.layer}
        onFill={(v) => update((c) => { get(c).fill = v; })}
        onLayer={(v) => update((c) => { get(c).layer = v; })}
      />
    </Row>
  );
}

function Heading(props: { children: string }) {
  return (
    <h2 className="mb-1.5 mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">
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
  const style = (label: string, get: (c: LabelConfig) => { fill: Fill; layer: Layer }) => (
    <Row label={label}>
      <StyleControls
        fill={get(cfg).fill} layer={get(cfg).layer}
        onFill={(v) => update((c) => { get(c).fill = v; })}
        onLayer={(v) => update((c) => { get(c).layer = v; })}
      />
    </Row>
  );
  return (
    <div>
      <Heading>Beer</Heading>
      <Row label="Name" error={errors.name}>
        <Input className="h-6 flex-1 text-xs" value={cfg.beerName}
          onChange={(e) => update((c) => { c.beerName = e.target.value; })} />
      </Row>
      {style("Name style", (c) => c.nameStyle)}
      <TextRow label="Subtitle" line={cfg.styleLine} update={update} get={(c) => c.styleLine} />
      <Row label="ABV %">
        <Input className="h-6 flex-1 text-xs" value={cfg.abv}
          onChange={(e) => update((c) => { c.abv = e.target.value; })} />
      </Row>
      {style("ABV style", (c) => c.abvStyle)}
      <Row label="UPC-A" error={errors.upc}>
        <Input className="h-6 flex-1 font-mono text-xs" value={cfg.upc}
          onChange={(e) => update((c) => { c.upc = e.target.value.trim(); })} />
      </Row>
      <Row label="QR">
        <ColorField value={cfg.qrFill} onChange={(v) => update((c) => { c.qrFill = v; })} allowNone={false} />
        <LayerSelect value={cfg.qrLayer} onChange={(v) => update((c) => { c.qrLayer = v; })} />
      </Row>
      <Row label="QR stroke">
        <Checkbox
          title="stroke on/off"
          checked={cfg.qrStroke !== "none"}
          onCheckedChange={(v) =>
            update((c) => { c.qrStroke = v === true ? "#FFFFFF" : "none"; })}
        />
        {cfg.qrStroke !== "none" && (
          <ColorField value={cfg.qrStroke}
            onChange={(v) => update((c) => { c.qrStroke = v; })} allowNone={false} />
        )}
      </Row>

      <Heading>Description</Heading>
      <Textarea
        rows={7} className="font-mono text-xs" value={cfg.description}
        onChange={(e) => update((c) => { c.description = e.target.value; })}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        # header · **bold** · _white ink_ · plain = default gold
      </p>

      <Heading>Template elements</Heading>
      <TextRow label="Volume" line={cfg.volume} update={update} get={(c) => c.volume} />
      {style("Wordmark", (c) => c.wordmark)}
      {style("Logo", (c) => c.logo)}
      <TextRow label="Handle/addr" line={cfg.handleAddress} update={update} get={(c) => c.handleAddress} />
      {style("Warning", (c) => c.warning)}
      <TextRow label="Store cold" line={cfg.storeCold} update={update} get={(c) => c.storeCold} />
    </div>
  );
}
