import { useEffect, useState } from 'react';
import { FlaskConical, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MAINTAINER_X_URL } from '@shared/brand';
import { bugReportHref } from '@shared/config/github';
import { buildBugReportHref } from '@shared/feedback/bugReport';
import { isBeta, releaseStage } from '@shared/config/release';
import { SAFE_EXTERNAL_REL } from '@shared/security';
import { Button } from '@shared/ui/button';

const linkClass =
  'font-semibold text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export const releaseBannerStorageKey = (): string =>
  `rmf.releaseBanner.dismissed.${releaseStage()}`;

const readDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(releaseBannerStorageKey()) === '1';
  } catch {
    return false;
  }
};

const writeDismissed = (): void => {
  try {
    window.localStorage.setItem(releaseBannerStorageKey(), '1');
  } catch {
    // Storage can be blocked (private mode, policy). Dismissal then lasts
    // for this page view only, which is the honest fallback.
  }
};

const focusMain = (): void => {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
};

/**
 * Shared release-stage banner (SPEC-A8). Rendered by every layout above the
 * shared header while `VITE_RELEASE_STAGE` is `beta`. The server always
 * renders it; after hydration it hides only when the visitor dismissed it
 * for the current stage.
 */
export const ReleaseStageBanner = ({ routePattern }: { routePattern?: string }) => {
  const { t } = useTranslation('common');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (readDismissed()) setDismissed(true);
  }, []);

  if (!isBeta() || dismissed) return null;

  const reportHref = routePattern === undefined ? bugReportHref() : buildBugReportHref({ routePattern });
  const reportIsWeb = reportHref.startsWith('https:') || reportHref.startsWith('http:');

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
    focusMain();
  };

  return (
    <section
      aria-label={t('releaseStage.banner.label')}
      className="border-b border-border bg-secondary text-foreground"
      data-testid="release-stage-banner"
    >
      <div className="container mx-auto flex min-w-0 items-start gap-3 px-4 py-2 text-sm sm:items-center">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 sm:mt-0" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          <p className="min-w-0 text-start">{t('releaseStage.banner.message')}</p>
          <a
            className={linkClass}
            href={reportHref}
            {...(reportIsWeb ? { rel: SAFE_EXTERNAL_REL, target: '_blank' } : {})}
          >
            {t('releaseStage.banner.reportBug')}
          </a>
          {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL contains noopener and noreferrer. */}
          <a className={linkClass} href={MAINTAINER_X_URL} rel={SAFE_EXTERNAL_REL} target="_blank">
            {t('releaseStage.banner.followProgress')}
          </a>
        </div>
        <Button
          aria-label={t('releaseStage.banner.dismiss')}
          className="-my-1 size-8 shrink-0"
          onClick={dismiss}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
    </section>
  );
};
