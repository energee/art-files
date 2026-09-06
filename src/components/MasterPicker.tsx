// MasterPicker.tsx — the head of the sidebar, above the Layers list: a plain
// Select of THIS master, its variants, and New Variant. Nothing else.
//
// It carries no file verbs and no library. Switching to a DIFFERENT master
// is File → Open Master… (App.tsx's openMasterPicker), which previews the
// rebind's bench counts through the confirm-dialog pattern (MasterSaveReview)
// before committing — the same "3 values move to the bench — continue?"
// question this component used to ask inline, now asked once, at the one
// place a rebind can actually happen. Forking the template is File → Save
// Master As…, which mints a new master id, rebinds this document onto it and
// writes the file — the old "Duplicate as new master…" did all of that
// except the writing.
//
// The menu answers one question — WHICH VERSION AM I EDITING
// (docs/plans/label-first-editing.md, Task 12):
//   * the master's own row: the base version.
//   * its variants, listed under it (indented) as versions of it. Picking
//     one switches to it, which is what makes Add Layer add into
//     `variants.<id>.layers` instead of the base master. Merely enabling a
//     variant (the chips in LayerList) shows that version; it does not make
//     it the one you are changing.
//   * New Variant, an action at the foot.
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Master } from "@/model/layers";

/** The foot row's sentinel (see the header note). No variant id can collide
 *  with it — a minted one is always `variant-…`. */
const NEW_VARIANT = "__new-variant";
const VERSION = "__version:";

export function MasterPicker(props: {
  /** The master currently bound to this document. */
  master: Master;
  /** The variant being edited, or null for the base master. */
  version: string | null;
  /** Switch the working version. Null is the base master. */
  onVersion: (id: string | null) => void;
  /** Edit → New Variant: adds an empty variant to this master and switches it
   *  on for this label. */
  onNewVariant: () => void;
}): React.JSX.Element {
  /** "Lolev" on the base version, "Lolev / Collab" while editing one. */
  const versionName = props.master.variants.find((v) => v.id === props.version)?.name;
  const editing = versionName ? `${props.master.name} / ${versionName}` : props.master.name;

  return (
    <div className="px-2 py-2">
      <Select
        value={props.version === null ? props.master.id : VERSION + props.version}
        onValueChange={(id) => {
          if (!id) return;
          if (id === NEW_VARIANT) { props.onNewVariant(); return; }
          if (id.startsWith(VERSION)) { props.onVersion(id.slice(VERSION.length)); return; }
          // The current master's own row means "the base version".
          if (id === props.master.id) { props.onVersion(null); return; }
        }}>
        <SelectTrigger id="master-picker" aria-label="Master" size="sm" className="w-full">
          <span className="text-muted-foreground">Master:</span>
          <SelectValue>{editing}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={props.master.id}>{props.master.name}</SelectItem>
          {props.master.variants.map((v) => (
            <SelectItem key={v.id} value={VERSION + v.id} className="pl-7">{v.name}</SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW_VARIANT}>New Variant</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
