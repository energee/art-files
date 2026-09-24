// logo.ts — turns logo2025.svg into normalized absolute path data, shared by
// both deliverable builders. Kept out of pdf/build.ts so the PSD builder can
// use it without importing the PDF renderer.
import svgpath from "svgpath";

/** Extract the logo's paths (basic shapes converted — see shapeToPath)
 *  pre-scaled to `width` points. Transforms are applied — each shape's own
 *  composed with its ancestor <g> transforms (text-outline exports carry
 *  their y-flip there) — and the output is normalized to absolute M/L/C/Z
 *  commands with rounded coordinates — pdf-lib's drawSvgPath cannot handle
 *  relative/shorthand/arc/H/V commands or its own scale option's
 *  exponent-notation output, and the PSD builder needs plain cubics to turn
 *  into bezier knots. */
export function parseLogo(
  svg: string,
  width: number,
  /** Optional height cap: with it the art is fitted into width x maxH (the
   *  larger scale that still fits both), which is what the collab slots need —
   *  a collab wordmark and a collab roundel have nothing like the same aspect,
   *  so scaling by width alone would let a tall mark run off its slot. */
  maxH?: number,
): { paths: string[]; w: number; h: number } {
  // Memoized: the preview builds re-parse the same laurel (and any dropped
  // SVG collab logo) twice per rebuild with identical inputs, and the
  // svgpath transform/unarc pipeline is the cost. The handful of live SVG
  // strings makes a plain Map fine.
  // ponytail: unbounded cache keyed by whole-SVG strings — add eviction only
  // if a session ever cycles through many distinct logos.
  const key = `${width}|${maxH ?? ""}`;
  let bySize = logoCache.get(svg);
  if (!bySize) logoCache.set(svg, (bySize = new Map()));
  let hit = bySize.get(key);
  if (!hit) bySize.set(key, (hit = parseLogoUncached(svg, width, maxH)));
  return hit;
}

const logoCache = new Map<string, Map<string, { paths: string[]; w: number; h: number }>>();

/** Emit a normalized path string: H/V become L, and quadratics (T is
 *  already Q after unshort()) become the exact cubic, C1 = P0 + 2/3(Q1 - P0),
 *  C2 = P2 + 2/3(Q1 - P2). Elevated before round() so the thirds round like
 *  every other number; returning an array from iterate() replaces the segment. */
function emit(p: ReturnType<typeof svgpath>): string {
  const out: string[] = [];
  const towardQ = (from: number, q: number) => from + (2 / 3) * (q - from);
  p.iterate((seg, _i, x, y) => {
    if (seg[0] !== "Q") return;
    const [, qx, qy, ex, ey] = seg;
    return [["C", towardQ(x, qx), towardQ(y, qy), towardQ(ex, qx), towardQ(ey, qy), ex, ey]];
  });
  p.round(4).iterate((seg, _i, x, y) => {
    if (seg[0] === "H") out.push(`L ${seg[1]} ${y}`);
    else if (seg[0] === "V") out.push(`L ${x} ${seg[1]}`);
    else out.push(seg.join(" "));
  });
  return out.join(" ");
}

/** Strip comments and the non-rendered containers (Illustrator wraps art in
 *  a <clipPath>) so their paths aren't drawn as ink or counted in the fit box
 *  (#68). One pass; `/>` is tried first so a self-closing <defs/> can't
 *  swallow the markup up to a later </defs>. */
function renderedOnly(svg: string): string {
  return svg.replace(/<!--[\s\S]*?-->|<(defs|clipPath|mask|symbol|pattern)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g, "");
}

/** Read one attribute's value from a start tag ("" when absent). */
function attr(tag: string, name: string): string {
  return tag.match(new RegExp(` ${name}="([^"]+)"`))?.[1] ?? "";
}

/** A tag's geometry as path data (#69): <path> as-is, the basic shapes
 *  converted per the SVG spec's equivalent-path rules. "" means the shape
 *  draws nothing (zero-size rect, zero-radius circle). Elements that render
 *  but aren't geometry we can fill — <use>, <text>, <image> — throw by name
 *  so a logo never loses art silently. */
