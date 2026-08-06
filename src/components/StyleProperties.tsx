// StyleProperties.tsx — the right-hand Inspector: one panel shaped by the
// selected layer, Figma-style. Replaces both the old contextual style panel
// (which existed only while an element was selected) and LabelForm's field
// rows: the Content section carries whatever the layer is made of (text
// input, markdown editor, file drop, scale/nudge knobs), the Style section
// carries the shared fill/layer/bold/stroke stack. Document-level layers
// (background, mask) are file drops only — no Style section. Selection
// itself lives in the layers panel and the preview; this component only
// receives the chosen LayerId.
import { X } from "lucide-react";
import type { LabelConfig, StyledLine } from "@/types";
import { applyStyle, elementById, isDefaultStyle, type ElementId } from "@/elements";
import { DOC_LAYER_LABELS, LAYER_ICONS, isElementId, type LayerId } from "@/components/layers";
import { defaultConfig, displayName } from "@/defaults";
import { ColorField } from "./ColorField";
import { ScrubField } from "./ScrubField";
import { DescriptionEditor } from "./DescriptionEditor";
import { FileDrop } from "./FileDrop";
import { MetallicToggle } from "./MetallicToggle";
import { BarcodePresetBar, BeerStylePresetBar } from "./PresetBar";
import { PAGE } from "@/layout";

/** The label's short side in inches. canScene scales the corner radius off
 *  min(width, height) of the label texture, i.e. the page height. */
const LABEL_SHORT_IN = PAGE.h / 72;
/** Corner radius display conversion: stored as % of the short side. */
const pctToInches = (pct: number) => (pct / 100) * LABEL_SHORT_IN;
import { machineName, qrUrl } from "@/qr";
import { DEFAULT_STROKE_PX } from "@/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

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

/** Document-presentation knobs the Settings layer edits — session-level 3D
 *  view options that live in App, not in the saved config. Percentages: the
 *  corner radius is % of the label's short edge, size is % of can height. */
export interface DocSettings {
  cornerRadius: number;
  onCornerRadius: (v: number) => void;
  labelSize: number;
  onLabelSize: (v: number) => void;
  /** Foil-mask blur, % of label width — softens the metallic edges. */
  edgeSoftness: number;
  onEdgeSoftness: (v: number) => void;
}

/** All build-time file assets the inspector can edit, grouped so App passes
 *  one prop: the texture and mask (Document layers) plus the collab logos. */
export interface InspectorFiles {
  texture: { fileName?: string; previewUrl?: string; onFile: (f: File) => void };
  mask: { fileName?: string; previewUrl?: string; error?: string; onFile: (f: File) => void };
  collab: CollabFiles;
}

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
      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
        <Switch
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
  files: InspectorFiles; settings: DocSettings;
}): React.JSX.Element | null {
  const { id, cfg, errors, update, files, settings } = props;
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
        <div className="space-y-1">
          <Input
            id={machineName(elementById(id).label)}
            className="h-6 w-full text-xs"
            value={(elementById(id).style(cfg) as StyledLine).text}
            onChange={(e) =>
              update((c) => { (elementById(id).style(c) as StyledLine).text = e.target.value; })}
          />
          {/* Beer styles repeat across labels, so the Style line — and only
              it — carries a preset library (see presets.json). */}
          {id === "styleLine" && (
            <BeerStylePresetBar
              current={(elementById(id).style(cfg) as StyledLine).text}
              onApply={(text) =>
                update((c) => { (elementById(id).style(c) as StyledLine).text = text; })}
            />
          )}
        </div>
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
          {/* Barcodes get reused across beers, so they live in presets.json
              rather than being retyped from a label proof each time. */}
          <BarcodePresetBar
            upc={cfg.upc}
            onApply={(upc) => update((c) => { c.upc = upc; })}
          />
        </div>
      );
    case "qr":
      // The QR payload is derived from the beer name and has no field of its
      // own, so show what will actually be encoded. title carries the full
      // string: the column is too narrow for a whole URL, and truncating
      // without one would hide the tail for good.
      return (
        <p
          title={qrUrl(displayName(cfg))}
          className="truncate font-mono text-[11px] text-muted-foreground"
        >
          {qrUrl(displayName(cfg))}
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
    case "settings":
      // Document-wide presentation knobs for the 3D views: corner radius
      // shapes the die-cut label (alphaMap in canScene), label size is its
      // height as a share of the can's. The print PDFs are untouched — the
      // physical label is cut and sized at the press, not rendered.
      return (
        <div className="space-y-2">
          {/* Shown in inches — the unit a die-cut is specified in — while the
              stored value stays a percentage of the label's short side, which
              is what canScene's alphaMap consumes. */}
          <ScrubField
            id="doc-corner-radius" label="Corner radius" unit={'"'}
            value={pctToInches(settings.cornerRadius)}
            min={0} max={pctToInches(5)} step={0.005} dragStep={0.005}
            onChange={(inches) => settings.onCornerRadius((inches / LABEL_SHORT_IN) * 100)}
          />
          <ScrubField
            id="doc-label-size" label="Label size" unit="%"
            value={settings.labelSize} min={50} max={95} step={1}
            onChange={settings.onLabelSize}
          />
          {/* Blur on the foil mask's edges: 0 = hard specular outlines
              around every metallic element, higher = softer transitions. */}
          <ScrubField
            id="doc-edge-softness" label="Edge softness" unit="%"
            value={settings.edgeSoftness} min={0} max={1} step={0.01} dragStep={0.01}
            onChange={settings.onEdgeSoftness}
          />
        </div>
      );
    case "wordmark":
    case "warning":
      // Fixed template art/text: nothing to edit beyond style — say so
      // rather than rendering an empty section.
      return <p className="text-[11px] text-muted-foreground">Fixed template art — nothing to edit.</p>;
  }
}

