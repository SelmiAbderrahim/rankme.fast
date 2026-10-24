import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatAbsoluteDate } from '@shared/lib/datetime';
import { addDays, addMonths, clampDateOnly, firstDayOfWeek, isSameMonth, parseDateOnly, startOfMonth, toDateOnly, todayDateOnly } from '@shared/lib/dateOnly';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';

export interface DatePickerProps {
  id?: string;
  labelId?: string;
  /** A calendar day in YYYY-MM-DD form, or an empty string. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}
/** A localized calendar whose values remain calendar days across time zones. */
export const DatePicker = ({
  id,
  labelId,
  value,
  onChange,
  min,
  max,
  placeholder,
  clearable = true,
  disabled,
  className,
  'data-testid': testId,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: DatePickerProps) => {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.language;
  const rtl = i18n.dir(locale) === 'rtl';
  const generatedId = useId();
  const valueId = `${generatedId}-value`,
    headingId = `${generatedId}-month`;
  const selected = parseDateOnly(value),
    minTime = parseDateOnly(min),
    maxTime = parseDateOnly(max);
  const clamp = (time: number) => clampDateOnly(time, minTime, maxTime);
  const today = todayDateOnly();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(() => clamp(selected ?? today));
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(focused));
  const gridRef = useRef<HTMLTableElement>(null);
  const focusDay = (time: number) =>
    requestAnimationFrame(() =>
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${toDateOnly(time)}"]`)
        ?.focus(),
    );
  const moveFocus = (time: number) => {
    const next = clamp(time);
    setFocused(next);
    if (!isSameMonth(next, visibleMonth)) setVisibleMonth(startOfMonth(next));
    focusDay(next);
  };
  const openChange = (next: boolean) => {
    if (next) {
      const start = clamp(selected ?? today);
      setFocused(start);
      setVisibleMonth(startOfMonth(start));
    }
    setOpen(next);
  };
  const choose = (time: number) => {
    onChange(toDateOnly(time));
    setOpen(false);
  };
  const showMonth = (months: number) => {
    setFocused(clamp(addMonths(focused, months)));
    setVisibleMonth(startOfMonth(addMonths(visibleMonth, months)));
  };
  const weekStart = firstDayOfWeek(locale);
  const lead = (new Date(visibleMonth).getUTCDay() - weekStart + 7) % 7;
  const gridStart = addDays(visibleMonth, -lead);
  const weeks = Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(gridStart, week * 7 + day)),
  );
  const utc = { timeZone: 'UTC' } as const;
  const monthLabel = new Intl.DateTimeFormat(locale, {
    ...utc,
    month: 'long',
    year: 'numeric',
  }).format(visibleMonth);
  const shortWeekday = new Intl.DateTimeFormat(locale, { ...utc, weekday: 'short' });
  const longWeekday = new Intl.DateTimeFormat(locale, { ...utc, weekday: 'long' });
  const fullDate = new Intl.DateTimeFormat(locale, { ...utc, dateStyle: 'full' });
  const numeral = new Intl.NumberFormat(locale);
  const outOfRange = (time: number) =>
    (minTime !== null && time < minTime) || (maxTime !== null && time > maxTime);
  const previousDisabled = minTime !== null && visibleMonth <= minTime;
  const nextDisabled = maxTime !== null && addMonths(visibleMonth, 1) > maxTime;
  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, column: number) => {
    const forward = rtl ? -1 : 1,
      months = event.shiftKey ? 12 : 1;
    const moves: Record<string, () => number> = {
      ArrowRight: () => addDays(focused, forward),
      ArrowLeft: () => addDays(focused, -forward),
      ArrowDown: () => addDays(focused, 7),
      ArrowUp: () => addDays(focused, -7),
      Home: () => addDays(focused, -column),
      End: () => addDays(focused, 6 - column),
      PageDown: () => addMonths(focused, months),
      PageUp: () => addMonths(focused, -months),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveFocus(move());
  };
  const display =
    selected !== null
      ? formatAbsoluteDate(value, locale)
      : (placeholder ?? t('datePicker.placeholder'));
  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          data-slot="date-picker"
          data-value={value}
          data-testid={testId}
          aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={cn('w-full justify-start px-3 font-normal', className)}
        >
          <CalendarDays aria-hidden="true" className="text-muted-foreground" />
          <span
            id={valueId}
            className={cn('truncate', selected === null && 'text-muted-foreground')}
          >
            {display}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        dir={rtl ? 'rtl' : 'ltr'}
        className="w-auto p-3"
        role="dialog"
        aria-label={t('datePicker.dialogLabel')}
        data-testid={testId ? `${testId}-calendar` : undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusDay(focused);
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('datePicker.previousMonth')}
            data-nav="previous"
            disabled={previousDisabled}
            onClick={() => showMonth(-1)}
          >
            <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
          </Button>
          <p id={headingId} aria-live="polite" className="text-sm font-medium">
            {monthLabel}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('datePicker.nextMonth')}
            data-nav="next"
            disabled={nextDisabled}
            onClick={() => showMonth(1)}
          >
            <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
          </Button>
        </div>
        <table
          ref={gridRef}
          role="grid"
          aria-labelledby={headingId}
          data-month={toDateOnly(visibleMonth).slice(0, 7)}
          className="mt-2 border-collapse"
        >
          <thead>
            <tr>
              {weeks[0]!.map((day) => (
                <th
                  key={day}
                  scope="col"
                  abbr={longWeekday.format(day)}
                  className="pb-1 text-xs font-normal text-muted-foreground"
                >
                  {shortWeekday.format(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((day, column) => {
                  const isSelected = day === selected,
                    isToday = day === today;
                  return (
                    <td
                      key={day}
                      role="gridcell"
                      aria-selected={isSelected}
                      className="p-0 text-center"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        data-date={toDateOnly(day)}
                        tabIndex={day === focused ? 0 : -1}
                        aria-label={fullDate.format(day)}
                        aria-current={isToday ? 'date' : undefined}
                        disabled={outOfRange(day)}
                        onClick={() => choose(day)}
                        onKeyDown={(event) => onDayKeyDown(event, column)}
                        className={cn(
                          'font-normal max-md:min-h-0 max-md:min-w-0 max-[359px]:size-10 min-[360px]:max-md:size-11',
                          !isSameMonth(day, visibleMonth) && 'text-muted-foreground',
                          isToday && 'border border-input',
                          isSelected &&
                            'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                        )}
                      >
                        {numeral.format(new Date(day).getUTCDate())}
                      </Button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex justify-between gap-2 border-t border-border pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-action="today"
            disabled={outOfRange(today)}
            onClick={() => choose(today)}
          >
            {t('datePicker.today')}
          </Button>
          {clearable && selected !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-action="clear"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              {t('datePicker.clear')}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
