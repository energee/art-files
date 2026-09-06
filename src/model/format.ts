// Format strings for derived layer content: literal text with {fieldId} or
// {fieldId|transform} refs over FIELD values only (never other layers, so cycles
// are impossible by construction). Spec: "Format strings (derived content)".
import { machineName } from "../qr";

export const TRANSFORMS: Record<string, (s: string) => string> = {
  // The one machine-name rule, shared with the export filename (defaults.ts).
  slug: machineName,
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  trim: (s) => s.trim(),
};

const REF = /\{([a-zA-Z][\w-]*)(?:\|([a-z]+))?\}/g;

export function fieldRefs(fmt: string): string[] {
  return [...fmt.matchAll(REF)].map((m) => m[1]);
}

/** The format string split into literal and ref segments, in order, using
 *  the SAME REF grammar expandFormat consumes above — FormatBuilder renders
 *  these directly rather than re-parsing the grammar itself. A ref segment
 *  carries `tr` only when the format string names a transform. */
export function segments(fmt: string): ({ lit: string } | { id: string; tr?: string })[] {
  const out: ({ lit: string } | { id: string; tr?: string })[] = [];
  let last = 0;
  for (const m of fmt.matchAll(REF)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ lit: fmt.slice(last, at) });
    out.push(m[2] ? { id: m[1], tr: m[2] } : { id: m[1] });
    last = at + m[0].length;
  }
  if (last < fmt.length) out.push({ lit: fmt.slice(last) });
  return out;
}

/** Expand refs; a missing field keeps its literal "{ref}" (visible in the
 *  preview as an obvious placeholder) and is reported in `missing`. */
export function expandFormat(
  fmt: string, values: Record<string, string>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = fmt.replace(REF, (raw, id: string, tr?: string) => {
    const v = values[id];
    if (v === undefined) { missing.push(id); return raw; }
    return tr && TRANSFORMS[tr] ? TRANSFORMS[tr](v) : v;
  });
  return { text, missing };
}

/** A link-shaped format: literal prefix followed by ONE trailing ref, which
 *  a QR always slugifies. Returns undefined for anything else (a hand-written
 *  multi-ref template), which the caller falls back to a raw text box for.
 *  Parsed through `segments` so the grammar stays owned by this file. */
export function parseLink(fmt: string): { prefix: string; id?: string } | undefined {
  const segs = segments(fmt);
  const last = segs[segs.length - 1];
  const head = last && "id" in last ? segs.slice(0, -1) : segs;
  if (head.some((s) => !("lit" in s))) return undefined; // a ref before the tail
  return { prefix: head.map((s) => ("lit" in s ? s.lit : "")).join(""),
           id: last && "id" in last ? last.id : undefined };
}

/** parseLink's inverse. The ref is always slugified — a link that is not URL
 *  safe is not a link. */
export const formatLink = (prefix: string, id: string): string =>
  id ? `${prefix}{${id}|slug}` : prefix;