/** The style stack for an element layer, Figma-style groups: Ink (fill +
 *  metallic toggle in one row), Text (bold switch + tracking, glyph layers
 *  only), and Stroke (switch header; color + width while on). Same
 *  applyStyle writes as ever — only the arrangement changed. */
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
  const metallic = s.layer === "metallic";
  const fid = machineName(el.label); // prefixes this panel's control ids

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Heading>Color</Heading>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <ColorField
              id={`${fid}-fill`} value={s.fill} onChange={(v) => set({ fill: v })}
              allowNone={el.allowNone}
            />
          </div>
          {/* Same metallic toggle as the layer rows — plate choice is part
              of the ink, so it sits beside the color. */}
          <MetallicToggle
            pressed={metallic}
            onPressedChange={(on) => set({ layer: on ? "metallic" : "white" })}
            className="size-6 border border-input"
          />
        </div>
      </div>

      {(el.hasBold || el.isText) && (
        <div className="space-y-1">
          {/* "Typography", not "Text": the content section above is now
              titled Text, and two same-named sections would read as one. */}
          <Heading>Typography</Heading>
          <div className="flex items-center gap-3">
            {el.hasBold && (
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch
                  id={`${fid}-bold`}
                  checked={bold}
                  onCheckedChange={(v) => set({ bold: v === true })}
                />
                Bold
              </label>
            )}
            {el.isText && (
              // Clamped both ends by ScrubField: tracking wide enough to
              // overrun the label reads as a broken line, not a style.
              <div className="min-w-0 flex-1">
                <ScrubField
                  id={`${fid}-tracking`} label="Letter Spacing" unit="pt"
                  value={s.letterSpacing ?? 0} min={-2} max={20} step={0.01} dragStep={0.1}
                  onChange={(v) => set({ letterSpacing: v })}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Heading>Stroke</Heading>
          <Switch
            id={`${fid}-stroke`}
            checked={strokeOn}
            aria-label="Outer stroke"
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
  /** Never null: App closes the whole inspector sheet instead of rendering
   *  an empty state when nothing is selected. */
  id: LayerId;
  cfg: LabelConfig;
  /** Validation messages, already composed by App. Keys: "name", "upc". */
  errors: Record<string, string>;
  update: Update;
  files: InspectorFiles;
  settings: DocSettings;
  /** Clears the selection, which closes the inspector sheet. */
  onClose: () => void;
}): React.JSX.Element {
  const id = props.id;
  const isEl = isElementId(id);
  const label = isEl ? elementById(id).label : DOC_LAYER_LABELS[id];
  const Icon = LAYER_ICONS[id];

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
            variant="ghost" size="icon" className="size-11"
            aria-label="Close inspector" onClick={props.onClose}
          >
            <X className="size-6" />
          </Button>
        </span>
      </div>

      <Heading>Text</Heading>
      <Content id={id} cfg={props.cfg} errors={props.errors} update={props.update}
        files={props.files} settings={props.settings} />

      {/* Document layers (background/mask) carry no Style stack — they are
          file drops only, so the section is omitted rather than shown
          disabled. */}
      {isEl && <ElementStyle id={id} cfg={props.cfg} update={props.update} />}
    </div>
  );
}
