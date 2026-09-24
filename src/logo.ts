// logo.ts — turns logo2025.svg into normalized absolute path data, shared by
// both deliverable builders. Kept out of pdf/build.ts so the PSD builder can
// use it without importing the PDF renderer.
import svgpath from "svgpath";

/** Extract the logo's paths pre-scaled to `width` points. Transforms are
 *  applied — each path's own composed with its ancestor <g> transforms
 *  (text-outline exports carry their y-flip there) — and the output is
 *  normalized to absolute
 *  M/L/C/Z commands only (arcs, H/V and quadratics are all rewritten) with
 *  rounded coordinates — pdf-lib's drawSvgPath cannot handle
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

/** Emit a normalized path string, converting H/V to L and elevating
 *  quadratics (Q, and T once unshort() has made it a Q) to the exact
 *  equivalent cubic: C1 = P0 + 2/3(Q1 - P0), C2 = P2 + 2/3(Q1 - P2). The PSD
 *  builder only reads M/L/C/Z, so a Q left in dropped its whole subpath. */
function emit(p: ReturnType<typeof svgpath>): string {
  const out: string[] = [];
  // Elevate before round() so the thirds are rounded like every other number.
  // Returning an array from svgpath's iterate() replaces that segment.
  p.iterate((seg, _i, x, y) => {
    if (seg[0] !== "Q") return;
    const [, qx, qy, ex, ey] = seg;
    return [["C", x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
      ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]];
  });
  p.round(4).iterate((seg, _i, x, y) => {
    if (seg[0] === "H") out.push(`L ${seg[1]} ${y}`);
    else if (seg[0] === "V") out.push(`L ${x} ${seg[1]}`);
    else out.push(seg.join(" "));
  });
  return out.join(" ");
}

function parseLogoUncached(
  svg: string,
  width: number,
  maxH?: number,
): { paths: string[]; w: number; h: number } {
  // Walk <g>/<path> tags in document order, carrying the ancestor <g>
  // transforms down to each path. Text-to-outline exports (Illustrator,
  // fontforge) wrap their paths in a group with a scale(1,-1)-style matrix —
  // font units are y-up — so reading only the path's own transform mirrors
  // and flips the art. Transforms compose in document order, which is
  // exactly what svgpath's space-separated transform string applies.
  const transformOf = (tag: string) => tag.match(/ transform="([^"]+)"/)?.[1] ?? "";
  const stack: string[] = [];
  const parsed: ReturnType<typeof svgpath>[] = [];
  for (const m of svg.matchAll(/<g\b[^>]*>|<\/g>|<path\b[^>]*>/g)) {
    const tag = m[0];
    if (tag === "</g>") stack.pop();
    else if (tag.startsWith("<g")) {
      // A self-closing <g/> opens nothing: pushing it would leak its
      // transform onto every following sibling, with no </g> to pop it.
      if (!tag.endsWith("/>")) stack.push(transformOf(tag));
    } else {
      const d = tag.match(/ d="([^"]+)"/)?.[1];
      if (!d) throw new Error("Logo path is missing d attribute");
      const tf = [...stack, transformOf(tag)].join(" ").trim();
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
