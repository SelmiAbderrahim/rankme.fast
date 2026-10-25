import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiKeysPanel, McpPermissionsPanel } from '@features/settings';
import { PageHeader } from '@shared/components/PageHeader';
import { useTabParam } from '@shared/hooks/useTabParam';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { ACCOUNT_TABS, LEGACY_ACCOUNT_TAB_REDIRECTS } from '../types';
import { ProfileInfoCard } from './ProfileInfoCard';
import { ExportData } from './ExportData';
import { DeleteAccountLink } from './DeleteAccountLink';

/**
 * Personal account settings. Security, notifications, and workspace branding
 * each have one dedicated settings page; old tab links redirect there.
 */
const AccountTabs = () => {
  const { t } = useTranslation('account');
  const [tab, setTab] = useTabParam('profile', ACCOUNT_TABS);

  return (
    <div className="flex w-full flex-col gap-6 px-4 py-8"
      data-testid="account-page">
      <PageHeader
        icon={APP_PAGE_ICONS.profile}
        title={t('title')}
        description={t('description')}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          {ACCOUNT_TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="profile">
          <ProfileInfoCard />
        </TabsContent>
        <TabsContent value="mcp">
          <McpPermissionsPanel />
        </TabsContent>
        <TabsContent value="api-keys">
          <ApiKeysPanel />
        </TabsContent>
        <TabsContent value="privacy">
          <div className="flex flex-col gap-6">
            <ExportData />
            <DeleteAccountLink />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export const AccountPage = () => {
  const { search, hash } = useLocation();
  const legacyTab = new URLSearchParams(search).get('tab');
  const destination = legacyTab !== null && Object.hasOwn(LEGACY_ACCOUNT_TAB_REDIRECTS, legacyTab)
    ? LEGACY_ACCOUNT_TAB_REDIRECTS[legacyTab] : undefined;
  if (destination) return <Navigate to={{ pathname: destination, hash }} replace />;
  return <AccountTabs />;
};
