// StyleProperties.tsx — the right-hand Inspector: one panel shaped by the
// selected layer, Figma-style. Replaces both the old contextual style panel
// (which existed only while an element was selected) and LabelForm's field
// rows: the Content section carries whatever the layer is made of (text
// input, markdown editor, file drop, scale/nudge knobs), the Style section
// carries the shared fill/layer/bold/stroke stack. Document-level layers
// (background, mask) are file drops only — no Style section. With two or
// more layers selected the Content section is dropped and the Style stack
// edits the whole selection at once, blanking any field they disagree about.
// Selection itself lives in App (see selection.ts), driven by the layers
// panel and the preview; this component only receives the chosen LayerIds.
import { Bold, WholeWord, X } from "lucide-react";
import type { LabelConfig, Style, StyledLine } from "@/types";
import {
  SHIPPED, applyStyle, elementById, isDefaultStyle,
  type ElementId, type LabelElement,
} from "@/elements";
import { DOC_LAYER_LABELS, LAYER_ICONS, isElementId, type LayerId } from "@/components/layers";
import { sharedValue } from "@/selection";
import { displayName } from "@/defaults";
import { strokeLayerOf } from "@/strokes";
import { ColorField } from "./ColorField";
import { ScrubField } from "./ScrubField";
import { DescriptionEditor } from "./DescriptionEditor";
import { FileDrop } from "./FileDrop";
import { MetallicToggle } from "./MetallicToggle";
import { ThemeSwitch } from "./ThemeSwitch";
import { BarcodePresetBar, BeerStylePresetBar } from "./PresetBar";
import { machineName, qrUrl } from "@/qr";
import {
  DEFAULT_STROKE_PX, LABEL_SHORT_IN, LABEL_WIDE_IN,
} from "@/layout";
import { BLEED_DRAG_STEP_IN, BLEED_STEP_IN, displayBleedIn } from "@/presets";
import { decimalsOf } from "@/numeric";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";

type Update = (fn: (c: LabelConfig) => void) => void;

/** A Settings knob STORED as a percentage (of `of` inches — the form
 *  canScene consumes) but SHOWN in inches, the unit a die-cut, a label and a
 *  press are specified in. One component for every such knob, so none can
 *  quietly go back to reading in percent and the percentage stays an
 *  implementation detail of the renderer rather than a conversion the
 *  operator does in their head.
 *
 *  Both directions round to the field's precision. The inches are rounded
 *  because a percentage converted to inches is a long float
 *  (0.12816666666666668) that says nothing at a 0.005 step; the percentage is
 *  rounded because it is what lands in presets.json, a file kept in git
 *  precisely so it can be read and diffed — one drag should not write
 *  82.06785137318255 into it. */
function InchField(props: {
  id: string; label: string;
  /** What the stored percentage is a percentage OF, in inches. */
  of: number;
  pct: number; minPct: number; maxPct: number;
  /** Display and drag granularity, in inches. */
  step: number;
  onPct: (pct: number) => void;
}) {
  const inches = (pct: number) => (pct / 100) * props.of;
  const decimals = decimalsOf(props.step);
  return (
    <ScrubField
      id={props.id} label={props.label} unit={'"'}
      value={Number(inches(props.pct).toFixed(decimals))}
      min={inches(props.minPct)} max={inches(props.maxPct)}
      step={props.step} dragStep={props.step}
      // Back to a percentage at the same precision the inches were shown in:
      // `of` inches per 100%, so one display step is 100/of percent.
      onChange={(v) => props.onPct(Number(((v / props.of) * 100).toFixed(decimals + 2)))}
    />
  );
}

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
  onClearLeft: () => void;
  onClearCenter: () => void;
}

/** Document-presentation knobs the Settings layer edits — 3D view options
 *  that live in App and persist to presets.json, not in the saved label
 *  config. Each is a percentage of a different thing (see RenderSettings for
 *  the list) and each is shown in inches by an InchField. */
