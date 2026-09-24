import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@shared/lib/utils';

export function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <Loader2
      aria-hidden="true"
      data-slot="spinner"
      className={cn('animate-spin motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
