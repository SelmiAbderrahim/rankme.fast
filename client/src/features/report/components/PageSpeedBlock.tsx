/**
 * PageSpeed block — compact field vs lab table rendered inside
 * a page-speed rule row (`core-web-vitals-poor`, `page-speed-lab-low`,
 * `mobile-unfriendly`). No gauges, no multicolor meters, no gradient fills
 * — the neutral shadcn/ui theme (design-system.md): flat 1px-bordered
 * block, plain text metrics, static semantic Badge for the CWV category.
 *
 * States rendered here:
 *   - `status: 'unavailable'`  → localized inline note, no table.
 *   - `samples.length === 0`   → same "no data yet" inline note.
 *   - Samples with `fieldDataLevel === 'none'` and no `coreWebVitals` →
 *     "not enough visitor data yet" per row (Chrome-UX-Report threshold).
 *   - Samples with `fieldDataLevel === 'origin'` → labeled with an origin
 *     fallback note so the reader knows it's not URL-level data.
 */
import { useTranslation } from 'react-i18next';
import { safeExternalHref } from '@shared/security';
import { Badge } from '@shared/ui/badge';
import type {
  CoreWebVitalsCategory,
  PageSpeedSection,
} from '../types';

export interface PageSpeedBlockProps {
  section: PageSpeedSection;
}

const categoryVariant: Record<CoreWebVitalsCategory, 'destructive' | 'secondary' | 'outline'> = {
  good: 'outline',
  'needs-improvement': 'secondary',
  poor: 'destructive',
};

const formatMs = (n: number): string => `${Math.round(n)} ms`;
const formatCls = (n: number): string => n.toFixed(2);

export const PageSpeedBlock = ({ section }: PageSpeedBlockProps) => {
  const { t } = useTranslation('report');

  if (section.status === 'unavailable') {
    return (
      <div
        className="border-border bg-muted/40 rounded-lg border p-4"
        data-testid="report-pagespeed-unavailable"
        role="note"
      >
        <p className="text-sm font-semibold">{t('pageSpeed.unavailableTitle')}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('pageSpeed.unavailableBody')}
        </p>
      </div>
    );
  }

  if (section.samples.length === 0) {
    return (
      <div
        className="border-border bg-muted/40 rounded-lg border p-4"
        data-testid="report-pagespeed-empty"
        role="note"
      >
        <p className="text-sm font-semibold">{t('pageSpeed.noFieldDataTitle')}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('pageSpeed.noFieldDataBody')}
        </p>
      </div>
    );
  }

  const count = section.samples.length;

  return (
    <div
      className="border-border rounded-lg border"
      data-testid="report-pagespeed-block"
    >
      <div className="border-b px-4 py-3">
        <p className="text-sm font-semibold">{t('pageSpeed.sectionTitle')}</p>
        <p className="text-muted-foreground text-xs">
          {count === 1 ? t('pageSpeed.sampleLabelOne') : t('pageSpeed.sampleLabel', { count })}
        </p>
      </div>
      <div className="flex flex-col divide-y">
        {section.samples.map((sample) => {
          const cwv = sample.coreWebVitals;
          return (
            <div
              key={`${sample.url}::${sample.strategy}`}
              className="px-4 py-3"
              data-testid="report-pagespeed-sample"
              data-url={sample.url}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href={safeExternalHref(sample.url)}
                  target="_blank"
                  rel="nofollow ugc noopener noreferrer"
                  className="text-primary min-w-0 flex-1 font-mono text-xs break-all underline"
                >
                  {sample.url}
                </a>
                {cwv ? (
                  <Badge
                    variant={categoryVariant[cwv.category]}
                    data-testid={`report-pagespeed-cwv-${cwv.category}`}
                  >
                    {t(`pageSpeed.categories.${cwv.category}`)}
                  </Badge>
                ) : null}
              </div>

              {/* Field data (CrUX / real visitors). */}
              {cwv ? (
                <div className="mt-3">
                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    {t('pageSpeed.fieldLabel')}
                  </p>
                  <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">{t('pageSpeed.metrics.lcp')}</dt>
                      <dd className="font-medium tabular-nums">{formatMs(cwv.lcpMs)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">{t('pageSpeed.metrics.inp')}</dt>
                      <dd className="font-medium tabular-nums">{formatMs(cwv.inp)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">{t('pageSpeed.metrics.cls')}</dt>
                      <dd className="font-medium tabular-nums">{formatCls(cwv.cls)}</dd>
                    </div>
                  </dl>
                  {sample.fieldDataLevel === 'origin' ? (
                    <p className="text-muted-foreground mt-1 text-xs italic">
                      {t('pageSpeed.originFallback')}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground mt-2 text-xs italic">
                  {t('pageSpeed.noFieldDataTitle')}
                </p>
              )}

              {/* Lab estimate (Lighthouse). */}
              <div className="mt-3">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {t('pageSpeed.labLabel')}
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-muted-foreground">
                    {t('pageSpeed.metrics.performance')}
                  </span>{' '}
                  <span className="font-medium tabular-nums">{sample.labScores.performance}</span>
                  <span className="text-muted-foreground"> / 100</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
