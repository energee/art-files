// EditingTarget.tsx — the head of the Design sidebar: "Editing: Master ▾".
// Design mode authors the MASTER, not one label, and this selector is what
// says where the next edit lands — the master's own defaults, or a named
// variant's overrides (spec: "Editing: Master ▾"; the model side is
// model/document.ts's EditTarget / applyDesignEdit). App routes every Design
// edit through the target this picks (see App.tsx's `designEdit`).
//
// It also scopes the sidebar. The second export here, TargetFields, is the
// list of the fields the current target declares — the master's own, or just
// the variant's. It lives in this file because it is part of the selector's
// job, but it is a separate element so App can put it where the spec says it
// goes: master picker, Editing selector, layers, then the fields of the
// current target only, then the inspector. That list is deliberately not
// FieldList: Design mode *declares* fields, Fill mode *fills* them, and the
// two share nothing but the word. Task 5's "Make fillable" appends to exactly
// this list.
//
// No field here is read-only, but none stays permanently editable by
// accident either: every row ships LOCKED, with an unlock right beside it
// (product rule — "fields that ship with a master ship locked with an
// unlock, and must always be overridable"). Unlocking a row is session-only
// UI state, deliberately outside the document and its history — like
// App.tsx's hiddenLayers — so it resets to locked on the next visit rather
// than becoming a stored fact about the field. While unlocked a row's label
// is an inline text field (commits on blur/Enter) and carries a remove
// button; while locked it is plain text with no remove.
//
// The dropdown is a plain disclosure button rather than the shadcn
// DropdownMenu the layers panel uses: this menu's items are the document's
// own variants (plus an inline "New variant…" text input that has to live
// beside them), and a portalled menu would put that input outside the
// sidebar's flow. No dialogs anywhere — inline creation, per spec.
import { useState } from "react";
import { Check, ChevronDown, Lock, Plus, Unlock, X } from "lucide-react";
import type { EditTarget } from "@/model/document";
import type { Master } from "@/model/types";
import { cn } from "@/lib/utils";

