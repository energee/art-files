// StyleProperties.tsx — the right-hand Inspector: one panel shaped by the
// selected layer, Figma-style. Replaces both the old contextual style panel
// (which existed only while an element was selected) and LabelForm's field
// rows: the Content section carries whatever the layer is made of (text
// input, markdown editor, file drop, scale/nudge knobs), the Style section
// carries the shared fill/layer/bold/stroke stack. Document-level layers
// (background, mask) are file drops only — no Style section. Selection
// itself lives in the layers panel and the preview; this component only
// receives the chosen LayerId.
import {
  AlignLeft, Barcode, Beaker, Handshake, Image as ImageIcon, Info, Layers as LayersIcon,
  Percent, QrCode, Snowflake, Sparkles, Text, TriangleAlert, Type, X,
} from "lucide-react";
import type { LabelConfig, Layer, StyledLine } from "@/types";
import { applyStyle, elementById, isDefaultStyle, type ElementId } from "@/elements";
import { DOC_LAYER_LABELS, isElementId, type LayerId } from "@/components/layers";
import { defaultConfig } from "@/defaults";
import { ColorField } from "./ColorField";
import { ScrubField } from "./ScrubField";
import { DescriptionEditor } from "./DescriptionEditor";
import { FileDrop } from "./FileDrop";
import { machineName, qrUrl } from "@/qr";
import { DEFAULT_STROKE_PX } from "@/layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

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

/** All build-time file assets the inspector can edit, grouped so App passes
 *  one prop: the texture and mask (Document layers) plus the collab logos. */
export interface InspectorFiles {
  texture: { fileName?: string; previewUrl?: string; onFile: (f: File) => void };
  mask: { fileName?: string; previewUrl?: string; error?: string; onFile: (f: File) => void };
  collab: CollabFiles;
}

/** Per-layer lucide icon, mirroring the layers panel's row icons so the
 *  inspector header reads as "this row, expanded". */
const LAYER_ICONS: Record<LayerId, React.ComponentType<{ className?: string }>> = {
  name: Type,
  styleLine: AlignLeft,
  abv: Percent,
  description: Text,
  qr: QrCode,
  barcode: Barcode,
  collabLead: Handshake,
  collabLeft: ImageIcon,
  collabCenter: ImageIcon,
  volume: Beaker,
  wordmark: Type,
  logo: Sparkles,
  handleAddress: Info,
  warning: TriangleAlert,
  storeCold: Snowflake,
  background: ImageIcon,
  mask: LayersIcon,
};

/** Section heading — same idiom LabelForm used, so the inspector reads in
 *  the app's established voice. */
function Heading(props: { children?: React.ReactNode }) {
  return (
    <h2 className="mb-1.5 mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">
      {props.children}
    </h2>
  );
}

/** Vertical nudge in points for a logo-like element, positive = down. Text
 *  elements have no equivalent: their baselines are layout.ts's job. */
function OffsetInput(props: {
  value?: number; title: string; onChange: (v: number) => void;
}) {
  return (
    <Input
      type="number"
      step={1}
      title={props.title}
      aria-label={props.title}
      className="h-6 w-16 text-xs"
      value={props.value ?? 0}
      // An empty or non-numeric field reads as "no nudge", not NaN — which
      // would propagate into every y in the draw and blank the label.
      onChange={(e) => props.onChange(Number(e.target.value) || 0)}
    />
  );
}

/** The laurel's vertical nudge, surfaced on the Logo layer AND the centre
 *  collab layer: both are controlled off the one cfg.logo.offsetY, so they
 *  can never disagree; it moves the whole centre stack — the collab mark
 *  hangs off the laurel's nudged bottom (see drawElements), so the pair
 *  keeps its gap and cannot drift apart the way two independent knobs
 *  let it. */
function StackNudge(props: { cfg: LabelConfig; update: Update }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs text-muted-foreground">Stack nudge</Label>
      <OffsetInput
        value={props.cfg.logo.offsetY}
        title="Move the laurel and the centre collab mark together, points (+ = down)"
        onChange={(v) => props.update((c) => { c.logo.offsetY = v; })}
      />
      <span className="text-[11px] text-muted-foreground">laurel + centre mark</span>
    </div>
  );
}

/** The collab on/off switch, shown on all three collab layers. Everything
 *  else about a collab is per-layer, but whether the block renders at all is
 *  one flag — turning it off does not discard the uploaded art or the slot
 *  styles, so flipping it back restores the label exactly as it was. */
function CollabSwitch(props: { cfg: LabelConfig; update: Update }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
      <Switch
        checked={props.cfg.collabEnabled}
        onCheckedChange={(on) => props.update((c) => { c.collabEnabled = on; })}
      />
      Collab enabled
    </label>
  );
}

