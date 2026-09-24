import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { countryName, languageName } from '@shared/markets';
import type { AudienceResearchInput } from '../types';

interface ConfirmRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  input: AudienceResearchInput;
  maxPages: number;
  submitting: boolean;
  onConfirm: () => void;
}

/**
 * Restates market/competitors/topics and the on-demand (no continuous
 * monitoring) model before the state-changing `POST /runs` fires.
 * Confirming is the ONLY path that starts a run — the form itself
 * never auto-runs.
 */
export function ConfirmRunDialog({
  open,
  onOpenChange,
  input,
  maxPages,
  submitting,
  onConfirm,
}: ConfirmRunDialogProps) {
  const { t, i18n } = useTranslation('audienceResearch');
  const marketLine = `${countryName(input.siteMarket.country, i18n.language) ?? t('common:market.unknownCountry')} · ${languageName(input.siteMarket.language, i18n.language) ?? t('common:market.unknownLanguage')} · ${input.siteMarket.device}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="audience-research-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{t('confirm.title')}</DialogTitle>
          <DialogDescription>{t('confirm.body', { maxPages })}</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">{t('confirm.marketLine')}</dt>
            <dd data-testid="audience-research-confirm-market">{marketLine}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('confirm.competitorsLine')}</dt>
            <dd data-testid="audience-research-confirm-competitors">
              {input.competitorDomains.length > 0 ? input.competitorDomains.join(', ') : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('confirm.topicsLine')}</dt>
            <dd data-testid="audience-research-confirm-topics">
              {input.seedTopics.length > 0 ? input.seedTopics.join(', ') : '—'}
            </dd>
          </div>
        </dl>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('confirm.cancelButton')}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            loading={submitting}
            loadingLabel={t('form.submitting')}
            data-testid="audience-research-confirm-submit"
          >
            {t('confirm.confirmButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
