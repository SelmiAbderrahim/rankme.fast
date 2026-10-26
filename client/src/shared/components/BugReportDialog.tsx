import { useTranslation } from 'react-i18next';
import { bugReportHref, githubIssuesUrl } from '@shared/config/github';
import { buildBugReportHref } from '@shared/feedback/bugReport';
import { SAFE_EXTERNAL_REL } from '@shared/security';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shared/ui/dialog';

const triggerClass =
  'font-semibold text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Shared beta feedback entry; opening a destination remains the visitor's choice. */
export function BugReportDialog({ routePattern }: { routePattern?: string }) {
  const { t } = useTranslation('common');
  const issues = githubIssuesUrl();
  const href = issues ?? (routePattern ? buildBugReportHref({ routePattern }) : bugReportHref());

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className={triggerClass} type="button">
          {t('releaseStage.banner.reportBug')}
        </button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('feedback.reportBug')}</DialogTitle>
          <DialogDescription>{t('feedback.chooseChannel')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">{t('cancel')}</Button>
          </DialogClose>
          <Button asChild variant="outline">
            <a href={href} {...(issues ? { rel: SAFE_EXTERNAL_REL, target: '_blank' } : {})}>
              {t(issues ? 'feedback.openIssues' : 'feedback.emailSupport')}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
