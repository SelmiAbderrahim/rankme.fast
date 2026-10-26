import { useTranslation } from 'react-i18next';
import { formatSignedNumber, type SignedNumberOptions } from '@shared/lib/signedNumber';
import { cn } from '@shared/lib/utils';

export interface SignedNumberProps {
  value: number;
  options?: SignedNumberOptions;
  className?: string;
  'data-testid'?: string;
}

export function SignedNumber({ value, options, className, ...rest }: SignedNumberProps) {
  const { i18n } = useTranslation();
  return <bdi dir="ltr" className={cn('tabular-nums whitespace-nowrap', className)} data-testid={rest['data-testid']}>{formatSignedNumber(value, i18n.language, options)}</bdi>;
}
