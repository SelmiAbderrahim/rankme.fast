import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Badge } from '@shared/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { CountryCombobox, languageName, useMarketCatalog } from '@shared/markets';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  loadCompetitors,
  selectCompetitorsList,
  competitorsReducer,
} from '@features/competitors';
import { rootReducer } from '@app/store';
import {
  clearStartStatus,
  setFormCompetitors,
  setFormTopics,
  updateFormMarket,
} from '../store/slice';
import { startRun } from '../store/thunks';
import { selectForm, selectStartStatus } from '../store/selectors';
import type { AudienceResearchInput } from '../types';
import { ConfirmRunDialog } from './ConfirmRunDialog';

const MAX_COMPETITORS = 5;
const MAX_TOPICS = 10;
const TOPIC_MIN = 2;
const TOPIC_MAX = 160;
/** Public pages one run may crawl — mirrors the server's collect ceiling. */
const MAX_COLLECT_PAGES = 20;

const DEVICES = ['desktop', 'mobile', 'all'] as const;

// Injected once — mirrors the lazy-panel `rootReducer.inject` pattern used
// by `SiteWorkspacePage` so the competitors picker works even when the user
// has never opened the (Agency-gated) Competitors tab directly.
let competitorsInjected = false;
function ensureCompetitorsReducerInjected(): void {
  if (competitorsInjected) return;
  rootReducer.inject({ reducerPath: 'competitors', reducer: competitorsReducer });
  competitorsInjected = true;
}

interface NewRunFormProps {
  siteId: string;
}

