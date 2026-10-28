// InPlacePlainField.tsx — the IN-PLACE editing session for a number or code
// text layer, opened by double-clicking it on the preview: one plain box over
// the layer's drawn glyphs at label metrics (turned with the text for a
// rotated layer), with the sidebar's validation error under it. Split out of
// PreviewCompare.tsx (#433), which owns when a session opens and closes.
import type { MeasureFace } from "@/plan";
import { useTranslation } from "@/i18n";
import { facesOf } from "@/planLayers";
import type { LayerBox } from "@/hittestLayers";
import type { TextLayer, TextLine } from "@/model/layers";
import { uppercaseOf } from "@/model/layers";
import { validateLayerInput } from "@/model/fields";
import { PAGE, trackedWidth } from "@/layout";
import { FACE_WEIGHT } from "@/fonts";
import { cn } from "@/lib/utils";
import { cqh, inkOf, pageBox, SEL_PAD } from "./previewOverlay";

/** The IN-PLACE session for a number/code layer: the value as typed, flagged
 *  (not stripped) when the sidebar's check rejects it. */
export function InPlacePlainField(props: {
  layer: TextLayer;
  fontCss: string;
  /** The layer's drawn box, label-space points, BLEED_SHIFT applied. */
  box: LayerBox;
  /** The canvas's own measure, so a suffix lands where the render puts it. */
  measure: MeasureFace;
  onApply: (lines: TextLine[]) => void;
  /** Ends the session, keeping what was typed: Enter or Escape. */
  onClose: () => void;
  /** Click-away guard (see PreviewCompare's pointerdown capture effect). */
  fieldRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const { layer, fontCss, box: b, measure, onApply, onClose, fieldRef } = props;
  const st = layer.style;
  const rotated = layer.rotation === 90;
  const faces = facesOf(layer);
  const size = layer.size;
  const typed = layer.lines[0]?.text ?? "";
  const ls = st.letterSpacing ?? 0;
  // A suffixed field (the ABV's unit tail) has to END where its glyphs
  // end, so the redrawn tail lands where the render will put it: the
  // same measure the canvas draws with, plus the one trailing gap CSS
  // letter-spacing adds after the last glyph, plus 2px of caret room.
  const fieldWidth = layer.suffix
    ? `calc(${cqh(trackedWidth(measure(typed, size, faces.base, layer.fontFamily), typed, ls) + ls)} + 2px)`
    : "100%";
  // The sidebar's check: input kept as typed, a bad value flagged.
  const check = typed === "" ? { ok: true } : validateLayerInput(layer, typed);
  const errorId = `${layer.id}-inplace-error`;
  // The chip hangs under the box, or over it when the box sits in the
  // sheet's bottom fifth; it grows leftward from a box right of centre. Either
  // way it stays inside the preview frame, which clips.
  const chipAt = cn(b.y + b.h > PAGE.h * 0.8 ? "bottom-full mb-2" : "top-full mt-2",
    b.x + b.w / 2 > PAGE.w / 2 ? "right-0" : "left-0");
  return (
    <div
      ref={fieldRef}
      className="absolute"
      style={{
        ...pageBox(b.x, b.y, b.w, b.h, SEL_PAD),
        fontSize: cqh(size),
        lineHeight: 1,
        fontFamily: fontCss,
        fontWeight: FACE_WEIGHT[faces.base],
        // Unkerned like drawPlate; the input inherits it through
        // preflight's `font: inherit` (#144).
        fontKerning: "none",
        letterSpacing: cqh(ls),
        color: inkOf(st),
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* The row the field sits on. Unrotated it just fills the box;
          rotated it is the SAME row, sized to the drawn column, centred
          in the (tall, narrow) box and turned -90deg to match the
          canvas. */}
      <div
        className="absolute flex items-center"
        style={rotated ? {
          left: "50%",
          top: "50%",
          width: cqh(b.h),
          height: cqh(b.w),
          transform: "translate(-50%, -50%) rotate(-90deg)",
        } : { inset: 0 }}
      >
        <input
          autoFocus
          value={typed}
          aria-label={t("Edit {{name}} text", { name: layer.name.toLowerCase() })}
          aria-invalid={!check.ok || undefined} aria-describedby={check.ok ? undefined : errorId}
          onFocus={(e) => {
            const end = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(end, end);
          }}
          onChange={(e) => onApply([{ ...st, text: e.target.value }])}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") onClose();
          }}
          className={cn("h-full bg-transparent outline-none caret-sky-400",
            !layer.suffix && "px-1")}
          style={{
            width: fieldWidth,
            textAlign: layer.align === "center" ? "center" : layer.align === "right" ? "right" : "left",
            textTransform: uppercaseOf(layer) ? "uppercase" : undefined,
          }}
        />
        {layer.suffix && (
          // The drawn tail is hidden with its layer for the session, so
          // the editor redraws it, uneditable, right after the value.
          <span className="whitespace-nowrap">{layer.suffix}</span>
        )}
      </div>
      {!check.ok && (
        // Outside the rotated row so it reads level; UI face, clear of the ticks.
        <p id={errorId} className={cn("absolute whitespace-nowrap rounded-sm bg-popover px-1 font-sans text-xs font-normal leading-4 tracking-normal normal-case text-destructive-text shadow-sm", chipAt)}>{check.error}</p>
      )}
    </div>
  );
}
