// Model types and parser for the Master/Variation label model (spec:
// docs/superpowers/specs/2026-08-27-master-variation-design.md). Pure types +
// a defensive parser; no DOM, no rendering. resolve.ts collapses these into
// the existing LabelConfig, which stays the renderers' contract.
import type { LabelConfig } from "../types";

export type FieldKind = "text" | "number" | "image" | "code" | "select" | "toggle";
export type FieldValue = string | number | boolean;

/** What a .label may fill. `path` binds the value into the resolved
 *  LabelConfig (dot path, e.g. "beerName", "styleLine.text") — the Plan-1
 *  bridge until layers generalize in Plan 2. */
export interface FieldDecl {
  id: string;
  label: string;
  kind: FieldKind;
  path: string;
  /** Derived content: a format string over field values (format.ts); when
   *  set, the expanded string is written to `path` instead of the raw value. */
  format?: string;
  /** number kind */
  min?: number; max?: number;
  /** select kind */
  options?: string[];
  /** code kind: which validator applies. Mirrors barcode.ts's `Symbology`
   *  (re-declared, not imported, to avoid a circular import). */
  symbology?: "upc-a" | "ean-13" | "code-128";
}

export interface Guides {
  left: number | null; center: "auto" | null; right: number | null;
  top: number | null; bottom: number | null;   // null = guide removed
}

/** A pure diff on the master — never a copy. */
export interface Variation {
  id: string;
  name: string;
  overrides: Partial<LabelConfig>;
  layerOverrides: Record<string, unknown>;   // used from Plan 2 on
  fields: FieldDecl[];
}

export interface Master {
  formatVersion: 1;
  id: string;
  name: string;
  physical: { labelWidthIn: number; labelHeightIn: number; bleedIn: number; canDiameterIn: number };
  defaults: Partial<LabelConfig>;
  guides: Guides;
  fields: FieldDecl[];
  variations: Variation[];
}

/** The new .label payload: IDs and values only — no layout, no styling. */
export interface LabelFileV2 {
  formatVersion: 2;
  masterId: string;
  masterHint?: string;
  enabledVariations: string[];        // in enable order
  values: Record<string, FieldValue>; // keyed by FieldDecl.id; dormant values kept
}

function fail(msg: string): never { throw new Error(`Invalid master file: ${msg}`); }

export function parseMaster(json: unknown): Master {
  const m = json as Master;
  if (!m || typeof m !== "object") fail("not an object");
  if (m.formatVersion !== 1) fail(`unsupported formatVersion (expected 1)`);
  if (!m.id || typeof m.id !== "string") fail("missing id");
  if (!m.name || typeof m.name !== "string") fail("missing name");
  const p = m.physical;
  if (!p || [p.labelWidthIn, p.labelHeightIn, p.bleedIn, p.canDiameterIn].some((n) => typeof n !== "number"))
    fail("missing or incomplete physical dimensions");
  if (!m.defaults || typeof m.defaults !== "object") fail("missing defaults");
  if (!m.guides || typeof m.guides !== "object") fail("missing guides");
  const fields = m.fields ?? fail("missing fields");
  const variations = m.variations ?? fail("missing variations");
  const seen = new Set<string>();
  for (const v of variations) {
    if (!v.id) fail("variation without id");
    if (seen.has(v.id)) fail(`duplicate variation id "${v.id}"`);
    seen.add(v.id);
  }
  const kinds = new Set<FieldKind>(["text", "number", "image", "code", "select", "toggle"]);
  const fids = new Set<string>();
  for (const f of [...fields, ...variations.flatMap((v) => v.fields ?? [])]) {
    if (!f.id || !f.kind || !f.path) fail(`field "${f.id ?? "?"}" missing id/kind/path`);
    if (!kinds.has(f.kind)) fail(`field "${f.id}" has unknown kind "${f.kind}"`);
    if (fids.has(f.id)) fail(`duplicate field id "${f.id}"`);
    fids.add(f.id);
  }
  return m;
}