export function EditingTarget(props: {
  master: Master;
  target: EditTarget;
  onTarget: (t: EditTarget) => void;
  /** Creates the variant, enables it, and selects it as the target. */
  onNewVariant: (name: string) => void;
  /** Unsaved master edits — the label shows a dot. */
  dirty: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");

  // A target naming a variant the master no longer declares falls back to its
  // bare id rather than silently reading as "Master". App clamps the target
  // before it gets here (App.tsx's clampTarget, which a stale target reaches
  // through undo past a "New variant…" or an Open onto a different master),
  // so this is a backstop — but a stale target must never look like it is
  // editing the master.
  const variant = props.target === "master"
    ? undefined
    : props.master.variants.find((v) => v.id === (props.target as { variant: string }).variant);
  const label = props.target === "master"
    ? "Master"
    : variant?.name ?? props.target.variant;

  const closeNaming = () => { setNaming(false); setDraft(""); };
  const commitNaming = () => {
    const name = draft.trim();
    if (!name) { closeNaming(); return; }
    props.onNewVariant(name);
    closeNaming();
    // Creation is a completed pick: App selects the new variant as the
    // target, so leaving the menu up would show a stale checkmark.
    setOpen(false);
  };

  const pick = (t: EditTarget) => {
    props.onTarget(t);
    setOpen(false);
    closeNaming();
  };

  const item = "flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
  const isMaster = props.target === "master";

  return (
    <div className="border-b border-sidebar-border px-2 py-2">
      <button
        id="editing-target"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <span className="text-sidebar-foreground/60">Editing:</span>
        <span className="font-medium">{label}</span>
        {/* Unsaved master edits. A dot, not the word "modified": the same
            signal the tab strip uses, and it has to fit beside the name. */}
        {props.dirty && (
          <span title="Unsaved master edits" className="text-sidebar-foreground/70">•</span>
        )}
        <ChevronDown className="ml-auto size-3.5 shrink-0 opacity-60" />
      </button>

      {open && (
        <div role="menu" className="mt-1 rounded-md border border-sidebar-border p-1">
          <button
            id="editing-target-master"
            type="button"
            role="menuitem"
            onClick={() => pick("master")}
            className={cn(item, isMaster && "bg-sidebar-accent text-sidebar-accent-foreground")}
          >
            <Check className={cn("size-3", !isMaster && "invisible")} />
            Master
          </button>
          {props.master.variants.map((v) => {
            const active = !isMaster && v.id === (props.target as { variant: string }).variant;
            return (
              <button
                key={v.id}
                id={`editing-target-${v.id}`}
                type="button"
                role="menuitem"
                onClick={() => pick({ variant: v.id })}
                className={cn(item, active && "bg-sidebar-accent text-sidebar-accent-foreground")}
              >
                <Check className={cn("size-3", !active && "invisible")} />
                {v.name}
              </button>
            );
          })}
          {/* Inline creation: the item swaps itself for a text input in
              place — Enter commits, Esc cancels (spec: no dialogs). */}
          {naming ? (
            <input
              id="editing-target-name"
              autoFocus
              value={draft}
              placeholder="Variant name"
              aria-label="New variant name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitNaming(); }
                else if (e.key === "Escape") { e.preventDefault(); closeNaming(); }
              }}
              className="mt-0.5 w-full rounded-sm border border-sidebar-border bg-transparent px-2 py-1 text-xs text-sidebar-foreground outline-none"
            />
          ) : (
            <button
              id="editing-target-new"
              type="button"
              role="menuitem"
              onClick={() => setNaming(true)}
              className={cn(item, "text-sidebar-foreground/70")}
            >
              <Plus className="size-3" />
              New variant…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The fields the CURRENT target declares — name, kind, and, once unlocked
 *  (see the file header: "No field here is read-only"), an inline rename and
 *  remove. The master's own when the target is the master, and a variant's
 *  own (never the master's too) when it isn't: this answers "what does the
 *  thing I am editing declare", not "what will a filler see". App renders it
 *  under the layers list; Fill mode's FieldList is what edits the values. */
export function TargetFields(props: {
  master: Master;
  target: EditTarget;
  /** Commits an unlocked row's inline rename. Optional — a caller that
   *  never unlocks a row (or doesn't wire the affordance at all) can omit
   *  it; the rename input simply doesn't appear without it. */
  onRenameField?: (fieldId: string, label: string) => void;
  /** Removes an unlocked row. Same optionality as onRenameField above. */
  onRemoveField?: (fieldId: string) => void;
}): React.JSX.Element {
  // A local, not props.target: TS can't hold the narrowing across the
  // callback below.
  const target = props.target;
  const fields = target === "master"
    ? props.master.fields
    : props.master.variants.find((v) => v.id === target.variant)?.fields ?? [];
  // Session-only unlock gate (see this file's header) — never persisted,
  // never part of the document. Keyed by field id, so switching targets
  // (which changes WHICH fields render, not the ids of the ones that
  // stayed) doesn't spuriously carry an unlock over to an unrelated field
  // that happens to share an id with one from a different target.
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(new Set());
  const toggleLock = (id: string) => setUnlocked((old) => {
    const next = new Set(old);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  return (
    <div id="editing-target-fields" className="px-4 py-2">
      <p className="pb-1 text-[11px] uppercase tracking-wide text-sidebar-foreground/50">Fields</p>
      {fields.length === 0 ? (
        <p className="text-[11px] text-sidebar-foreground/60">
          No fields yet — select a layer and choose Make fillable.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {fields.map((f) => {
            const isUnlocked = unlocked.has(f.id);
            return (
              <li key={f.id} className="flex items-center gap-1.5 text-[11px] text-sidebar-foreground/85">
                <button
                  id={`field-lock-${f.id}`}
                  type="button"
                  aria-label={isUnlocked ? `Lock ${f.label}` : `Unlock ${f.label}`}
                  onClick={() => toggleLock(f.id)}
                  className="shrink-0 text-sidebar-foreground/50 hover:text-sidebar-foreground"
                >
                  {isUnlocked
                    ? <Unlock className="size-3" />
                    : <Lock className="size-3" />}
                </button>
                {isUnlocked && props.onRenameField ? (
                  <input
                    id={`field-name-${f.id}`}
                    aria-label={`Name for ${f.label}`}
                    defaultValue={f.label}
                    className="h-5 min-w-0 flex-1 rounded-sm border border-sidebar-border bg-transparent px-1 text-[11px] text-sidebar-foreground outline-none"
                    onBlur={(e) => {
                      const label = e.target.value.trim();
                      if (label && label !== f.label) props.onRenameField!(f.id, label);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <span className="truncate">{f.label}</span>
                )}
                <span className="shrink-0 text-sidebar-foreground/40">·</span>
                <span className="shrink-0 capitalize text-sidebar-foreground/60">{f.kind}</span>
                {isUnlocked && props.onRemoveField && (
                  <button
                    id={`field-remove-${f.id}`}
                    type="button"
                    aria-label={`Remove ${f.label}`}
                    onClick={() => props.onRemoveField!(f.id)}
                    className="ml-auto shrink-0 text-sidebar-foreground/50 hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
