// FieldList.tsx — Fill mode's sidebar: variation checkboxes + one widget per
// visible field, each writing through its FieldDecl.path (spec: UI — "Fill
// shows the label, the field list, and variation checkboxes"). The canvas
// remains the primary editing surface (click-to-select, in-place text edit);
// this is the parallel path for fillers who never touch Design mode.
import type { LabelConfig } from "@/types";
import type { FieldDecl, FieldValue, Master } from "@/model/types";
import { getPath, visibleFieldsOf } from "@/model/document";
import { validateField } from "@/model/fields";

/** One field's widget, keyed off `field.kind` (spec: FieldDecl — "what editor
 *  the filler gets"). Every widget is controlled off `cfg` via getPath and
 *  writes back only through `onValue` — no local state, so the field list and
 *  the canvas can never disagree about a value. */
function FieldRow({ field, cfg, onValue }: {
  field: FieldDecl; cfg: LabelConfig;
  onValue: (f: FieldDecl, v: FieldValue) => void;
}) {
  const raw = getPath(cfg, field.path);
  const id = `field-${field.id}`;
  if (field.kind === "toggle") {
    return (
      <div className="flex items-center gap-2">
        <input type="checkbox" id={id} checked={raw === true}
          onChange={(e) => onValue(field, e.target.checked)} />
        <label htmlFor={id} className="text-sm">{field.label}</label>
      </div>
    );
  }
  if (field.kind === "image") {
    // Asset-bound image fields land with Plan 4b's asset wiring — until then
    // this is a placeholder note, not a broken control.
    return (
      <div className="space-y-1">
        <span className="text-sm">{field.label}</span>
        <p className="text-xs text-muted-foreground">Set in Design mode.</p>
      </div>
    );
  }
  const value = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  // Blank is "not filled yet", not "invalid" — only validate once there's a
  // value to judge (mirrors resolve.ts skipping undefined values).
  const check = value === "" ? { ok: true as const, error: undefined as string | undefined } : validateField(field, value);
  const multiline = field.path === "description"; // the one multiline field;
  // the canvas WYSIWYG remains the rich path for it (spec: "The canvas is
  // the field list") — this textarea is plain text, not markdown-aware.
  const inputCls = "w-full rounded border border-input bg-transparent px-2 py-1 text-sm";
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm">{field.label}</label>
      {field.kind === "select" ? (
        <select id={id} value={value} className={inputCls}
          onChange={(e) => onValue(field, e.target.value)}>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : multiline ? (
        <textarea id={id} rows={4} value={value} className={inputCls}
          onChange={(e) => onValue(field, e.target.value)} />
      ) : (
        <input id={id} value={value} className={inputCls}
          type={field.kind === "number" ? "number" : "text"}
          min={field.min} max={field.max}
          onChange={(e) => onValue(field, e.target.value)} />
      )}
      {!check.ok && <p className="text-xs text-destructive">{check.error}</p>}
    </div>
  );
}

export function FieldList({ master, enabledVariations, cfg, onValue, onVariation }: {
  master: Master;
  enabledVariations: string[];
  cfg: LabelConfig;
  /** Write one field's value through its path (App routes through update()). */
  onValue: (field: FieldDecl, value: FieldValue) => void;
  onVariation: (id: string, on: boolean) => void;
}) {
  return (
    <div className="space-y-4 p-3">
      {master.variations.map((v) => (
        <div key={v.id} className="flex items-center gap-2">
          <input type="checkbox" id={`variation-${v.id}`}
            checked={enabledVariations.includes(v.id)}
            onChange={(e) => onVariation(v.id, e.target.checked)} />
          <label htmlFor={`variation-${v.id}`} className="text-sm font-medium">{v.name}</label>
        </div>
      ))}
      {visibleFieldsOf(master, enabledVariations).map((f) => (
        <FieldRow key={f.id} field={f} cfg={cfg} onValue={onValue} />
      ))}
    </div>
  );
}
