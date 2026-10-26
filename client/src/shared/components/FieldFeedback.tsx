import type { ReactNode } from 'react';
import { cn } from '@shared/lib/utils';

export const fieldHintId = (id: string): string => `${id}-hint`;
export const fieldErrorId = (id: string): string => `${id}-error`;
export function fieldDescribedBy(
  id: string,
  { hint, error }: { hint?: unknown; error?: unknown },
): string | undefined {
  const ids = [hint ? fieldHintId(id) : null, error ? fieldErrorId(id) : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}
export interface FieldFeedbackProps {
  id: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  hintTestId?: string;
  errorTestId?: string;
}
/** Hints remain visible when an error appears; both describe the control. */
export const FieldFeedback = ({
  id,
  hint,
  error,
  className,
  hintTestId,
  errorTestId,
}: FieldFeedbackProps) => {
  if (!hint && !error) return null;
  return (
    <div className={cn('flex flex-col gap-1', className)} data-slot="field-feedback">
      {hint ? (
        <p
          id={fieldHintId(id)}
          data-slot="field-hint"
          data-testid={hintTestId}
          className="text-muted-foreground text-sm"
        >
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={fieldErrorId(id)}
          data-slot="field-error"
          data-testid={errorTestId}
          role="alert"
          className="text-destructive text-sm"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
};
