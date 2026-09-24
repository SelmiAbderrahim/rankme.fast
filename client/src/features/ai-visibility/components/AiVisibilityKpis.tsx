import { useTranslation } from 'react-i18next';
import { StatCard } from '@shared/ui/stat-card';
import { StatusChip } from '@shared/ui/status-chip';
import type { AiVisibilityOverview } from '../types';

interface Props {
  overview: AiVisibilityOverview;
}

/**
 * KPI strip above the share-of-voice card — surfaces the aggregate fields the
 * overview endpoint already returns (sentiment split, mention coverage).
 */
export const AiVisibilityKpis = ({ overview }: Props) => {
  const { t, i18n } = useTranslation('aiVisibility');
  const pctFormat = new Intl.NumberFormat(i18n.language, { style: 'percent' });
  const mentionedCount = new Set(
    overview.snapshots.filter((row) => row.mentioned).map((row) => row.prompt),
  ).size;
  const totalPrompts = overview.prompts.length;
  const sentiment = overview.sentiment;

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="ai-visibility-kpis"
    >
      <StatCard
        variant="kpi"
        label={t('kpi.shareOfVoice')}
        value={
          overview.shareOfVoicePct === null ? (
            t('share.noData')
          ) : (
            <span dir="ltr">{pctFormat.format(overview.shareOfVoicePct / 100)}</span>
          )
        }
        context={t('share.description')}
        data-testid="ai-visibility-kpi-share"
      />
      <StatCard
        variant="kpi"
        label={t('kpi.mentioned')}
        value={
          <span dir="ltr">
            {t('kpi.mentionedOf', { mentioned: mentionedCount, total: totalPrompts })}
          </span>
        }
        context={t('kpi.mentionedContext')}
        data-testid="ai-visibility-kpi-mentioned"
      />
      <StatCard
        variant="kpi"
        label={t('kpi.sentiment')}
        value={
          <span className="flex flex-wrap gap-1" data-testid="ai-visibility-kpi-sentiment">
            <StatusChip tone="success">
              <span className="tabular-nums" dir="ltr">
                {sentiment.positive}
              </span>{' '}
              {t('kpi.sentimentPositive')}
            </StatusChip>
            <StatusChip tone="muted">
              <span className="tabular-nums" dir="ltr">
                {sentiment.neutral}
              </span>{' '}
              {t('kpi.sentimentNeutral')}
            </StatusChip>
            <StatusChip tone="destructive">
              <span className="tabular-nums" dir="ltr">
                {sentiment.negative}
              </span>{' '}
              {t('kpi.sentimentNegative')}
            </StatusChip>
          </span>
        }
        context={t('kpi.sentimentContext')}
        data-testid="ai-visibility-kpi-tone"
      />
    </div>
  );
};