function shapeToPath(name: string, tag: string): string {
  const n = (a: string) => +attr(tag, a) || 0;
  switch (name) {
    case "path": {
      const d = attr(tag, "d");
      if (!d) throw new Error("Logo path is missing d attribute");
      return d;
    }
    case "rect": {
      const x = n("x"), y = n("y"), w = n("width"), h = n("height");
      if (!(w > 0 && h > 0)) return "";
      // rx/ry: a missing one mirrors the other; both clamp to half the side.
      const rxA = attr(tag, "rx"), ryA = attr(tag, "ry");
      const rx = Math.min(+(rxA || ryA) || 0, w / 2), ry = Math.min(+(ryA || rxA) || 0, h / 2);
      if (!(rx > 0 && ry > 0)) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
      const arc = `A ${rx} ${ry} 0 0 1`;
      return `M ${x + rx} ${y} H ${x + w - rx} ${arc} ${x + w} ${y + ry} V ${y + h - ry} ` +
        `${arc} ${x + w - rx} ${y + h} H ${x + rx} ${arc} ${x} ${y + h - ry} V ${y + ry} ${arc} ${x + rx} ${y} Z`;
    }
    case "circle":
    case "ellipse": {
      const cx = n("cx"), cy = n("cy");
      const rx = n(name === "circle" ? "r" : "rx"), ry = name === "circle" ? rx : n("ry");
      if (!(rx > 0 && ry > 0)) return "";
      const arc = `A ${rx} ${ry} 0 1 0`;
      return `M ${cx - rx} ${cy} ${arc} ${cx + rx} ${cy} ${arc} ${cx - rx} ${cy} Z`;
    }
    case "polygon":
    case "polyline": {
      // Path grammar takes the implicit lineto after M, so the point list
      // drops straight in.
      const pts = attr(tag, "points").trim();
      return pts ? `M ${pts}${name === "polygon" ? " Z" : ""}` : "";
    }
    case "line":
      return `M ${n("x1")} ${n("y1")} L ${n("x2")} ${n("y2")}`;
    default:
      throw new Error(
        `Logo SVG uses <${name}>, which can't be placed — convert it to plain paths ` +
        "(outline text, expand/unlink clones, remove embedded images) and re-export.",
      );
  }
}

function parseLogoUncached(
  svg: string,
  width: number,
  maxH?: number,
): { paths: string[]; w: number; h: number } {
  // Walk the rendered <g> and drawing tags in document order, carrying the
  // ancestor <g> transforms down to each shape. Text-to-outline exports
  // (Illustrator, fontforge) wrap their paths in a group with a
  // scale(1,-1)-style matrix — font units are y-up — so reading only the
  // shape's own transform mirrors and flips the art. Transforms compose in
  // document order, which is exactly what svgpath's space-separated
  // transform string applies.
  const stack: string[] = [];
  const parsed: ReturnType<typeof svgpath>[] = [];
  // Every name here must have a case in shapeToPath (or reach its throw);
  // a drawing element missing from this list is silently skipped.
  const tags = /<\/g>|<(g|path|rect|circle|ellipse|polygon|polyline|line|use|text|image)\b[^>]*>/g;
  for (const m of renderedOnly(svg).matchAll(tags)) {
    const [tag, name] = m;
    if (!name) stack.pop(); // </g>
    else if (name === "g") {
      // A self-closing <g/> opens nothing: pushing it would leak its
      // transform onto every following sibling, with no </g> to pop it.
      if (!tag.endsWith("/>")) stack.push(attr(tag, "transform"));
    } else {
      const d = shapeToPath(name, tag);
      if (!d) continue;
      const tf = [...stack, attr(tag, "transform")].join(" ").trim();
      parsed.push(svgpath(d).transform(tf).abs().unshort().unarc());
    }
  }
  if (parsed.length === 0) throw new Error("Could not parse logo SVG paths");

  // The laurel path (no height cap): scale by the viewBox, exactly as ever —
  // LOGO_ASPECT and the shipped laurel geometry are measured against it.
  if (maxH === undefined) {
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    if (!vb) throw new Error("Could not parse logo SVG viewBox");
    const scale = width / +vb[1];
    return {
      paths: parsed.map((p) => emit(p.scale(scale))),
      w: +vb[1] * scale, h: +vb[2] * scale,
    };
  }

  // Collab slots: fit and center the INK, not the viewBox. An uploaded icon
  // whose drawing sits in a corner of an oversized viewBox (or a viewBox
  // with a non-zero origin, which the laurel regex above would reject)
  // would otherwise render tiny and off-center in its slot. The box comes
  // from every coordinate the segments carry — control points included, so
  // it can overestimate a curve's extent by a hair (a curve never leaves
  // its control polygon), which errs toward fitting INSIDE the slot.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parsed)
    p.iterate((seg) => {
      const [cmd, ...nums] = seg;
      if (cmd === "H") { minX = Math.min(minX, nums[0]!); maxX = Math.max(maxX, nums[0]!); }
      else if (cmd === "V") { minY = Math.min(minY, nums[0]!); maxY = Math.max(maxY, nums[0]!); }
      else for (let i = 0; i + 1 < nums.length; i += 2) {
        const px = nums[i]!, py = nums[i + 1]!;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
    });
  const bw = maxX - minX, bh = maxY - minY;
  if (!(bw > 0 && bh > 0)) throw new Error("Logo SVG has no drawable extent");
  const scale = Math.min(width / bw, maxH / bh);
  return {
    paths: parsed.map((p) => emit(p.translate(-minX, -minY).scale(scale))),
    w: bw * scale, h: bh * scale,
  };
}
