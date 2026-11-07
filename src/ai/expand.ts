// expand.ts — stroke expansion for the Illustrator (.ai) export (#597,
// docs/plans/ai-export.md). The print PDF draws a keyline as a live 2w
// round-joined stroke under the fill; its visible part is the shape dilated
// by w. `dilate` computes that outline as filled path data, so the .ai file
// carries no live stroke. Skia PathOps (canvaskit-wasm/full, BSD-3) does the
// geometry; its 8 MB wasm loads on the first call only, never with the app.
import type { CanvasKit, Path } from "canvaskit-wasm";

let kit: Promise<CanvasKit> | undefined;

/** CanvasKit, loaded once. Node (tests, scripts/) reads the wasm beside the
 *  module; the webview fetches Vite's hashed asset, which needs
 *  'wasm-unsafe-eval' in the Tauri CSP (src-tauri/tauri.conf.json). */
function canvasKit(): Promise<CanvasKit> {
  kit ??= (async () => {
    const { default: init } = await import("canvaskit-wasm/full");
    if (globalThis.process?.versions?.node) return init();
    const { default: wasm } = await import("canvaskit-wasm/bin/full/canvaskit.wasm?url");
    return init({ locateFile: () => wasm });
  })();
  return kit;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** M/L/C/Z path data. Quads are raised to cubics exactly; conics (Skia's
 *  round joins and caps, at most 90° each) take the standard one-cubic
 *  approximation, under 0.03% of the radius off. */
function cubicOnly(ck: CanvasKit, path: Path): string {
  const c = path.toCmds();
  const out: string[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < c.length;) {
    const verb = c[i++];
    if (verb === ck.MOVE_VERB || verb === ck.LINE_VERB) {
      [x, y] = [c[i++], c[i++]];
      out.push(`${verb === ck.MOVE_VERB ? "M" : "L"}${fmt(x)} ${fmt(y)}`);
    } else if (verb === ck.QUAD_VERB || verb === ck.CONIC_VERB) {
      const [px, py, ex, ey] = [c[i++], c[i++], c[i++], c[i++]];
      const wt = verb === ck.CONIC_VERB ? c[i++] : 1;
      const k = (4 * wt) / (3 * (1 + wt));
      out.push(`C${fmt(x + k * (px - x))} ${fmt(y + k * (py - y))} ${fmt(ex + k * (px - ex))} ${fmt(ey + k * (py - ey))} ${fmt(ex)} ${fmt(ey)}`);
      [x, y] = [ex, ey];
    } else if (verb === ck.CUBIC_VERB) {
      const p = c.slice(i, i + 6);
      i += 6;
      out.push(`C${Array.from(p, fmt).join(" ")}`);
      [x, y] = [p[4], p[5]];
    } else if (verb === ck.CLOSE_VERB) {
      out.push("Z");
    } else {
      throw new Error(`Unknown path verb ${verb}`);
    }
  }
  return out.join("");
}

/**
 * The keyline outline of `paths` (SVG path data, nonzero fill) at keyline
 * width `w` pt: stroke(2w, round join and cap) ∪ fill, as one nonzero,
 * cubic-only path, so overlapping inputs leave no seam. An open centre-line
 * becomes its round-capped band, as the print PDF's live stroke draws it.
 * Draw it in the stroke colour, then the original fill on top. Returns []
 * when there is nothing to draw (no paths, or w is not positive).
 */
export async function dilate(paths: readonly string[], w: number): Promise<string[]> {
  if (!(w > 0) || !paths.length) return [];
  const ck = await canvasKit();
  const union = (a: Path | null, b: Path | null) => {
    const u = a && b && ck.Path.MakeFromOp(a, b, ck.PathOp.Union);
    a?.delete(); b?.delete();
    if (!u) throw new Error("dilate: stroke expansion failed");
    return u;
  };
  // Each string is its own nonzero fill, as drawSvgPath draws it, so they
  // are unioned rather than concatenated (which would also make a leading
  // relative `m` relative to the previous string).
  const all = paths.map((d) => {
    const fill = ck.Path.MakeFromSVGString(d);
    if (!fill) throw new Error("dilate: unparseable SVG path data");
    return union(fill.makeStroked({ width: 2 * w, join: ck.StrokeJoin.Round, cap: ck.StrokeCap.Round }), fill);
  }).reduce(union);
  // PathOps answers even-odd; the PDF fills nonzero.
  const winding = all.makeAsWinding();
  all.delete();
  if (!winding) throw new Error("dilate: stroke expansion failed");
  const d = cubicOnly(ck, winding);
  winding.delete();
  return d ? [d] : [];
}
