/**
 * Static SERP-feature chips — one per closed-enum member.
 *
 * Chips are static badges with a localized accessible name; never color
 * alone, never pulsing. `other` renders like every first-class member — the
 * vendor's unknown features are disclosed, not dropped. An empty list is an
 * honest "none observed" muted line, not an invented chip.
 */
import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import type { SerpFeature } from '../types';

const FEATURE_TONE: Record<SerpFeature, StatusTone> = {
  ai_overview: 'warning',
  featured_snippet: 'info',
  people_also_ask: 'info',
  local_pack: 'success',
  video: 'primary',
  images: 'primary',
  shopping: 'success',
  knowledge_graph: 'info',
  other: 'muted',
};

export const SerpFeatureChips = ({ features }: { features: SerpFeature[] }) => {
  const { t } = useTranslation();

  if (features.length === 0) {
    return (
      <span
        className="text-muted-foreground text-xs"
        data-testid="kw-serp-none"
      >
        {t('keywordResearch:overview.noFeatures')}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap gap-1">
      {features.map((feature) => (
        <StatusChip
          key={feature}
          tone={FEATURE_TONE[feature]}
          data-testid={`kw-serp-${feature}`}
        >
          {t(`keywordResearch:overview.featureLabels.${feature}`)}
        </StatusChip>
      ))}
    </span>
  );
};
