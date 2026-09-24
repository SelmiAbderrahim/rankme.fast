/**
 * Standalone surface for Live Keyword Trends.
 *
 * A dedicated `/keyword-research/live-trends` route so an account can reach
 * live search interest without navigating the workspace tabs. The route pins `?tab=live-trends` per the frozen URL
 * grammar: it never routes elsewhere, so the tab param is invariant here —
 * kept anyway so the standalone URL matches the workspace embed's shape
 * exactly.
 */
import { useTabParam } from '@shared/hooks/useTabParam';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@shared/components/PageHeader';
import { DocsLink } from '@shared/docs/DocsLink';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { LiveTrendsView } from './LiveTrendsView';

const TAB_VALUES = ['live-trends'] as const;

export const KeywordLiveTrendsPage = () => {
  const { t } = useTranslation();
  // Registers/normalizes `?tab=live-trends` on mount and rewrites unknown
  // values back to the sole valid tab (url-tab-state rule).
  useTabParam<'live-trends'>('live-trends', TAB_VALUES);
  return (
    <main
      id="keyword-live-trends-page"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6"
      data-testid="keyword-live-trends-page"
    >
      <PageHeader
        icon={APP_PAGE_ICONS.keywordLiveTrends}
        title={t('keywordResearch:liveTrends.title')}
        description={t('keywordResearch:liveTrends.description')}
        actions={<DocsLink slug="keyword-trends" />}
      />
      <LiveTrendsView />
    </main>
  );
};
