import { useRef, useState, type ReactElement, type ReactNode, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';

export interface NavTooltipProps {
  label: ReactNode;
  shortcut?: string;
  when?: 'always' | 'truncated' | 'never';
  children: ReactElement;
}
export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded border border-background/40 px-1 font-sans text-[0.7rem] leading-4 font-medium">
    {children}
  </kbd>
);
/** Share one directional hint and keep the trigger mounted as its mode changes. */
export const NavTooltip = ({ label, shortcut, when = 'always', children }: NavTooltipProps) => {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const capture = (event: SyntheticEvent<HTMLElement>) => {
    trigger.current = event.currentTarget;
  };
  return (
    <Tooltip
      open={when !== 'never' && open}
      onOpenChange={(next) => {
        const labelElement = trigger.current?.querySelector<HTMLElement>('[data-nav-label]');
        if (
          next &&
          when === 'truncated' &&
          !(labelElement && labelElement.scrollWidth > labelElement.clientWidth)
        )
          return;
        setOpen(next);
      }}
    >
      <TooltipTrigger asChild onPointerEnter={capture} onFocus={capture}>
        {children}
      </TooltipTrigger>
      <TooltipContent
        side={i18n.dir() === 'rtl' ? 'left' : 'right'}
        sideOffset={8}
        className="flex items-center gap-2"
        data-testid="nav-tooltip"
      >
        <span>{label}</span>
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
};
