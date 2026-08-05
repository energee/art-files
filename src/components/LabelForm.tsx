// LabelForm.tsx — the sidebar's authoring form, split into two bands: "This
// beer" holds the fields that change every release (name, subtitle, ABV,
// UPC, QR, description) with no style controls in sight; "Brand template"
// collects the six set-once elements (volume, wordmark, logo, handle/
// address, warning, store cold) behind a collapsed disclosure with a count
// badge, since their gold/metallic defaults are correct almost every time.
// Every row that maps to an ElementId calls onSelect(id) on focus (or click,
// for rows with no input to focus) so StyleProperties — rendered by App just
// below this component — can show that element's fill/layer/bold/stroke
// controls. No per-row swatch chips anymore; a small dot next to a row's
// label is the only per-row style signal left, flagging a style that
// deviates from THAT element's shipped default (see isDefaultStyle) — so a
// freshly loaded config shows no dots at all, including the elements that
// ship deliberately off-gold.
import { ChevronRight, Info } from "lucide-react";
import type { LabelConfig, StyledLine } from "@/types";
import { ELEMENTS, elementById, isDefaultStyle, type ElementId } from "@/elements";
import { machineName, qrUrl } from "@/qr";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DescriptionEditor } from "./DescriptionEditor";

type Update = (fn: (c: LabelConfig) => void) => void;

// The six template elements and their count both come from ELEMENTS' group
// field, computed once — never a second hardcoded id list, so a future
// rebalancing of the registry can't silently drift out of sync with what
// the disclosure shows.
const TEMPLATE_ELEMENTS = ELEMENTS.filter((e) => e.group === "template");

/** Marker shown next to a row's label when its element's live style differs
 *  from that element's OWN shipped default — replaces the old always-visible
 *  swatch chip as the signal that this row has been styled by hand. */
function Dot() {
  return <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />;
}

function Row(props: {
  label: string; htmlFor?: string; error?: string; marker?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor={props.htmlFor}
          className="flex w-24 shrink-0 items-center gap-1 text-[13px] font-normal text-muted-foreground"
        >
          {props.label}
          {props.marker && <Dot />}
        </Label>
        {props.children}
      </div>
      {props.error && <p className="ml-[6.375rem] text-xs text-destructive">{props.error}</p>}
    </div>
  );
}

/** A row for an ElementId whose text lives in a StyledLine alongside its
 *  style (bold sits there too) — true exactly when ELEMENTS marks hasBold,
 *  the same guarantee StyleProperties.tsx's cast relies on. Covers Subtitle,
 *  Volume, Handle/addr and Store cold. */
function TextElementRow(props: {
  id: ElementId; label: string; cfg: LabelConfig; update: Update; onSelect: (id: ElementId) => void;
}) {
  const el = elementById(props.id);
  const line = el.style(props.cfg) as StyledLine;
  const htmlId = machineName(props.label);
  return (
    <Row label={props.label} htmlFor={htmlId} marker={!isDefaultStyle(props.id, line)}>
      <Input
        id={htmlId}
        className="h-6 min-w-0 flex-1 text-xs"
        value={line.text}
        onFocus={() => props.onSelect(props.id)}
        onChange={(e) =>
          props.update((c) => { (elementById(props.id).style(c) as StyledLine).text = e.target.value; })}
      />
    </Row>
  );
}

/** A row for an ElementId with no editable text of its own (Wordmark, Logo,
 *  Warning, QR) — the whole row is the click/focus target that opens
 *  StyleProperties, since there's no input to carry that job. onClick
 *  matters here, not just onFocus: Safari does not move focus to a
 *  <button> on mouse click (unlike every other engine), so onFocus alone
 *  would silently miss mouse users there. */