/** A collab logo slot's knobs: file drop, size, optional nudge, raster tint.
 *  Size is a plain multiplier on the slot's fit-to-box scale (1 = fit) —
 *  collab marks differ too much in visual weight for one fitted size to be
 *  right for all of them. */
function CollabSlotContent(props: {
  id: "collabLeft" | "collabCenter"; cfg: LabelConfig; update: Update; files: InspectorFiles;
}) {
  const slot = props.cfg[props.id];
  const left = props.id === "collabLeft";
  const c = props.files.collab;
  return (
    <div className="space-y-2">
      <FileDrop
        label={left ? "Text Logo (SVG/PNG)" : "Graphic Logo (SVG/PNG)"}
        accept={COLLAB_ACCEPT}
        fileName={left ? c.leftName : c.centerName}
        previewUrl={left ? c.leftUrl : c.centerUrl}
        onFile={left ? c.onLeft : c.onCenter}
      />
      <div className="flex items-center gap-1.5">
        <Label htmlFor={`${props.id}-scale`} className="text-xs text-muted-foreground">Size</Label>
        <Input
          id={`${props.id}-scale`}
          type="number" step={0.05} min={0.1} max={2}
          className="h-6 w-20 text-xs"
          value={slot.scale}
          onChange={(e) => {
            const v = Number(e.target.value);
            // Ignore a cleared or nonsensical field rather than rendering a
            // zero-size (invisible) or negative-scaled logo.
            if (v > 0) props.update((cc) => { cc[props.id].scale = v; });
          }}
        />
        {/* Only the left slot gets a nudge of its own. The centre mark is
            part of the centre stack and moves with the laurel — see the
            StackNudge shown on the centre layer below. */}
        {left && (
          <OffsetInput
            value={slot.offsetY}
            title="Vertical nudge, points (+ = down)"
            onChange={(v) => props.update((cc) => { cc[props.id].offsetY = v; })}
          />
        )}
      </div>
      {/* Raster only: an SVG already takes the slot's fill. Shown always
          rather than only for a loaded PNG so the setting is discoverable
          before the art is dropped. */}
      <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
        <Checkbox
          checked={!!slot.tintRaster}
          onCheckedChange={(on) =>
            props.update((cc) => { cc[props.id].tintRaster = on === true; })}
        />
        tint PNG
      </label>
      {!left && <StackNudge cfg={props.cfg} update={props.update} />}
      <CollabSwitch cfg={props.cfg} update={props.update} />
    </div>
  );
}

/** The selected layer's Content section body, or null when the layer has
 *  nothing editable beyond style (wordmark, warning) — the caller shows a
 *  muted note instead. */
