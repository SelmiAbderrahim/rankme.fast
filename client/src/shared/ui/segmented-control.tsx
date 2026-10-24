import type { ComponentProps } from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from '@shared/lib/utils';

export function SegmentedControl({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="segmented-control"
      className={cn(
        'inline-flex h-9 w-fit max-w-full items-center rounded-lg bg-muted p-[3px] max-md:h-auto text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
export function SegmentedControlItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="segmented-control-item"
      className={cn(
        "inline-flex h-[calc(100%-1px)] cursor-pointer items-center justify-center gap-1.5 max-md:min-h-11 rounded-md border border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground/70 transition-[background-color,border-color,color,box-shadow,opacity] outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm dark:text-muted-foreground dark:hover:text-foreground dark:data-[state=checked]:border-input dark:data-[state=checked]:bg-input/30 dark:data-[state=checked]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}
