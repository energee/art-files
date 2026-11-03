// Model types left from the v1 Master/Variant label model (spec:
// docs/superpowers/specs/2026-08-27-master-variation-design.md). Pure types;
// no DOM, no rendering. Still live: FieldDecl/FieldValue/LabelFileV2 type the
// v2 label readers (model/labelfile.ts, src/labelfile.ts) and model/fields.ts.
// The v1 Master itself is gone: model/files.ts refuses a v1 .master.
import type { LabelConfig } from "../types";
import type { DeepPartial } from "./merge";

type FieldKind = "text" | "number" | "image" | "code" | "select" | "toggle";
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

/** The new .label payload: IDs and values only — no layout, no styling. */
export interface LabelFileV2 {
  formatVersion: 2;
  masterId: string;
  masterHint?: string;
  enabledVariants: string[];        // in enable order
  values: Record<string, FieldValue>; // keyed by FieldDecl.id; dormant values kept
  /** Label-level deviations from the resolved master, applied after resolve
   *  (spec: Migration — "preserves nonstandard styling as label-level
   *  overrides"). Absent = none. */
  overrides?: DeepPartial<LabelConfig>;
  /** Values and variant toggles that the CURRENT master does not declare,
   *  kept verbatim so aiming a label at another master and back loses
   *  nothing. Matching is by id, so a variant id the new master also
   *  declares comes straight back off the bench. */
  dormant?: { values: Record<string, FieldValue>; variants: string[] };
}
