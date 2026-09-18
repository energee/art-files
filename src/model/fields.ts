// Input validation for a layer's declared input (`number` or `code`): the
// "how the value is validated" half of a field. Invalid values become
// field-level errors upstream — the preview never crashes on them
// (resolveLayers.ts skips applying them).
import { validateFor, type Symbology } from "../barcode";
import type { Validation } from "../validation";
export type { Validation };

export type InputKind = "number" | "code";
const ok: Validation = { ok: true };
const err = (error: string): Validation => ({ ok: false, error });

export function validateInput(
  input: InputKind, value: string,
  opts: { min?: number; max?: number; symbology?: Symbology } = {},
): Validation {
  if (input === "number") {
    const n = Number(value);
    if (value.trim() === "" || Number.isNaN(n)) return err("Expected a number.");
    if (opts.min !== undefined && n < opts.min) return err(`Must be at least ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) return err(`Must be at most ${opts.max}.`);
    return ok;
  }
  // An unset symbology validates as UPC-A: the historical `upc` field
  // predates `symbology` and was always a UPC-A code, so leaving it unset
  // is a deliberate default, not a fallback.
  return validateFor(opts.symbology ?? "upc-a", value);
}

const SYMBOLOGY_LABEL: Record<Symbology, string> = {
  "upc-a": "UPC-A", "ean-13": "EAN-13", "code-128": "Code 128",
};

/** P4: a plain-English scannability warning for a custom barcode layer's
 *  module width, or null while it's fine. Fires under 0.72pt (0.01in) — the
 *  rule of thumb for common laser/CCD scanners on a curved metal can, below
 *  which adjacent bars start to blur together as the label wraps. Purely
 *  advisory: it never blocks saving or drawing, unlike validateInput's
 *  errors — the layer still draws (see plan.ts's custom-barcode item), just
 *  at a width a scanner may reject. */
export function minModuleWarning(symbology: Symbology, moduleW: number): string | null {
  const MIN = 0.72;
  if (moduleW >= MIN) return null;
  return `${SYMBOLOGY_LABEL[symbology]} module width is ${moduleW}pt — below the ${MIN}pt minimum for reliable scanning on curved metal.`;
}
