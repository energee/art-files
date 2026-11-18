// LayerInspectorSections.tsx — the inspector's per-kind sections: Position
// (guides, binding, rotation), the text/image/barcode/QR geometry and
// typography, and the Style stack (fill, plate, stroke). Each writes only
// through `set` with a minimal patch (LayerInspector.tsx's header). Split out
// of LayerInspector.tsx (#433). Each is memoized on the part of the layer it
// reads, so typing or dragging re-renders only the sections it changes (#715).
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "@/i18n";
import { ChevronDownIcon, Link2, Link2Off, RotateCcw } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
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
import {
  Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { ColorField } from "./ColorField";
import { MetallicToggle } from "./MetallicToggle";
import { BadgeSlot, ScrubField } from "./ScrubField";
import { CharacterHeight } from "./CharacterHeight";
import { FONT_FAMILIES, fontFamily, fontFamilyOf, type FontFamilyId, type ImportedFontId } from "@/fontCatalog";
import { importedFamilies, labelFontCss, loadLabelFaces, registerImportedFont } from "@/fonts";
import { readImportedFont } from "@/fontImport";
import type { ImportedFont } from "@/labelfile";
import { importSystemFamily, listSystemFonts, type SystemFamily } from "@/systemFonts";
import { fileAsset, openThrough, readTarget } from "@/files";
import { fontFilter, fontTypes } from "@/filePickers";
import { notify } from "@/notify";
import { errMsg } from "@/lib/utils";
import { COARSE, useMedia } from "@/usePhoneLayout";
import {
  BlankableField, DimensionField, Field, FieldPair, Heading, PT, Segmented, SelectField, SwitchRow,
  ignoringContent, ignoringContentAndPlacement, useInspectorOptions, type Ctx,
} from "./LayerInspectorControls";

export const Position = memo(function Position(props: Ctx & {
  layer: Layer; layerNames: readonly { id: string; name: string }[]; onUnbind: () => void; onBind?: (to: string, side: BindingSide) => void;
  /** Several layers are selected: a binding is one layer's, so its rows and
   *  the Bind button are hidden. */
  multi?: boolean;
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
  // X and Y share one pair, and so do their guides; a side binding hides
  // one axis, and the other then takes the row alone (no half-empty pair).
  const showX = !horizontal;
  const showY = (!binding || horizontal) && typeof y === "number";
  const pair = (a: ReactNode, b: ReactNode) =>
    a && b ? <FieldPair>{a}{b}</FieldPair> : a || b;
  const xField = showX && (
    <DimensionField badge={badge(["x"], "X")}
      id={`${id}-x`} label={guideOf(layer.guideX) ? t("X offset") : "X"} unit={props.unit} value={layer.x}
      min={-2000} max={2000} {...PT} compact
      onChange={(x) => set({ x })}
    />
  );
  const yField = showY && (
    <DimensionField badge={badge(["y"], "Y")}
      id={`${id}-y`} label={guideOf(layer.guideY) ? t("Y offset") : "Y"} unit={props.unit} value={y}
      min={-2000} max={2000} {...PT} compact
      onChange={(v) => set({ y: v })}
    />
  );
  // A segmented row is label + three icons + badge, too wide for half of
  // the panel, so in a pair it stacks: label above, control below, its
  // badge after the control so the control lines up under the label. On a
  // touch screen the pair is one full-width column (FieldPair) and the row
  // stacks the same way.
  const stacked = (node: ReactNode) =>
    <div className="[&>div]:flex-col [&>div]:items-start [&>div]:gap-1 [&>div>span]:flex-row-reverse">{node}</div>;
  const hGuide = showX && (
    <Segmented
      label={t("Horizontal guide")} value={guideOf(layer.guideX)}
      options={hGuides}
      badge={badge(["guideX", "anchor"], t("Horizontal guide"))}
      onChange={(guideX) => set({ guideX, x: 0, anchor: guideX })}
    />
  );
  const vGuide = showY && (
    <Segmented
      label={t("Vertical guide")} value={guideOf(layer.guideY)}
      options={vGuides}
      badge={badge(["guideY", "vAnchor"], t("Vertical guide"))}
      onChange={(guideY) => set({ guideY, y: 0, vAnchor: guideY === "bottom" ? "bottom" : "top" })}
    />
  );
  // Image layers are the one kind no backend rotates: raster art places as
  // a bare rect with no transform, so honoring it would mean adding one to
  // all three backends. Hide the control rather than ship a toggle that
  // silently does nothing.
  const rotation = layer.kind !== "image" && (
    <span className="flex items-center gap-1.5">
      <BadgeSlot badge={badge(["rotation"], t("Rotation"))} />
      <Toggle
        size="sm" variant="outline"
        pressed={layer.rotation === 90}
        onPressedChange={(on) => set({ rotation: on ? 90 : 0 })}
        aria-label={t("Rotate 90°")}
        title={t("Rotate 90° counter-clockwise (reads bottom to top)")}
      >
        <RotateCcw className="size-3.5" /> 90°
      </Toggle>
    </span>
  );
  // Unbound, Bind is an icon button on Rotation's row; bound, the binding's
  // own rows (Bound to, Side, Gap, Unbind) replace it.
  const bind = !binding && !props.multi && (
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button variant="outline" size="icon-xs" aria-label={t("Bind to layer…")} title={t("Bind to layer…")}
          disabled={!props.onBind || others.length === 0}>
          <Link2 className="size-3" />
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
  );
  return (
    <div className="space-y-1.5">
      <Heading>{t("Position")}</Heading>
      {pair(xField, yField)}
      {hGuide && vGuide ? pair(stacked(hGuide), stacked(vGuide)) : hGuide || vGuide}
      {binding && !props.multi && (
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
          <DimensionField badge={badge(["binding", "y"], t("Gap"))} id={`${id}-gap`} label={t("Gap")} unit={props.unit} value={binding.gap}
            min={-500} max={500} {...PT}
            onChange={(gap) => layer.binding
              ? set({ binding: { ...binding, gap } })
              : set({ y: { below: binding.to, gap } })} />
          <Button variant="outline" size="xs" className="w-full" onClick={props.onUnbind}>
            <Link2Off className="size-3" /> {t("Unbind")}
          </Button>
        </>
      )}
      {(rotation || bind) && (
        <div className="group/reset flex items-center justify-between gap-2">
          {rotation && <Label className="text-xs text-muted-foreground">{t("Rotation")}</Label>}
          <span className="flex items-center gap-1.5">{bind}{rotation}</span>
        </div>
      )}
    </div>
  );
}, ignoringContent);

type TextProps = Ctx & { layer: TextLayer; fontFamily?: string };

/** Typography's rows around CharacterHeight, the one row that follows the
 *  text being typed: it stays out of the memoized halves so they can skip. */
export function TextGeometry(props: TextProps) {
  const { layer, set } = props;
  const setSize = useCallback((size: number) => set({ size }), [set]);
  return (
    <div className="space-y-1.5">
      <TextFace {...props} />
      <CharacterHeight key={layer.fontFamily ?? props.fontFamily} layer={layer}
        family={fontFamilyOf({ fontFamily: layer.fontFamily ?? props.fontFamily }, importedFamilies())}
        onChange={setSize} />
      <TextSetting {...props} />
    </div>
  );
}

/** One toast for Import Font…'s refusals, so a retry replaces the last. */
const FONT_IMPORT_TOAST = "font-import-error";

/** The Font list matches what you type against each row's shown name only
 *  (its keywords), never its value (a family id). */
const matchName = (_value: string, search: string, keywords?: string[]) =>
  keywords?.some((k) => k.toLowerCase().includes(search.trim().toLowerCase())) ? 1 : 0;

/** The Font control: a searchable list opened from the Font field. Rows:
 *  Default (the master's family), the bundled families, every imported
 *  family registered this session (the registry is shared by tabs; a save
 *  carries only the fonts its layers use), Import Font…, and on desktop a
 *  System Fonts group of installed families, listed when the list first
 *  opens. Picking a system family imports it into the file like Import Font…. */
const TextFace = memo(function TextFace(props: TextProps) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const id = layer.id;
  const coarse = useMedia(COARSE);
  const fontInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const desktop = isTauri();
  const [system, setSystem] = useState<SystemFamily[]>([]);
  // Registered imported families, so an imported font shows its own name.
  const imported = importedFamilies();
  const defaultFont = t("Default ({{font}})", { font: fontFamily(fontFamilyOf(props, imported), imported).label });
  const current = layer.fontFamily ?? "inherit";

  // The installed families, scanned once a session (systemFonts.ts). Until
  // they arrive the group is simply absent; a failed scan leaves it absent
  // and the next open tries again.
  useEffect(() => {
    if (!open || !desktop) return;
    let live = true;
    listSystemFonts().then((families) => { if (live) setSystem(families); }, () => {});
    return () => { live = false; };
  }, [open, desktop]);

  // Each row draws its name in its own font: register the bundled and
  // imported faces when the list opens (a family a layer already uses is
  // registered; the rest load here, once a session). Until a face arrives
  // its row shows in the interface font.
  useEffect(() => {
    if (!open) return;
    for (const family of [...Object.keys(FONT_FAMILIES), ...importedFamilies().keys()])
      loadLabelFaces(family as FontFamilyId).catch(() => {});
  }, [open]);

  /** Register a read font and set it as one patch (with several layers
   *  selected, the parent writes it to each text layer in one undo step).
   *  Any refusal is an error toast; the layer keeps its font. */
  const refuse = (err: unknown) =>
    notify.error(t("Could not import font: {{error}}", { error: errMsg(err) }), { id: FONT_IMPORT_TOAST });
  async function applyFont(read: Promise<{ id: ImportedFontId; font: ImportedFont }>) {
    try {
      const { id: fontId, font } = await read;
      await registerImportedFont(fontId, font);
      set({ fontFamily: fontId });
    } catch (err) {
      refuse(err);
    }
  }
  /** Import Font…: the native dialog on desktop, the browser's picker, or
   *  the hidden input where the browser has none. A cancel does nothing. */
  async function pickFont() {
    try {
      const targets = await openThrough({ filter: fontFilter(), types: fontTypes(), multiple: true });
      if (targets === undefined) fontInput.current?.click();
      else if (targets) await applyFont(Promise.all(targets.map(readTarget)).then(readImportedFont));
    } catch (err) {
      refuse(err); // the picker itself failed
    }
  }
  /** One row; picking it closes the list, then runs `pick`. `font` is the
   *  CSS font-family its name is drawn in, when it names a font. */
  const row = (value: string, label: string, pick: () => void, font?: string) => (
    <CommandItem key={value} value={value} keywords={[label]} data-checked={value === current}
      onSelect={() => { setOpen(false); pick(); }}>
      {/* The row's line keeps the interface font's height; the name sits on
          its baseline with no line height of its own, so a font declaring a
          huge ascent (STIX Size: 2.6 em) can't push it out of the row. */}
      <span className="truncate" title={label}>
        {font ? <span style={{ fontFamily: font, lineHeight: 0 }}>{label}</span> : label}
      </span>
    </CommandItem>
  );
  const setFont = (value: FontFamilyId | undefined) => () => set({ fontFamily: value });
  return (
    <>
      <Heading>{t("Typography")}</Heading>
      <Field label={t("Font")} badge={badge(["fontFamily"], t("Font"))}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={
            <Button type="button" variant="outline" size="sm" aria-label={t("Font")}
              className="h-7 w-40 justify-between px-2.5 text-xs font-normal" />
          }>
            <span data-slot="font-value" className="truncate">
              {layer.fontFamily ? fontFamily(layer.fontFamily, imported).label : defaultFont}
            </span>
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          </PopoverTrigger>
          {/* Sized to the longest name, at least the field's width; a name
              past max-w-80 truncates and keeps its full text as a title.
              A touch open leaves focus alone, so no keyboard covers the list. */}
          <PopoverContent align="start" initialFocus={(openType) => openType !== "touch"}
            className="w-auto min-w-(--anchor-width) max-w-80 gap-0 p-0">
            <Command filter={matchName}>
              <CommandInput placeholder={t("Search fonts")} />
              <CommandList>
                <CommandGroup>
                  {row("inherit", defaultFont, setFont(undefined), labelFontCss(fontFamilyOf(props, imported)))}
                  {Object.entries(FONT_FAMILIES).map(([value, font]) =>
                    row(value, font.label, setFont(value as FontFamilyId), labelFontCss(value as FontFamilyId)))}
                  {[...imported].map(([value, font]) => row(value, font.label, setFont(value), labelFontCss(value)))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  {row("import-font", t("Import Font…"), () => void pickFont())}
                </CommandGroup>
                {desktop && system.length > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading={t("System Fonts")}>
                      {/* An installed font draws by its own name; the
                          interface font stands in if the webview has none. */}
                      {system.map((family) => row(`system:${family.family}`, family.family,
                        () => void applyFont(importSystemFamily(family)), `${JSON.stringify(family.family)}, system-ui, sans-serif`))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {/* Import Font…'s fallback where the browser has no open picker. No
            `accept` on a touch screen, where a phone's picker can grey out a
            font it has no type for; readImportedFont refuses a wrong file. */}
        <input ref={fontInput} type="file" multiple accept={coarse ? undefined : ".ttf,.otf"} hidden
          onChange={(e) => {
            const files = [...e.target.files ?? []];
            e.target.value = "";
            if (files.length) void applyFont(Promise.all(files.map(fileAsset)).then(readImportedFont));
          }} />
      </Field>
      <ScrubField badge={badge(["size"], t("Size"))}
        id={`${id}-size`} label={t("Size")} unit="pt" unitTitle={t("Type size is always points")} value={layer.size}
        min={1} max={300} {...PT}
        onChange={(size) => set({ size })}
      />
    </>
  );
}, ignoringContentAndPlacement);

const TextSetting = memo(function TextSetting(props: TextProps) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const { aligns } = useInspectorOptions();
  const id = layer.id;
  return (
    <>
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
      <ScrubField badge={badge(["leading"], t("Leading"))}
        id={`${id}-leading`} label={t("Line spacing")} unit="×"
        value={layer.leading ?? 1.2} min={0.5} max={4} step={0.01} dragStep={0.05}
        onChange={(leading) => set({ leading })}
      />
      <ScrubField badge={badge(["headerScale"], t("Header scale"))}
        id={`${id}-header-scale`} label={t("Heading scale")} unit="×"
        value={layer.headerScale ?? 1} min={0.5} max={4} step={0.01} dragStep={0.05}
        onChange={(headerScale) => set({ headerScale })}
      />
      {/* Clamped both ends by the field: tracking wide enough to overrun
          the label reads as a broken line, not a style. */}
      <ScrubField badge={badge(["style.letterSpacing"], t("Letter Spacing"))}
        id={`${id}-tracking`} label={t("Letter spacing")} unit="pt"
        unitTitle={t("Letter spacing is always points")}
        value={layer.style.letterSpacing ?? 0} min={-2} max={20} step={0.01} dragStep={0.1}
        onChange={(letterSpacing) => set({ style: { letterSpacing } })}
      />
      {/* A display transform, not an edit: the stored text keeps its
          typed case, which is what lets the QR's {name|slug} still read
          it. Legacy masters author it one level up, hence uppercaseOf. */}
      <SwitchRow
        label={t("Uppercase")} checked={uppercaseOf(layer)}
        badge={badge(["style.uppercase", "uppercase"], t("Uppercase"))}
        onChange={(uppercase) => set({ style: { uppercase } })}
      />
    </>
  );
}, ignoringContentAndPlacement);

export const ImageGeometry = memo(function ImageGeometry(props: Ctx & { layer: ImageLayer; rasterArt?: boolean }) {
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
  // has no geometry to edit — not even Fit.
  if (page) return null;
  return (
    <div className="space-y-1.5">
      <Heading>{t("Image")}</Heading>
      <DimensionField badge={badge(["w"], t("Width"))}
        id={`${id}-w`} label={t("Width")} unit={props.unit} value={layer.w}
        min={1} max={2000} {...PT}
        onChange={(w) => set({ w })}
      />
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
}, ignoringContentAndPlacement);

export const BarcodeGeometry = memo(function BarcodeGeometry(props: Ctx & { layer: BarcodeLayer }) {
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
      <DimensionField badge={badge(["moduleW"], t("Module width"))}
        id={`${id}-modulew`} label={t("Module width")} unit={props.unit} value={layer.moduleW}
        min={0.01} max={10} step={0.01} dragStep={0.05}
        onChange={(moduleW) => set({ moduleW })}
      />
      {warning && <p className="text-[11px] text-warning-text">{warning}</p>}
      <DimensionField badge={badge(["h"], t("Height"))}
        id={`${id}-h`} label={t("Height")} unit={props.unit} value={layer.h}
        min={1} max={300} {...PT}
        onChange={(h) => set({ h })}
      />
      <SwitchRow
        label={t("Show digits")} checked={layer.showDigits ?? true}
        badge={badge(["showDigits"], t("Show digits"))}
        onChange={(showDigits) => set({ showDigits })}
      />
    </div>
  );
}, ignoringContentAndPlacement);

export const QrGeometry = memo(function QrGeometry(props: Ctx & { layer: QrLayer }) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const { qrStyles, ecLevels } = useInspectorOptions();
  const id = layer.id;
  return (
    <div className="space-y-1.5">
      <Heading>{t("QR")}</Heading>
      <DimensionField badge={badge(["size"], t("Size"))}
        id={`${id}-size`} label={t("Size")} unit={props.unit} value={layer.size}
        min={1} max={300} {...PT}
        onChange={(size) => set({ size })}
      />
      <SelectField id={`${id}-qr-style`} label={t("Style")} ariaLabel={t("QR style")} badge={badge(["qrStyle"], t("QR style"))}
        items={qrStyles} value={layer.qrStyle} onChange={(v) => set({ qrStyle: v as QrLayer["qrStyle"] })} />
      {/* Match the renderer’s default (DEFAULT_EC_LEVEL) when the optional level is absent. */}
      <SelectField id={`${id}-ec`} label={t("Error correction")} ariaLabel={t("Error correction")} badge={badge(["ecLevel"], t("Error correction"))}
        items={ecLevels} value={layer.ecLevel ?? DEFAULT_EC_LEVEL} onChange={(v) => set({ ecLevel: v as QrLayer["ecLevel"] })} />
    </div>
  );
}, ignoringContentAndPlacement);

/** Fill + plate, tracking (text only), and the stroke stack — the same
 *  controls StyleProperties' ElementStyle offered, written as `style.*`
 *  patches. */
export const StyleSection = memo(function StyleSection(props: Ctx & { layer: Layer; rasterArt?: boolean }) {
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
        <div className="group/reset flex items-center gap-1.5">
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
              plate says (the mask paints it solid), so the toggle is shown
              inert with the reason. SVG art plans as paths and keeps it. */}
          <MetallicToggle
            pressed={style.layer === "metallic"}
            disabled={style.fill === "none"}
            unavailable={props.rasterArt ? t("Raster art always prints on white ink. Use an SVG for metallic.") : undefined}
            onPressedChange={(on) => setStyle({ layer: on ? "metallic" : "white" })}
            className="size-6 border border-input"
          />
          {!props.rasterArt && badge(["style.layer"], t("Plate"))}
        </div>
      </div>


      <div className="space-y-1">
        <Heading control={
          <span className="flex items-center gap-1.5 touch:gap-3">
            {/* One reset per state: here while the stroke is off, beside
                the colour while it is on. The wider gap on touch keeps the
                switch's reach (switch.tsx) off the reset. */}
            <BadgeSlot badge={!strokeOn && badge(["style.stroke"], t("Stroke"))} />
            <Switch
              aria-label={t("Outer stroke")}
              checked={strokeOn}
              // Switching on starts from the useful colour for the kind: a
              // keyline for glyphs and art, the white halo a code needs to
              // scan over the texture.
              onCheckedChange={(on) =>
                setStyle({ stroke: on === true ? (isCode ? "#FFFFFF" : "#000000") : "none" })}
            />
          </span>
        }>{t("Stroke")}</Heading>
        {strokeOn && (
          <>
            <div className="group/reset flex items-center gap-1.5">
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
            <ScrubField badge={badge(["style.strokeWidth"], t("Stroke Width"))}
              id={`${id}-stroke-width`} label={t("Width")} unit="px" unitTitle={t("Stroke width is pixels at 600 DPI")}
              value={style.strokeWidth ?? DEFAULT_STROKE_PX} min={1} max={60} step={1}
              onChange={(strokeWidth) => setStyle({ strokeWidth })}
            />
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
}, ignoringContentAndPlacement);
