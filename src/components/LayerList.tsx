// LayerList.tsx — the ONE Layers list of the master-as-layers redesign
// (spec: docs/superpowers/specs/2026-09-04-master-as-layers-design.md, "UI"
// and "Removed"). A flat list of the resolved layers, FRONT TO BACK (the
// caller hands rows in draw order, back to front, and this component
// reverses them), no Document group — background and mask are the two
// bottom rows like any other. Each row: kind icon, name (double-click or the
// row menu to rename inline), a variant badge when a variant ADDS the layer
// (dimmed while that variant is off), a provenance mark when an enabled
// variant overrides part of it, then the two per-layer switches — enabled
// (absent on the background/mask rows: nothing to fill), power (`enabled`,
// the only visibility switch — there is no session eye any more), lock —
// plus drag reordering and a "…" menu with
// Rename / Remove. The header carries the title, the "Changed" filter
// that replaced Fill mode, one chip per variant, and the "Add layer" menu.
//
// Props-only: no app state, no model imports beyond types. Every write goes
// out through a callback — the caller decides where it lands (master or the
// variant that owns the layer; spec: "Editing target selector" removed).
import { gestureIds } from "@/selection";
import {
  Barcode, Ellipsis, Image, ListFilter, Lock, Plus, Power,
  QrCode, Scan, Type, type LucideIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Layer, LayerKind } from "@/model/layers";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/** A variant as the header chips and the row badges see it. */
export interface VariantChip { id: string; name: string; enabled: boolean }

export interface LayerRow {
  /** The RESOLVED layer (every enabled variant's diff already merged in). */
  layer: Layer;
  /** Set when a variant ADDS this layer (an id the master lacks), and also on
   *  a master layer an enabled variant overrides (alongside
   *  `variantOverridden`): the row shows the variant's name as a badge, titled
   *  "Added by" or "Changed by" accordingly, and dims while it is off. */
  variant?: VariantChip;
  /** An enabled VARIANT changes part of this master layer — the one that
   *  does, so the mark can name it. Distinct from `changed` because resetting
   *  it edits the MASTER FILE, not this label. */
  variantOverridden?: VariantChip;
  /** THIS label changed the layer (a fill value or an override) — what the
   *  header's "Changed" filter shows. */
  changed?: boolean;
}

/** Click modifiers as the row reports them. `meta` is ⌘ on macOS and Ctrl
 *  elsewhere (the toggle-select gesture) — the platform rule lives here so
 *  the caller only ever sees one flag. */
export interface SelectMods { shift: boolean; meta: boolean }

export interface LayerListProps {
  /** DRAW ORDER, back to front — exactly `Master.layers` plus any
   *  variant-added layers after them. The list renders them reversed, front
   *  to back, the way a layers panel reads. */
  rows: LayerRow[];
  selected: readonly string[];
  onSelect: (id: string, mods: SelectMods) => void;
  /** The three per-row switches. `enabled` off = the layer never draws
   *  (recorded, undoable — there is no session-only hide); `locked` = fillers
   *  cannot move it. */
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
  /** The row menu's Remove, and the Delete/Backspace key on a selected row. */
  onRemove: (id: string) => void;
  /** The header filter: show only layers THIS label has changed — a fill
   *  value or an override. Every layer is fillable now, so "what did I
   *  change?" is the question worth filtering on. */
  changedOnly: boolean;
  onChangedOnly: (v: boolean) => void;
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
    case "image": return layer.role === "mask" ? Scan : Image;
  }
}

/** One small square control, the idiom every row switch shares: lit while
 *  `lit`, faded (and brightening on hover) otherwise. */
