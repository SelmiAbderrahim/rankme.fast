import { useTranslation } from 'react-i18next';
import { SecuritySettings } from '@features/auth';
import {
  ApiKeysPanel,
  BrandingPanel,
  McpPermissionsPanel,
  NotificationPreferences,
} from '@features/settings';
import { PageHeader } from '@shared/components/PageHeader';
import { useTabParam } from '@shared/hooks/useTabParam';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import { ACCOUNT_TABS } from '../types';
import { ProfileInfoCard } from './ProfileInfoCard';
import { ExportData } from './ExportData';
import { DeleteAccount } from './DeleteAccount';

/**
 * `/profile` — the Account hub. One tabbed page (`?tab=`) composing the profile
 * editor with the existing security, notifications, connections, and data-rights
 * surfaces. The standalone `/settings/*` routes still work; this is the single
 * place to manage everything.
 */
export const AccountPage = () => {
  const { t } = useTranslation('account');
  const [tab, setTab] = useTabParam('profile', ACCOUNT_TABS);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6">
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
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationPreferences />
        </TabsContent>
        <TabsContent value="branding">
          <BrandingPanel />
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
            <DeleteAccount />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
