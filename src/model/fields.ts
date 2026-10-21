// Per-kind field validation (spec: FieldDecl). A field is "what editor the
// filler gets and how the value is validated"; this is the validation half.
// Invalid values become field-level errors upstream — the preview never crashes
// on them (resolveLayers.ts skips applying them).
import type { FieldDecl, FieldValue } from "./types";
import { validateUpc, validateEan13 } from "../upc";
import { validateCode128 } from "../code128";
import type { Symbology } from "../barcode";
import type { TextLayer } from "./layers";

type Result = { ok: boolean; error?: string };
const ok: Result = { ok: true };
const err = (error: string): Result => ({ ok: false, error });

export function validateField(decl: FieldDecl, value: FieldValue): Result {
  switch (decl.kind) {
    case "text":
      return typeof value === "string" ? ok : err("Expected text.");
    case "number": {
      // Plain decimals only: Number() would also take "1e1", "0x10" and "6.",
      // which print as typed, not as the number they parse to. Blank is "not
      // filled yet", like every other field.
      if (typeof value === "boolean") return err("Expected a number.");
      const text = String(value).trim();
      if (!text) return ok;
      const n = Number(text);
      if (typeof value === "string" ? !/^-?\d+(\.\d+)?$/.test(text) : !Number.isFinite(n))
        return err("Expected a number.");
      if (decl.min !== undefined && n < decl.min) return err(`Must be at least ${decl.min}.`);
      if (decl.max !== undefined && n > decl.max) return err(`Must be at most ${decl.max}.`);
      return ok;
    }
    case "image":
      return typeof value === "string" ? ok : err("Expected an image.");
    case "code": {
      if (typeof value !== "string") return err("Expected a code value.");
      // upc-a and an unset symbology both validate as UPC-A: the historical
      // `upc` field predates `symbology` and was always a UPC-A code, so
      // leaving symbology unset is a deliberate default, not a fallback.
      const validate = decl.symbology === "ean-13" ? validateEan13
        : decl.symbology === "code-128" ? validateCode128
        : validateUpc;
      const r = validate(value);
      return r.ok ? ok : err(r.error!);
    }
    case "select":
      return decl.options?.includes(String(value))
        ? ok : err(`Must be one of: ${decl.options?.join(", ") ?? ""}.`);
    case "toggle":
      return typeof value === "boolean" ? ok : err("Expected on/off.");
    default:
      return err(`Unknown field kind "${decl.kind}".`);
  }
}

/** A number/code text layer's typed value, checked as validateField would
 *  check its field — the one spelling of that FieldDecl, shared by the
 *  resolver (a bad value keeps the master's) and both editors, the sidebar
 *  field and the on-canvas box (they flag the value as typed). A layer with
 *  no `input` takes any text. */
export function validateLayerInput(
  layer: Pick<TextLayer, "id" | "name" | "input" | "min" | "max" | "symbology">, text: string,
): Result {
  if (!layer.input) return ok;
  return validateField({ id: layer.id, label: layer.name, kind: layer.input, path: "",
    min: layer.min, max: layer.max, symbology: layer.symbology }, text);
}

const SYMBOLOGY_LABEL: Record<Symbology, string> = {
  "upc-a": "UPC-A", "ean-13": "EAN-13", "code-128": "Code 128",
};

/** P4: a plain-English scannability warning for a custom barcode layer's
 *  module width, or null while it's fine. Fires under 0.72pt (0.01in) — the
 *  rule of thumb for common laser/CCD scanners on a curved metal can, below
 *  which adjacent bars start to blur together as the label wraps. Purely
 *  advisory: it never blocks saving or drawing, unlike validateField's
 *  errors — the layer still draws (see plan.ts's custom-barcode item), just
 *  at a width a scanner may reject. */
export function minModuleWarning(symbology: Symbology, moduleW: number): string | null {
  const MIN = 0.72;
  if (moduleW >= MIN) return null;
  return `${SYMBOLOGY_LABEL[symbology]} module width is ${moduleW}pt — below the ${MIN}pt minimum for reliable scanning on curved metal.`;
}
