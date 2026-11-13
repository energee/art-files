import { useTranslation } from "@/i18n"
import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  bar,
  container,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** `"lock"`, a locking bar: the same modal dialog (focus trap, Escape,
   *  role), laid out as one row under the title bar with the window dimmed
   *  behind it, for a question the app can't go on without.
   *  `"plain"`, a bar that blocks nothing: no dimming, in the flow of
   *  `container` (the tab strip's slot), and keys.ts doesn't count it as a
   *  dialog. Its Dialog must be `modal={false} disablePointerDismissal`. */
  bar?: "lock" | "plain"
  /** Where the popup is portalled; the body when there is none. */
  container?: HTMLElement | null
}) {
  const { t } = useTranslation()
  return (
    <DialogPortal container={container ?? undefined}>
      {bar !== "plain" && <DialogOverlay className={bar ? "supports-backdrop-filter:backdrop-blur-none" : undefined} />}
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-bar={bar}
        className={cn(
          bar
            // top-10 is the header's height: the bar sits where the tab strip does.
            ? (bar === "plain" ? "shrink-0 border-b" : "fixed inset-x-0 top-10 z-50 border-y shadow-sm") + " flex flex-wrap items-center justify-end gap-x-4 gap-y-2 bg-popover px-3 py-2 text-sm text-popover-foreground duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-2 data-closed:animate-out data-closed:fade-out-0 [&_[data-slot=dialog-header]]:min-w-48 [&_[data-slot=dialog-header]]:flex-1 [&_[data-slot=dialog-header]]:gap-1 [&_[data-slot=dialog-title]]:text-sm [&_[data-slot=dialog-description]]:text-xs [&_[data-slot=dialog-footer]]:m-0! [&_[data-slot=dialog-footer]]:flex-row! [&_[data-slot=dialog-footer]]:rounded-none! [&_[data-slot=dialog-footer]]:border-0! [&_[data-slot=dialog-footer]]:bg-transparent! [&_[data-slot=dialog-footer]]:p-0!"
            : "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">{t("Close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          {t("Close")}
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
