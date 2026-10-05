import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageHeader } from '@shared/components/PageHeader';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { Button } from '@shared/ui/button';

/** Page title for keyword research, shared by the standalone workspace and the site-embedded panel. */
export const KeywordResearchHeader = () => {
  const { t } = useTranslation();
  return (
    <PageHeader
      icon={APP_PAGE_ICONS.keywordResearch}
      title={t('keywordResearch:panelTitle')}
      description={t('keywordResearch:panelDescription')}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="outline" asChild>
            <Link to="/keyword-research/history" data-testid="keyword-research-history-link">
              <History className="me-1 h-4 w-4" aria-hidden="true" />
              {t('keywordResearch:historyLink')}
            </Link>
          </Button>
        </div>
      }
    />
  );
};
