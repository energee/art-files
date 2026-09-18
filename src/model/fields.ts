// Input validation for a layer's declared input (`number` or `code`): the
// "how the value is validated" half of a field. Invalid values become
// field-level errors upstream — the preview never crashes on them
// (resolveLayers.ts skips applying them).
import { validateUpc, validateEan13 } from "../upc";
import { validateCode128 } from "../code128";
import type { Symbology } from "../barcode";

export type InputKind = "number" | "code";
/** A union, not `{ ok: boolean; error?: string }`: `!r.ok` narrows to the
 *  branch that has the message, so no caller writes `r.error!`. */
export type Validation = { ok: true } | { ok: false; error: string };
const ok: Validation = { ok: true };
const err = (error: string): Validation => ({ ok: false, error });

export function validateInput(
  input: InputKind, value: string | number,
  opts: { min?: number; max?: number; symbology?: Symbology } = {},
): Validation {
  if (input === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(n)) return err("Expected a number.");
    if (opts.min !== undefined && n < opts.min) return err(`Must be at least ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) return err(`Must be at most ${opts.max}.`);
    return ok;
  }
  if (typeof value !== "string") return err("Expected a code value.");
  // upc-a and an unset symbology both validate as UPC-A: the historical
  // `upc` field predates `symbology` and was always a UPC-A code, so
  // leaving symbology unset is a deliberate default, not a fallback.
  const validate = opts.symbology === "ean-13" ? validateEan13
    : opts.symbology === "code-128" ? validateCode128
    : validateUpc;
  const r = validate(value);
  return r.ok ? ok : err(r.error!);
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
