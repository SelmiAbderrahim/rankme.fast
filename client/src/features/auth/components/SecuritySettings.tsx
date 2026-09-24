import { useTranslation } from 'react-i18next';
import { PageHeader } from '@shared/components/PageHeader';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { ActiveSessions } from './ActiveSessions';
import { ChangeEmail } from './ChangeEmail';
import { ChangePassword } from './ChangePassword';
import { DeleteAccount } from './DeleteAccount';
import { TwoFactorSettings } from './TwoFactorSettings';

/**
 * `/settings/security` — home for account credential controls. Hosts
 * password change, email change (with re-verification via Better Auth),
 * two-factor (TOTP + backup codes) enrolment, active-session management, and
 * the danger-zone account deletion.
 */
export const SecuritySettings = () => {
  const { t } = useTranslation('auth');
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6">
      <PageHeader
        icon={APP_PAGE_ICONS.security}
        title={t('security.title')}
        description={t('security.description')}
      />
      <ChangePassword />
      <ChangeEmail />
      <TwoFactorSettings />
      <ActiveSessions />
      <DeleteAccount />
    </div>
  );
};
