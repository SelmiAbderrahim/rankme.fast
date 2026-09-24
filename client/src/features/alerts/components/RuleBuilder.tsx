import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Checkbox } from '@shared/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import type { CreateRuleInput } from '../api';
import {
  ALERT_RULE_TYPES,
  ALERT_THRESHOLD_MAX,
  ALERT_THRESHOLD_MIN,
  DEFAULT_ALERT_THRESHOLD,
  type AlertRuleType,
  type AlertSite,
} from '../types';

interface RuleBuilderProps {
  sites: AlertSite[];
  siteId: string | null;
  /** Authenticated recipient for the "Email me" channel. */
  currentUserId: string | null;
  /** Pro+ gates the Slack and generic-webhook channels. */
  paidChannelsLocked: boolean;
  /** True once the account is at its `alertRules` ceiling. */
  capReached: boolean;
  submitting: boolean;
  onSubmit: (input: CreateRuleInput) => void;
}

/**
 * Rule builder. Every refusal it can anticipate is expressed as a DISABLED
 * control with a visible reason — the server still re-checks each one, so the
 * disabled state is an affordance, never the enforcement.
 */
export const RuleBuilder = ({
  sites,
  siteId,
  currentUserId,
  paidChannelsLocked,
  capReached,
  submitting,
  onSubmit,
}: RuleBuilderProps) => {
  const { t } = useTranslation('alerts');
  const [type, setType] = useState<AlertRuleType>('rank_drop');
  const [selectedSite, setSelectedSite] = useState(siteId ?? '');
  const [threshold, setThreshold] = useState(String(DEFAULT_ALERT_THRESHOLD));
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [slackUrl, setSlackUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');

  const site = selectedSite || siteId || '';
  const emailRecipient = emailEnabled ? currentUserId : null;
  const noChannel = emailRecipient === null && slackUrl === '' && webhookUrl === '';
  const disabled = capReached || submitting || site === '' || noChannel;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    onSubmit({
      siteId: site,
      type,
      ...(type === 'rank_drop' ? { threshold: Number(threshold) } : {}),
      ...(emailRecipient !== null ? { emailRecipientIds: [emailRecipient] } : {}),
      ...(slackUrl ? { slackWebhookUrl: slackUrl } : {}),
      ...(webhookUrl ? { webhookUrl } : {}),
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit}
      data-testid="alerts-rule-builder"
      aria-label={t('builder.title')}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="alerts-site">{t('builder.site')}</Label>
        <Select value={site} onValueChange={setSelectedSite}>
          <SelectTrigger id="alerts-site">
            <SelectValue placeholder={t('builder.sitePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {sites.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="alerts-type">{t('builder.type')}</Label>
        <Select value={type} onValueChange={(next) => setType(next as AlertRuleType)}>
          <SelectTrigger id="alerts-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALERT_RULE_TYPES.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`type.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {type === 'rank_drop' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="alerts-threshold">{t('builder.threshold')}</Label>
          <Input
            id="alerts-threshold"
            type="number"
            inputMode="numeric"
            min={ALERT_THRESHOLD_MIN}
            max={ALERT_THRESHOLD_MAX}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">{t('builder.thresholdHint')}</p>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">{t('builder.channels')}</legend>

        <div className="flex items-center gap-2">
          <Checkbox
            id="alerts-channel-email"
            checked={emailEnabled}
            onCheckedChange={(next) => setEmailEnabled(next === true)}
          />
          <Label htmlFor="alerts-channel-email">{t('channel.email')}</Label>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="alerts-channel-slack">{t('channel.slack')}</Label>
          <Input
            id="alerts-channel-slack"
            type="url"
            value={slackUrl}
            disabled={paidChannelsLocked}
            placeholder={t('builder.slackPlaceholder')}
            onChange={(event) => setSlackUrl(event.target.value)}
          />
          {paidChannelsLocked ? (
            <p className="text-sm text-muted-foreground" data-testid="alerts-slack-locked">
              {t('builder.paidChannelLocked')}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="alerts-channel-webhook">{t('channel.webhook')}</Label>
          <Input
            id="alerts-channel-webhook"
            type="url"
            value={webhookUrl}
            disabled={paidChannelsLocked}
            placeholder={t('builder.webhookPlaceholder')}
            onChange={(event) => setWebhookUrl(event.target.value)}
          />
          {paidChannelsLocked ? (
            <p className="text-sm text-muted-foreground" data-testid="alerts-webhook-locked">
              {t('builder.paidChannelLocked')}
            </p>
          ) : null}
        </div>

        {noChannel ? (
          <p className="text-sm text-destructive" data-testid="alerts-no-channel">
            {t('builder.noChannel')}
          </p>
        ) : null}
      </fieldset>

      <div>
        <Button type="submit" disabled={disabled} loading={submitting}>
          {t('builder.submit')}
        </Button>
      </div>
    </form>
  );
};
