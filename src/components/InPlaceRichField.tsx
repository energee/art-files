// InPlaceRichField.tsx — the IN-PLACE editing session for a rich text
// layer, opened by double-clicking it on the preview: TextEditor's rich-lines
// field positioned over the layer's drawn glyphs at label metrics, with its
// Header/Bold/White-ink pill portaled to <body>. Split out of
// PreviewCompare.tsx (#433), which owns when a session opens and closes.
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { facesOf } from "@/planLayers";
import type { LayerBox } from "@/hittestLayers";
import type { Face } from "@/plan";
import type { TextLayer, TextLine } from "@/model/layers";
import { uppercaseOf } from "@/model/layers";
import { FONT_ASC, FONT_DESC, PAGE } from "@/layout";
import type { Style } from "@/types";
import { FACE_WEIGHT } from "@/fonts";
import { TextToolbarButtons, useTextField, type LinePaint } from "./TextEditor";
import { corner, cqh, inkOf } from "./previewOverlay";

/** An in-place field's painter for a text layer: plain runs in the layer's
 *  base face, bold runs / header lines in its bold face (facesOf — the same
 *  pair planLayers draws with), white-ink lines white, everything else in
 *  the layer's ink. FACE_WEIGHT is the one face→CSS-weight table measure and
 *  draw already share. whitespace-pre because the renderer wraps only by an
 *  explicit `width`, so the editor must not wrap on its own. */
function paintFor(faces: { base: Face; bold: Face }, st: Style): LinePaint {
  const plainWeight = String(FACE_WEIGHT[faces.base]);
  const boldWeight = String(FACE_WEIGHT[faces.bold]);
  const ink = inkOf(st);
  return (el, l) => {
    el.className = "whitespace-pre outline-none";
    el.style.fontWeight = l.bold || l.header ? boldWeight : plainWeight;
    el.style.color = l.white ? "#FFFFFF" : ink;
  };
}

/** The IN-PLACE session for a rich text layer: the same rich-lines engine as
 *  the sidebar field (useTextField), but the contenteditable sits over the
 *  layer's own spot on the sheet at label metrics, so `**bold**` and
 *  `_white ink_` show as bold and white ink rather than as punctuation. The
 *  canvas skips the layer for the session (see PreviewCompare's onEditSession), so this DOM
 *  text IS the layer while you type, and the Header/Bold/White-ink toggles
 *  float above it as a fixed pill, portaled to <body> so App's CSS zoom
 *  scales the text with the artwork but never the toolbar chrome. */
export function InPlaceRichField(props: {
  layer: TextLayer;
  fontCss: string;
  /** The layer's drawn box, label-space points, BLEED_SHIFT applied. */
  box: LayerBox;
  /** Pill position, viewport px, captured once at open. */
  toolbarPos: { left: number; top: number };
  onApply: (lines: TextLine[]) => void;
  onUppercase: (uppercase: boolean) => void;
  /** Ends the session: Escape asks to undo it (`cancel`). */
  onClose: (cancel: boolean) => void;
  /** Click-away guards — the field wrapper and the portaled pill both count
   *  as "inside the session" (see PreviewCompare's pointerdown capture effect). */
  fieldRef: React.RefObject<HTMLDivElement | null>;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { layer, fontCss, box, toolbarPos, onApply, onClose, fieldRef, toolbarRef } = props;
  const size = layer.size;
  const leading = (layer.leading ?? 1.2) * size;
  const faces = facesOf(layer);
  const rotated = layer.rotation === 90;
  // Rebuilt only when the layer's faces or ink change — the field seeds
  // from it, and every reseed repaints every line and run through it.
  const paint = useMemo(
    () => paintFor(faces, layer.style),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faces.base, faces.bold, layer.style.fill, layer.style.layer],
  );
  const { rootRef, caret, toggle, toggleHeader, fieldProps } = useTextField({
    lines: layer.lines, onChange: onApply, base: layer.style,
    uppercase: uppercaseOf(layer), paint,
  });

  // Focus with the caret at the end once on open — the hook's seed effect
  // registered first, so the line-divs exist by the time this runs.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(root);
      sel.collapseToEnd();
    }
  }, [rootRef]);

  // CSS positions the first BASELINE where the canvas drew it: the box's
  // leading edge is FONT_ASC beyond the baseline (see planLayers), while a
  // CSS line box of `leading` height centers the font's (FONT_ASC+FONT_DESC)
  // content area inside it — the half-leading difference is the offset
  // between the two. Rotated, that edge is the box's LEFT (the column grows
  // rightward from the baseline) rather than its top.
  const cross = ((FONT_ASC + FONT_DESC) * size - leading) / 2;
  // The room to type INTO, where the text grows: from the anchor point
  // outward per the layer's alignment — to the sheet's right edge for a
  // left-aligned block, symmetric about the anchor for a centred one, back
  // to the sheet's left edge for a right-aligned one. A declared wrap width
  // is the field's width instead. The rotated column reads bottom-to-top
  // from its own start, up to the sheet's top edge.
  const ax = box.x + (layer.align === "center" ? box.w / 2 : box.w);
  const align = layer.align === "justify" ? "left" : layer.align;
  let place: React.CSSProperties;
  if (rotated) {
    const bottom = box.y + box.h;
    place = {
      ...corner(box.x + cross, bottom),
      width: cqh(layer.width ?? bottom),
      transformOrigin: "0 0",
      transform: "rotate(-90deg)",
    };
  } else if (layer.width !== undefined) {
    place = { ...corner(box.x, box.y + cross), width: `${(layer.width / PAGE.w) * 100}%` };
  } else if (align === "center") {
    const half = Math.min(ax, PAGE.w - ax);
    place = { ...corner(ax - half, box.y + cross), width: `${((2 * half) / PAGE.w) * 100}%` };
  } else if (align === "right") {
    place = { ...corner(0, box.y + cross), width: `${(ax / PAGE.w) * 100}%` };
  } else {
    place = { ...corner(box.x, box.y + cross), width: `${((PAGE.w - box.x) / PAGE.w) * 100}%` };
  }
  return (
    <>
      <div
        ref={fieldRef}
        className="absolute"
        style={{
          ...place,
          fontSize: cqh(size),
          lineHeight: leading / size,
          fontFamily: fontCss,
          // Unkerned, like the canvas under it and the PDF (#86, #144).
          fontKerning: "none",
          letterSpacing: cqh(layer.style.letterSpacing ?? 0),
          textAlign: align,
        }}
        // The wrapper's click/dblclick handlers hit-test the canvas;
        // interacting with the editor must not re-select or reopen.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(true); }}
      >
        <div
          {...fieldProps}
          aria-label={`Edit ${layer.name.toLowerCase()} text`}
          className="outline-none caret-sky-400"
        />
      </div>
      {createPortal(
        <div
          ref={toolbarRef}
          className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-md"
          style={toolbarPos}
        >
          <TextToolbarButtons caret={caret} toggle={toggle} toggleHeader={toggleHeader}
            uppercase={uppercaseOf(layer)} onUppercase={props.onUppercase} />
        </div>,
        document.body,
      )}
    </>
  );
}
