import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@shared/ui/status-chip';
import type { LocalSeoSection } from '../types';

export interface LocalSeoBlockProps {
  section: LocalSeoSection | null;
  siteId: string;
}

export const LocalSeoBlock = ({ section, siteId }: LocalSeoBlockProps) => {
  const { t } = useTranslation('report');

  if (section === null || section.status === 'unavailable') {
    return (
      <div className="border-border bg-muted/40 rounded-lg border p-4" role="note">
        <p className="text-sm font-semibold">{t('localSeoBlock.unavailableTitle')}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('localSeoBlock.unavailableBody')}
        </p>
      </div>
    );
  }

  if (section.status === 'not-configured') {
    return (
      <div className="border-border bg-muted/40 rounded-lg border p-4" role="note">
        <p className="text-sm font-semibold">{t('localSeoBlock.notConfiguredTitle')}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('localSeoBlock.notConfiguredBody')}
        </p>
        <Link
          to={`/sites/${siteId}?tab=local-seo`}
          className="text-primary mt-2 inline-block text-sm font-medium underline"
        >
          {t('localSeoBlock.notConfiguredCta')}
        </Link>
      </div>
    );
  }

  return (
    <div className="border-border rounded-lg border" data-testid="report-local-seo-block">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-semibold">{t('localSeoBlock.title')}</p>
      </div>
      <div className="space-y-4 px-4 py-3">
        {section.listings.length > 0 ? (
          <div>
            <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">
              {t('localSeoBlock.listings')}
            </p>
            <ul className="space-y-1">
              {section.listings.map((row) => (
                <li key={row.source} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{row.source}</span>
                  {row.consistent ? (
                    <StatusChip tone="success">{t('localSeoBlock.consistent')}</StatusChip>
                  ) : (
                    <StatusChip tone="destructive">{t('localSeoBlock.inconsistent')}</StatusChip>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {section.reviews !== null ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('localSeoBlock.averageRating')}</dt>
              <dd className="font-medium tabular-nums" dir="ltr">
                {section.reviews.averageRating === null
                  ? t('localSeoBlock.noData')
                  : section.reviews.averageRating.toFixed(1)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('localSeoBlock.reviewCount')}</dt>
              <dd className="font-medium tabular-nums" dir="ltr">
                {section.reviews.reviewCount}
              </dd>
            </div>
            {section.qa !== null ? (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">
                  {t('localSeoBlock.unansweredQuestions')}
                </dt>
                <dd className="font-medium tabular-nums" dir="ltr">
                  {section.qa.unansweredCount}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {section.localPack !== null ? (
          <div className="text-sm">
            <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
              {t('localSeoBlock.localPack')}
            </p>
            <p>
              <span className="font-medium">{section.localPack.keyword}</span>
              {': '}
              <span className="tabular-nums" dir="ltr">
                {section.localPack.position === null
                  ? t('localSeoBlock.notRanked')
                  : `#${section.localPack.position}`}
              </span>
              <span className="text-muted-foreground">
                {' · '}
                {t('localSeoBlock.packSize', { count: section.localPack.totalPackSize })}
              </span>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
