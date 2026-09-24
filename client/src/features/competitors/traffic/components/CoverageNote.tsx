import { useTranslation } from 'react-i18next';
import { Badge } from '@shared/ui/badge';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import type { ObservationMeta } from '@shared/observations/types';

interface CoverageNoteProps {
  observation: ObservationMeta;
  sourceHref?: string;
}

/** Honest disclosure rendered beside every provider-index numeric value. */
export const CoverageNote = ({ observation, sourceHref }: CoverageNoteProps) => {
  const { t, i18n } = useTranslation('competitorsTraffic');
  const observedAt = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
  }).format(new Date(observation.observedAt));

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Badge variant="outline">{t('estimate.label')}</Badge>
      <span>{t('estimate.coverage')}</span>
      <span>{t('estimate.observedAt', { date: observedAt })}</span>
      <span>{t(`estimate.freshness.${observation.freshness}`)}</span>
      {sourceHref ? (
        // eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL includes noopener+noreferrer.
        <a
          href={safeExternalHref(sourceHref)}
          rel={SAFE_EXTERNAL_REL}
          target="_blank"
          className="underline underline-offset-4"
        >
          {t('estimate.source')}
        </a>
      ) : null}
    </span>
  );
};
