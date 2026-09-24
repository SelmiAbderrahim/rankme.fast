import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObservationMeta } from '@shared/observations/types';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';

interface ReviewObservationMetaProps {
  observation: ObservationMeta | null;
}

const TONE_BY_KIND: Record<ObservationMeta['sourceKind'], StatusTone> = {
  first_party: 'muted',
  provider_observation: 'info',
  estimate: 'muted',
  ai_interpretation: 'warning',
};

/**
 * Shared provenance disclosure for the review surface. Numeric
 * inventory/stats are provider observations; generated themes are explicitly
 * labelled AI interpretation and never visually blend into deterministic
 * service math.
 */
export const ReviewObservationMeta = ({
  observation,
}: ReviewObservationMetaProps) => {
  const { t, i18n } = useTranslation('reviewIntelligence');
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [i18n.language],
  );

  if (!observation) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      data-testid={`reviews-provenance-${observation.sourceKind}`}
    >
      <StatusChip tone={TONE_BY_KIND[observation.sourceKind]}>
        {t(`provenance.${observation.sourceKind}`)}
      </StatusChip>
      <span>
        {t('provenance.observedAt', {
          date: formatter.format(new Date(observation.observedAt)),
        })}
      </span>
      <span>{t('provenance.sampleCount', { count: observation.sampleCount })}</span>
    </div>
  );
};