export interface DocSettings {
  cornerRadius: number;
  onCornerRadius: (v: number) => void;
  /** Foil-mask blur, % of label width — softens the metallic edges. */
  edgeSoftness: number;
  onEdgeSoftness: (v: number) => void;
  /** Export resolution in real DPI, NOT a percentage like the four above —
   *  the one knob here a press specifies directly. */
  dpi: number;
  onDpi: (v: number) => void;
  /** Bleed per side in inches — an absolute length, so it is NOT an InchField:
   *  that one converts a stored percentage, and there is nothing here for a
   *  percentage to be OF. */
  bleedIn: number;
  onBleedIn: (v: number) => void;
}

/** All build-time file assets the inspector can edit, grouped so App passes
 *  one prop: the texture and mask (Document layers) plus the collab logos. */
export interface InspectorFiles {
  texture: { fileName?: string; previewUrl?: string; onFile: (f: File) => void; onClear: () => void };
  mask: { fileName?: string; previewUrl?: string; error?: string; onFile: (f: File) => void; onClear: () => void };
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
 *  let it. Applied only while collab is on (see logoNudge): the nudge
 *  exists to clear the centre mark, so disabling collab returns the
 *  laurel to its laid-out spot while the value stays saved. */
function StackNudge(props: { cfg: LabelConfig; update: Update }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className="text-xs text-muted-foreground">Stack nudge</Label>
      <OffsetInput
        value={props.cfg.logo.offsetY}
        title="Move the laurel and the centre collab mark together, points (+ = down)"
        onChange={(v) => props.update((c) => { c.logo.offsetY = v; })}
      />
      <span className="text-[11px] text-muted-foreground">
        {props.cfg.collabEnabled ? "laurel + centre mark" : "applies while collab is on"}
      </span>
    </div>
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
        onClear={left ? c.onClearLeft : c.onClearCenter}
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
      // Free text, not a number input: the stored value is the bare figure
      // ("5.2") and build.ts prints "5.2% alc by vol", but ranges and "n/a"
      // have to stay typeable. The suffix names the unit a bare 5rem box
      // leaves to guess, and hides when the value already carries one.
      return (
        <div className="flex items-center gap-1.5">
          <Input
            id="abv" className="h-6 w-20 text-xs" value={cfg.abv}
            onChange={(e) => update((c) => { c.abv = e.target.value; })}
          />
          {!cfg.abv.includes("%") && (
            <span className="text-xs text-muted-foreground">% alc by vol</span>
          )}
        </div>
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
      // The lead-in's text is fixed, and the collab on/off switch lives on
      // the layers panel's Collab group header — nothing to edit here.
      return <p className="text-[11px] text-muted-foreground">Fixed template art — nothing to edit.</p>;
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
          onClear={files.texture.onClear}
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
          onClear={files.mask.onClear}
        />
      );
    case "settings":
      // Document-wide presentation knobs for the 3D views: corner radius
      // shapes the die-cut label (alphaMap in canScene), height and width say
      // how much of the can it covers. The print PDFs are untouched — the
      // physical label is cut and sized at the press, not rendered.
      // Every knob reads in inches (see InchField); each stays a percentage
      // in presets.json and in canScene, which is what those consume.
      return (
        <div className="space-y-2">
          {/* Die-cut corner radius, off the label's short side. */}
          <InchField
            id="doc-corner-radius" label="Corner radius" of={LABEL_SHORT_IN}
            // Sixteenths: a die is specified in them, and InchField's step is
            // also its display precision — at 0.005 the house 1/16" die reads
            // as 0.062.
            pct={settings.cornerRadius} minPct={0} maxPct={5} step={0.0625}
            onPct={settings.onCornerRadius}
          />
          {/* No label height/width knobs: the label wraps the can at the size
              the artboard says it is (see LABEL_HEIGHT_RATIO). */}
          {/* Blur on the foil mask's edges: 0 = hard specular outlines
              around every metallic element, wider = softer transitions.
              Measured across the label's width, like the renderer does. */}
          <InchField
            id="doc-edge-softness" label="Edge softness" of={LABEL_WIDE_IN}
            pct={settings.edgeSoftness} minPct={0} maxPct={1} step={0.001}
            onPct={settings.onEdgeSoftness}
          />
          {/* Real DPI, so a plain ScrubField rather than an InchField: the
              four knobs above are percentages shown in inches, but resolution
              is already in the unit the press asks for. Only the rastered
              PSD and the ruler's px readout follow it — stroke widths saved
              in px keep converting at DESIGN_DPI, so changing this resizes
              the file without reweighting any ink. */}
          <ScrubField
            id="doc-dpi" label="Resolution" unit="dpi"
            value={settings.dpi} min={72} max={1200} step={50} dragStep={10}
            onChange={settings.onDpi}
          />
          {/* Bleed per side, in inches. A plain ScrubField like the DPI above,
              and for the same reason: it is already the unit a press specifies
              it in. It grows the PAGE around a fixed 8x5in die, so the trim
              never changes — the toolbar's readout moves, its trim tooltip
              does not, and no element shifts relative to the cut.
              Displayed at the step's own precision (0.063 for the shipped
              0.063333...), the way InchField shows the house 1/16" die as
              0.062. That rounding is display-only, which is the one thing
              ScrubField does NOT do by default — it renders exactly what it is
              handed, on the assumption that a caller rounding for display also
              means to store the rounded value. Here that assumption does not
              hold, so commitBleedIn guards the way back.
              step is the TYPED precision and dragStep the coarser drag one:
              at a single 0.005 step ScrubField snapped every commit to three
              decimals, which turned the shipped 0.0635 into 0.064 the moment
              the field was touched. Ten-thousandths is the unit a bleed is
              quoted in, so it has to be the one the field commits at. */}
          <ScrubField
            id="doc-bleed" label="Bleed" unit={'"'}
            value={displayBleedIn(settings.bleedIn)}
            min={0} max={0.5} step={BLEED_STEP_IN} dragStep={BLEED_DRAG_STEP_IN}
            onChange={settings.onBleedIn}
          />
          {/* An app preference, not a document one — it lives here because
              Settings is the only preferences surface the app has, and it is
              deliberately not saved with the presets. */}
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">Appearance</Label>
            <ThemeSwitch />
          </div>
        </div>
      );
    case "wordmark":
    case "warning":
      // Fixed template art/text: nothing to edit beyond style — say so
      // rather than rendering an empty section.
      return <p className="text-[11px] text-muted-foreground">Fixed template art — nothing to edit.</p>;
  }
}

