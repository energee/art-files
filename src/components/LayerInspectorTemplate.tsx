// LayerInspectorTemplate.tsx — the inspector's "Template field settings":
// the fill contract a text layer declares (placeholder, input, range,
// symbology, suffix) and the fill vocabulary (field label and choices) a text
// or barcode layer offers. Every key here routes to the master (edit.ts's
// patchLayers). Split out of LayerInspector.tsx (#433).
import { useTranslation } from "@/i18n";
import { X } from "lucide-react";
import type { Choice, Layer, Symbology, TextLayer } from "@/model/layers";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BlankableField, InputRow, Row, SelectField, useInspectorOptions, useRequiredText, type Ctx,
} from "./LayerInspectorControls";

/** Authoring the fill vocabulary: the caption a filler sees, and the list they
 *  pick from (docs/plans/choice-input.md, Task 6). Both are fill-contract keys,
 *  so `set` routes them to the master like `placeholder` does.
 *
 *  `choices` is emitted as the WHOLE array on every edit — it is one leaf to
 *  leafPaths, so it is one override badge and one row in the Save Master
 *  review, and a per-item patch would have neither. Not text-only: a barcode
 *  carries a `value` rather than an `input`, and its tier list is the same
 *  thing, so this renders for both. */
export function Vocabulary(props: Ctx & { layer: Layer }) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const id = layer.id;
  const choices = layer.choices ?? [];
  /** Writes the list back, dropping the key entirely once it is empty so
   *  absent and [] stay one state (parseMaster normalises the same way). */
  const put = (next: Choice[]) => set({ choices: next.length ? next : undefined });
  /** A new row must arrive with a VALID value. parseMaster rejects a blank one
   *  ("has a choice with no value") and App drops the whole failed edit, so an
   *  empty row would never survive the round trip to be typed into. Numbered
   *  on collision, like addVariant's ids, so two clicks give two rows. */
  const fresh = (): string => {
    let value = t("New choice");
    for (let n = 2; choices.some((c) => c.value === value); n++) value = t("New choice {{count}}", { count: n });
    return value;
  };
  const edit = (i: number, patch: Partial<Choice>) =>
    put(choices.map((c, j) => {
      if (j !== i) return c;
      const merged = { ...c, ...patch };
      // A blanked title is no title, not an empty one.
      if (!merged.title) delete merged.title;
      return merged;
    }));

  return (
    <>
      <Row badge={badge(["title"], t("Title"))}>
        <InputRow
          id={`${id}-title`} label={t("Field label")} value={layer.title ?? ""}
          hint={t("Caption above the fill field")}
          onChange={(v) => set({ title: v || undefined })}
        />
      </Row>
      <Row badge={badge(["choices"], t("Choices"))}>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("Choices")}</Label>
          {choices.map((c, i) => (
            <ChoiceRow
              key={i} id={id} index={i} choice={c}
              onEdit={(patch) => edit(i, patch)}
              onRemove={() => put(choices.filter((_, j) => j !== i))} />
          ))}
          <button
            type="button" aria-label={t("Add choice")}
            className="rounded-sm px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            onClick={() => put([...choices, { value: fresh() }])}>
            + {t("Add choice")}
          </button>
        </div>
      </Row>
    </>
  );
}

/** One row of the vocabulary editor. Its value is required — see
 *  useRequiredText — while the title is free to be blank. */
function ChoiceRow(props: {
  id: string; index: number; choice: Choice;
  onEdit: (patch: Partial<Choice>) => void;
  onRemove: () => void;
}) {
  const { id, index, choice, onEdit, onRemove } = props;
  const { t } = useTranslation();
  const valueProps = useRequiredText(choice.value, (v) => onEdit({ value: v }));
  return (
    <div className="flex items-center gap-1">
      <Input
        id={`${id}-choice-${index}-title`} className="h-6 w-20 text-xs"
        value={choice.title ?? ""} placeholder={t("Title")}
        aria-label={t("Choice {{count}} title", { count: index + 1 })}
        onChange={(e) => onEdit({ title: e.target.value })} />
      <Input
        id={`${id}-choice-${index}-value`} className="h-6 flex-1 text-xs"
        placeholder={t("Value")} aria-label={t("Choice {{count}} value", { count: index + 1 })}
        {...valueProps} />
      <button
        type="button" aria-label={t("Remove choice {{count}}", { count: index + 1 })}
        className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-accent"
        onClick={onRemove}>
        <X className="size-3" />
      </button>
    </div>
  );
}

export function FillContract(props: Ctx & { layer: TextLayer }) {
  const { layer, set, badge } = props;
  const { t } = useTranslation();
  const { inputs, symbologies } = useInspectorOptions();
  const id = layer.id;
  const numeric = layer.input === "number";
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{t("Set up this field for labels that use this master.")}</p>
      <Row badge={badge(["placeholder"], t("Placeholder"))}>
        <InputRow id={`${id}-placeholder`} label={t("Placeholder")} value={layer.placeholder ?? ""}
          hint={t("Drawn while the layer is empty")} onChange={(v) => set({ placeholder: v || undefined })} />
      </Row>
      <SelectField id={`${id}-input`} label={t("Input")} ariaLabel={t("Input")} badge={badge(["input"], t("Input"))}
        items={inputs} value={layer.input ?? "text"} onChange={(v) => set({ input: v === "text" ? undefined : v as TextLayer["input"] })} />
      {numeric && (
        <>
          <BlankableField id={`${id}-min`} label={t("Minimum")} unit="" placeholder={t("none")}
            value={layer.min} min={-1e6} max={1e6} step={0.01} badge={badge(["min"], t("Minimum"))}
            onChange={(min) => set({ min })} />
          <BlankableField id={`${id}-max`} label={t("Maximum")} unit="" placeholder={t("none")}
            value={layer.max} min={-1e6} max={1e6} step={0.01} badge={badge(["max"], t("Maximum"))}
            onChange={(max) => set({ max })} />
        </>
      )}
      {layer.input === "code" && (
        <SelectField id={`${id}-fill-symbology`} label={t("Symbology")} ariaLabel={t("Symbology")} badge={badge(["symbology"], t("Symbology"))}
          items={symbologies} value={layer.symbology ?? "upc-a"} onChange={(v) => set({ symbology: v as Symbology })} />
      )}
      <Vocabulary layer={layer} set={set} badge={badge} unit={props.unit} />
      {layer.input !== undefined && (
        <Row badge={badge(["suffix"], t("Suffix"))}>
          <InputRow id={`${id}-suffix`} label={t("Suffix")} value={layer.suffix ?? ""}
            hint={t("Drawn after the filled value")} onChange={(v) => set({ suffix: v || undefined })} />
        </Row>
      )}
    </div>
  );
}
