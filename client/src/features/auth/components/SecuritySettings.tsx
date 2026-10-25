import { useTranslation } from 'react-i18next';
import { PageHeader } from '@shared/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { useCredentialAccount } from '../useCredentialAccount';
import { messageForAuthError } from '../errorMessage';
import { ActiveSessions } from './ActiveSessions';
import { ChangeEmail } from './ChangeEmail';
import { ChangePassword } from './ChangePassword';
import { DeleteAccount } from './DeleteAccount';
import { TwoFactorSettings } from './TwoFactorSettings';
import { SetPassword } from './SetPassword';

/**
 * `/settings/security` — home for account credential controls. Hosts
 * password change, email change (with re-verification via Better Auth),
 * two-factor (TOTP + backup codes) enrolment, active-session management, and
 * the danger-zone account deletion.
 *
 * `embedded` drops the page header and padding when a host (the Account tabs)
 * already renders its own header, so two full headers never nest.
 */
export const SecuritySettings = ({ embedded = false }: { embedded?: boolean }) => {
  const { t } = useTranslation(['auth', 'errors']);
  const { state, retry, email } = useCredentialAccount();
  return (
    <div
      className={
        embedded
          ? 'flex w-full flex-col gap-6'
          : 'mx-auto flex w-full max-w-2xl flex-col gap-6 py-6'
      }
    >
      {embedded ? null : (
        <PageHeader
          icon={APP_PAGE_ICONS.security}
          title={t('security.title')}
          description={t('security.description')}
        />
      )}
      {state.status === 'ready' ? (
        state.hasPassword ? <ChangePassword /> : email ? <SetPassword key={email} email={email} /> : null
      ) : <Card>
        <CardHeader><CardTitle className="text-xl">{t('change.title')}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.status === 'loading' ? <p role="status">{t('setupPassword.loading')}</p> : <>
            <p role="alert">{messageForAuthError(state.error, t)}</p>
            <Button type="button" onClick={retry}>{t('security.sessions.retry')}</Button>
          </>}
        </CardContent>
      </Card>}
      <ChangeEmail />
      {state.status === 'ready' ? <TwoFactorSettings hasPassword={state.hasPassword} /> : null}
      <ActiveSessions hasPassword={state.status === 'ready' ? state.hasPassword : true} />
      <DeleteAccount />
    </div>
  );
};
