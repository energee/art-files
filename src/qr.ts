// qr.ts — pure QR geometry. Builds the module matrix with qrcode-generator
// (margin 0, matching the barcode-qr app) and emits styled shapes: either
// round data dots + circular finder rings (the Labradorite label's "dots"
// style, still the default) or plain/rounded module squares, per QrOptions.
import qrcode from "qrcode-generator";

/** Beer title -> machine name: lowercase, non-alphanumeric runs -> "-". */
export function machineName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function qrUrl(beerName: string): string {
  return `https://lolev.beer/beer/${machineName(beerName)}`;
}

export interface QrOptions {
  style?: "square" | "rounded" | "dots";
  ecLevel?: "L" | "M" | "Q" | "H";
  /** Quarter turn counter-clockwise, matching LayerBase.rotation. Applied to
   *  the unit-space shapes, so every backend (PDF, canvas, PSD) gets the
   *  rotation for free out of qrPath — no placed-item transform anywhere. */
  rotation?: 0 | 90;
}

export interface QrShapes {
  count: number; // modules per side
  /** Data module centers in unit space (0..1), excluding finder patterns.
   *  Populated only for the "dots" style. */
  dots: { cx: number; cy: number }[];
  /** Finder pattern centers in unit space; drawn as ring + center dot.
   *  Populated only for the "dots" style. */
  finders: { cx: number; cy: number }[];
  /** Unit-space top-left corners of every dark module, finders INCLUDED —
   *  populated only for the "square"/"rounded" styles, which paint every
   *  dark module the same way instead of styling finders separately. */
  squares?: { x: number; y: number }[];
  moduleSize: number; // unit-space module size (1/count)
  /** Which style produced these shapes, so qrPath knows how to render them
   *  without the caller re-passing options. */
  style: "square" | "rounded" | "dots";
}

// Last-call memo: each preview rebuild asks for the same payload twice (art
// then mask mode), and repeats it across rebuilds whenever the edit didn't
// touch the beer name or options — the matrix encode is the expensive step.
let lastShapes: { key: string; shapes: QrShapes } | null = null;

export function qrShapes(data: string, opts?: QrOptions): QrShapes {
  const style = opts?.style ?? "dots";
  const ecLevel = opts?.ecLevel ?? "L";
  const rotation = opts?.rotation ?? 0;
  const key = `${data}|${style}|${ecLevel}|${rotation}`;
  if (lastShapes?.key === key) return lastShapes.shapes;
  const built = buildShapes(data, style, ecLevel);
  const shapes = rotation === 90 ? rotate90(built) : built;
  lastShapes = { key, shapes };
  return shapes;
}

/** A quarter turn counter-clockwise in unit space (y grows down, so CCW on
 *  screen sends a point to (y, 1 - x)). Centers map straight across; a
 *  square is stored by its TOP-LEFT corner, so its rotated corner is one
 *  module up from the mapped original. The matrix is square, so the box —
 *  and therefore every caller's layout — is unchanged. */
function rotate90(s: QrShapes): QrShapes {
  const ms = s.moduleSize;
  return {
    ...s,
    dots: s.dots.map((d) => ({ cx: d.cy, cy: 1 - d.cx })),
    finders: s.finders.map((f) => ({ cx: f.cy, cy: 1 - f.cx })),
    squares: s.squares?.map((q) => ({ x: q.y, y: 1 - q.x - ms })),
  };
}

/** qrcode-generator's Byte mode keeps only `charCodeAt(i) & 0xff`; pass the
 *  UTF-8 bytes one per char so non-ASCII text scans back exactly (ASCII is
 *  unchanged). Local, instead of patching the shared `qrcode.stringToBytes`. */
const utf8 = new TextEncoder();
function utf8ByteString(s: string): string {
  return String.fromCharCode(...utf8.encode(s));
}

function buildShapes(
  data: string,
  style: "square" | "rounded" | "dots",
  ecLevel: "L" | "M" | "Q" | "H",
): QrShapes {
  const qr = qrcode(0, ecLevel);
  qr.addData(utf8ByteString(data || " "));
  qr.make();
  const count = qr.getModuleCount();
  const ms = 1 / count;
  const inFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);

  if (style !== "dots") {
    const squares: { x: number; y: number }[] = [];
    for (let r = 0; r < count; r++)
      for (let c = 0; c < count; c++)
        if (qr.isDark(r, c)) squares.push({ x: c * ms, y: r * ms });
    return { count, dots: [], finders: [], squares, moduleSize: ms, style };
  }

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
    style,
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

/** SVG path for a square module at unit-space top-left (x,y), side `s`, grown
 *  by `grow` on every edge; `radius` > 0 rounds the corners with arcs. */
function square(x: number, y: number, s: number, grow: number, radius: number): string {
  const x0 = x - grow, y0 = y - grow, side = s + 2 * grow;
  if (radius <= 0) return `M ${x0} ${y0} h ${side} v ${side} h ${-side} Z`;
  const r = Math.min(radius, side / 2);
  return (
    `M ${x0 + r} ${y0} ` +
    `h ${side - 2 * r} a ${r} ${r} 0 0 1 ${r} ${r} ` +
    `v ${side - 2 * r} a ${r} ${r} 0 0 1 ${-r} ${r} ` +
    `h ${-(side - 2 * r)} a ${r} ${r} 0 0 1 ${-r} ${-r} ` +
    `v ${-(side - 2 * r)} a ${r} ${r} 0 0 1 ${r} ${-r} Z`
  );
}

/** One combined SVG path (nonzero fill) for the whole QR at a given size in
 *  points; suitable for pdf-lib drawSvgPath and for an <path> element. */
export function qrPath(shapes: QrShapes, size: number, grow = 0): string {
  const parts: string[] = [];
  const ms = shapes.moduleSize * size;

  if (shapes.squares) {
    const radius = shapes.style === "rounded" ? 0.25 * ms : 0;
    for (const sq of shapes.squares)
      parts.push(square(sq.x * size, sq.y * size, ms, grow, radius));
    return parts.join(" ");
  }

  for (const d of shapes.dots)
    parts.push(circle(d.cx * size, d.cy * size, ms * 0.5 * 0.92 + grow));
  for (const f of shapes.finders) {
    parts.push(circle(f.cx * size, f.cy * size, 3.5 * ms * 0.95 + grow));
    parts.push(circle(f.cx * size, f.cy * size, 2.3 * ms - grow, true));
    parts.push(circle(f.cx * size, f.cy * size, 1.4 * ms + grow));
  }
  return parts.join(" ");
}
