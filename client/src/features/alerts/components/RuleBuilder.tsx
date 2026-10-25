import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { SiteOptionLabel } from '@shared/components/SiteOptionLabel';
import { Button } from '@shared/ui/button';
import { Checkbox } from '@shared/ui/checkbox';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
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
  /** True once the account is at its rule ceiling. */
  capReached: boolean;
  submitting: boolean;
  onSubmit: (input: CreateRuleInput) => void;
}

type ChannelInput = 'slack' | 'webhook';

interface ChannelToggleProps {
  channel: ChannelInput;
  enabled: boolean;
  value: string;
  error: string | null;
  onEnabledChange: (next: boolean) => void;
  onValueChange: (next: string) => void;
  onBlur: () => void;
}

/**
 * A URL-backed channel: the same enable checkbox as Email, with its address
 * field revealed only while the channel is on.
 */
const ChannelToggle = ({
  channel,
  enabled,
  value,
  error,
  onEnabledChange,
  onValueChange,
  onBlur,
}: ChannelToggleProps) => {
  const { t } = useTranslation('alerts');
  const toggleId = `alerts-channel-${channel}`;
  const inputId = `${toggleId}-url`;
  const errorId = `${inputId}-error`;
  return (
    <div className="grid items-start gap-x-4 gap-y-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
      {/* One row per channel: the toggle sits in a fixed column and the address
          in the next, whose height is reserved even while it is empty, so
          turning Slack on never moves the Webhook row. */}
      <div className="flex min-h-9 items-center gap-2">
        <Checkbox
          id={toggleId}
          checked={enabled}
          onCheckedChange={(next) => onEnabledChange(next === true)}
        />
        <Label htmlFor={toggleId}>{t(`channel.${channel}`)}</Label>
      </div>
      <div className="flex min-h-9 min-w-0 flex-col gap-2" data-testid={`alerts-${channel}-field`}>
        {enabled ? (
          <>
            <Label htmlFor={inputId} className="sr-only">
              {t(`builder.${channel}Placeholder`)}
            </Label>
            <Input
              id={inputId}
              type="url"
              dir="ltr"
              value={value}
              placeholder={t(`builder.${channel}Placeholder`)}
              aria-invalid={error !== null}
              aria-describedby={error !== null ? errorId : undefined}
              onChange={(event) => onValueChange(event.target.value)}
              onBlur={onBlur}
            />
            {error !== null ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Rule builder. The submit button stays available: a missing site, channel or
 * channel address is reported inline, next to the field, when the user tries
 * to save — never as an unexplained disabled button. A channel address that is
 * still empty is reported when its field loses focus, not the moment the
 * channel is ticked. The server re-checks every rule; the checks here are an
 * affordance.
 */
export const RuleBuilder = ({
  sites,
  siteId,
  currentUserId,
  capReached,
  submitting,
  onSubmit,
}: RuleBuilderProps) => {
  const { t } = useTranslation('alerts');
  const [type, setType] = useState<AlertRuleType>('rank_drop');
  const [selectedSite, setSelectedSite] = useState(siteId ?? '');
  const [threshold, setThreshold] = useState(String(DEFAULT_ALERT_THRESHOLD));
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackUrl, setSlackUrl] = useState('');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  // Errors appear after the first save attempt, then track the form live.
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<ChannelInput, boolean>>({
    slack: false,
    webhook: false,
  });
  const touch = (channel: ChannelInput) =>
    setTouched((current) => (current[channel] ? current : { ...current, [channel]: true }));
  const setChannelEnabled = (channel: ChannelInput, next: boolean) => {
    setTouched((current) => ({ ...current, [channel]: false }));
    if (channel === 'slack') setSlackEnabled(next);
    else setWebhookEnabled(next);
  };

  const site = selectedSite || siteId || '';
  const selectedSitePaused = sites.some((option) => option.id === site && option.paused === true);
  const emailRecipient = emailEnabled ? currentUserId : null;
  const slackAddress = slackEnabled ? slackUrl.trim() : '';
  const webhookAddress = webhookEnabled ? webhookUrl.trim() : '';

  // A rule on a paused site can never fire, so the server refuses it and the
  // form never submits one (a site page can still preselect it).
  const thresholdValid =
    /^\d+$/.test(threshold) &&
    Number(threshold) >= ALERT_THRESHOLD_MIN &&
    Number(threshold) <= ALERT_THRESHOLD_MAX;
  const errors = {
    site: site === '' ? t('builder.siteRequired') : selectedSitePaused ? t('builder.sitePausedBlocked') : null,
    threshold:
      type === 'rank_drop' && !thresholdValid
        ? t('builder.thresholdInvalid', { min: ALERT_THRESHOLD_MIN, max: ALERT_THRESHOLD_MAX })
        : null,
    slack: slackEnabled && slackAddress === '' ? t('builder.slackRequired') : null,
    webhook: webhookEnabled && webhookAddress === '' ? t('builder.webhookRequired') : null,
    channels:
      emailRecipient === null && !slackEnabled && !webhookEnabled ? t('builder.noChannel') : null,
  };
  const valid = Object.values(errors).every((error) => error === null);
  const shown = (error: string | null) => (attempted ? error : null);
  const siteError = shown(errors.site);
  const thresholdError = shown(errors.threshold);
  const channelError = shown(errors.channels);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (capReached || submitting) return;
    setAttempted(true);
    setTouched({ slack: true, webhook: true });
    if (!valid) return;
    onSubmit({
      siteId: site,
      type,
      ...(type === 'rank_drop' ? { threshold: Number(threshold) } : {}),
      ...(emailRecipient !== null ? { emailRecipientIds: [emailRecipient] } : {}),
      ...(slackAddress ? { slackWebhookUrl: slackAddress } : {}),
      ...(webhookAddress ? { webhookUrl: webhookAddress } : {}),
    });
  };

  return (
    <form
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={handleSubmit}
      noValidate
      data-testid="alerts-rule-builder"
      aria-label={t('builder.title')}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="alerts-site">{t('builder.site')}</Label>
        <Select value={site} onValueChange={setSelectedSite}>
          <SelectTrigger
            className="w-full sm:w-80"
            id="alerts-site"
            aria-invalid={siteError !== null}
            aria-describedby={siteError !== null ? 'alerts-site-error' : undefined}
          >
            <SelectValue placeholder={t('builder.sitePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {sites.map((option) => (
              <SelectItem
                key={option.id}
                value={option.id}
                disabled={option.paused === true}
                data-testid={`alerts-site-option-${option.id}`}
              >
                {option.paused === true ? (
                  <span className="flex flex-col items-start">
                    <span>
                      <SiteOptionLabel site={option} pausedLabel={t('builder.sitePaused')} />
                    </span>
                    <span className="text-xs text-muted-foreground">{t('builder.sitePausedOption')}</span>
                  </span>
                ) : (
                  <SiteOptionLabel site={option} pausedLabel={t('builder.sitePaused')} />
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedSitePaused && siteError === null ? (
          <p className="text-sm text-muted-foreground" data-testid="alerts-site-paused-hint">
            {t('builder.sitePausedBlocked')}
          </p>
        ) : null}
        {siteError !== null ? (
          <p
            id="alerts-site-error"
            role="alert"
            className="text-sm text-destructive"
            data-testid="alerts-site-required"
          >
            {siteError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="alerts-type">{t('builder.type')}</Label>
        <Select value={type} onValueChange={(next) => setType(next as AlertRuleType)}>
          <SelectTrigger
            className="w-full sm:w-80"
            id="alerts-type"
            aria-describedby={type === 'rank_drop' ? 'alerts-rank-drop-hint' : undefined}
          >
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
        {type === 'rank_drop' ? (
          <p
            id="alerts-rank-drop-hint"
            className="text-sm text-muted-foreground"
            data-testid="alerts-rank-drop-hint"
          >
            {t('builder.rankDropHint')} {t('builder.rankDropBuiltIn')}{' '}
            <Link className="text-foreground underline underline-offset-4" to="/settings/notifications">
              {t('builder.rankDropBuiltInLink')}
            </Link>
          </p>
        ) : null}
      </div>

      {type === 'rank_drop' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="alerts-threshold">{t('builder.threshold')}</Label>
          <Input
            className="w-full sm:w-80"
            id="alerts-threshold"
            type="number"
            inputMode="numeric"
            min={ALERT_THRESHOLD_MIN}
            max={ALERT_THRESHOLD_MAX}
            step={1}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            aria-invalid={thresholdError !== null}
            aria-describedby={thresholdError !== null ? 'alerts-threshold-error' : 'alerts-threshold-hint'}
          />
          {thresholdError !== null ? (
            <p id="alerts-threshold-error" role="alert" className="text-sm text-destructive">
              {thresholdError}
            </p>
          ) : null}
          <p id="alerts-threshold-hint" className="text-sm text-muted-foreground">
            {t('builder.thresholdHint')}
          </p>
        </div>
      ) : null}

      <fieldset
        className="flex flex-col gap-3"
        aria-describedby={channelError !== null ? 'alerts-no-channel' : undefined}
      >
        <legend className="mb-1 text-sm font-semibold">{t('builder.channels')}</legend>

        <div className="flex items-center gap-2">
          <Checkbox
            id="alerts-channel-email"
            checked={emailEnabled}
            onCheckedChange={(next) => setEmailEnabled(next === true)}
          />
          <Label htmlFor="alerts-channel-email">{t('channel.email')}</Label>
        </div>

        <ChannelToggle
          channel="slack"
          enabled={slackEnabled}
          value={slackUrl}
          error={touched.slack ? errors.slack : null}
          onEnabledChange={(next) => setChannelEnabled('slack', next)}
          onValueChange={setSlackUrl}
          onBlur={() => touch('slack')}
        />

        <ChannelToggle
          channel="webhook"
          enabled={webhookEnabled}
          value={webhookUrl}
          error={touched.webhook ? errors.webhook : null}
          onEnabledChange={(next) => setChannelEnabled('webhook', next)}
          onValueChange={setWebhookUrl}
          onBlur={() => touch('webhook')}
        />

        {channelError !== null ? (
          <p
            id="alerts-no-channel"
            role="alert"
            className="text-sm text-destructive"
            data-testid="alerts-no-channel"
          >
            {channelError}
          </p>
        ) : null}
      </fieldset>

      <div>
        <Button type="submit" disabled={capReached} loading={submitting}>
          {t('builder.submit')}
        </Button>
      </div>
    </form>
  );
};
