// maskimage.ts — pure mask-PNG pixel processing shared by the browser app
// (canvas ImageData) and the Node harness (pngjs). The repo convention:
// white (255,255,255) = metallic (knockout), blue (0,156,215) = white ink.

export interface MaskValidation {
  ok: boolean;
  error?: string;
  /** Fraction of pixels not close to either allowed color. */
  offPalette: number;
}

const BLUE = [0, 156, 215];
const TOL = 24; // per-channel tolerance for antialiased/compressed sources

/** White = metallic (no white ink printed, so the foil shows). Exported
 *  because the 3D views derive their per-pixel metalness map from a rendered
 *  mask plate and must read the convention from here, not re-encode it. */
export function isWhite(r: number, g: number, b: number): boolean {
  return r > 255 - TOL && g > 255 - TOL && b > 255 - TOL;
}
function isBlue(r: number, g: number, b: number): boolean {
  return (
    Math.abs(r - BLUE[0]) < TOL &&
    Math.abs(g - BLUE[1]) < TOL &&
    Math.abs(b - BLUE[2]) < TOL
  );
}

export function validateMask(rgba: Uint8Array | Uint8ClampedArray): MaskValidation {
  let off = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    if (!isWhite(rgba[i], rgba[i + 1], rgba[i + 2]) && !isBlue(rgba[i], rgba[i + 1], rgba[i + 2]))
      off++;
  }
  const offPalette = off / n;
  if (offPalette > 0.01)
    return {
      ok: false,
      offPalette,
      error: `Mask has ${(offPalette * 100).toFixed(1)}% pixels that are neither white nor blue (0,156,215).`,
    };
  return { ok: true, offPalette };
}

/** Recolor in place for the mask PDF: blue stays blue (white ink there),
 *  everything else (metallic) becomes transparent so the page shows white. */
export function recolorMaskForPdf(rgba: Uint8Array | Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    if (isBlue(rgba[i], rgba[i + 1], rgba[i + 2])) {
      rgba[i] = BLUE[0];
      rgba[i + 1] = BLUE[1];
      rgba[i + 2] = BLUE[2];
      rgba[i + 3] = 255;
    } else {
      rgba[i + 3] = 0;
    }
  }
}