function Content(props: {
  id: LayerId; cfg: LabelConfig; errors: Record<string, string>; update: Update;
  files: InspectorFiles;
}): React.JSX.Element | null {
  const { id, cfg, errors, update, files } = props;
  switch (id) {
    case "name":
      return (
        <div className="space-y-1">
          <Input
            id="beer-name" className="h-6 w-full text-xs" value={cfg.beerName}
            onChange={(e) => update((c) => { c.beerName = e.target.value; })}
          />
          {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>
      );
    case "styleLine":
    case "volume":
    case "storeCold":
      // Text that lives in a StyledLine alongside its style — true exactly
      // when ELEMENTS marks hasBold, the same guarantee the Style section's
      // cast relies on.
      return (
        <Input
          id={machineName(elementById(id).label)}
          className="h-6 w-full text-xs"
          value={(elementById(id).style(cfg) as StyledLine).text}
          onChange={(e) =>
            update((c) => { (elementById(id).style(c) as StyledLine).text = e.target.value; })}
        />
      );
    case "abv":
      return (
        <Input
          id="abv" className="h-6 w-20 text-xs" value={cfg.abv}
          onChange={(e) => update((c) => { c.abv = e.target.value; })}
        />
      );
    case "description":
      return (
        <DescriptionEditor
          value={cfg.description}
          base={cfg.descStyle}
          onChange={(md) => update((c) => { c.description = md; })}
        />
      );
    case "handleAddress":
      // Info authors in the same markdown subset as the description, through
      // the same WYSIWYG editor — `**bold**` and `_white ink_` over the row's
      // own style (see parseInfoLine). The slot draws ONE rotated line, so
      // only the first line is kept: a stored second line would silently
      // never appear on the label.
      return (
        <DescriptionEditor
          value={cfg.handleAddress.text}
          base={cfg.handleAddress}
          onChange={(md) =>
            update((c) => { c.handleAddress.text = md.split("\n")[0]; })}
        />
      );
    case "barcode":
      return (
        <div className="space-y-1">
          <Input
            id="upc" className="h-6 w-full font-mono text-xs" value={cfg.upc}
            onChange={(e) => update((c) => { c.upc = e.target.value.trim(); })}
          />
          {errors.upc && <p className="text-xs text-destructive">{errors.upc}</p>}
        </div>
      );
    case "qr":
      // The QR payload is derived from the beer name and has no field of its
      // own, so show what will actually be encoded. title carries the full
      // string: the column is too narrow for a whole URL, and truncating
      // without one would hide the tail for good.
      return (
        <p
          title={qrUrl(cfg.beerName)}
          className="truncate font-mono text-[11px] text-muted-foreground"
        >
          {qrUrl(cfg.beerName)}
        </p>
      );
    case "collabLead":
      // The lead-in's text is fixed; only whether the collab block renders
      // at all is editable here.
      return <CollabSwitch cfg={cfg} update={update} />;
    case "collabLeft":
    case "collabCenter":
      return <CollabSlotContent id={id} cfg={cfg} update={update} files={files} />;
    case "logo":
      // The laurel is drawn as a box at a fixed cy — unlike a text element
      // there is no baseline field to move it with, hence the nudge.
      return <StackNudge cfg={cfg} update={update} />;
    case "background":
      return (
        <FileDrop
          label="Texture PNG/JPG"
          accept={{ "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] }}
          fileName={files.texture.fileName}
          previewUrl={files.texture.previewUrl}
          onFile={files.texture.onFile}
        />
      );
    case "mask":
      return (
        <FileDrop
          label="Metallic mask PNG (optional)"
          accept={{ "image/png": [".png"] }}
          fileName={files.mask.fileName}
          previewUrl={files.mask.previewUrl}
          error={files.mask.error}
          onFile={files.mask.onFile}
        />
      );
    case "wordmark":
    case "warning":
      // Fixed template art/text: nothing to edit beyond style.
      return null;
  }
}

/** The shared style stack for an element layer — unchanged in behavior from
 *  the old panel: fill, plate select, bold where applicable, tracking for
 *  glyph layers, and the outer stroke toggle with color/width. */
function ElementStyle(props: { id: ElementId; cfg: LabelConfig; update: Update }) {
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

  return (
    <div className="space-y-3">
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

export function Inspector(props: {
  /** Never null: App collapses the whole inspector column instead of
   *  rendering an empty state when nothing is selected. */
  id: LayerId;
  cfg: LabelConfig;
  /** Validation messages, already composed by App. Keys: "name", "upc". */
  errors: Record<string, string>;
  update: Update;
  files: InspectorFiles;
  /** Clears the selection, which collapses the inspector column. */
  onClose: () => void;
}): React.JSX.Element {
  const id = props.id;
  const isEl = isElementId(id);
  const label = isEl ? elementById(id).label : DOC_LAYER_LABELS[id];
  const Icon = LAYER_ICONS[id];
  const content = (
    <Content id={id} cfg={props.cfg} errors={props.errors} update={props.update} files={props.files} />
  );
  // wordmark/warning render Content as null — show a muted note instead of
  // an empty section, so the section's absence reads as intentional.
  const noContent = id === "wordmark" || id === "warning";

  // Restores this element's shipped appearance — read from defaultConfig(),
  // not a hardcoded gold/metallic/none triple, so elements that ship with a
  // deliberate deviation (the logo's dark keyline) reset to THEIR default
  // rather than losing it.
  const reset = isEl
    ? () => {
        const el = elementById(id);
        const d = el.style(defaultConfig());
        props.update((c) =>
          applyStyle(c, id, {
            fill: d.fill,
            layer: d.layer,
            stroke: d.stroke ?? "none",
            strokeWidth: d.strokeWidth,
            letterSpacing: d.letterSpacing,
            ...(el.hasBold ? { bold: (d as StyledLine).bold ?? false } : {}),
          }));
      }
    : undefined;
  const dirty = isEl && !isDefaultStyle(id, elementById(id).style(props.cfg));

  return (
    <div className="space-y-1 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Icon className="size-3.5" />
          {label}
        </span>
        <span className="flex items-center gap-1">
          {dirty && (
            <Button
              variant="ghost" size="sm" className="h-6 px-2 text-[11px]"
              onClick={reset}
            >
              Reset
            </Button>
          )}
          <Button
            variant="ghost" size="icon" className="size-6"
            aria-label="Close inspector" onClick={props.onClose}
          >
            <X className="size-3" />
          </Button>
        </span>
      </div>

      <Heading>Content</Heading>
      {noContent ? (
        <p className="text-[11px] text-muted-foreground">Fixed template art — nothing to edit.</p>
      ) : (
        content
      )}

      {/* Document layers (background/mask) carry no Style stack — they are
          file drops only, so the section is omitted rather than shown
          disabled. */}
      {isEl && (
        <>
          <Heading>Style</Heading>
          <ElementStyle id={id} cfg={props.cfg} update={props.update} />
        </>
      )}
    </div>
  );
}
