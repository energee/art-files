// LayerInspectorSections.tsx — the inspector's per-kind sections: Position
// (guides, binding, rotation), the text/image/barcode/QR geometry and
// typography, and the Style stack (fill, plate, stroke). Each writes only
// through `set` with a minimal patch (LayerInspector.tsx's header). Split out
// of LayerInspector.tsx (#433).
import { useTranslation } from "@/i18n";
import { ChevronsUpDown, Heading1, Link2, Link2Off, RotateCcw, WholeWord } from "lucide-react";
import { bindingOf, guideOf, uppercaseOf } from "@/model/layers";
import type {
  BindingSide, BarcodeLayer, ImageLayer, Layer, QrLayer, Symbology, TextLayer,
} from "@/model/layers";
import type { DeepPartial } from "@/model/merge";
import type { Style } from "@/types";
import { DEFAULT_STROKE_PX } from "@/layout";
import { DEFAULT_EC_LEVEL } from "@/qr";
import { strokeLayerOf } from "@/strokes";
import { minModuleWarning } from "@/model/fields";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { ColorField } from "./ColorField";
import { MetallicToggle } from "./MetallicToggle";
import { ScrubField } from "./ScrubField";
import { CharacterHeight } from "./CharacterHeight";
import { FONT_FAMILIES, fontFamilyOf, type FontFamilyId } from "@/fontCatalog";
import {
  BlankableField, DimensionField, Field, Heading, PT, Row, Segmented, SelectField, SwitchRow,
  useInspectorOptions, type Ctx,
} from "./LayerInspectorControls";

