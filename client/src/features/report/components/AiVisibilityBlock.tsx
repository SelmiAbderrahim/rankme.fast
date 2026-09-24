import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import type { AiVisibilitySection } from '../types';

export interface AiVisibilityBlockProps {
  section: AiVisibilitySection | null;
  siteId: string;
}

const sentimentTone: Record<'positive' | 'neutral' | 'negative', StatusTone> = {
  positive: 'success',
  neutral: 'muted',
  negative: 'destructive',
};

export const AiVisibilityBlock = ({ section, siteId }: AiVisibilityBlockProps) => {
  const { t, i18n } = useTranslation('report');

  if (section === null || section.status === 'unavailable') {
    return (
      <div className="border-border bg-muted/40 rounded-lg border p-4" role="note">
        <p className="text-sm font-semibold">{t('aiVisibilityBlock.unavailableTitle')}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('aiVisibilityBlock.unavailableBody')}
        </p>
      </div>
    );
  }

  if (section.status === 'no-prompts-tracked') {
    return (
      <div className="border-border bg-muted/40 rounded-lg border p-4" role="note">
        <p className="text-sm font-semibold">{t('aiVisibilityBlock.noPromptsTitle')}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('aiVisibilityBlock.noPromptsBody')}
        </p>
        <Link
          to={`/sites/${siteId}?tab=ai-visibility`}
          className="text-primary mt-2 inline-block text-sm font-medium underline"
        >
          {t('aiVisibilityBlock.noPromptsCta')}
        </Link>
      </div>
    );
  }

  const brandPct = section.shareOfVoicePct ?? 0;
  const competitorPct = 100 - brandPct;

  return (
    <div className="border-border rounded-lg border" data-testid="report-ai-visibility-block">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-semibold">{t('aiVisibilityBlock.title')}</p>
      </div>
      <div className="space-y-4 px-4 py-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('aiVisibilityBlock.aiOverview')}</dt>
            <dd className="font-medium tabular-nums" dir="ltr">
              {section.aiOverviewCitedCount}/{section.aiOverviewTotalChecked}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t('aiVisibilityBlock.aiChats')}</dt>
            <dd className="font-medium tabular-nums" dir="ltr">
              {section.llmMentionedCount}/{section.llmTotalChecked}
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            {t('aiVisibilityBlock.shareOfVoice')}
          </p>
          <div className="flex h-3 overflow-hidden rounded-sm border bg-muted">
            <div className="bg-chart-1" style={{ width: `${brandPct}%` }} />
            <div className="bg-chart-2" style={{ width: `${competitorPct}%` }} />
          </div>
          <table className="mt-2 w-full text-sm">
            <tbody>
              <tr>
                <th className="text-muted-foreground text-start font-normal">
                  {t('aiVisibilityBlock.brand')}
                </th>
                <td className="text-end tabular-nums" dir="ltr">
                  {section.shareOfVoicePct === null
                    ? t('aiVisibilityBlock.noData')
                    : new Intl.NumberFormat(i18n.language, {
                        style: 'percent',
                        maximumFractionDigits: 0,
                      }).format(brandPct / 100)}
                </td>
              </tr>
              <tr>
                <th className="text-muted-foreground text-start font-normal">
                  {t('aiVisibilityBlock.competitors')}
                </th>
                <td className="text-end tabular-nums" dir="ltr">
                  {section.shareOfVoicePct === null
                    ? t('aiVisibilityBlock.noData')
                    : new Intl.NumberFormat(i18n.language, {
                        style: 'percent',
                        maximumFractionDigits: 0,
                      }).format(competitorPct / 100)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['positive', 'neutral', 'negative'] as const).map((key) => (
            <StatusChip key={key} tone={sentimentTone[key]}>
              {t(`aiVisibilityBlock.sentiment.${key}`)}: {section.sentiment[key]}
            </StatusChip>
          ))}
        </div>

        {section.notMentionedPrompts.length > 0 ? (
          <ul className="space-y-1">
            {section.notMentionedPrompts.map((prompt) => (
              <li key={prompt} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{prompt}</span>
                <StatusChip tone="muted">{t('aiVisibilityBlock.notMentioned')}</StatusChip>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
};
