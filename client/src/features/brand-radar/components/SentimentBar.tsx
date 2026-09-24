import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import type { BrandRadarScanDetail } from '../types';

/**
 * Sentiment distribution — a FLAT horizontal stacked bar (no gradient, no
 * animation) on the SPEC-A1 status tokens, plus an accessible four-row table
 * fallback carrying the SAME whole-percentage values the server sent.
 *
 * The client computes nothing: `sentimentDistribution` arrives as whole
 * percents from `serializeScanDetail` and is rendered as handed over.
 */
export const BRAND_RADAR_SENTIMENT_KEYS = [
  'positive',
  'neutral',
  'negative',
  'unknown',
] as const;

export type BrandRadarSentimentKey = (typeof BRAND_RADAR_SENTIMENT_KEYS)[number];

/** Bar segment fills — full-strength status tokens (SPEC-A1). */
const SEGMENT_FILL: Record<BrandRadarSentimentKey, string> = {
  positive: 'bg-success',
  neutral: 'bg-muted-foreground',
  negative: 'bg-destructive',
  unknown: 'bg-muted',
};

/** Legend chips — soft-tint fills (SPEC-A2) with text, never colour alone. */
export const BRAND_RADAR_SENTIMENT_TONES: Record<BrandRadarSentimentKey, StatusTone> = {
  positive: 'success',
  neutral: 'muted',
  negative: 'destructive',
  unknown: 'muted',
};

interface SentimentBarProps {
  distribution: BrandRadarScanDetail['sentimentDistribution'];
}

export const SentimentBar = ({ distribution }: SentimentBarProps) => {
  const { t } = useTranslation('brandRadar');
  const segments = BRAND_RADAR_SENTIMENT_KEYS.map((key) => ({
    key,
    percent: distribution[key],
  }));

  return (
    <section className="flex flex-col gap-3" data-testid="brand-radar-sentiment">
      <h3 className="text-sm font-semibold">{t('detail.sentiment.title')}</h3>
      <div
        className="border-border flex h-3 w-full overflow-hidden rounded-md border"
        aria-hidden="true"
      >
        {segments.map((segment) => (
          <div
            key={segment.key}
            className={SEGMENT_FILL[segment.key]}
            style={{ width: `${segment.percent}%` }}
            data-testid={`brand-radar-sentiment-segment-${segment.key}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-2">
        {segments.map((segment) => (
          <li key={segment.key}>
            <StatusChip tone={BRAND_RADAR_SENTIMENT_TONES[segment.key]}>
              {t(`detail.sentiment.${segment.key}`)}{' '}
              {t('detail.sentiment.percent', { percent: segment.percent })}
            </StatusChip>
          </li>
        ))}
      </ul>
      <details className="sr-only" data-testid="brand-radar-sentiment-table">
        <summary>{t('detail.sentiment.expandTable')}</summary>
        <table>
          <caption>{t('detail.sentiment.tableCaption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('detail.sentiment.columnLabel')}</th>
              <th scope="col">{t('detail.sentiment.columnShare')}</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => (
              <tr key={segment.key} data-testid={`brand-radar-sentiment-row-${segment.key}`}>
                <td>{t(`detail.sentiment.${segment.key}`)}</td>
                <td>{t('detail.sentiment.percent', { percent: segment.percent })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
};
