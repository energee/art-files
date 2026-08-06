// logo.ts — turns logo2025.svg into normalized absolute path data, shared by
// both deliverable builders. Kept out of pdf/build.ts so the PSD builder can
// use it without importing the PDF renderer.
import svgpath from "svgpath";

/** Extract the logo's paths pre-scaled to `width` points. Per-path transforms
 *  (the mirrored branch) are applied, and the output is normalized to absolute
 *  M/L/C/Z commands with rounded coordinates — pdf-lib's drawSvgPath cannot
 *  handle relative/shorthand/arc/H/V commands or its own scale option's
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

function parseLogoUncached(
  svg: string,
  width: number,
  maxH?: number,
): { paths: string[]; w: number; h: number } {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb) throw new Error("Could not parse logo SVG viewBox");
  const scale =
    maxH === undefined ? width / +vb[1] : Math.min(width / +vb[1], maxH / +vb[2]);
  const tags = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
  const paths = tags.map((tag) => {
    const d = tag.match(/ d="([^"]+)"/)?.[1];
    if (!d) throw new Error("Logo path is missing d attribute");
    const tf = tag.match(/ transform="([^"]+)"/)?.[1] ?? "";
    const out: string[] = [];
    svgpath(d)
      .transform(tf)
      .scale(scale)
      .abs()
      .unshort()
      .unarc()
      .round(4)
      .iterate((seg, _i, x, y) => {
        if (seg[0] === "H") out.push(`L ${seg[1]} ${y}`);
        else if (seg[0] === "V") out.push(`L ${x} ${seg[1]}`);
        else out.push(seg.join(" "));
      });
    return out.join(" ");
  });
  if (paths.length === 0) throw new Error("Could not parse logo SVG paths");
  return { paths, w: +vb[1] * scale, h: +vb[2] * scale };
}
