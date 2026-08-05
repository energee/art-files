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
import { machineName } from "@/qr";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { DescriptionEditor } from "./DescriptionEditor";
import { FileDrop } from "./FileDrop";

type Update = (fn: (c: LabelConfig) => void) => void;

/** Collab art is whatever the partner brewery sends: vector preferred (it
 *  takes the slot's fill/layer like the laurel), raster accepted. */
const COLLAB_ACCEPT = {
  "image/svg+xml": [".svg"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

/** The uploaded collab logos and their handlers. They live in App beside the
 *  texture and mask — like those, the image is a build-time asset, not part of
 *  the saved config, which holds only the slot's style and size. */
export interface CollabFiles {
  leftName?: string;
  leftUrl?: string;
  centerName?: string;
  centerUrl?: string;
  onLeft: (f: File) => void;
  onCenter: (f: File) => void;
}

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
    </Button>
  );
}

/** Vertical nudge in points for a logo-like element, positive = down. Text
 *  elements have no equivalent: their baselines are layout.ts's job. */
function OffsetInput(props: {
  value?: number; title: string; onChange: (v: number) => void; onFocus: () => void;
}) {
  return (
    <Input
      type="number"
      step={1}
      title={props.title}
      aria-label={props.title}
      className="h-6 w-16 text-xs"
      value={props.value ?? 0}
      onFocus={props.onFocus}
      // An empty or non-numeric field reads as "no nudge", not NaN — which
      // would propagate into every y in the draw and blank the label.
      onChange={(e) => props.onChange(Number(e.target.value) || 0)}
    />
  );
}

/** A collab logo slot: the size knob plus the row's usual job of opening
 *  StyleProperties for that element. Size is a plain multiplier on the slot's
 *  fit-to-box scale (1 = fit) — collab marks differ too much in visual weight
 *  for one fitted size to be right for all of them. */
function CollabSlotRow(props: {
  id: "collabLeft" | "collabCenter"; label: string; cfg: LabelConfig; update: Update;
  selected: boolean; onSelect: (id: ElementId) => void;
  /** Only the left slot gets a nudge of its own. The centre mark is part of
   *  the centre stack and moves with the laurel — see the Logo row. */
  offset?: boolean;
}) {
  const slot = props.cfg[props.id];
  const htmlId = machineName(props.label);
  return (
    <Row label={props.label} htmlFor={htmlId} marker={!isDefaultStyle(props.id, slot)}>
      <Input
        id={htmlId}
        type="number"
        step={0.05}
        min={0.1}
        max={2}
        className={cn("h-6 w-20 text-xs", props.selected && "ring-1 ring-ring")}
        value={slot.scale}
        onFocus={() => props.onSelect(props.id)}
        onChange={(e) => {
          const v = Number(e.target.value);
          // Ignore a cleared or nonsensical field rather than rendering a
          // zero-size (invisible) or negative-scaled logo.
          if (v > 0) props.update((c) => { c[props.id].scale = v; });
        }}
      />
      {props.offset && (
        <OffsetInput
          value={slot.offsetY}
          title="Vertical nudge, points (+ = down)"
          onFocus={() => props.onSelect(props.id)}
          onChange={(v) => props.update((c) => { c[props.id].offsetY = v; })}
        />
      )}
      {/* Raster only: an SVG already takes the slot's fill. Shown always
          rather than only for a loaded PNG so the setting is discoverable
          before the art is dropped. */}
      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
        <Checkbox
          checked={!!slot.tintRaster}
          onCheckedChange={(on) =>
            props.update((c) => { c[props.id].tintRaster = on === true; })}
        />
        tint PNG
      </label>
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
  selected: ElementId | null;
  onSelect: (id: ElementId | null) => void;
  collab: CollabFiles;
}) {
  const { cfg, errors, update, selected, onSelect, collab } = props;
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

      <StyleOnlyElementRow id="qr" label="QR" cfg={cfg} selected={selected === "qr"} onSelect={onSelect} />

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

      {/* Collab block: everything below the switch is mounted only while it is
          on, so a normal release never sees these fields. Turning it off does
          not discard the uploaded art or the slot styles — the switch is the
          one thing the renderer checks, so flipping it back restores the
          label exactly as it was. */}
      <Heading>
        <label className="flex cursor-pointer items-center gap-1.5">
          <Switch
            checked={cfg.collabEnabled}
            onCheckedChange={(on) => {
              update((c) => { c.collabEnabled = on; });
              // Leaving a collab element selected would strand the style panel
              // on a row that just unmounted.
              if (!on && selected?.startsWith("collab")) onSelect(null);
            }}
          />
          Collab
        </label>
      </Heading>
      {cfg.collabEnabled && (
        <>
          <div className="mb-1.5 flex gap-2">
            <FileDrop label="Left logo (SVG/PNG)" accept={COLLAB_ACCEPT}
              fileName={collab.leftName} previewUrl={collab.leftUrl}
              onFile={collab.onLeft} />
            <FileDrop label="Center logo (SVG/PNG)" accept={COLLAB_ACCEPT}
              fileName={collab.centerName} previewUrl={collab.centerUrl}
              onFile={collab.onCenter} />
          </div>
          <StyleOnlyElementRow id="collabLead" label="Lead-in" cfg={cfg}
            selected={selected === "collabLead"} onSelect={onSelect} />
          <CollabSlotRow id="collabLeft" label="Left size" cfg={cfg} update={update}
            selected={selected === "collabLeft"} onSelect={onSelect} offset />
          <CollabSlotRow id="collabCenter" label="Center size" cfg={cfg} update={update}
            selected={selected === "collabCenter"} onSelect={onSelect} />
        </>
      )}

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
            // The laurel gets a vertical nudge alongside its style row — it
            // is drawn as a box at a fixed cy, so unlike a text element there
            // is no baseline field to move it with. It moves the whole centre
            // stack: the collab mark hangs off the laurel's nudged bottom
            // (see drawElements), so the pair keeps its gap and cannot drift
            // apart the way two independent knobs let it.
            if (el.id === "logo")
              return (
                <div key={el.id}>
                  <StyleOnlyElementRow
                    id={el.id} label={label} cfg={cfg}
                    selected={selected === el.id} onSelect={onSelect}
                  />
                  <Row label="Stack nudge">
                    <OffsetInput
                      value={cfg.logo.offsetY}
                      title="Move the laurel and the centre collab mark together, points (+ = down)"
                      onFocus={() => onSelect("logo")}
                      onChange={(v) => update((c) => { c.logo.offsetY = v; })}
                    />
                  </Row>
                </div>
              );
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
