// previewOverlay.ts — PreviewCompare's overlay geometry: label-space points
// mapped onto the preview frame (pageBox, corner, cqh), the trim guide's
// dashed stroke and die-cut corners, the selection/resize ticks and their
// padding, the readout's inch format, and the on-screen ink of a style.
// Pure values and style objects, no React state. Split out of
// PreviewCompare.tsx (#433).
import type { ResizeHandle } from "@/model/edit";
import { ART, PAGE } from "@/layout";
import type { Style } from "@/types";

/** The eight selection ticks, which double as resize handles. hx/hy name
 *  the grabbed edge (-1 left/top, 0 not grabbed, 1 right/bottom); position
 *  and cursor follow from them. */
export const HANDLES = ([-1, 0, 1] as const).flatMap((hy) => ([-1, 0, 1] as const)
  .filter((hx) => hx || hy)
  .map((hx) => {
    const at = `${hy < 0 ? "-top-[3px]" : hy > 0 ? "-bottom-[3px]" : "top-1/2 -translate-y-1/2"} ${
      hx < 0 ? "-left-[3px]" : hx > 0 ? "-right-[3px]" : "left-1/2 -translate-x-1/2"}`;
    const cursor = !hx ? "cursor-ns-resize" : !hy ? "cursor-ew-resize" : hx === hy ? "cursor-nwse-resize" : "cursor-nesw-resize";
    const base = `absolute size-2 rounded-[1px] border border-sky-400 bg-background ${at}`;
    return { handle: { hx, hy } as ResizeHandle, key: `${hx},${hy}`, cls: `${base} pointer-events-auto touch-none ${cursor}`, clsLocked: base };
  }));

/** Breathing room between a layer's measured box and its selection
 *  outline, in screen px. */
export const SEL_PAD = 4;
/** The multi-selection group frame sits outside the per-layer rings. */
export const GROUP_PAD = SEL_PAD * 3;

/** Label points as the inches the readout speaks in — Photoshop's move/resize
 *  badge, three decimals. */
export const inches = (pt: number) => `${(pt / 72).toFixed(3)} in`;

/** Bleed per side, in label-space points: the gap between the trimmed art box
 *  and the printed page. The die cuts at ART, so the sheet's own corners are
 *  the die's, offset outward by this much. */
export const BLEED = ART.x;

/** A circular corner of `r` points, expressed against a box of `w` x `h`
 *  points. Percentages rather than px so the corner tracks the preview at any
 *  on-screen size (same reason pageBox works in percentages); the two-value
 *  `x / y` form keeps it circular in page space instead of letting each axis
 *  scale to its own edge, which is what a single percentage would do. */
export const cornerRadius = (r: number, w: number, h: number): React.CSSProperties => ({
  borderRadius: `${(r / w) * 100}% / ${(r / h) * 100}%`,
});

/** The die-cut radius in label-space points. The knob is a share of the
 *  label's short side (see settings.ts), and the label is the trimmed piece —
 *  so it measures against ART, not the bleed-inclusive page, and matches the
 *  same computation the 3D die uses in canScene. */
export const dieRadius = (pct: number) => (pct / 100) * Math.min(ART.w, ART.h);

const DASH = 6; // px per tone, so the cycle repeats every 2 * DASH
const dashes = (dir: string) =>
  `repeating-linear-gradient(${dir}, #000 0 ${DASH}px, #fff ${DASH}px ${DASH * 2}px)`;
/** The trim guide's stroke: alternating black and white dashes, one 1px line
 *  per edge — the marquee convention, for the reason the convention exists:
 *  black and white are the one pair with no shared blind spot over
 *  arbitrary label art (measured 4.60:1 worst case over a real texture). */
export const BLEED_STROKE: React.CSSProperties = {
  backgroundImage: [dashes("90deg"), dashes("90deg"), dashes("180deg"), dashes("180deg")].join(","),
  backgroundSize: "100% 1px, 100% 1px, 1px 100%, 1px 100%",
  backgroundPosition: "0 0, 0 100%, 0 0, 100% 0",
  backgroundRepeat: "no-repeat",
};

/** An overlay box positioned in page space: label-space points in, CSS
 *  percentages of the preview frame out, so it tracks the container at any
 *  on-screen size without its own resize handling. `pad` grows the box by n
 *  screen px on every side. Shared by the trim guide and the selection
 *  outlines, which must agree about the coordinate basis. */
export const pageBox = (
  x: number, y: number, w: number, h: number, pad = 0,
): React.CSSProperties => ({
  left: `calc(${(x / PAGE.w) * 100}% - ${pad}px)`,
  top: `calc(${(y / PAGE.h) * 100}% - ${pad}px)`,
  width: `calc(${(w / PAGE.w) * 100}% + ${pad * 2}px)`,
  height: `calc(${(h / PAGE.h) * 100}% + ${pad * 2}px)`,
});

/** Label-space points as a container-query length — a share of the preview's
 *  HEIGHT, which is the unit the in-place editors size glyphs, tracking and
 *  rotated rows in so they track the sheet at any zoom. Page x and y are the
 *  same points against a wrapper whose aspect ratio is locked to the page,
 *  so this is the right unit on both axes. */
export const cqh = (pt: number) => `${(pt / PAGE.h) * 100}cqh`;

/** Just pageBox's top-left corner, for an overlay that sizes itself. */
export const corner = (x: number, y: number): React.CSSProperties => ({
  left: `${(x / PAGE.w) * 100}%`,
  top: `${(y / PAGE.h) * 100}%`,
});

/** What a style paints as on screen: white-plate text renders white,
 *  anything else shows its fill (flat — the metallic sheen is the print's,
 *  not the screen's). */
export const inkOf = (st: Style) =>
  (st.layer === "white" || st.fill === "none" ? "#FFFFFF" : st.fill);
