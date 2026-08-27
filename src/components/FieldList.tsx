// FieldList.tsx — Fill mode's sidebar: variant checkboxes + one widget per
// visible field, each writing through its FieldDecl.path (spec: UI — "Fill
// shows the label, the field list, and variant checkboxes"). The canvas
// remains the primary editing surface (click-to-select, in-place text edit);
// this is the parallel path for fillers who never touch Design mode.
import type { LabelConfig } from "@/types";
import type { FieldDecl, FieldValue, Master } from "@/model/types";
import { getPath, visibleFieldsOf } from "@/model/document";
import { validateField } from "@/model/fields";
import { CHECKER } from "@/components/FileDrop";

/** One field's widget, keyed off `field.kind` (spec: FieldDecl — "what editor
 *  the filler gets"). Every widget is controlled off `cfg` via getPath and
 *  writes back only through `onValue` — no local state, so the field list and
 *  the canvas can never disagree about a value. */
function FieldRow({ field, cfg, onValue, onImageFile, imageFileOf }: {
  field: FieldDecl; cfg: LabelConfig;
  onValue: (f: FieldDecl, v: FieldValue) => void;
  onImageFile: (file: File) => Promise<string>;
  imageFileOf?: (assetId: string) => { name: string; previewUrl: string } | undefined;
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
    // A real file well, not a note: since the Collab variant's two logo
    // slots became ordinary image fields, this IS the only place a partner's
    // logo can be loaded — the bespoke inspector wells are gone. The VALUE
    // is an asset id into the label's per-id image store; `onImageFile`
    // (App) reads the file, mints the id and returns it, and clearing writes
    // "" rather than deleting the key, so the field stays a declared,
    // overridable value like every other.
    const assetId = typeof raw === "string" ? raw : "";
    // The loaded asset's filename + thumbnail, looked up off the same store
    // custom image layers use (App's customImages) — matches how the
    // deleted collab wells (FileDrop, see CHECKER) showed a loaded file:
    // without this, "Clear" appearing was the ONLY sign anything had loaded,
    // and a filler swapping two partner logos could not tell which slot held
    // which.
    const file = assetId ? imageFileOf?.(assetId) : undefined;
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm">{field.label}</label>
        <div className="flex items-center gap-2">
          {file && (
            <img src={file.previewUrl} alt=""
              className="size-9 shrink-0 rounded-sm object-cover"
              style={{ background: CHECKER }} />
          )}
          <div className="min-w-0 flex-1">
            <input id={id} type="file" className="w-full text-xs"
              accept="image/svg+xml,image/png,image/jpeg"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Reset the input so re-picking the SAME file fires onChange
                // again — otherwise a cleared field can't be refilled from it.
                e.target.value = "";
                if (file) void onImageFile(file).then((asset) => onValue(field, asset));
              }} />
            {file && <div className="truncate text-xs text-muted-foreground">{file.name}</div>}
          </div>
          {assetId && (
            <button id={`${id}-clear`} type="button"
              className="shrink-0 rounded border border-input px-2 py-0.5 text-xs"
              onClick={() => onValue(field, "")}>Clear</button>
          )}
        </div>
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

export function FieldList({
  master, enabledVariants, cfg, onValue, onVariant, onImageFile, imageFileOf,
}: {
  master: Master;
  enabledVariants: string[];
  cfg: LabelConfig;
  /** Write one field's value through its path (App routes through update()). */
  onValue: (field: FieldDecl, value: FieldValue) => void;
  onVariant: (id: string, on: boolean) => void;
  /** An image field's well: read the dropped file into the label's per-id
   *  image store and resolve to the minted asset id, which the row then
   *  writes as the field's value. App owns the store (the same one custom
   *  image layers use), so the widget itself never touches it. */
  onImageFile: (file: File) => Promise<string>;
  /** Look up a loaded image field's filename + thumbnail off the same
   *  per-id store `onImageFile` writes into. Optional: a caller with no
   *  image fields to show (or a test exercising everything else) can omit
   *  it, and a well with no match just shows the bare file input. */
  imageFileOf?: (assetId: string) => { name: string; previewUrl: string } | undefined;
}) {
  return (
    <div className="space-y-4 p-3">
      {master.variants.map((v) => (
        <div key={v.id} className="flex items-center gap-2">
          <input type="checkbox" id={`variant-${v.id}`}
            checked={enabledVariants.includes(v.id)}
            onChange={(e) => onVariant(v.id, e.target.checked)} />
          <label htmlFor={`variant-${v.id}`} className="text-sm font-medium">{v.name}</label>
        </div>
      ))}
      {visibleFieldsOf(master, enabledVariants).map((f) => (
        <FieldRow key={f.id} field={f} cfg={cfg} onValue={onValue} onImageFile={onImageFile}
          imageFileOf={imageFileOf} />
      ))}
    </div>
  );
}
