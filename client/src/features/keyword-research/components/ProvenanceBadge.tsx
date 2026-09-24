/**
 * Compact provenance chip for the server's `meta` shape.
 *
 * Estimates (volume, difficulty, CPC, trend math), provider observations
 * (positions, SERP features), and AI interpretations (clusters) are labelled
 * distinctly and never blended into an unlabeled score. The optional
 * timestamp line discloses `observedAt` / `freshUntil` so stale data reads
 * as stale.
 */
import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import type {
  KeywordObservationKind,
  KeywordObservationMeta,
} from '../types';

const KIND_TONE: Record<KeywordObservationKind, StatusTone> = {
  estimate: 'muted',
  provider_observation: 'info',
  ai_interpretation: 'warning',
};

const KIND_LABEL_KEY: Record<KeywordObservationKind, string> = {
  estimate: 'keywordResearch:provenance.estimate',
  provider_observation: 'keywordResearch:provenance.providerObservation',
  ai_interpretation: 'keywordResearch:provenance.aiInterpretation',
};

interface ProvenanceBadgeProps {
  meta: KeywordObservationMeta;
  /** Render the observedAt/freshUntil disclosure line next to the chip. */
  withTimestamps?: boolean;
}

export const ProvenanceBadge = ({
  meta,
  withTimestamps = false,
}: ProvenanceBadgeProps) => {
  const { t, i18n } = useTranslation();

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <span
      className="inline-flex flex-wrap items-center gap-2"
      data-testid={`kw-provenance-${meta.kind}`}
    >
      <StatusChip tone={KIND_TONE[meta.kind]}>
        {t(KIND_LABEL_KEY[meta.kind])}
      </StatusChip>
      {withTimestamps ? (
        <span className="text-muted-foreground text-xs">
          {t('keywordResearch:provenance.observedAt', {
            time: formatDate(meta.observedAt),
          })}{' '}
          ·{' '}
          {t('keywordResearch:provenance.freshUntil', {
            time: formatDate(meta.freshUntil),
          })}
        </span>
      ) : null}
    </span>
  );
};

/** Standalone kind chip for column-level labelling (no meta object needed). */
export const ProvenanceKindChip = ({
  kind,
}: {
  kind: KeywordObservationKind;
}) => {
  const { t } = useTranslation();
  return (
    <StatusChip tone={KIND_TONE[kind]} data-testid={`kw-provenance-chip-${kind}`}>
      {t(KIND_LABEL_KEY[kind])}
    </StatusChip>
  );
};
