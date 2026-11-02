import { isMacOS } from "@/keys";
// LayerList.tsx — the ONE Layers list of the master-as-layers redesign
// (spec: docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI"
// and "Removed"). A flat list of the resolved layers, FRONT TO BACK (the
// caller hands rows in draw order, back to front, and this component
// reverses them), no Document group — background and mask are the two
// bottom rows like any other. Each row: kind icon, name (double-click or the
// row menu to rename inline), a variant badge when a variant ADDS the layer
// (its row dimmed while that variant is off), a provenance mark when an
// enabled variant overrides part of it, then fixed Show, Lock and Remove
// columns. Visibility and canvas-lock controls are always visible; Remove
// is available only on selected rows. Right-click any row for Rename,
// Lock (not on page art) and Remove.
// The header carries the title, the "Changed" filter that replaced Fill mode,
// and the "Add layer" menu.
//
// Props-only: no app state, no model imports beyond types. Every write goes
// out through a callback — the caller decides where it lands (master or the
// variant that owns the layer; spec: "Editing target selector" removed).
import { gestureIds, modsOf, type SelectMods } from "@/selection";
import {
  Barcode, Eye, EyeOff, Image, Wallpaper, ListFilter, Lock, LockOpen, Plus,
  QrCode, Scan, Trash2, Type, type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Layer, LayerKind } from "@/model/layers";
import type { LayerRow } from "@/model/rows";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// No shadcn wrapper for it; its Popup/Item parts are the Menu ones, so the
// dropdown's content and items render inside it unchanged.
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export interface LayerListProps {
  /** DRAW ORDER, back to front — exactly `Master.layers` plus any
   *  variant-added layers after them. The list renders them reversed, front
   *  to back, the way a layers panel reads. */
  rows: LayerRow[];
  selected: readonly string[];
  onSelect: (id: string, mods: SelectMods) => void;
  /** Visibility (`enabled`) and canvas lock. Hidden layers never draw
   *  (recorded, undoable — there is no session-only hide); locked layers
   *  cannot be dragged, resized or nudged on the canvas. */
  onToggle: (id: string, prop: "enabled" | "locked", value: boolean) => void;
  /** Inline rename committed (trimmed, non-empty, changed). */
  onRename: (id: string, name: string) => void;
  /** Distance through the owning container’s draw order: positive = toward
   *  the front (up the visible list), negative = toward the back. */
  onReorder: (id: string, delta: number) => void;
  /** Adds to the version the master Select names — a variant when one is
   *  switched to, the base master otherwise. It used to offer a submenu per
   *  variant; the Select decides now, so there is one Add layer. */
  onAdd: (kind: LayerKind) => void;
  /** The selected row's Remove button, the row menu's Remove, and the
   *  Delete/Backspace key on a selected row. */
  onRemove: (id: string) => void;
  /** The header filter: show only layers THIS label has changed — a fill
   *  value or an override. Every layer is fillable now, so "what did I
   *  change?" is the question worth filtering on. */
  changedOnly: boolean;
  onChangedOnly: (v: boolean) => void;
  /** Layers whose filled value is invalid (it blocks export), layer id →
   *  the reason. Each such row is tinted red with an error dot, and its
   *  tooltips name the reason. */
  invalid?: ReadonlyMap<string, string>;
}

/** "Add layer" menu entries — the same icons the rows use for each kind. */
const ADD_LAYER_KINDS: { kind: LayerKind; label: string; Icon: LucideIcon }[] = [
  { kind: "text", label: "Text", Icon: Type },
  { kind: "image", label: "Image", Icon: Image },
  { kind: "barcode", label: "Barcode", Icon: Barcode },
  { kind: "qr", label: "QR", Icon: QrCode },
];

/** Per-kind icon; the two page-art roles get their own so the bottom rows
 *  read as "the texture" and "the mask" rather than two more pictures. */
function iconFor(layer: Layer): LucideIcon {
  switch (layer.kind) {
    case "text": return Type;
    case "barcode": return Barcode;
    case "qr": return QrCode;
    case "image": return layer.role === "mask" ? Scan : layer.role === "background" ? Wallpaper : Image;
  }
}