/** The style stack for one OR MANY element layers, Figma-style groups: Ink
 *  (fill + metallic toggle in one row), Text (bold switch + tracking, glyph
 *  layers only), and Stroke (switch header; color + width while on). Same
 *  applyStyle writes as ever — with several selected, one `update` runs the
 *  loop, so a multi-element edit is ONE history entry, not N.
 *
 *  Where the selected elements disagree about a value the field renders blank
 *  (`mixed`) rather than showing the first element's value as if it were
 *  everyone's; editing it still writes to all of them. */
function ElementStyle(props: {
  /** The selected elements, resolved by the caller (which already needed
   *  them for its dirty check). */
  els: readonly LabelElement[];
  cfg: LabelConfig;
  update: Update;
}) {
  const els = props.els;
  const el = els[0];
  const styles = els.map((e) => e.style(props.cfg));
  // Each element's own shipped stroke colour, for the toggle below. "none"
  // would make switching it on a no-op, so fall back to the keyline black.
  const shippedStrokeOf = (e: LabelElement) => {
    const shipped = e.style(SHIPPED).stroke;
    return !shipped || shipped === "none" ? "#000000" : shipped;
  };
  /** One field's readout across the selection: the shared value, or the
   *  first element's with `mixed` set when they disagree (see sharedValue).
   *  Spread straight into a ColorField/ScrubField — pairing `value` with its
   *  own `mixed` here is what keeps a field from claiming one element's
   *  value belongs to all of them, or from going uncontrolled when it has
   *  no shared value to show. A single selection is never mixed. */
  const field = <T,>(read: (s: Style) => T) => {
    const shared = sharedValue(styles.map(read));
    return { value: shared ?? read(styles[0]), mixed: shared === undefined };
  };
  const fill = field((s) => s.fill);
  const tracking = field((s) => s.letterSpacing ?? 0);
  const strokeColor = field((s) => s.stroke!);
  const strokeWidth = field((s) => s.strokeWidth ?? DEFAULT_STROKE_PX);
  const strokeOn = sharedValue(styles.map((s) => !!s.stroke && s.stroke !== "none"));
  const metallic = sharedValue(styles.map((s) => s.layer)) === "metallic";
  const strokeMetallic = sharedValue(styles.map(strokeLayerOf)) === "metallic";
  // `style()` is declared Style, but for hasBold elements the live object
  // backing it is actually a StyledLine (see elements.ts's ELEMENTS/applyStyle
  // comments) — the cast only ever runs when hasBold confirms that shape.
  const boldEls = els.filter((e) => e.hasBold);
  const bold = sharedValue(
    els.flatMap((e, i) => (e.hasBold ? [(styles[i] as StyledLine).bold ?? false] : [])));
  const anyText = els.some((e) => e.isText);
  /** One update for the whole selection = one undo step. `fn` reads each
   *  element, so a patch that depends on the element (its shipped stroke)
   *  goes through the same single write as a flat one. applyStyle drops the
   *  fields an element can't take (bold, tracking), so nothing is filtered
   *  here — that rule lives in the registry. */
  const setEach = (fn: (e: LabelElement) => Partial<StyledLine>) =>
    props.update((c) => { for (const e of els) applyStyle(c, e.id, fn(e)); });
  const set = (patch: Partial<StyledLine>) => setEach(() => patch);
  // Control ids must be unique on the page; a selection of several is
  // prefixed "multi" rather than by one arbitrary member's label.
  const fid = els.length === 1 ? machineName(el.label) : "multi";

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Heading>Color</Heading>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <ColorField
              id={`${fid}-fill`} {...fill} onChange={(v) => set({ fill: v })}
              // "No ink" is offered only when EVERY selected element allows
              // it: one unscannable code in the selection is enough to make
              // the option wrong for the whole edit.
              allowNone={els.every((e) => e.allowNone)}
            />
          </div>
          {/* Same metallic toggle as the layer rows — plate choice is part
              of the ink, so it sits beside the color. Mixed plates read as
              off; pressing it puts the whole selection on one plate. */}
          <MetallicToggle
            pressed={metallic}
            onPressedChange={(on) => set({ layer: on ? "metallic" : "white" })}
            className="size-6 border border-input"
          />
        </div>
      </div>

      {(boldEls.length > 0 || anyText) && (
        <div className="space-y-1">
          {/* "Typography", not "Text": the content section above is now
              titled Text, and two same-named sections would read as one. */}
          <Heading>Typography</Heading>
          <div className="space-y-1.5">
            {/* Only the elements whose registry entry accepts bold are
                counted — and only they are written (applyStyle drops it for
                the rest). A toggle button like the description toolbar's
                Bold and the Ink row's metallic, not a switch — same action,
                same control. It has no indeterminate state, so a mixed
                selection shows it off and says so in the tooltip. */}
            {boldEls.length > 0 && (
              <Toggle
                id={`${fid}-bold`}
                size="sm"
                pressed={bold ?? false}
                onPressedChange={(v) => set({ bold: v === true })}
                aria-label={bold === undefined ? "Bold (mixed)" : "Bold"}
                title={bold === undefined ? "Bold (mixed)" : "Bold"}
                className="size-6 border border-input"
              >
                <Bold className="size-3.5" />
              </Toggle>
            )}
            {anyText && (
              // Clamped both ends by ScrubField: tracking wide enough to
              // overrun the label reads as a broken line, not a style.
              <div className="min-w-0 flex-1">
                <ScrubField
                  id={`${fid}-tracking`} label="Letter Spacing" icon={WholeWord} unit="pt"
                  {...tracking} min={-2} max={20} step={0.01} dragStep={0.1}
                  onChange={(v) => set({ letterSpacing: v })}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Heading>{strokeOn === undefined ? "Stroke (mixed)" : "Stroke"}</Heading>
          <Switch
            id={`${fid}-stroke`}
            checked={strokeOn ?? false}
            aria-label="Outer stroke"
            // Switching a stroke on starts at whatever EACH element ships
            // with — black for everything keylined, the barcode's white halo
            // for the barcode — so defaults.ts stays the only place that
            // decides, and a new element needs no case here. Hence the loop
            // rather than one `set`: the on-colour is per element.
            onCheckedChange={(v) =>
              setEach((e) => ({ stroke: v === true ? shippedStrokeOf(e) : "none" }))}
          />
        </div>
        {/* Colour and width only while every selected element actually draws
            a stroke: with the selection half-stroked there is no one stroke
            for them to edit. */}
        {strokeOn === true && (
          <>
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <ColorField
                  id={`${fid}-stroke-color`} {...strokeColor}
                  onChange={(v) => set({ stroke: v })} allowNone={false}
                />
              </div>
              <MetallicToggle
                label="Stroke"
                pressed={strokeMetallic}
                onPressedChange={(on) =>
                  set({ strokeLayer: on ? "metallic" : "white" })}
                className="size-6 border border-input"
              />
            </div>
            {/* Clamped at 60px by ScrubField: each extra px adds stroke draw
                calls, and ring()'s sample ceiling is sized for that limit. */}
            <ScrubField
              id={`${fid}-stroke-width`} label="Width" unit="px"
              {...strokeWidth} min={1} max={60} step={1}
              onChange={(v) => set({ strokeWidth: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function Inspector(props: {
  /** The current selection, in click order. Never empty: App closes the
   *  whole inspector sheet instead of rendering an empty state. With two or
   *  more, only the Style section shows (see the Content note below). */
  ids: readonly LayerId[];
  cfg: LabelConfig;
  /** Validation messages, already composed by App. Keys: "name", "upc". */
  errors: Record<string, string>;
  update: Update;
  files: InspectorFiles;
  settings: DocSettings;
  /** Clears the selection, which closes the inspector sheet. */
  onClose: () => void;
}): React.JSX.Element {
  const ids = props.ids;
  const id = ids[0];
  const multi = ids.length > 1;
  // A multi-selection is elements only — App's resolveSelect never mixes a
  // document layer in (their panels edit files and document knobs, not
  // Styles), so `isEl` describes the whole selection.
  const isEl = isElementId(id);
  const els = ids.filter(isElementId).map(elementById);
  const label = isEl ? elementById(id).label : DOC_LAYER_LABELS[id];
  const Icon = LAYER_ICONS[id];

  // Restores each selected element's shipped appearance — read from
  // defaultConfig(), not a hardcoded gold/metallic/none triple, so elements
  // that ship with a deliberate deviation (the logo's dark keyline) reset to
  // THEIR default rather than losing it. One update for the whole selection,
  // so a multi-reset is a single undo step like every other edit here.
  // Unconditional: with no element selected the loop is a no-op, and the
  // button that calls it only renders while something is dirty.
  const reset = () =>
    props.update((c) => {
      for (const el of els) {
        const d = el.style(SHIPPED);
        applyStyle(c, el.id, {
          fill: d.fill,
          layer: d.layer,
          stroke: d.stroke ?? "none",
          strokeLayer: strokeLayerOf(d),
          strokeWidth: d.strokeWidth,
          letterSpacing: d.letterSpacing,
          ...(el.hasBold ? { bold: (d as StyledLine).bold ?? false } : {}),
        });
      }
    });
  const dirty = els.some((el) => !isDefaultStyle(el.id, el.style(props.cfg)));

  return (
    <div className="space-y-1 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          {/* With several selected there is no one layer icon to show, and
              the count is the thing that has to be unmistakable — an edit
              here lands on all of them. */}
          {multi ? `${ids.length} layers selected` : <><Icon className="size-3.5" />{label}</>}
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
            variant="ghost" size="icon" className="size-7"
            aria-label="Close inspector" onClick={props.onClose}
          >
            <X className="size-4" />
          </Button>
        </span>
      </div>

      {/* Content is single-selection only: there is no honest merge of a
          text field, a file drop and a UPC, so with several selected the
          inspector is the Style stack alone. */}
      {!multi && (
        <>
          <Heading>Text</Heading>
          <Content id={id} cfg={props.cfg} errors={props.errors} update={props.update}
            files={props.files} settings={props.settings} />
        </>
      )}

      {/* Document layers (background/mask) carry no Style stack — they are
          file drops only, so the section is omitted rather than shown
          disabled. */}
      {isEl && <ElementStyle els={els} cfg={props.cfg} update={props.update} />}
    </div>
  );
}
