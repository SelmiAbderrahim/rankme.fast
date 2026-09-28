import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';

/** One probed http/https × apex/www address (`https-canonicalization` evidence). */
export interface AddressVariant {
  url: string;
  status: number | null;
  finalUrl: string | null;
  ok: boolean | null;
}

const isVariant = (value: unknown): value is AddressVariant => {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.url === 'string' &&
    (v.status === null || typeof v.status === 'number') &&
    (v.finalUrl === null || typeof v.finalUrl === 'string') &&
    (v.ok === null || typeof v.ok === 'boolean')
  );
};

/** The probed address variants stored on a finding, or null when there are none. */
export const addressVariantsOf = (
  meta: Record<string, unknown> | undefined,
): AddressVariant[] | null => {
  const raw = meta?.addressVariants;
  if (!Array.isArray(raw)) return null;
  const variants = raw.filter(isVariant);
  return variants.length > 0 ? variants : null;
};

const toneFor = (ok: boolean | null): StatusTone =>
  ok === true ? 'success' : ok === false ? 'destructive' : 'muted';

/**
 * Evidence table for the HTTPS / address-setup check: where each address of
 * the site ends up, so a warning names the exact address to fix.
 */
export const AddressVariantsBlock = ({ variants }: { variants: AddressVariant[] }) => {
  const { t } = useTranslation('report');

  const resultFor = (variant: AddressVariant): string => {
    if (variant.status === null || variant.finalUrl === null) {
      return t('detail.addressVariants.unreachable');
    }
    if (variant.status >= 400) {
      return t('detail.addressVariants.endsWithError', {
        url: variant.finalUrl,
        status: variant.status,
      });
    }
    if (variant.finalUrl === variant.url) {
      return variant.ok
        ? t('detail.addressVariants.mainAddress')
        : t('detail.addressVariants.answersDirectly', { status: variant.status });
    }
    return t('detail.addressVariants.redirectsTo', { url: variant.finalUrl });
  };

  const chipFor = (ok: boolean | null): string =>
    ok === true
      ? t('detail.addressVariants.okChip')
      : ok === false
        ? t('detail.addressVariants.problemChip')
        : t('detail.addressVariants.unknownChip');

  return (
    <div className="mb-4" data-testid="report-address-variants">
      <h4 className="text-sm font-semibold">{t('detail.addressVariants.title')}</h4>
      <Table className="mt-1">
        <TableHeader>
          <TableRow>
            <TableHead>{t('detail.addressVariants.address')}</TableHead>
            <TableHead>{t('detail.addressVariants.result')}</TableHead>
            <TableHead className="text-end">{t('detail.addressVariants.verdict')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variants.map((variant) => (
            <TableRow key={variant.url} data-testid="report-address-variant">
              <TableCell className="font-mono text-xs break-all" dir="ltr">
                {variant.url}
              </TableCell>
              <TableCell className="text-xs whitespace-normal break-all">
                {resultFor(variant)}
              </TableCell>
              <TableCell className="text-end">
                <StatusChip tone={toneFor(variant.ok)}>{chipFor(variant.ok)}</StatusChip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
