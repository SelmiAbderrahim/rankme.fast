import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/shared/lib/utils"

type NativeSelectProps = React.ComponentProps<"select"> & {
  /** Classes for the positioning wrapper — use for widths (`w-56`, `sm:w-64`). */
  wrapperClassName?: string
}

/**
 * A real `<select>` styled to match the Radix `Select` trigger (height,
 * `border-input`, radius, shadow, focus ring and chevron). Prefer this for
 * short, form-bound lists (filters, registered form fields) where the browser's
 * own picker is the better control on touch devices and `register()` / uncontrolled
 * `onChange` handlers already target a native element; use `Select` for
 * searchable or rich-option lists. The two must never look different side by side.
 *
 * forwardRef so react-hook-form's `register` ref attaches under React 18.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => {
    return (
      <div
        data-slot="native-select-wrapper"
        className={cn("relative flex min-w-0", wrapperClassName)}
      >
        <select
          ref={ref}
          data-slot="native-select"
          className={cn(
            "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent ps-3 pe-9 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none dark:bg-input/30 dark:hover:bg-input/50",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
            // Focus ring is neutral ink; an invalid field keeps the red ring while focused.
            "focus-visible:aria-invalid:border-destructive focus-visible:aria-invalid:ring-destructive/40",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDownIcon
          aria-hidden="true"
          data-slot="native-select-icon"
          className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground opacity-50"
        />
      </div>
    )
  }
)
NativeSelect.displayName = "NativeSelect"

export { NativeSelect }
