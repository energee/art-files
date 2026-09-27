"use client"

import { keyOwner } from "@/keys"

import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { PanelLeftIcon } from "lucide-react"

/** localStorage key holding the dragged width as a plain pixel integer. */
const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar_width"
// Width is drag-adjustable, so it lives in state as a pixel number rather
// than a CSS length string. Min/max keep the panel usable at both ends.
const SIDEBAR_WIDTH = 256
const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 520
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  toggleSidebar: () => void
  /** Current desktop sidebar width in pixels (drag-adjustable). */
  width: number
  setWidth: (width: number) => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  hotkey = true,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Register the ⌘/Ctrl-B window shortcut. Hidden workspace-tab instances
   *  pass false so only the active editor's provider owns the key. */
  hotkey?: boolean
}) {
  const [width, setWidth] = React.useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
    return stored >= SIDEBAR_MIN_WIDTH && stored <= SIDEBAR_MAX_WIDTH
      ? stored
      : SIDEBAR_WIDTH
  })

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return setOpen((open) => !open)
  }, [setOpen])

  // Adds a keyboard shortcut to toggle the sidebar. Like the app's other ⌘
  // shortcuts it stays live in the inspector Sheet and a Select, standing
  // aside only for a text field (⌘B is bold there) and a modal dialog.
  React.useEffect(() => {
    if (!hotkey) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const owner = keyOwner(event.target)
      if (event.defaultPrevented || owner === "text" || owner === "dialog") return
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar, hotkey])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      toggleSidebar,
      width,
      setWidth,
    }),
    [state, open, setOpen, toggleSidebar, width]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": `${width}px`,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({ className, children, ...props }: React.ComponentProps<"div">) {
  const { state } = useSidebar()
  return (
    <div className="group peer block text-sidebar-foreground" data-state={state}
      data-collapsible={state === "collapsed" ? "offcanvas" : ""} data-side="left" data-slot="sidebar">
      <div data-slot="sidebar-gap"
        className="relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear in-data-resizing:transition-none group-data-[collapsible=offcanvas]:w-0" />
      <div data-slot="sidebar-container" data-side="left" inert={state === "collapsed"}
        className={cn("fixed inset-y-0 left-0 z-10 flex h-svh w-(--sidebar-width) transition-[left,width] duration-200 ease-linear in-data-resizing:transition-none group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]", className)}
        {...props}>
        <div data-sidebar="sidebar" data-slot="sidebar-inner" className="flex size-full flex-col bg-sidebar">{children}</div>
        <SidebarResizeHandle />
      </div>
    </div>
  )
}

/**
 * Drag strip on the sidebar's outer edge. Shows a col-resize cursor on hover
 * and rewrites the provider's width while dragging. Pointer capture keeps the
 * drag alive when the cursor outruns the 4px strip, so no window listeners.
 */
function SidebarResizeHandle({ className }: { className?: string }) {
  const { setWidth } = useSidebar()
  const latest = React.useRef(SIDEBAR_WIDTH)

  // During a drag we write --sidebar-width straight onto the wrapper element
  // and mark it data-resizing (which kills the 200ms width transition that
  // would otherwise animate — and visibly lag — every pointer move). React
  // state is updated once on pointer up, so a drag costs zero re-renders.
  const wrapperOf = (el: HTMLElement) =>
    el.closest<HTMLElement>("[data-slot=sidebar-wrapper]")

  return (
    <div
      data-slot="sidebar-resize-handle"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        const wrapper = wrapperOf(event.currentTarget)
        if (wrapper) wrapper.dataset.resizing = "true"
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const offset = event.clientX
        latest.current = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, offset)
        )
        wrapperOf(event.currentTarget)?.style.setProperty(
          "--sidebar-width",
          `${latest.current}px`
        )
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
        const wrapper = wrapperOf(event.currentTarget)
        if (wrapper) delete wrapper.dataset.resizing
        setWidth(latest.current)
        localStorage.setItem(
          SIDEBAR_WIDTH_STORAGE_KEY,
          String(Math.round(latest.current))
        )
      }}
      // Double-click resets to the default width, the convention in Figma
      // and VS Code.
      onDoubleClick={(event) => {
        latest.current = SIDEBAR_WIDTH
        // Written explicitly rather than removed: if state is already at the
        // default, React re-renders nothing and a removed var would leave the
        // width unresolved.
        wrapperOf(event.currentTarget)?.style.setProperty(
          "--sidebar-width",
          `${SIDEBAR_WIDTH}px`
        )
        setWidth(SIDEBAR_WIDTH)
        localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
      }}
      className={cn(
        "absolute inset-y-0 z-20 w-1 cursor-col-resize touch-none",
        "right-0",
        "group-data-[collapsible=offcanvas]:hidden hover:bg-sidebar-border",
        className
      )}
    />
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background", className
      )}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto", className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-label",
      sidebar: "group-label",
    },
  })
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-0", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  render,
  isActive = false,
  variant = "default",
  size = "default",
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    isActive?: boolean
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      size,
      active: isActive,
    },
  })

  return comp
}

export {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
}
