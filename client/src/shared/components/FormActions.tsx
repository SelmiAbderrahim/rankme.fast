import type { ReactNode } from 'react';
import { cn } from '@shared/lib/utils';

/** Form actions align at the inline start and wrap on narrow screens. */
export const FormActions = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div data-slot="form-actions" className={cn('flex flex-wrap items-center gap-2', className)}>
    {children}
  </div>
);
