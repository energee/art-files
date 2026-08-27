// Format strings for derived layer content: literal text with {fieldId} or
// {fieldId|transform} refs over FIELD values only (never other layers, so cycles
// are impossible by construction). Spec: "Format strings (derived content)".
export const TRANSFORMS: Record<string, (s: string) => string> = {
  slug: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  trim: (s) => s.trim(),
};

const REF = /\{([a-zA-Z][\w-]*)(?:\|([a-z]+))?\}/g;

export function fieldRefs(fmt: string): string[] {
  return [...fmt.matchAll(REF)].map((m) => m[1]);
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
