import { isMacOS } from "@/keys";
// LayerList.tsx — the ONE Layers list of the master-as-layers redesign
// (spec: docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI"
// and "Removed"). A flat list of the resolved layers, FRONT TO BACK (the
// caller hands rows in draw order, back to front, and this component
// reverses them), no Document group — background and mask are the two
// bottom rows like any other. Each row: kind icon, name (double-click or the
// row menu to rename inline), a variant badge when a variant ADDS the layer
// (its row dimmed while that variant is off), a provenance mark when an
// enabled variant overrides part of it, a lock while locked, then power
// (`enabled`, at the right edge) — plus drag reordering. Remove: a button
// on the selected row; right-click any row for Rename, Lock (not on page
// art) and Remove.
// The header carries the title, the "Changed" filter that replaced Fill mode,
// and the "Add layer" menu.
//
// Props-only: no app state, no model imports beyond types. Every write goes
// out through a callback — the caller decides where it lands (master or the
// variant that owns the layer; spec: "Editing target selector" removed).
import { gestureIds, modsOf, type SelectMods } from "@/selection";
import {
  Barcode, Image, Wallpaper, ListFilter, Lock, Plus, Power,
  PowerOff, QrCode, Scan, Trash2, Type, type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layer, LayerKind } from "@/model/layers";
import type { LayerRow } from "@/model/rows";
import { LOCK_TITLE } from "./LayerInspectorControls";
import { cn } from "@/lib/utils";
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
  /** Power (`enabled`) and lock. `enabled` off = the layer never draws
   *  (recorded, undoable — there is no session-only hide); `locked` = fillers
   *  cannot move it — set from the row menu, cleared by a locked row's lock. */
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
  /** Layers whose filled value is invalid (it blocks export): each row gets
   *  an error dot. */
  invalid?: ReadonlySet<string>;
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

/** One 24px square control (WCAG 2.2 target size), the idiom every row
 *  control shares. `lit` = always shown: the row's exception (off,
 *  locked) or any control on the selected row. Otherwise hidden until the
 *  row is hovered or the control focused: twenty rows of normal-state icons
 *  hid the few that mattered. */
