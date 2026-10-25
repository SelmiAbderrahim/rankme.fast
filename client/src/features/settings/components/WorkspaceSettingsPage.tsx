import { useTranslation } from 'react-i18next';
import { PageHeader } from '@shared/components/PageHeader';
import { DocsLink } from '@shared/docs/DocsLink';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { BrandingPanel } from './BrandingPanel';

/** Workspace-owned report branding has one settings home. */
export const WorkspaceSettingsPage = () => {
  const { t } = useTranslation(['settings', 'common']);
  return <div className="flex w-full flex-col gap-6 px-4 py-8" data-testid="workspace-settings-page">
    <PageHeader icon={APP_PAGE_ICONS.workspace} title={t('common:nav.workspace')}
      description={t('settings:workspace.description')}
      actions={<DocsLink slug="client-reports" />} />
    <BrandingPanel />
  </div>;
};
