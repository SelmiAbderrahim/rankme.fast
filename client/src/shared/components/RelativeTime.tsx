import { useTranslation } from 'react-i18next';
import { formatAbsoluteDate, formatRelativeDate, type DateInput } from '@shared/lib/datetime';
import { cn } from '@shared/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@shared/ui/tooltip';

export interface RelativeTimeProps {
  value: DateInput;
  className?: string;
  now?: number;
  timeZone?: string;
  granularity?: 'day';
  'data-testid'?: string;
}

/** Relative dates expose their exact date to pointer and keyboard users. */
export function RelativeTime({ value, className, now, timeZone, granularity, ...rest }: RelativeTimeProps) {
  const { i18n } = useTranslation();
  const relative = formatRelativeDate(value, i18n.language, { now, timeZone, granularity });
  const absolute = formatAbsoluteDate(value, i18n.language, { timeZone, withTime: granularity !== 'day' });
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <time dateTime={typeof value === 'string' ? value : new Date(value).toISOString()} tabIndex={0} data-absolute={absolute} data-testid={rest['data-testid']} className={cn('focus-visible:ring-ring/50 rounded-sm underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-[3px]', className)}>{relative}</time>
  </TooltipTrigger><TooltipContent>{absolute}</TooltipContent></Tooltip></TooltipProvider>;
}