const control = (lit: boolean) => cn(
  "grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70",
  "hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
  "disabled:cursor-not-allowed disabled:opacity-20 [&>svg]:size-3.5",
  !lit && "opacity-0 group-hover/menu-item:opacity-100 focus-visible:opacity-100",
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
  /** Its filled value is invalid and blocks export. */
  invalid?: boolean;
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
  const { layer } = row;
  const { id, name } = layer;
  const Icon = iconFor(layer);
  // Dimmed end to end when the layer isn't drawing: its own power is off, or
  // the variant that adds it is off.
  const inactive = !layer.enabled || (row.variant !== undefined && !row.variant.enabled);
  const locked = !!layer.locked;
  // Page art can't be dragged (hittestLayers skips it), so it offers no lock.
  const page = layer.kind === "image" && (layer.role === "background" || layer.role === "mask");
  const [renaming, setRenaming] = useState(false);
  // A row selected from the canvas may sit below the fold of a short window.
  const itemRef = useRef<HTMLLIElement>(null);
  // The lock unmounts once unlocked; its focus moves here, not to the body.
  const powerRef = useRef<HTMLButtonElement>(null);
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
      ?.querySelector<HTMLElement>('[aria-label="Add layer"]');
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
    <SidebarMenuItem ref={itemRef} data-layer-id={id} className={cn("relative",
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
            title={`Drag to reorder · Alt+↑/↓ · ${isMacOS() ? "⇧-click for a range, ⌘-click to add" : "Shift-click for a range, Ctrl-click to add"}`}
            className={cn(
              // The row paints hover and selection; its keyboard-focused name
              // keeps the sidebar ring. Focus identifies the next target;
              // selection identifies the active row, so they remain distinct.
              "min-w-0 flex-1 touch-none cursor-pointer text-xs hover:bg-transparent data-active:bg-transparent active:bg-transparent active:cursor-grabbing",
              // The button's own hover/active/selected accent ink would repaint
              // an inactive row's name at full strength; keep it muted (#440).
              inactive && "text-muted-foreground hover:text-muted-foreground active:text-muted-foreground data-active:text-muted-foreground data-open:hover:text-muted-foreground",
            )}
          >
            <Icon />
            {renaming ? (
              <input
                autoFocus
                defaultValue={name}
                aria-label={`Rename ${name}`}
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
                title={`${row.variantOverridden ? "Changed" : "Added"} by the ${row.variant.name} variant${
                  row.variant.enabled ? "" : " (off)"}`}
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
                aria-label={`${row.variantOverridden.name} changes this layer`}
                title={`${row.variantOverridden.name} changes this layer. Resetting changes the master file.`}
                className="size-1.5 shrink-0 rounded-full bg-current text-info-text"
              />
            )}
            {row.changed && (
              <span
                role="img"
                aria-label="Changed in this label"
                title="Changed in this label"
                className="size-1.5 shrink-0 rounded-full border border-current text-info-text"
              />
            )}
            {invalid && (
              <span role="img" aria-label="Invalid value" title="Fix this value before exporting"
                className="size-1.5 shrink-0 rounded-full bg-destructive" />
            )}
          </SidebarMenuButton>

          {/* One cluster at the right edge, power last so its column lines up
              down the list. Remove exists on the selected row only — you act
              on the row you picked, and a stray click on a hovered row can't
              remove it. (Rename is the inspector's name box, a double-click or
              the row menu.) The lock exists only while locked (click to
              unlock; lock from the inspector or the row menu), never on page
              art. Power shows a muted PowerOff at all times on an off row,
              and a full-ink Power on hover or on the selected row — the icon
              is the state, and a stronger icon means "on". */}
          {isSelected && (
            <button
              type="button"
              onClick={(e) => { stop(e); removeSelected(); }}
              aria-label={`${name}: remove`}
              title="Remove"
              className={cn(control(true), "hover:text-destructive-text")}
            >
              <Trash2 />
            </button>
          )}
          {locked && !page && (
            <button
              type="button"
              onClick={(e) => { stop(e); p.onToggle(id, "locked", false); powerRef.current?.focus(); }}
              aria-label={`${name}: locked`}
              aria-pressed
              title={`${LOCK_TITLE} Click to unlock.`}
              className={control(true)}
            >
              <Lock />
            </button>
          )}
          <button
            ref={powerRef}
            type="button"
            onClick={(e) => { stop(e); p.onToggle(id, "enabled", inactive); }}
            aria-label={`${name}: enabled`}
            aria-pressed={!inactive}
            data-state={inactive ? "off" : "on"}
            title={inactive ? "Turn on this layer and its variant" : "Turn off this layer"}
            // Ink strength = on: on is full ink, off the row's muted ink even
            // under the pointer, so switching a layer off always lightens it.
            className={cn(control(inactive || isSelected),
              inactive ? "text-muted-foreground hover:text-muted-foreground" : "text-sidebar-foreground")}
          >
            {inactive ? <PowerOff /> : <Power />}
          </button>
        </ContextMenu.Trigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
          {!page && <DropdownMenuItem onClick={() => p.onToggle(id, "locked", !locked)}>{locked ? "Unlock" : "Lock"}</DropdownMenuItem>}
          <DropdownMenuItem variant="destructive" onClick={() => p.onRemove(id)}>Remove</DropdownMenuItem>
        </DropdownMenuContent>
      </ContextMenu.Root>
    </SidebarMenuItem>
  );
}

export function LayerList(props: LayerListProps): React.JSX.Element {
  const { rows, selected, onReorder } = props;
  const [announcement, setAnnouncement] = useState("");
  const reorder = useCallback((id: string, delta: number) => {
    onReorder(id, delta);
    const text = `${rows.find((r) => r.layer.id === id)?.layer.name ?? "Layer"} moved ${delta > 0 ? "forward" : "backward"}.`;
    // A live region speaks only when its text changes, so a repeat of the
    // same move toggles a trailing no-break space to be announced again.
    setAnnouncement((prev) => prev === text ? text + "\u00a0" : text);
  }, [onReorder, rows]);
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
        <span className="flex-1">Layers</span>
        <button
          type="button"
          aria-pressed={props.changedOnly}
          onClick={() => props.onChangedOnly(!props.changedOnly)}
          title="Show only layers changed in this label"
          className={chip(props.changedOnly)}
        >
          <ListFilter /> Changed
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Add layer"
                className="flex items-center gap-0.5 rounded-sm px-1 text-[11px] text-attention-text hover:text-attention-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <Plus className="size-3" /> Add layer
              </button>
            }
          />
          <DropdownMenuContent align="end">
            {ADD_LAYER_KINDS.map(({ kind, label, Icon }) => (
              <DropdownMenuItem key={kind} variant="attention" onClick={() => props.onAdd(kind)}>
                <Icon className="size-3.5" /> {label}
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
              invalid={props.invalid?.has(row.layer.id)}
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