/** Every row control keeps a 24px keyboard/pointer target in its fixed column. */
const control = cn(
  "mx-auto grid size-[24px] shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70",
  "hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
  "disabled:cursor-not-allowed disabled:opacity-20 [&>svg]:size-3.5",
);

/** Header chip — the Changed filter's look: a small pill, filled while
 *  pressed. */
const chip = (pressed: boolean) => cn(
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
  pressed
    ? "border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground"
    : "border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  "[&>svg]:size-3",
);

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function Row({ row, isSelected, atFront, atBack, dragHandlers, dropEdge, lifted, invalid, ...p }: {
  dragHandlers: React.HTMLAttributes<HTMLButtonElement>;
  /** Why its filled value is invalid (it blocks export); unset when valid. */
  invalid?: string;
  dropEdge?: "top" | "bottom";
  /** Part of the block an in-flight drag is carrying — every selected row
   *  when a selected row is dragged — shown lifted so the group reads as one. */
  lifted?: boolean;
  row: LayerRow;
  isSelected: boolean;
  /** Ends of the DRAW order, computed by the list over every row (not the
   *  filtered view), so keyboard reordering stops at the owning container’s ends. */
  atFront: boolean;
  atBack: boolean;
} & Pick<LayerListProps, "onSelect" | "onToggle" | "onRename" | "onReorder" | "onRemove">) {
  const { t } = useTranslation();
  const hintId = useId();
  const { layer } = row;
  const { id, name } = layer;
  const Icon = iconFor(layer);
  // Dimmed end to end when the layer isn't drawing: its own power is off, or
  // the variant that adds it is off.
  const inactive = !layer.enabled || (row.variant !== undefined && !row.variant.enabled);
  const locked = !!layer.locked;
  const dragHint = t("Drag to reorder · Alt+↑/↓ · {{range}} for a range, {{add}} to add", {
    range: isMacOS() ? "⇧-click" : "Shift-click", add: isMacOS() ? "⌘-click" : "Ctrl-click",
  });
  // What the name button's tooltip says, and what assistive tech reads as its
  // description for an invalid row: the reason, then the hint.
  const hint = invalid ? `${invalid} · ${dragHint}` : dragHint;
  // Page art can't be dragged (hittestLayers skips it), so it offers no lock.
  const page = layer.kind === "image" && (layer.role === "background" || layer.role === "mask");
  let variantTitle = "";
  if (row.variant) {
    let key = row.variant.enabled ? "Added by the {{name}} variant" : "Added by the {{name}} variant (off)";
    if (row.variantOverridden) {
      key = row.variant.enabled ? "Changed by the {{name}} variant" : "Changed by the {{name}} variant (off)";
    }
    variantTitle = t(key, { name: row.variant.name });
  }
  const [renaming, setRenaming] = useState(false);
  // A row selected from the canvas may sit below the fold of a short window.
  const itemRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (isSelected) itemRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [isSelected]);

  const commitRename = (value: string) => {
    const next = value.trim();
    if (next && next !== name) p.onRename(id, next);
    setRenaming(false);
  };

  /** The selected row's Remove (its button, or Delete/Backspace), then focus
   *  to the next unselected row's name, else this list's Add layer — never
   *  dropped to the page. */
  const removeSelected = () => {
    const current = itemRef.current!.querySelector<HTMLElement>('[data-slot="sidebar-menu-button"]')!;
    const list = current.closest('[data-slot="sidebar-menu"]');
    const buttons = [...(list?.querySelectorAll<HTMLElement>('[data-slot="sidebar-menu-button"]') ?? [])];
    const at = buttons.indexOf(current);
    const keep = (button: HTMLElement) => button.getAttribute("aria-pressed") !== "true";
    const next = buttons.slice(at + 1).find(keep) ?? buttons.slice(0, at).reverse().find(keep);
    // This list's own Add layer: every workspace tab mounts a LayerList, so
    // a document-wide lookup would find the first (hidden) tab's.
    const addLayer = current.closest('[data-slot="sidebar-group"]')
      ?.querySelector<HTMLElement>("[data-add-layer]");
    p.onRemove(id);
    queueMicrotask(() => {
      if (!current.isConnected) (next ?? addLayer)?.focus();
    });
  };

  // Keys on the row's name button: Delete/Backspace = the Remove button,
  // ⌥↑/⌥↓ = one reorder step. Gated on the row being selected, so the keys
  // act on exactly the row its Remove button is showing for.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isSelected) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const delta = e.key === "ArrowUp" ? 1 : -1;
      if (delta === 1 ? !atFront : !atBack) { e.preventDefault(); p.onReorder(id, delta); }
    }
  };

  return (
    <SidebarMenuItem ref={itemRef} data-layer-id={id} data-invalid={invalid ? "" : undefined} className={cn("relative",
      lifted && "opacity-50 ring-1 ring-sidebar-primary/60 rounded-md",
      dropEdge === "top" && "before:absolute before:inset-x-0 before:top-0 before:z-10 before:border-t-2 before:border-sidebar-primary",
      dropEdge === "bottom" && "after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:border-b-2 after:border-sidebar-primary",
    )}>
      {/* The whole row is the select target and carries the hover/selected
          highlight end to end; every control inside stops propagation so
          toggling a switch never changes the selection. Enter on the name
          button fires a click that bubbles here the same way. Right-click opens Rename / Lock /
          Remove at the pointer. */}
      <ContextMenu.Root>
        <ContextMenu.Trigger
          onClick={(e) => p.onSelect(id, modsOf(e))}
          className={cn(
            "flex cursor-pointer items-center gap-0.5 rounded-md pr-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            // Selected is a primary tint, not the hover grey: the accent sat at
            // ~1.05:1 on the sidebar, so a selection was invisible once the
            // pointer left it.
            isSelected && "bg-sidebar-primary/15 text-sidebar-accent-foreground hover:bg-sidebar-primary/20",
            // Muted ink, not opacity: row opacity multiplied into every child's
            // own alpha (the badge's /70 composited to ~/35, 2.15:1). Muted is
            // 5.70:1 light / 7.09:1 dark on the sidebar, 4.66 / 6.83 on the
            // hover accent and 4.62 / 5.64 on the selected tint (#440). Listed
            // last so it beats both. The tint holds on hover here: primary/20
            // takes light muted to 4.29:1.
            inactive && "text-muted-foreground hover:text-muted-foreground",
            inactive && isSelected && "hover:bg-sidebar-primary/15",
            // Invalid is the standing sign that export is blocked, so it wins
            // over the muted ink above. destructive-text on the sidebar tint
            // (light / dark): /10 6.22 / 5.01, /15 5.74 / 4.61. /20 is 4.23 in
            // dark, so a selected row keeps /15 (its hover tint) and gains a
            // ring instead, so selection still reads over the red. The ring is
            // the only cue apart from a hovered row, so it stays full strength:
            // 4.08 / 5.03 against the tint, where /60 was 2.30 / 2.74, under
            // the 3:1 non-text minimum (tests/theme-contrast.test.ts).
            invalid && "bg-destructive/10 text-destructive-text hover:bg-destructive/15 hover:text-destructive-text",
            invalid && isSelected && "bg-destructive/15 ring-1 ring-inset ring-sidebar-primary",
          )}
        >
          <SidebarMenuButton
            size="sm"
            isActive={isSelected}
            aria-pressed={isSelected}
            {...(!renaming ? dragHandlers : {})}
            // Rename lives on the button, not the name span: pointerdown's
            // setPointerCapture (the drag) retargets the follow-up dblclick to
            // this capture element, so a span handler never fires (#115).
            onDoubleClick={() => setRenaming(true)}
            onKeyDown={(e) => { dragHandlers.onKeyDown?.(e); if (!e.defaultPrevented) onKeyDown(e); }}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            // The title is a mouse tooltip; for an invalid row aria-describedby
            // takes over as the description, so the hidden element below holds
            // the same text and the drag hint is not lost to the reason.
            aria-describedby={invalid ? hintId : undefined}
            title={hint}
            className={cn(
              // The row paints hover and selection; its keyboard-focused name
              // keeps the sidebar ring. Focus identifies the next target;
              // selection identifies the active row, so they remain distinct.
              "min-w-0 flex-1 touch-none cursor-pointer text-xs hover:bg-transparent data-active:bg-transparent active:bg-transparent active:cursor-grabbing",
              // The button's own hover/active/selected accent ink would repaint
              // an inactive row's name at full strength; keep it muted (#440).
              inactive && "text-muted-foreground hover:text-muted-foreground active:text-muted-foreground data-active:text-muted-foreground data-open:hover:text-muted-foreground",
              // Likewise the red ink, which beats the muted one.
              invalid && "text-destructive-text hover:text-destructive-text active:text-destructive-text data-active:text-destructive-text data-open:hover:text-destructive-text",
            )}
          >
            <Icon />
            {renaming ? (
              <input
                autoFocus
                defaultValue={name}
                aria-label={t("Rename {{name}}", { name })}
                onClick={stop}
                // The row menu would take focus and commit a half-typed name.
                onContextMenu={stop}
                onBlur={(e) => commitRename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(e.currentTarget.value);
                  else if (e.key === "Escape") setRenaming(false);
                  // The row's own shortcuts must not see a typed name.
                  e.stopPropagation();
                }}
                className="min-w-0 flex-1 rounded-sm border border-sidebar-border bg-transparent px-1 text-xs outline-none"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate">
                {name}
              </span>
            )}
            {row.variant && (
              <span
                title={variantTitle}
                // /70 on an active row; an inactive row's badge inherits the
                // row's muted ink with no extra alpha, since stacking a fainter
                // colour (or row opacity) under it fell below WCAG AA's 4.5:1
                // (#440). Off is said by the dimmed row and its power-off icon;
                // a struck-through badge read as "deleted".
                className={cn(
                  "shrink-0 rounded-sm border border-sidebar-border px-1 text-[10px] leading-4",
                  !inactive && "text-sidebar-foreground/70",
                )}
              >
                {row.variant.name}
              </span>
            )}
            {/* Two provenance marks, deliberately different shapes: a FILLED
                dot for a variant (it lives in the master file and applies to
                every label with that variant on) and a RING for this label's own
                change. Same glyph for both is what made the old single dot
                unreadable — and its title claimed "variant" either way. */}
            {row.variantOverridden && (
              <span
                role="img"
                aria-label={t("{{name}} changes this layer", { name: row.variantOverridden.name })}
                title={t("{{name}} changes this layer. Resetting changes the master file.", { name: row.variantOverridden.name })}
                className="size-1.5 shrink-0 rounded-full bg-current text-info-text"
              />
            )}
            {row.changed && (
              <span
                role="img"
                aria-label={t("Changed in this label")}
                title={t("Changed in this label")}
                className="size-1.5 shrink-0 rounded-full border border-current text-info-text"
              />
            )}
            {invalid && (
              <span role="img" aria-label={t("Invalid value")} title={invalid}
                className="size-1.5 shrink-0 rounded-full bg-destructive" />
            )}
          </SidebarMenuButton>
          {/* Beside the name button, not in it, so the reason and hint describe
              the button without also becoming part of its name. */}
          {invalid && <span id={hintId} className="sr-only">{hint}</span>}

          <div className="grid shrink-0 grid-cols-[24px_24px_32px] items-center" onClick={stop}>
            <button
              type="button"
              onClick={() => p.onToggle(id, "enabled", inactive)}
              aria-label={t("{{name}}: enabled", { name })}
              aria-pressed={!inactive}
              data-state={inactive ? "off" : "on"}
              title={inactive
                ? (row.variant && !row.variant.enabled
                  ? t("Show in preview and exports (also enables {{name}})", { name: row.variant.name })
                  : t("Show in preview and exports"))
                : t("Hide from preview and exports")}
              className={cn(control,
                inactive ? "text-muted-foreground hover:text-muted-foreground" : "text-sidebar-foreground")}
            >
              {inactive ? <EyeOff /> : <Eye />}
            </button>
            <div>
              {!page && (
                <button
                  type="button"
                  onClick={() => p.onToggle(id, "locked", !locked)}
                  aria-label={t("{{name}}: locked", { name })}
                  aria-pressed={locked}
                  title={`${locked ? t("Unlock on canvas.") : t("Lock on canvas.")} ${t("Locked on canvas: drag, resize and nudge are off. Typed values still apply.")}`}
                  className={cn(control, locked && "text-sidebar-foreground")}
                >
                  {locked ? <Lock /> : <LockOpen />}
                </button>
              )}
            </div>
            <div className="pl-[8px]">
              {isSelected && (
                <button
                  type="button"
                  onClick={removeSelected}
                  aria-label={t("{{name}}: remove", { name })}
                  title={t("Remove layer")}
                  className={cn(control, "hover:text-destructive-text")}
                >
                  <Trash2 />
                </button>
              )}
            </div>
          </div>
        </ContextMenu.Trigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => setRenaming(true)}>{t("Rename")}</DropdownMenuItem>
          {!page && <DropdownMenuItem onClick={() => p.onToggle(id, "locked", !locked)}>{locked ? t("Unlock") : t("Lock")}</DropdownMenuItem>}
          <DropdownMenuItem variant="destructive" onClick={() => p.onRemove(id)}>{t("Remove")}</DropdownMenuItem>
        </DropdownMenuContent>
      </ContextMenu.Root>
    </SidebarMenuItem>
  );
}

