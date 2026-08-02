// qr.ts — pure QR geometry. Builds the module matrix with qrcode-generator
// (ECC L, margin 0, matching the barcode-qr app) and emits styled shapes:
// round data dots + circular finder rings, as seen on the Labradorite label.
import qrcode from "qrcode-generator";

export interface QrShapes {
  count: number; // modules per side
  /** Data module centers in unit space (0..1), excluding finder patterns. */
  dots: { cx: number; cy: number }[];
  /** Finder pattern centers in unit space; drawn as ring + center dot. */
  finders: { cx: number; cy: number }[];
  moduleSize: number; // unit-space module size (1/count)
}

export function qrShapes(data: string): QrShapes {
  const qr = qrcode(0, "L");
  qr.addData(data || " ");
  qr.make();
  const count = qr.getModuleCount();
  const ms = 1 / count;
  const inFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);
  const dots: { cx: number; cy: number }[] = [];
  for (let r = 0; r < count; r++)
    for (let c = 0; c < count; c++)
      if (qr.isDark(r, c) && !inFinder(r, c))
        dots.push({ cx: (c + 0.5) * ms, cy: (r + 0.5) * ms });
  const f = 3.5 * ms;
  return {
    count,
    dots,
    finders: [
      { cx: f, cy: f },
      { cx: 1 - f, cy: f },
      { cx: f, cy: 1 - f },
    ],
    moduleSize: ms,
  };
}

/** SVG path for a circle at (cx,cy); ccw=true reverses winding so a smaller
 *  inner circle cuts a hole under the nonzero fill rule (finder rings). */
function circle(cx: number, cy: number, r: number, ccw = false): string {
  const sweep = ccw ? 0 : 1;
  return (
    `M ${cx - r} ${cy} ` +
    `a ${r} ${r} 0 1 ${sweep} ${2 * r} 0 ` +
    `a ${r} ${r} 0 1 ${sweep} ${-2 * r} 0 Z`
  );
}

/** One combined SVG path (nonzero fill) for the whole QR at a given size in
 *  points; suitable for pdf-lib drawSvgPath and for an <path> element. */
export function qrPath(shapes: QrShapes, size: number): string {
  const parts: string[] = [];
  const ms = shapes.moduleSize * size;
  for (const d of shapes.dots)
    parts.push(circle(d.cx * size, d.cy * size, ms * 0.5 * 0.92));
  for (const f of shapes.finders) {
    parts.push(circle(f.cx * size, f.cy * size, 3.5 * ms * 0.95));
    parts.push(circle(f.cx * size, f.cy * size, 2.3 * ms, true));
    parts.push(circle(f.cx * size, f.cy * size, 1.4 * ms));
  }
  return parts.join(" ");
}
