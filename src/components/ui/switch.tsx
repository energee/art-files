import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.15rem] w-8 shrink-0 touch:relative touch:after:absolute touch:after:-inset-x-[9px] touch:after:-inset-y-[15px] touch:after:content-[''] cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-switch-on data-unchecked:bg-input",
        className
      )}
      {...props}
    >
      {/* On a touch screen the after: box widens the hit area to 44px
          without growing the drawn track. Every row that holds a switch
          (the inspector's Field and Heading, the Settings dialog's
          two-file row) is 44px tall there, so the box stays in its row. */}
      {/* A white thumb in both schemes: the tracks (--input, --switch-on)
          are mid-to-dark either way. */}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-white ring-0 transition-transform data-checked:translate-x-[calc(100%-2px)]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
