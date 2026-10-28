// outline.ts — converts placed text into fontkit glyph outlines for PDF white ink.
// Paths stay in label coordinates (top-left origin), ready for
// drawSvgPath(path, { x: 0, y: PAGE.h }).
import type { Font } from "@pdf-lib/fontkit";
import type { PlacedText } from "../plan";

type Pt = [number, number];
type Knot = { linked: false; points: [number, number, number, number, number, number] };

/** Neutral cubic paths structurally compatible with ag-psd's BezierPath. */
interface OutlinePath {
  readonly closed: true;
  readonly knots: readonly Knot[];
}

export interface GlyphPaths {
  readonly paths: readonly OutlinePath[];
  /** Control-point bounds in label coordinates, retained for PSD's barcode contract. */
  readonly bbox: { minX: number; maxX: number; minY: number; maxY: number };
}

const knot = (cIn: Pt, anchor: Pt, cOut: Pt): Knot => ({
  linked: false,
  points: [cIn[0], cIn[1], anchor[0], anchor[1], cOut[0], cOut[1]],
});

const closed = (knots: Knot[]): OutlinePath => ({ closed: true, knots });

/**
 * Use the same shaped glyph sequence as pdf-lib's text encoder, but its raw
 * advances rather than GPOS kerning or offsets. Tracking is applied once per
 * emitted glyph. `rotated` maps the 90° PDF placement back to label space.
 */
export function glyphPaths(
  font: Pick<Font, "unitsPerEm" | "layout">,
  text: string,
  size: number,
  rotated: boolean,
  anchorX: number,
  anchorY: number,
  tracking = 0,
): GlyphPaths {
  const scale = size / font.unitsPerEm;
  const paths: OutlinePath[] = [];
  const bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const track = (point: Pt) => {
    bbox.minX = Math.min(bbox.minX, point[0]);
    bbox.maxX = Math.max(bbox.maxX, point[0]);
    bbox.minY = Math.min(bbox.minY, point[1]);
    bbox.maxY = Math.max(bbox.maxY, point[1]);
  };
  let advance = 0;
  const glyphs = font.layout(text).glyphs;
  for (const glyph of glyphs) {
    const toLabel = rotated
      ? (x: number, y: number): Pt => [anchorX - y * scale, anchorY - (advance + x * scale)]
      : (x: number, y: number): Pt => [anchorX + advance + x * scale, anchorY - y * scale];
    let points: { anchor: Pt; in?: Pt; out?: Pt }[] = [];
    let last: Pt = [0, 0];
    const flush = () => {
      if (points.length >= 2)
        paths.push(closed(points.map((point) => knot(point.in ?? point.anchor, point.anchor, point.out ?? point.anchor))));
      points = [];
    };
    for (const command of glyph.path.commands) {
      if (command.command === "moveTo") {
        flush();
        last = toLabel(command.args[0], command.args[1]);
        points.push({ anchor: last });
        track(last);
      } else if (command.command === "lineTo") {
        last = toLabel(command.args[0], command.args[1]);
        points.push({ anchor: last });
        track(last);
      } else if (command.command === "quadraticCurveTo") {
        const control = toLabel(command.args[0], command.args[1]);
        const end = toLabel(command.args[2], command.args[3]);
        const c1: Pt = [last[0] + (2 / 3) * (control[0] - last[0]), last[1] + (2 / 3) * (control[1] - last[1])];
        const c2: Pt = [end[0] + (2 / 3) * (control[0] - end[0]), end[1] + (2 / 3) * (control[1] - end[1])];
        points[points.length - 1].out = c1;
        points.push({ anchor: end, in: c2 });
        track(control);
        track(end);
        last = end;
      } else if (command.command === "bezierCurveTo") {
        const c1 = toLabel(command.args[0], command.args[1]);
        const c2 = toLabel(command.args[2], command.args[3]);
        const end = toLabel(command.args[4], command.args[5]);
        points[points.length - 1].out = c1;
        points.push({ anchor: end, in: c2 });
        track(c1);
        track(c2);
        track(end);
        last = end;
      } else if (command.command === "closePath") {
        flush();
      }
    }
    flush();
    advance += glyph.advanceWidth * scale + tracking;
  }
  return { paths, bbox };
}

/** Convert label-space glyph paths to one compound SVG path for `drawSvgPath`. */
export function outlineText(font: Pick<Font, "unitsPerEm" | "layout">, item: PlacedText): string[] {
  const paths = glyphPaths(font, item.text, item.size, item.rotated, item.x, item.y, item.tracking).paths;
  if (!paths.length) return [];
  return [paths.map((path) => {
    const first = path.knots[0].points;
    let d = `M ${first[2]} ${first[3]}`;
    for (let i = 1; i < path.knots.length; i++) {
      const previous = path.knots[i - 1].points;
      const current = path.knots[i].points;
      d += ` C ${previous[4]} ${previous[5]} ${current[0]} ${current[1]} ${current[2]} ${current[3]}`;
    }
    const last = path.knots.at(-1)!.points;
    return `${d} C ${last[4]} ${last[5]} ${first[0]} ${first[1]} ${first[2]} ${first[3]} Z`;
  }).join(" ")];
}