export function NewRunForm({ siteId }: NewRunFormProps) {
  const { t, i18n } = useTranslation('audienceResearch');
  const dispatch = useAppDispatch();
  const form = useAppSelector(selectForm);
  const startStatus = useAppSelector(selectStartStatus);
  const competitorsList = useAppSelector(selectCompetitorsList);
  const marketCatalog = useMarketCatalog('seo');
  const selectedMarket = marketCatalog.markets.find(
    (market) => market.countryCode === form.market.country,
  ) ?? null;

  const [topicDraft, setTopicDraft] = useState('');
  const [topicValidationKey, setTopicValidationKey] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const countryId = useId();
  const languageId = useId();
  const deviceId = useId();
  const topicInputId = useId();

  useEffect(() => {
    ensureCompetitorsReducerInjected();
    void dispatch(loadCompetitors({ siteId }));
  }, [dispatch, siteId]);

  useEffect(() => {
    if (marketCatalog.loading || marketCatalog.error || marketCatalog.markets.length === 0) return;
    const market = selectedMarket
      ?? marketCatalog.markets.find((candidate) => candidate.countryCode === 'US')
      ?? marketCatalog.markets[0]!;
    const language = market.languageCodes.includes(form.market.language)
      ? form.market.language
      : market.languageCodes.includes('en') ? 'en' : market.languageCodes[0] ?? 'en';
    if (market.countryCode !== form.market.country || language !== form.market.language) {
      dispatch(updateFormMarket({ country: market.countryCode, language }));
    }
  }, [dispatch, form.market.country, form.market.language, marketCatalog.error, marketCatalog.loading, marketCatalog.markets, selectedMarket]);

  const input: AudienceResearchInput = useMemo(
    () => ({
      siteMarket: form.market,
      competitorDomains: form.competitors,
      seedTopics: form.topics,
    }),
    [form.market, form.competitors, form.topics],
  );

  const onMarketChange = useCallback(
    (patch: Partial<AudienceResearchInput['siteMarket']>) => {
      dispatch(updateFormMarket(patch));
    },
    [dispatch],
  );

  const availableCompetitors = useMemo(
    () => competitorsList?.competitors.map((c) => c.domain) ?? [],
    [competitorsList],
  );

  // No `>= MAX_COMPETITORS` guard for the "select" path — every unselected
  // competitor button is already disabled once the cap is reached (below),
  // so this callback only ever adds a domain when there is room for it.
  const toggleCompetitor = useCallback(
    (domain: string) => {
      const isSelected = form.competitors.includes(domain);
      if (isSelected) {
        dispatch(setFormCompetitors(form.competitors.filter((d) => d !== domain)));
        return;
      }
      dispatch(setFormCompetitors([...form.competitors, domain]));
    },
    [dispatch, form.competitors],
  );

  const addTopic = useCallback(() => {
    const value = topicDraft.trim();
    if (!value) return;
    if (value.length < TOPIC_MIN) {
      setTopicValidationKey('form.topics.validationLength');
      return;
    }
    if (value.length > TOPIC_MAX) {
      setTopicValidationKey('form.topics.validationLength');
      return;
    }
    if (form.topics.length >= MAX_TOPICS) {
      setTopicValidationKey('form.topics.validationMax');
      return;
    }
    setTopicValidationKey(null);
    dispatch(setFormTopics([...form.topics, value]));
    setTopicDraft('');
  }, [dispatch, form.topics, topicDraft]);

  const removeTopicAt = useCallback(
    (index: number) => {
      dispatch(setFormTopics(form.topics.filter((_, i) => i !== index)));
    },
    [dispatch, form.topics],
  );

  const onTopicKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTopic();
        return;
      }
      if (e.key === 'Backspace' && topicDraft.length === 0 && form.topics.length > 0) {
        removeTopicAt(form.topics.length - 1);
      }
    },
    [addTopic, form.topics.length, removeTopicAt, topicDraft.length],
  );

  const openConfirm = useCallback(() => {
    setConfirmOpen(true);
  }, []);

  const onConfirmRun = useCallback(() => {
    void dispatch(startRun({ siteId, input })).then((result) => {
      if (startRun.fulfilled.match(result)) {
        setConfirmOpen(false);
      }
    });
  }, [dispatch, input, siteId]);

  const onDismissStartError = useCallback(() => {
    dispatch(clearStartStatus());
  }, [dispatch]);

  const canStart = !startStatus.loading && Boolean(selectedMarket) && !marketCatalog.error;

  return (
    <Card data-testid="audience-research-new-run-form">
      <CardHeader>
        <CardTitle>{t('nav.label')}</CardTitle>
        <CardDescription>{t('nav.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div>
          <p className="mb-2 text-sm font-medium">{t('form.market.label')}</p>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={countryId}>{t('form.market.country')}</Label>
              <CountryCombobox
                id={countryId}
                value={form.market.country}
                markets={marketCatalog.markets}
                loading={marketCatalog.loading}
                disabled={marketCatalog.error}
                testId="audience-research-form-country"
                onValueChange={(country, market) => {
                  // allowAll is false, so the combobox only emits catalog entries here.
                  const selectedCountry = country!;
                  const selected = market!;
                  const language = selected.languageCodes.includes(form.market.language)
                    ? form.market.language
                    : selected.languageCodes.includes('en') ? 'en' : selected.languageCodes[0] ?? 'en';
                  onMarketChange({ country: selectedCountry, language });
                }}
              />
              {marketCatalog.error ? <p className="text-destructive text-xs">{t('common:market.loadError')}</p> : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={languageId}>{t('form.market.language')}</Label>
              <Select
                value={form.market.language}
                onValueChange={(v) => onMarketChange({ language: v })}
              >
                <SelectTrigger id={languageId} data-testid="audience-research-form-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(selectedMarket?.languageCodes ?? []).map((l) => (
                    <SelectItem key={l} value={l}>
                      {languageName(l, i18n.language) ?? l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={deviceId}>{t('form.market.device')}</Label>
              <Select
                value={form.market.device}
                onValueChange={(v) => onMarketChange({ device: v as typeof DEVICES[number] })}
              >
                <SelectTrigger id={deviceId} data-testid="audience-research-form-device">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEVICES.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium">
            {t('form.competitors.label')} ({form.competitors.length}/{MAX_COMPETITORS})
          </p>
          <p className="text-muted-foreground mb-2 text-xs">{t('form.competitors.helper')}</p>
          {availableCompetitors.length === 0 ? (
            <p className="text-muted-foreground text-xs" data-testid="audience-research-form-no-competitors">
              —
            </p>
          ) : (
            <div className="flex flex-wrap gap-2" data-testid="audience-research-form-competitors">
              {availableCompetitors.map((domain) => {
                const selected = form.competitors.includes(domain);
                const disabled = !selected && form.competitors.length >= MAX_COMPETITORS;
                return (
                  <button
                    key={domain}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleCompetitor(domain)}
                    data-testid={`audience-research-competitor-${domain}`}
                    data-selected={selected ? 'true' : undefined}
                  >
                    <Badge variant={selected ? 'default' : 'outline'}>{domain}</Badge>
                  </button>
                );
              })}
            </div>
          )}
          {form.competitors.length >= MAX_COMPETITORS ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {t('form.competitors.limit', { max: MAX_COMPETITORS })}
            </p>
          ) : null}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label htmlFor={topicInputId}>{t('form.topics.label')}</Label>
            <span
              className="text-muted-foreground text-xs"
              aria-live="polite"
              data-testid="audience-research-topics-count"
            >
              {t('form.topics.count', { count: form.topics.length, max: MAX_TOPICS })}
            </span>
          </div>
          <div className="mb-2 flex flex-wrap gap-2" data-testid="audience-research-topics-chips">
            {form.topics.map((topic, index) => (
              <Badge key={`${topic}-${index}`} variant="secondary" className="gap-1">
                {topic}
                <button
                  type="button"
                  onClick={() => removeTopicAt(index)}
                  aria-label={t('form.topics.chipRemove', { topic })}
                  data-testid={`audience-research-topic-remove-${index}`}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              id={topicInputId}
              value={topicDraft}
              placeholder={t('form.topics.placeholder')}
              onChange={(e) => {
                setTopicDraft(e.target.value);
                setTopicValidationKey(null);
              }}
              onKeyDown={onTopicKeyDown}
              disabled={form.topics.length >= MAX_TOPICS}
              data-testid="audience-research-topic-input"
            />
            <Button
              type="button"
              variant="outline"
              onClick={addTopic}
              disabled={form.topics.length >= MAX_TOPICS || topicDraft.trim().length === 0}
            >
              {t('form.topics.label')}
            </Button>
          </div>
          {topicValidationKey ? (
            <p className="text-destructive mt-1 text-xs" role="alert" data-testid="audience-research-topic-validation">
              {t(topicValidationKey, { max: MAX_TOPICS })}
            </p>
          ) : null}
        </div>

        {startStatus.error ? (
          <Alert variant="destructive" data-testid="audience-research-start-error">
            <AlertTitle>{t('errors.generic')}</AlertTitle>
            <AlertDescription>{startStatus.error}</AlertDescription>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={onDismissStartError}>
                {t('confirm.cancelButton')}
              </Button>
            </div>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={openConfirm}
            disabled={!canStart}
            data-testid="audience-research-start-button"
          >
            {t('confirm.confirmButton')}
          </Button>
        </div>
      </CardContent>

      <ConfirmRunDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        input={input}
        maxPages={MAX_COLLECT_PAGES}
        submitting={startStatus.loading}
        onConfirm={onConfirmRun}
      />
    </Card>
  );
}