function StyleOnlyElementRow(props: {
  id: ElementId; label: string; cfg: LabelConfig; selected: boolean; onSelect: (id: ElementId) => void;
  /** Derived value worth showing next to the label — the QR's payload, which
   *  follows the beer name and has no field of its own to appear in. Sits
   *  inside the row's Button so it can't steal the click target. */
  hint?: string;
}) {
  const el = elementById(props.id);
  const dirty = !isDefaultStyle(props.id, el.style(props.cfg));
  return (
    <Button
      type="button"
      variant="ghost"
      onFocus={() => props.onSelect(props.id)}
      onClick={() => props.onSelect(props.id)}
      className={cn(
        "mb-1.5 h-6 w-full justify-start gap-1 px-1.5 text-[13px] font-normal text-muted-foreground",
        props.selected && "bg-muted text-foreground",
      )}
    >
      {props.label}
      {dirty && <Dot />}
      {props.hint && (
        // title carries the full string: the sidebar is too narrow to show a
        // whole URL, and truncating without one would hide the tail for good.
        <span title={props.hint} className="ml-auto truncate font-mono text-[11px] opacity-70">
          {props.hint}
        </span>
      )}
    </Button>
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
  selected: ElementId | null;
  onSelect: (id: ElementId | null) => void;
}) {
  const { cfg, errors, update, selected, onSelect } = props;
  return (
    <div>
      <Heading>This beer</Heading>
      <Row label="Name" htmlFor="beer-name" error={errors.name} marker={!isDefaultStyle("name", cfg.nameStyle)}>
        <Input id="beer-name" className="h-6 flex-1 text-xs" value={cfg.beerName}
          onFocus={() => onSelect("name")}
          onChange={(e) => update((c) => { c.beerName = e.target.value; })} />
      </Row>
      <TextElementRow id="styleLine" label="Subtitle" cfg={cfg} update={update} onSelect={onSelect} />

      {/* ABV and UPC share one row — both are short. Each input doubles as
          its element's row: focusing UPC selects the barcode the digits
          produce, the same way focusing Name selects the beer name. The
          barcode's shipped style (near-black bars, white halo, white ink) is
          a deliberate deviation from gold/metallic, but it IS its shipped
          default — like the logo's keyline — so no marker dot until someone
          restyles it. */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <Label
          htmlFor="abv"
          className="flex w-24 shrink-0 items-center gap-1 text-[13px] font-normal text-muted-foreground"
        >
          ABV %
          {!isDefaultStyle("abv", cfg.abvStyle) && <Dot />}
        </Label>
        <Input id="abv" className="h-6 w-14 text-xs" value={cfg.abv}
          onFocus={() => onSelect("abv")}
          onChange={(e) => update((c) => { c.abv = e.target.value; })} />
        <Label
          htmlFor="upc"
          className="flex shrink-0 items-center gap-1 text-[13px] font-normal text-muted-foreground"
        >
          UPC
          {!isDefaultStyle("barcode", elementById("barcode").style(cfg)) && <Dot />}
        </Label>
        <Input id="upc" className="h-6 min-w-0 flex-1 font-mono text-xs" value={cfg.upc}
          onFocus={() => onSelect("barcode")}
          onChange={(e) => update((c) => { c.upc = e.target.value.trim(); })} />
      </div>
      {errors.upc && <p className="ml-[6.375rem] text-xs text-destructive">{errors.upc}</p>}

      {/* The QR payload is derived from the beer name and has no form field,
          so the row shows what will actually be encoded. */}
      <StyleOnlyElementRow id="qr" label="QR" cfg={cfg} selected={selected === "qr"} onSelect={onSelect}
        hint={qrUrl(cfg.beerName)} />

      <Heading>
        Description
        <Tooltip>
          <TooltipTrigger
            render={<Info className="size-3 cursor-help" aria-label="Description syntax" />}
          />
          <TooltipContent># header · **bold** · _white ink_ · plain = the panel's style</TooltipContent>
        </Tooltip>
        {!isDefaultStyle("description", cfg.descStyle) && <Dot />}
      </Heading>
      <DescriptionEditor
        value={cfg.description}
        base={cfg.descStyle}
        onFocus={() => onSelect("description")}
        onChange={(md) => update((c) => { c.description = md; })}
      />

      <Collapsible>
        <Heading>
          <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1 text-left">
            <ChevronRight className="size-3 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            Brand template
            <span className="ml-1 rounded bg-muted px-1 text-[10px]">{TEMPLATE_ELEMENTS.length}</span>
          </CollapsibleTrigger>
        </Heading>
        <CollapsibleContent className="pt-1.5">
          {TEMPLATE_ELEMENTS.map((el) => {
            // Only "Handle / address" needs shortening — the rest already
            // match ELEMENTS' label verbatim — to fit the row's w-24 column.
            const label = el.id === "handleAddress" ? "Handle/addr" : el.label;
            return el.hasBold ? (
              <TextElementRow key={el.id} id={el.id} label={label} cfg={cfg} update={update} onSelect={onSelect} />
            ) : (
              <StyleOnlyElementRow
                key={el.id} id={el.id} label={label} cfg={cfg}
                selected={selected === el.id} onSelect={onSelect}
              />
            );
          })}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