export function LayerList(props: LayerListProps): React.JSX.Element {
  const { t } = useTranslation();
  const { rows, selected, onReorder } = props;
  const [announcement, setAnnouncement] = useState("");
  const reorder = useCallback((id: string, delta: number) => {
    onReorder(id, delta);
    const name = rows.find((r) => r.layer.id === id)?.layer.name ?? t("Layer");
    const text = delta > 0 ? t("{{name}} moved forward.", { name }) : t("{{name}} moved backward.", { name });
    // A live region speaks only when its text changes, so a repeat of the
    // same move toggles a trailing no-break space to be announced again.
    setAnnouncement((prev) => prev === text ? text + "\u00a0" : text);
  }, [onReorder, rows, t]);
  // Rows grouped by owning container (master, or the variant that added the
  // layer), in VISIBLE order (front first): a layer only reorders among its
  // peers. Computed once per rows change; the drag and the ⌥↑/⌥↓ ends read it.
  // `variant` alone is not ownership: layerRows also sets it on a master
  // layer an enabled variant overrides (with `variantOverridden`), and such a
  // layer still lives — and moves — in master.layers.
  const ownerOf = (r: LayerRow) => (r.variant && !r.variantOverridden ? r.variant.id : undefined);
  const peersOf = useMemo(() => {
    const groups = new Map<string | undefined, LayerRow[]>();
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const g = groups.get(ownerOf(r)) ?? [];
      groups.set(ownerOf(r), g);
      g.push(r);
    }
    return (row: LayerRow) => groups.get(ownerOf(row))!;
  }, [rows]);
  const drag = useRef<{
    id: string; x: number; y: number; active: boolean; peers: LayerRow[]; from: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const [drop, setDrop] = useState<{ id: string; edge: "top" | "bottom"; delta: number } | null>(null);
  const dropRef = useRef<typeof drop>(null);
  // The id whose drag has crossed the threshold, for the lifted-row look.
  const [dragging, setDragging] = useState<string | null>(null);
  const clearDrag = () => { drag.current = null; dropRef.current = null; setDrop(null); setDragging(null); };
  // The block that drag carries — the same rule the reorder itself applies.
  const liftedIds = useMemo(
    () => (dragging ? new Set(gestureIds(selected, dragging)) : null), [selected, dragging]);
  // Built once per rows/onReorder change (not per render): the handlers only
  // touch refs and setDrop, so a keystroke elsewhere re-uses the same objects.
  const dragHandlers = useMemo(() => {
    const build = (row: LayerRow): React.HTMLAttributes<HTMLButtonElement> => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      suppressClick.current = false;
      const peers = peersOf(row);
      drag.current = {
        id: row.layer.id, x: e.clientX, y: e.clientY, active: false,
        peers, from: peers.indexOf(row),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      const source = drag.current;
      if (!source) return;
      if (!source.active && Math.hypot(e.clientX - source.x, e.clientY - source.y) < 5) return;
      if (!source.active) setDragging(source.id);
      source.active = true;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-layer-id]");
      const target = rows.find((r) => r.layer.id === el?.dataset.layerId);
      let next: typeof drop = null;
      // Variant-added layers retain their owning variant; hidden rows keep their order.
      if (target && el && ownerOf(target) === ownerOf(row) && target.layer.id !== source.id) {
        const { peers, from } = source;
        const to = peers.indexOf(target);
        const box = el.getBoundingClientRect();
        const before = e.clientY < box.top + box.height / 2;
        const insertion = to + (before ? 0 : 1);
        const delta = from - (insertion - (from < insertion ? 1 : 0));
        if (delta) next = { id: target.layer.id, edge: before ? "top" : "bottom", delta };
      }
      const previous = dropRef.current;
      if (previous?.id !== next?.id || previous?.edge !== next?.edge || previous?.delta !== next?.delta) {
        dropRef.current = next;
        setDrop(next);
      }
    },
    onPointerUp: () => {
      if (drag.current?.active) {
        suppressClick.current = true;
        if (dropRef.current) reorder(drag.current.id, dropRef.current.delta);
      }
      clearDrag();
    },
    onKeyDown: (e) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault(); suppressClick.current = true; clearDrag();
      }
    },
    onPointerCancel: clearDrag,
    onLostPointerCapture: clearDrag,
    onClickCapture: (e) => {
      if (suppressClick.current && e.detail > 0) { e.preventDefault(); e.stopPropagation(); }
      suppressClick.current = false;
    },
    });
    const byId = new Map(rows.map((r) => [r.layer.id, build(r)]));
    return (row: LayerRow) => byId.get(row.layer.id)!;
  }, [rows, peersOf, reorder]);
  const shown = (props.changedOnly ? rows.filter((r) => !!r.changed) : rows)
    .slice().reverse();
  return (
    <SidebarGroup>
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
      {/* Title, the one filter, then Add layer — on one line, so the list
          starts a row higher. Variants used to sit here as toggle chips; they
          live in the master Select now, which names the version the canvas
          is drawing. */}
      <SidebarGroupLabel className="gap-1.5">
        <span className="flex-1">{t("Layers")}</span>
        <button
          type="button"
          aria-pressed={props.changedOnly}
          onClick={() => props.onChangedOnly(!props.changedOnly)}
          title={t("Show only layers changed in this label")}
          className={chip(props.changedOnly)}
        >
          <ListFilter /> {t("Changed")}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                data-add-layer aria-label={t("Add layer")}
                className="flex items-center gap-0.5 rounded-sm px-1 text-[11px] text-attention-text hover:text-attention-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <Plus className="size-3" /> {t("Add layer")}
              </button>
            }
          />
          <DropdownMenuContent align="end">
            {ADD_LAYER_KINDS.map(({ kind, label, Icon }) => (
              <DropdownMenuItem key={kind} variant="attention" onClick={() => props.onAdd(kind)}>
                <Icon className="size-3.5" /> {t(label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarGroupLabel>

      <SidebarGroupContent>
        <SidebarMenu>
          {shown.map((row) => (
            <Row
              key={row.layer.id}
              row={row}
              isSelected={selected.includes(row.layer.id)}
              atFront={peersOf(row)[0] === row}
              atBack={peersOf(row).at(-1) === row}
              dragHandlers={dragHandlers(row)}
              dropEdge={drop?.id === row.layer.id ? drop.edge : undefined}
              lifted={liftedIds?.has(row.layer.id)}
              invalid={props.invalid?.get(row.layer.id)}
              onSelect={props.onSelect}
              onToggle={props.onToggle}
              onRename={props.onRename}
              onReorder={reorder}
              onRemove={props.onRemove}
            />
          ))}
        </SidebarMenu>
        {shown.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-sidebar-foreground/50">
            {props.changedOnly ? "Nothing changed in this label yet." : "No layers."}
          </p>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
