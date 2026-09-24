import * as React from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

interface TableHeaderHelpProps {
  label: React.ReactNode;
  description: React.ReactNode;
  labelText?: string;
}

function TableHeaderHelp({ label, description, labelText }: TableHeaderHelpProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = React.useState(false);
  const clickOpen = React.useRef(false);
  const accessibleLabel = labelText ?? (typeof label === 'string' ? label : '');

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) clickOpen.current = false;
  };

  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <TooltipProvider>
        <Tooltip open={open} onOpenChange={handleOpenChange}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={t('tableHelp.about', { column: accessibleLabel })}
              aria-expanded={open}
              onClick={(event) => {
                // TooltipTrigger closes on every click after the child's handler.
                // This trigger is controlled so explicit click state must win.
                event.preventDefault();
                event.stopPropagation();
                const nextOpen = !clickOpen.current;
                clickOpen.current = nextOpen;
                setOpen(nextOpen);
              }}
              onPointerDown={(event) => {
                // Radix closes an open tooltip on pointer-down before the click
                // handler can distinguish a pinned click from transient hover.
                if (open) event.preventDefault();
                event.stopPropagation();
              }}
            >
              <Info aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72 whitespace-normal" sideOffset={4}>
            {description}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

export { TableHeaderHelp, type TableHeaderHelpProps };
