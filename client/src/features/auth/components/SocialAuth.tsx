import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Button } from '@shared/ui/button';
import { appHref } from '@shared/navigation/appHref';
import { authClient } from '../authClient';
import { authSuccessHref } from '../intent';

/** Google brand mark — lucide ships no brand icons; monochrome per design system. */
const GoogleMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
  </svg>
);

/** "OR CONTINUE WITH" separator from the design-system auth-card anatomy. */
export const AuthDivider = () => {
  const { t } = useTranslation('auth');
  return (
    <div className="relative" role="separator" aria-label={t('divider')}>
      <div className="absolute inset-0 flex items-center">
        <span className="border-border w-full border-t" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-card text-muted-foreground px-2">{t('divider')}</span>
      </div>
    </div>
  );
};

/**
 * Google OAuth entry — provider `outline` button per the design system. On
 * success Better Auth redirects the whole window to Google, so the pending
 * state only ever resolves on failure.
 */
export const GoogleSignIn = () => {
  const { t } = useTranslation('auth');
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const onGoogle = async () => {
    setPending(true);
    setFailed(false);
    const { error } = await authClient.signIn.social({
      provider: 'google',
      callbackURL: appHref(authSuccessHref(location.search)),
    });
    if (error) {
      setFailed(true);
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => void onGoogle()}
        disabled={pending}
      >
        <GoogleMark />
        {t('google.cta')}
      </Button>
      {failed ? (
        <p role="alert" className="text-destructive text-sm">
          {t('google.error')}
        </p>
      ) : null}
    </div>
  );
};