const control = (lit: boolean) => cn(
  "grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-sidebar-foreground/70",
  "hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
  "disabled:cursor-not-allowed disabled:opacity-20 [&>svg]:size-3",
  !lit && "opacity-40 hover:opacity-100 focus-visible:opacity-100",
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

function Row({ row, isSelected, atFront, atBack, dragHandlers, dropEdge, lifted, ...p }: {
  dragHandlers: React.HTMLAttributes<HTMLButtonElement>;
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
  const [renaming, setRenaming] = useState(false);

  const commitRename = (value: string) => {
    const next = value.trim();
    if (next && next !== name) p.onRename(id, next);
    setRenaming(false);
  };

  // Keyboard equivalents of the selected row's mouse-only affordances, on
  // the row's focusable (the name button): Delete/Backspace = the menu's
  // Remove, ⌥↑/⌥↓ = one reorder step. Gated on the row being selected, so
  // the keys act on exactly the row those controls are showing for.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isSelected) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault(); p.onRemove(id);
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const delta = e.key === "ArrowUp" ? 1 : -1;
      if (delta === 1 ? !atFront : !atBack) { e.preventDefault(); p.onReorder(id, delta); }
    }
  };

  return (
    <SidebarMenuItem data-layer-id={id} className={cn("relative",
      lifted && "opacity-50 ring-1 ring-sidebar-primary/60 rounded-md",
      dropEdge === "top" && "before:absolute before:inset-x-0 before:top-0 before:z-10 before:border-t-2 before:border-sidebar-primary",
      dropEdge === "bottom" && "after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:border-b-2 after:border-sidebar-primary",
    )}>
      {/* The whole row is the select target and carries the hover/selected
          highlight end to end; every control inside stops propagation so
          toggling a switch never changes the selection. The name button is
          the row's one focusable, named control — Enter on it fires a click
          that bubbles here the same way. */}
      <div
        onClick={(e) => p.onSelect(id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
        className={cn(
          "flex cursor-pointer items-center gap-0.5 rounded-md pr-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isSelected && "bg-sidebar-accent text-sidebar-accent-foreground",
          inactive && "opacity-50",
        )}
      >
        <SidebarMenuButton
          size="sm"
          isActive={isSelected}
          {...(!renaming ? dragHandlers : {})}
          // Rename lives on the button, not the name span: pointerdown's
          // setPointerCapture (the drag) retargets the follow-up dblclick to
          // this capture element, so a span handler never fires (#115).
          onDoubleClick={() => setRenaming(true)}
          onKeyDown={(e) => { dragHandlers.onKeyDown?.(e); if (!e.defaultPrevented) onKeyDown(e); }}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          title="Drag to reorder · Alt+↑/↓"
          className="min-w-0 flex-1 touch-none cursor-grab text-xs hover:bg-transparent active:cursor-grabbing"
        >
          <Icon />
          {renaming ? (
            <input
              autoFocus
              defaultValue={name}
              aria-label={`Rename ${name}`}
              onClick={stop}
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
              className={cn(
                "shrink-0 rounded-sm border border-sidebar-border px-1 text-[10px] leading-4",
                row.variant.enabled ? "text-sidebar-foreground/70" : "text-sidebar-foreground/40",
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
              title={`${row.variantOverridden.name} changes this layer — resetting edits the master file`}
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
        </SidebarMenuButton>

        {/* Row menu: the keyboard route to rename, and the one place to
            remove. Faded until the row is hovered, focused or selected, but
            always in the tab order — a focused trigger shows itself. */}
        <span onClick={stop} className="contents">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`${name} actions`}
                  className={cn(
                    control(false),
                    "opacity-0 group-hover/menu-item:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100",
                    isSelected && "opacity-40",
                  )}
                >
                  <Ellipsis />
                </button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                className="data-[variant=destructive]:text-destructive-text data-[variant=destructive]:focus:text-destructive-text"
                onClick={() => p.onRemove(id)}
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>

        {/* The two switches, in one fixed cluster at the right edge so the
            power and lock columns line up down the whole list. */}
        <button
          type="button"
          onClick={(e) => { stop(e); p.onToggle(id, "enabled", inactive); }}
          aria-label={`${name}: enabled`}
          aria-pressed={!inactive}
          // Lit while OFF: the exception is what needs pointing at, and the
          // row is already dimmed around it.
          title={inactive ? "Off — turn on to draw this layer and its variant" : "Enabled — turn off to stop it drawing"}
          className={control(inactive)}
        >
          <Power />
        </button>
        <button
          type="button"
          onClick={(e) => { stop(e); p.onToggle(id, "locked", !locked); }}
          aria-label={`${name}: locked`}
          aria-pressed={locked}
          title={locked ? "Locked — cannot be moved" : "Unlocked"}
          className={control(locked)}
        >
          <Lock />
        </button>
      </div>
    </SidebarMenuItem>
  );
}

export function LayerList(props: LayerListProps): React.JSX.Element {
  const { rows, selected } = props;
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
        if (dropRef.current) props.onReorder(drag.current.id, dropRef.current.delta);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, peersOf, props.onReorder]);
  const shown = (props.changedOnly ? rows.filter((r) => !!r.changed) : rows)
    .slice().reverse();
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="justify-between">
        <span>Layers</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Add layer"
                className="flex items-center gap-0.5 rounded-sm px-1 text-[11px] text-sidebar-foreground/70 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <Plus className="size-3" /> Add layer
              </button>
            }
          />
          <DropdownMenuContent align="end">
            {ADD_LAYER_KINDS.map(({ kind, label, Icon }) => (
              <DropdownMenuItem key={kind} onClick={() => props.onAdd(kind)}>
                <Icon className="size-3.5" /> {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarGroupLabel>

      {/* The one filter, on its own line: the sidebar is narrow. Variants used
          to sit here as toggle chips; they live in the master Select now,
          which names the version the canvas is drawing. */}
      <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
        <button
          type="button"
          aria-pressed={props.changedOnly}
          onClick={() => props.onChangedOnly(!props.changedOnly)}
          title="Show only the layers a label fills"
          className={chip(props.changedOnly)}
        >
          <ListFilter /> Changed
        </button>
      </div>

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
              onSelect={props.onSelect}
              onToggle={props.onToggle}
              onRename={props.onRename}
              onReorder={props.onReorder}
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
      {selected.length > 0 && (
        <p className="px-2 pt-1 text-center text-[11px] text-sidebar-foreground/50">
          ⇧ click for a range · ⌘ click to add
        </p>
      )}

    </SidebarGroup>
  );
}
