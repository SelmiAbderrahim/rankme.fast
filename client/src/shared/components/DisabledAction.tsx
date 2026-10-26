import { useId, type ComponentProps } from 'react';
import { Button } from '@shared/ui/button';

/** Keep the native button inert and expose its reason as a keyboard stop. */
export function DisabledAction({
  reason,
  id,
  disabled,
  loading,
  'aria-describedby': describedBy,
  ...props
}: ComponentProps<typeof Button> & { reason?: string }) {
  const generatedId = useId();
  const buttonId = id ?? `${generatedId}-action`;
  const reasonId = `${generatedId}-reason`;
  const unavailable = Boolean(disabled || loading);
  const description =
    [describedBy, unavailable && reason ? reasonId : undefined].filter(Boolean).join(' ') ||
    undefined;
  return (
    <span
      className="inline-flex min-w-0 max-w-full flex-col items-start gap-2 rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      role={unavailable ? 'group' : undefined}
      tabIndex={unavailable ? 0 : undefined}
      aria-labelledby={unavailable ? buttonId : undefined}
      aria-describedby={unavailable ? description : undefined}
    >
      <Button
        {...props}
        id={buttonId}
        disabled={disabled}
        loading={loading}
        aria-describedby={description}
      />
      {unavailable && reason ? (
        <span id={reasonId} className="text-muted-foreground max-w-sm text-xs whitespace-normal">
          {reason}
        </span>
      ) : null}
    </span>
  );
}
