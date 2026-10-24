/** Shared sidebar rows use the same current-page marker and interaction states. */
export const NAV_ROW_CLASS = [
  'relative flex h-9 w-full min-w-0 shrink-0 cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2.5',
  'text-start text-sm whitespace-nowrap text-muted-foreground outline-hidden',
  'transition-colors duration-150 motion-reduce:transition-none',
  'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
  'active:bg-sidebar-accent active:text-sidebar-foreground',
  'focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset',
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75] [&_svg]:text-muted-foreground [&_svg]:transition-colors [&_svg]:duration-150',
  'hover:[&_svg]:text-sidebar-foreground',
  'aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-accent-foreground aria-[current=page]:[&_svg]:text-sidebar-accent-foreground',
  'aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2 aria-[current=page]:before:start-0 aria-[current=page]:before:w-0.5 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-sidebar-primary',
  'data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-sidebar-accent-foreground',
  'data-[active=true]:before:absolute data-[active=true]:before:inset-y-2 data-[active=true]:before:start-0 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-full data-[active=true]:before:bg-sidebar-primary',
  'data-[parent-active=true]:font-medium data-[parent-active=true]:text-sidebar-foreground data-[parent-active=true]:[&_svg]:text-sidebar-foreground',
].join(' ');
export const NAV_RAIL_BUTTON_CLASS = 'size-10 justify-center gap-0 px-0';
export const NAV_LABEL_CLASS =
  'min-w-0 flex-1 truncate transition-opacity duration-150 ease-out motion-reduce:transition-none';
export const NAV_GROUP_LABEL_CLASS = 'text-xs font-medium text-muted-foreground';
export const NAV_ICON_BUTTON_CLASS =
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground active:bg-sidebar-accent active:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring motion-reduce:transition-none [&_svg]:size-4 [&_svg]:stroke-[1.75]';
