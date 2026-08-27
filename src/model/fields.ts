// Per-kind field validation (spec: FieldDecl). A field is "what editor the
// filler gets and how the value is validated"; this is the validation half.
// Invalid values become field-level errors upstream — the preview never crashes
// on them (resolve.ts skips applying them).
import type { FieldDecl, FieldValue } from "./types";
import { validateUpc } from "../upc";

type Result = { ok: boolean; error?: string };
const ok: Result = { ok: true };
const err = (error: string): Result => ({ ok: false, error });

export function validateField(decl: FieldDecl, value: FieldValue): Result {
  switch (decl.kind) {
    case "text":
      return typeof value === "string" ? ok : err("Expected text.");
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (typeof value === "boolean" || Number.isNaN(n)) return err("Expected a number.");
      if (decl.min !== undefined && n < decl.min) return err(`Must be at least ${decl.min}.`);
      if (decl.max !== undefined && n > decl.max) return err(`Must be at most ${decl.max}.`);
      return ok;
    }
    case "image":
      return typeof value === "string" ? ok : err("Expected an image.");
    case "code": {
      if (typeof value !== "string") return err("Expected a code value.");
      if (decl.symbology === "upc-a") {
        const r = validateUpc(value);
        return r.ok ? ok : err(r.error!);
      }
      return ok;   // other symbologies validate from Plan 2 on
    }
    case "select":
      return decl.options?.includes(String(value))
        ? ok : err(`Must be one of: ${decl.options?.join(", ") ?? ""}.`);
    case "toggle":
      return typeof value === "boolean" ? ok : err("Expected on/off.");
  }
}
