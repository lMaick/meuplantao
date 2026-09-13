import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none touch-manipulation cursor-pointer focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 shadow-xs",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground shadow-xs",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline min-h-0 h-auto p-0",
      },
      size: {
        default:
          "h-11 min-h-[44px] gap-2 px-4 text-sm md:h-9 md:min-h-9 md:gap-1.5 md:px-3 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 md:has-data-[icon=inline-end]:pr-2 md:has-data-[icon=inline-start]:pl-2",
        xs: "min-h-[44px] gap-1 rounded-[min(var(--radius-md),10px)] px-3 text-xs md:h-6 md:min-h-6 md:px-2 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 md:has-data-[icon=inline-end]:pr-1.5 md:has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-[44px] gap-1.5 rounded-[min(var(--radius-md),12px)] px-3.5 text-xs font-semibold md:h-8 md:min-h-8 md:gap-1 md:px-2.5 md:text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 md:has-data-[icon=inline-end]:pr-1.5 md:has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 min-h-[48px] gap-2 px-5 text-base font-semibold md:h-10 md:min-h-10 md:px-4 md:text-sm has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 md:has-data-[icon=inline-end]:pr-3 md:has-data-[icon=inline-start]:pl-3",
        icon: "size-11 min-h-[44px] min-w-[44px] md:size-9 md:min-h-9 md:min-w-9 [&_svg:not([class*='size-'])]:size-5 md:[&_svg:not([class*='size-'])]:size-4",
        "icon-xs":
          "size-11 min-h-[44px] min-w-[44px] rounded-[min(var(--radius-md),10px)] md:size-6 md:min-h-6 md:min-w-6 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-4 md:[&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-11 min-h-[44px] min-w-[44px] rounded-[min(var(--radius-md),12px)] md:size-8 md:min-h-8 md:min-w-8 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-4 md:[&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-12 min-h-[48px] min-w-[48px] md:size-10 md:min-h-10 md:min-w-10 [&_svg:not([class*='size-'])]:size-6 md:[&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