export function Position(props: Ctx & {
  layer: Layer; layerNames: readonly { id: string; name: string }[]; onUnbind: () => void; onBind?: (to: string, side: BindingSide) => void;
}) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const { hGuides, vGuides } = useInspectorOptions();
  const id = layer.id;
  const y = layer.y;
  const binding = bindingOf(layer);
  const horizontal = binding?.side === "left" || binding?.side === "right";
  const others = props.layerNames.filter((n) => n.id !== id);
  const nameOf = (lid: string) => props.layerNames.find((n) => n.id === lid)?.name ?? lid;
  return (
    <div className="space-y-1.5">
      <Heading>{t("Position")}</Heading>
      {!horizontal && <>
      <Row badge={badge(["x"], "X")}>
        <DimensionField
          id={`${id}-x`} label={guideOf(layer.guideX) ? t("X offset") : "X"} unit={props.unit} value={layer.x}
          min={-2000} max={2000} {...PT}
          onChange={(x) => set({ x })}
        />
      </Row>
      <Segmented
        label={t("Horizontal guide")} value={guideOf(layer.guideX)}
        options={hGuides}
        badge={badge(["guideX", "anchor"], t("Horizontal guide"))}
        onChange={(guideX) => set({ guideX, x: 0, anchor: guideX })}
      />
      </>}
      {(!binding || horizontal) && typeof y === "number" && (
        <>
          <Row badge={badge(["y"], "Y")}>
            <DimensionField
              id={`${id}-y`} label={guideOf(layer.guideY) ? t("Y offset") : "Y"} unit={props.unit} value={y}
              min={-2000} max={2000} {...PT}
              onChange={(v) => set({ y: v })}
            />
          </Row>
          <Segmented
            label={t("Vertical guide")} value={guideOf(layer.guideY)}
            options={vGuides}
            badge={badge(["guideY", "vAnchor"], t("Vertical guide"))}
            onChange={(guideY) => set({ guideY, y: 0, vAnchor: guideY === "bottom" ? "bottom" : "top" })}
          />
        </>
      )}
      {!binding ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <Button variant="outline" size="xs" className="w-full" disabled={!props.onBind || others.length === 0}>
              <Link2 className="size-3" /> {t("Bind to layer…")}
            </Button>
          } />
          <DropdownMenuContent align="start">
            {others.map((n) => (
              <DropdownMenuSub key={n.id}>
                <DropdownMenuSubTrigger aria-label={t("Bind to {{name}}", { name: n.name })}>{n.name}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(["top", "left", "right", "bottom"] as const).map((side) => (
                    <DropdownMenuItem key={side} aria-label={t("Bind to {{side}} of {{name}}", { side: t(side), name: n.name })}
                      className="text-xs" onClick={() => props.onBind?.(n.id, side)}>
                      {t(side)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Field label={t("Bound to")} badge={badge(["binding", "y"], t("Binding"))}>
            <span className="flex items-center gap-1 text-xs font-medium">
              <Link2 className="size-3 text-muted-foreground" aria-hidden="true" />{nameOf(binding.to)}
            </span>
          </Field>
          <Field label={t("Side")}>
            <Select value={binding.side} onValueChange={(side) => {
              if (side === "top" || side === "left" || side === "right" || side === "bottom") props.onBind?.(binding.to, side);
            }}>
              <SelectTrigger size="sm" aria-label={t("Binding side")} className="h-6 text-xs"><SelectValue>{t(binding.side[0].toUpperCase() + binding.side.slice(1))}</SelectValue></SelectTrigger>
              <SelectContent>
                {(["top", "left", "right", "bottom"] as const).map((side) =>
                  <SelectItem key={side} value={side}>{t(side[0].toUpperCase() + side.slice(1))}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Row badge={badge(["binding", "y"], t("Gap"))}>
            <DimensionField id={`${id}-gap`} label={t("Gap")} unit={props.unit} value={binding.gap}
              min={-500} max={500} {...PT}
              onChange={(gap) => layer.binding
                ? set({ binding: { ...binding, gap } })
                : set({ y: { below: binding.to, gap } })} />
          </Row>
          <Button variant="outline" size="xs" className="w-full" onClick={props.onUnbind}>
            <Link2Off className="size-3" /> {t("Unbind")}
          </Button>
        </>
      )}
      {/* Image layers are the one kind no backend rotates: raster art places
          as a bare rect with no transform, so honoring it would mean adding
          one to all three backends. Hide the control rather than ship a
          toggle that silently does nothing. */}
      {layer.kind !== "image" && (
      <Field label={t("Rotation")} badge={badge(["rotation"], t("Rotation"))}>
        <Toggle
          size="sm" variant="outline"
          pressed={layer.rotation === 90}
          onPressedChange={(on) => set({ rotation: on ? 90 : 0 })}
          aria-label={t("Rotate 90°")}
          title={t("Rotate 90° counter-clockwise (reads bottom to top)")}
        >
          <RotateCcw className="size-3.5" /> 90°
        </Toggle>
      </Field>
      )}
    </div>
  );
}

export function TextGeometry(props: Ctx & { layer: TextLayer; fontFamily?: string }) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const { aligns } = useInspectorOptions();
  const id = layer.id;
  return (
    <div className="space-y-1.5">
      <Heading>{t("Typography")}</Heading>
      <Row badge={badge(["fontFamily"], t("Font"))}>
        <Field label={t("Font")}>
          <Select value={layer.fontFamily ?? "inherit"}
            onValueChange={(value) => set({ fontFamily: value === "inherit" ? undefined : value as FontFamilyId })}>
            <SelectTrigger size="sm" aria-label={t("Font")} className="h-7 w-40 text-xs">
              <SelectValue>{layer.fontFamily ? FONT_FAMILIES[layer.fontFamily].label : t("Default ({{font}})", { font: FONT_FAMILIES[fontFamilyOf(props)].label })}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">{t("Default ({{font}})", { font: FONT_FAMILIES[fontFamilyOf(props)].label })}</SelectItem>
              {Object.entries(FONT_FAMILIES).map(([value, font]) => (
                <SelectItem key={value} value={value}>{font.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Row>
      <Row badge={badge(["size"], t("Size"))}>
        <ScrubField
          id={`${id}-size`} label={t("Size")} unit="pt" unitTitle={t("Type size is always points")} value={layer.size}
          min={1} max={300} {...PT}
          onChange={(size) => set({ size })}
        />
      </Row>
      <CharacterHeight key={layer.fontFamily ?? props.fontFamily} layer={layer}
        family={fontFamilyOf({ fontFamily: layer.fontFamily ?? props.fontFamily })}
        onChange={(size) => set({ size })} />
      <Segmented
        label={t("Align")} value={layer.align} options={aligns}
        badge={badge(["align"], t("Align"))}
        onChange={(align) => set({ align })}
      />
      <BlankableField
        id={`${id}-width`} label={t("Wrap width")} unit={props.unit} key={props.unit} placeholder={t("none")}
        value={layer.width} min={1} max={2000} {...PT}
        badge={badge(["width"], t("Wrap width"))}
        onChange={(width) => set({ width })}
      />
      <Row badge={badge(["leading"], t("Leading"))}>
        <ScrubField
          id={`${id}-leading`} label={t("Line spacing")} icon={ChevronsUpDown} unit="×"
          value={layer.leading ?? 1.2} min={0.5} max={4} step={0.01} dragStep={0.05}
          onChange={(leading) => set({ leading })}
        />
      </Row>
      <Row badge={badge(["headerScale"], t("Header scale"))}>
        <ScrubField
          id={`${id}-header-scale`} label={t("Heading scale")} icon={Heading1} unit="×"
          value={layer.headerScale ?? 1} min={0.5} max={4} step={0.01} dragStep={0.05}
          onChange={(headerScale) => set({ headerScale })}
        />
      </Row>
      {/* Clamped both ends by the field: tracking wide enough to overrun
          the label reads as a broken line, not a style. */}
      <Row badge={badge(["style.letterSpacing"], t("Letter Spacing"))}>
        <ScrubField
          id={`${id}-tracking`} label={t("Letter spacing")} icon={WholeWord} unit="pt"
          unitTitle={t("Letter spacing is always points")}
          value={layer.style.letterSpacing ?? 0} min={-2} max={20} step={0.01} dragStep={0.1}
          onChange={(letterSpacing) => set({ style: { letterSpacing } })}
        />
      </Row>
      {/* A display transform, not an edit: the stored text keeps its
          typed case, which is what lets the QR's {name|slug} still read
          it. Legacy masters author it one level up, hence uppercaseOf. */}
      <SwitchRow
        label={t("Uppercase")} checked={uppercaseOf(layer)}
        badge={badge(["style.uppercase", "uppercase"], t("Uppercase"))}
        onChange={(uppercase) => set({ style: { uppercase } })}
      />

    </div>
  );
}

export function ImageGeometry(props: Ctx & { layer: ImageLayer; rasterArt?: boolean }) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const { fits } = useInspectorOptions();
  const id = layer.id;
  const page = layer.role === "background" || layer.role === "mask";
  const fit = (
    <SelectField id={`${id}-fit`} label={t("Fit")} ariaLabel={t("Fit")} badge={badge(["fit"], t("Fit"))}
        items={fits} value={layer.fit ?? "contain"} onChange={(v) => set({ fit: v as ImageLayer["fit"] })} />
  );
  // The page art (texture, metallic mask) always covers the whole page, so it
  // has no geometry to edit — not even Fit; the note says so instead.
  if (page) return <p className="text-xs text-muted-foreground">{t("Page art always covers the full page.")}</p>;
  return (
    <div className="space-y-1.5">
      <Heading>{t("Image")}</Heading>
      <Row badge={badge(["w"], t("Width"))}>
        <DimensionField
          id={`${id}-w`} label={t("Width")} unit={props.unit} value={layer.w}
          min={1} max={2000} {...PT}
          onChange={(w) => set({ w })}
        />
      </Row>
      <BlankableField
        id={`${id}-h`} label={t("Height")} unit={props.unit} key={props.unit} placeholder={t("auto")}
        value={layer.h} min={1} max={2000} {...PT}
        badge={badge(["h"], t("Height"))}
        onChange={(h) => set({ h })}
      />
      {fit}
      {/* Raster only: an SVG already takes the fill, so the switch would do
          nothing there. */}
      {props.rasterArt && (
        <SwitchRow
          label={t("Tint raster")} checked={!!layer.tintRaster}
          badge={badge(["tintRaster"], t("Tint raster"))}
          onChange={(tintRaster) => set({ tintRaster })}
        />
      )}
    </div>
  );
}

export function BarcodeGeometry(props: Ctx & { layer: BarcodeLayer }) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const { symbologies } = useInspectorOptions();
  const id = layer.id;
  const warning = minModuleWarning(layer.symbology, layer.moduleW);
  return (
    <div className="space-y-1.5">
      <Heading>{t("Barcode")}</Heading>
      <SelectField id={`${id}-symbology`} label={t("Symbology")} ariaLabel={t("Symbology")} badge={badge(["symbology"], t("Symbology"))}
        items={symbologies} value={layer.symbology} onChange={(v) => set({ symbology: v as Symbology })} />
      {/* min > 0: a typed zero would collapse the symbol to nothing rather
          than reading as "very narrow". */}
      <Row badge={badge(["moduleW"], t("Module width"))}>
        <DimensionField
          id={`${id}-modulew`} label={t("Module width")} unit={props.unit} value={layer.moduleW}
          min={0.01} max={10} step={0.01} dragStep={0.05}
          onChange={(moduleW) => set({ moduleW })}
        />
      </Row>
      {warning && <p className="text-[11px] text-warning-text">{warning}</p>}
      <Row badge={badge(["h"], t("Height"))}>
        <DimensionField
          id={`${id}-h`} label={t("Height")} unit={props.unit} value={layer.h}
          min={1} max={300} {...PT}
          onChange={(h) => set({ h })}
        />
      </Row>
      <SwitchRow
        label={t("Show digits")} checked={layer.showDigits ?? true}
        badge={badge(["showDigits"], t("Show digits"))}
        onChange={(showDigits) => set({ showDigits })}
      />
    </div>
  );
}

export function QrGeometry(props: Ctx & { layer: QrLayer }) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const { qrStyles, ecLevels } = useInspectorOptions();
  const id = layer.id;
  return (
    <div className="space-y-1.5">
      <Heading>{t("QR")}</Heading>
      <Row badge={badge(["size"], t("Size"))}>
        <DimensionField
          id={`${id}-size`} label={t("Size")} unit={props.unit} value={layer.size}
          min={1} max={300} {...PT}
          onChange={(size) => set({ size })}
        />
      </Row>
      <SelectField id={`${id}-qr-style`} label={t("Style")} ariaLabel={t("QR style")} badge={badge(["qrStyle"], t("QR style"))}
        items={qrStyles} value={layer.qrStyle} onChange={(v) => set({ qrStyle: v as QrLayer["qrStyle"] })} />
      {/* Match the renderer’s default (DEFAULT_EC_LEVEL) when the optional level is absent. */}
      <SelectField id={`${id}-ec`} label={t("Error correction")} ariaLabel={t("Error correction")} badge={badge(["ecLevel"], t("Error correction"))}
        items={ecLevels} value={layer.ecLevel ?? DEFAULT_EC_LEVEL} onChange={(v) => set({ ecLevel: v as QrLayer["ecLevel"] })} />
    </div>
  );
}

/** Fill + plate, tracking (text only), and the stroke stack — the same
 *  controls StyleProperties' ElementStyle offered, written as `style.*`
 *  patches. */
export function StyleSection(props: Ctx & { layer: Layer; rasterArt?: boolean }) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const id = layer.id;
  const style: Style = layer.style;
  const setStyle = (patch: DeepPartial<Style>) => set({ style: patch });
  const strokeOn = !!style.stroke && style.stroke !== "none";
  const isCode = layer.kind === "barcode" || layer.kind === "qr";
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Heading>{t("Color")}</Heading>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            {/* "No ink" is only offered where it can't break the layer: a
                code with no fill cannot scan. */}
            <ColorField
              id={`${id}-fill`} label={t("Fill")} value={style.fill} allowNone={!isCode}
              onChange={(fill) => setStyle({ fill })}
            />
          </div>
          {badge(["style.fill"], t("Fill"))}
          {/* Raster art prints its whole footprint on white ink whatever the
              plate says (the mask paints it solid), so the toggle would do
              nothing there. SVG art plans as paths and keeps it. */}
          {!props.rasterArt && (
            <>
              <MetallicToggle
                pressed={style.layer === "metallic"}
                disabled={style.fill === "none"}
                onPressedChange={(on) => setStyle({ layer: on ? "metallic" : "white" })}
                className="size-6 border border-input"
              />
              {badge(["style.layer"], t("Plate"))}
            </>
          )}
        </div>
        {props.rasterArt && (
          <p className="text-[11px] text-muted-foreground">
            {t("Raster art always prints on white ink. Use an SVG for metallic.")}
          </p>
        )}
      </div>


      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Heading>{t("Stroke")}</Heading>
          <span className="flex items-center gap-1.5">
            <Switch
              aria-label={t("Outer stroke")}
              checked={strokeOn}
              // Switching on starts from the useful colour for the kind: a
              // keyline for glyphs and art, the white halo a code needs to
              // scan over the texture.
              onCheckedChange={(on) =>
                setStyle({ stroke: on === true ? (isCode ? "#FFFFFF" : "#000000") : "none" })}
            />
            {/* One reset per state: here while the stroke is off, beside
                the colour while it is on. */}
            {!strokeOn && badge(["style.stroke"], t("Stroke"))}
          </span>
        </div>
        {strokeOn && (
          <>
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <ColorField
                  id={`${id}-stroke-color`} label={t("Stroke")} value={style.stroke!} allowNone={false}
                  onChange={(stroke) => setStyle({ stroke })}
                />
              </div>
              {badge(["style.stroke"], t("Stroke Color"))}
              <MetallicToggle
                label={t("Stroke")}
                pressed={strokeLayerOf(style) === "metallic"}
                onPressedChange={(on) => setStyle({ strokeLayer: on ? "metallic" : "white" })}
                className="size-6 border border-input"
              />
              {badge(["style.strokeLayer"], t("Stroke Plate"))}
            </div>
            {/* 60px cap: wider strokes swallow the letterforms long before
                the geometry breaks. */}
            <Row badge={badge(["style.strokeWidth"], t("Stroke Width"))}>
              <ScrubField
                id={`${id}-stroke-width`} label={t("Width")} unit="px" unitTitle={t("Stroke width is pixels at 600 DPI")}
                value={style.strokeWidth ?? DEFAULT_STROKE_PX} min={1} max={60} step={1}
                onChange={(strokeWidth) => setStyle({ strokeWidth })}
              />
            </Row>
            {layer.kind === "barcode" && (
              <SwitchRow
                label={t("Solid background")} checked={!!layer.solidBackground}
                badge={badge(["solidBackground"], t("Solid background"))}
                onChange={(solidBackground) => set({ solidBackground })}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
