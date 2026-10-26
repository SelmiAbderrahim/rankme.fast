import type { ReactNode } from 'react';
import { dominantDirection } from '@shared/lib/bidi';

export interface BdiProps {
  /** Optional for translated component slots. */
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
  dominant?: boolean;
}

/** Isolate mixed-direction content without changing or interpreting its text. */
export const Bdi = ({ children, className, dominant = false, ...rest }: BdiProps) => (
  <bdi dir={dominant && typeof children === 'string' ? dominantDirection(children) : 'auto'} className={className} data-testid={rest['data-testid']}>
    {typeof children === 'string'
      ? children.split(/(\([^()]*\))/u).map((part, index) =>
          /^\([^()]*\p{L}[^()]*\)$/u.test(part)
            ? <span key={index} dir="auto" style={{ unicodeBidi: 'isolate' }}>{part}</span>
            : part,
        )
      : children}
  </bdi>
);
