import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, ListPlus, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ReportExportControl } from '@features/report-export';
import { RefreshButton } from '@shared/components/RefreshButton';
import { Alert, AlertDescription } from '@shared/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { Button } from '@shared/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { DEFAULT_LOCALE, isSupportedLocale } from '@shared/i18n';
import { MAX_TRACKED_AI_PROMPTS } from '../constants';
import {
  addAllSuggestions,
  addPrompt,
  generateSuggestions,
  loadAiVisibility,
  loadAiVisibilityTrend,
  loadStoredSuggestions,
  runAiVisibilityCheck,
  removePrompt,
} from '../store/thunks';
import {
  selectAiVisibilityAdding,
  selectAiVisibilityAddingAll,
  selectAiVisibilityCooldownUntil,
  selectAiVisibilityError,
  selectAiVisibilityLoaded,
  selectAiVisibilityLoading,
  selectAiVisibilityOverview,
  selectAiVisibilityRefreshError,
  selectAiVisibilityRefreshing,
  selectAiVisibilityRemovingId,
  selectAiVisibilitySiteId,
  selectAiVisibilitySuggestions,
  selectAiVisibilitySuggestionsError,
  selectAiVisibilitySuggestionsLoading,
  selectAiVisibilitySuggestionsGeneratedAt,
  selectAiVisibilitySuggestionsOutputLocale,
  selectAiVisibilitySuggestionsGenerating,
  selectAiVisibilitySuggestionsCooldownUntil,
  selectAiVisibilityTrend,
  selectAiVisibilityTrendError,
  selectAiVisibilityTrendLoading,
} from '../store/selectors';
import type { AiSentiment, AiTrackedPrompt, AiVisibilitySnapshot } from '../types';
import { AiVisibilityKpis } from './AiVisibilityKpis';
import { PromptEngineDetails } from './PromptEngineDetails';
import { AiVisibilityTrendChart } from './AiVisibilityTrendChart';

interface Props {
  siteId: string;
}

const sentimentTone: Record<AiSentiment, StatusTone> = {
  positive: 'success',
  neutral: 'muted',
  negative: 'destructive',
};

export const resolveAiVisibilityOutputLocale = (resolvedLanguage: unknown) =>
  isSupportedLocale(resolvedLanguage) ? resolvedLanguage : DEFAULT_LOCALE;

export const AiVisibilityPanel = ({ siteId }: Props) => {
  const { t, i18n } = useTranslation(['aiVisibility', 'language']);
  const dispatch = useAppDispatch();
  const promptInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [pendingRemove, setPendingRemove] = useState<AiTrackedPrompt | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const overview = useAppSelector(selectAiVisibilityOverview);
  const suggestions = useAppSelector(selectAiVisibilitySuggestions);
  const loading = useAppSelector(selectAiVisibilityLoading);
  const loaded = useAppSelector(selectAiVisibilityLoaded);
  const suggestionsLoading = useAppSelector(selectAiVisibilitySuggestionsLoading);
  const error = useAppSelector(selectAiVisibilityError);
  const suggestionsError = useAppSelector(selectAiVisibilitySuggestionsError);
  const suggestionsGeneratedAt = useAppSelector(selectAiVisibilitySuggestionsGeneratedAt);
  const suggestionsOutputLocale = useAppSelector(selectAiVisibilitySuggestionsOutputLocale);
  const suggestionsGenerating = useAppSelector(selectAiVisibilitySuggestionsGenerating);
  const suggestionsCooldownUntil = useAppSelector(selectAiVisibilitySuggestionsCooldownUntil);
  const isRefreshing = useAppSelector(selectAiVisibilityRefreshing);
  const cooldownUntil = useAppSelector(selectAiVisibilityCooldownUntil);
  const refreshError = useAppSelector(selectAiVisibilityRefreshError);
  const adding = useAppSelector(selectAiVisibilityAdding);
  const addingAll = useAppSelector(selectAiVisibilityAddingAll);
  const removingId = useAppSelector(selectAiVisibilityRemovingId);
  const trend = useAppSelector(selectAiVisibilityTrend);
  const trendLoading = useAppSelector(selectAiVisibilityTrendLoading);
  const trendError = useAppSelector(selectAiVisibilityTrendError);
  const sliceSiteId = useAppSelector(selectAiVisibilitySiteId);
  const sliceSiteIdRef = useRef(sliceSiteId);
  sliceSiteIdRef.current = sliceSiteId;
  const activeOutputLocale = resolveAiVisibilityOutputLocale(i18n.resolvedLanguage);

  useEffect(() => {
    if (sliceSiteIdRef.current === siteId) return;
    const promise = dispatch(loadAiVisibility({ siteId }));
    return () => {
      promise.abort();
    };
  }, [dispatch, siteId]);

  // Split from the trend load so an abort or failure in one cannot take the
  // other down. Both still auto-load: reading the stored suggestion set is
  // free, and the set must survive a reload so a paid generation is never
  // lost to a refresh.
  useEffect(() => {
    if (!loaded) return;
    const promise = dispatch(loadStoredSuggestions({ siteId, outputLocale: activeOutputLocale }));
    return () => {
      promise.abort();
    };
  }, [activeOutputLocale, dispatch, loaded, siteId]);

  useEffect(() => {
    if (!loaded) return;
    const promise = dispatch(loadAiVisibilityTrend({ siteId }));
    return () => {
      promise.abort();
    };
  }, [dispatch, loaded, siteId]);

  useEffect(() => {
    if (refreshError) toast.error(refreshError);
  }, [refreshError]);

  const promptCount = overview?.prompts.length ?? 0;
  const capReached = promptCount >= MAX_TRACKED_AI_PROMPTS;
  const promptRows = useMemo(() => overview?.prompts ?? [], [overview]);
  const latestByPrompt = useMemo(() => {
    const map = new Map<string, NonNullable<typeof overview>['snapshots'][number]>();
    for (const row of overview?.snapshots ?? []) {
      if (!map.has(row.prompt)) map.set(row.prompt, row);
    }
    return map;
  }, [overview]);
  // Latest snapshot per (prompt, engine) — rows arrive newest first, so the
  // first row per pair wins. Feeds the expandable per-engine breakdown.
  const enginesByPrompt = useMemo(() => {
    const map = new Map<string, AiVisibilitySnapshot[]>();
    const seen = new Set<string>();
    for (const row of overview?.snapshots ?? []) {
      const key = `${row.prompt}::${row.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = map.get(row.prompt) ?? [];
      list.push(row);
      map.set(row.prompt, list);
    }
    return map;
  }, [overview]);

  const lastCheckedLabel = overview?.checkedAt
    ? t('lastChecked', {
        date: new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(overview.checkedAt)),
      })
    : t('neverChecked');

  const generatedAtLabel = suggestionsGeneratedAt
    ? t('suggestions.generatedAt', {
        date: new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(suggestionsGeneratedAt)),
      })
    : '';

  const generate = () => {
    void dispatch(generateSuggestions({ siteId, outputLocale: activeOutputLocale })).then((action) => {
      if (!generateSuggestions.fulfilled.match(action)) return;
      toast.success(t('suggestions.generated', { count: action.payload.suggestions.length }));
    });
  };

  const runCheck = () => {
    void dispatch(runAiVisibilityCheck({ siteId })).then((action) => {
      if (!runAiVisibilityCheck.fulfilled.match(action)) return;
      const result = action.payload;
      const mentioned = new Set(
        result.snapshots.filter((row) => row.mentioned).map((row) => row.prompt),
      ).size;
      toast.success(t('refresh.success', { mentioned, total: result.prompts.length }));
      void dispatch(loadAiVisibilityTrend({ siteId }));
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || capReached) return;
    void dispatch(addPrompt({ siteId, prompt: value })).then((action) => {
      if (addPrompt.fulfilled.match(action)) setPrompt('');
    });
  };

  const focusPromptInput = () => promptInputRef.current!.focus();

  const trackedLower = useMemo(
    () => new Set(promptRows.map((row) => row.prompt.toLowerCase())),
    [promptRows],
  );
  const untrackedSuggestions = useMemo(
    () => suggestions.filter((item) => !trackedLower.has(item.prompt.toLowerCase())),
    [suggestions, trackedLower],
  );

  const trackAll = () => {
    // The button is hidden when nothing is untracked and disabled at the cap,
    // so the slice is always non-empty here.
    const slots = Math.max(0, MAX_TRACKED_AI_PROMPTS - promptCount);
    const prompts = untrackedSuggestions.slice(0, slots).map((item) => item.prompt);
    void dispatch(addAllSuggestions({ siteId, prompts }));
  };

  const confirmRemove = async (promptId: string) => {
    const action = await dispatch(removePrompt({ siteId, promptId }));
    if (removePrompt.fulfilled.match(action)) setPendingRemove(null);
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-8" data-testid="ai-visibility-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ReportExportControl
            kind="ai.visibility"
            target={{ scope: 'site', siteId }}
            selection={{}}
          />
          <RefreshButton
            onRefresh={runCheck}
            isRefreshing={isRefreshing}
            cooldownUntil={cooldownUntil}
            disabled={promptCount === 0}
            labelKey="aiVisibility:refresh.button"
            cooldownKey="aiVisibility:refresh.cooldown"
            data-testid="ai-visibility-refresh"
          />
          <p className="text-muted-foreground text-xs" data-testid="ai-visibility-last-checked">
            {lastCheckedLabel}
          </p>
        </div>
      </div>

      {error ? (
        <div className="flex flex-col gap-3">
          <Alert variant="destructive" role="alert" data-testid="ai-visibility-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <div>
            <Button
              type="button"
              variant="outline"
              data-testid="ai-visibility-retry"
              onClick={() => void dispatch(loadAiVisibility({ siteId }))}
            >
              {t('common:retry')}
            </Button>
          </div>
        </div>
      ) : null}

      {loading && !loaded ? (
        <div className="flex flex-col gap-2" aria-busy="true" data-testid="ai-visibility-loading">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}

      {overview ? <AiVisibilityKpis overview={overview} /> : null}

      <form className="flex flex-col gap-2" onSubmit={submit}>
        <Label htmlFor="ai-visibility-prompt">{t('form.label')}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="ai-visibility-prompt"
            ref={promptInputRef}
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            placeholder={t('form.placeholder')}
            maxLength={280}
            disabled={capReached || adding}
          />
          <Button
            type="submit"
            loading={adding}
            loadingLabel={t('form.adding')}
            disabled={capReached || !prompt.trim()}
          >
            <Plus aria-hidden="true" />
            {t('form.add')}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {capReached
            ? t('form.capReached', { cap: MAX_TRACKED_AI_PROMPTS })
            : t('form.cap', { count: promptCount, cap: MAX_TRACKED_AI_PROMPTS })}
        </p>
      </form>

      <div className="rounded-lg border" data-testid="ai-visibility-share">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">{t('share.title')}</p>
          <p className="text-muted-foreground text-xs">{t('share.description')}</p>
        </div>
        <div className="px-4 py-3">
          <div className="flex h-3 overflow-hidden rounded-sm border bg-muted">
            <div
              className="bg-chart-1"
              style={{ width: `${overview?.shareOfVoicePct ?? 0}%` }}
              data-testid="ai-visibility-brand-bar"
            />
            <div
              className="bg-chart-2"
              style={{ width: `${100 - (overview?.shareOfVoicePct ?? 0)}%` }}
              data-testid="ai-visibility-competitor-bar"
            />
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('share.brand')}</dt>
              <dd className="font-medium tabular-nums" dir="ltr">
                {overview?.shareOfVoicePct === null || overview?.shareOfVoicePct === undefined
                  ? t('share.noData')
                  : new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(
                      overview.shareOfVoicePct / 100,
                    )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('share.competitors')}</dt>
              <dd className="font-medium tabular-nums" dir="ltr">
                {overview?.shareOfVoicePct === null || overview?.shareOfVoicePct === undefined
                  ? t('share.noData')
                  : new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(
                      (100 - overview.shareOfVoicePct) / 100,
                    )}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="rounded-lg border" data-testid="ai-visibility-trend-card">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">{t('trend.title')}</p>
          <p className="text-muted-foreground text-xs">{t('trend.description')}</p>
        </div>
        <div className="px-4 py-3">
          {trendLoading ? (
            <div aria-busy="true" data-testid="ai-visibility-trend-loading">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : trendError ? (
            <Alert variant="destructive" role="alert" data-testid="ai-visibility-trend-error">
              <AlertDescription>{trendError}</AlertDescription>
            </Alert>
          ) : (
            <AiVisibilityTrendChart points={trend} />
          )}
        </div>
      </div>

      {overview && overview.notMentionedPrompts.length > 0 ? (
        <div className="rounded-lg border" data-testid="ai-visibility-not-mentioned">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-semibold">{t('notMentioned.title')}</p>
            <p className="text-muted-foreground text-xs">{t('notMentioned.body')}</p>
          </div>
          <ul className="flex flex-col gap-1 px-4 py-3 text-sm">
            {overview.notMentionedPrompts.map((row) => (
              <li key={row} className="text-muted-foreground">
                {row}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border" data-testid="ai-visibility-prompts">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">{t('prompts.title')}</p>
        </div>
        {promptRows.length === 0 ? (
          <div className="px-4 py-3">
            <Empty data-testid="ai-visibility-prompts-empty">
              <EmptyHeader>
                <EmptyTitle>{t('prompts.emptyTitle')}</EmptyTitle>
                <EmptyDescription>
                  {untrackedSuggestions.length > 0
                    ? t('onboarding.suggestionsReady')
                    : t('prompts.empty')}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {untrackedSuggestions.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    loading={addingAll}
                    loadingLabel={t('suggestions.trackingAll')}
                    data-testid="ai-visibility-onboarding-track-all"
                    onClick={trackAll}
                  >
                    <ListPlus aria-hidden="true" />
                    {t('onboarding.trackSuggestions')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="ai-visibility-prompts-empty-cta"
                    onClick={focusPromptInput}
                  >
                    {t('prompts.emptyCta')}
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>{t('prompts.prompt')}</TableHead>
                <TableHead>{t('prompts.status')}</TableHead>
                <TableHead>
                  <TableHeaderHelp
                    label={t('prompts.sentiment')}
                    description={t('common:tableHelp.sentiment')}
                  />
                </TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {promptRows.map((row) => {
                const latest = latestByPrompt.get(row.prompt);
                const engines = enginesByPrompt.get(row.prompt) ?? [];
                const expanded = expandedPrompt === row.prompt;
                return (
                  <Fragment key={row.id}>
                    <TableRow>
                      <TableCell>
                        {engines.length > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-expanded={expanded}
                            aria-label={expanded ? t('details.hide') : t('details.show')}
                            data-testid={`ai-visibility-expand-${row.id}`}
                            onClick={() => setExpandedPrompt(expanded ? null : row.prompt)}
                          >
                            {expanded ? (
                              <ChevronDown aria-hidden="true" />
                            ) : (
                              <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
                            )}
                          </Button>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-normal">{row.prompt}</TableCell>
                      <TableCell>
                        <StatusChip tone={latest?.mentioned ? 'success' : 'muted'}>
                          {latest?.mentioned ? t('prompts.mentioned') : t('prompts.notMentioned')}
                        </StatusChip>
                      </TableCell>
                      <TableCell>
                        {latest?.sentiment ? (
                          <StatusChip tone={sentimentTone[latest.sentiment]}>
                            {t(`sentiment.${latest.sentiment}`)}
                          </StatusChip>
                        ) : (
                          <StatusChip tone="muted">{t('sentiment.unknown')}</StatusChip>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setPendingRemove(row)}
                          aria-label={t('prompts.remove')}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expanded && engines.length > 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={5} className="bg-muted/50 px-6 py-3">
                          <PromptEngineDetails snapshots={engines} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="rounded-lg border" data-testid="ai-visibility-suggestions">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t('suggestions.title')}</p>
            <p className="text-muted-foreground text-xs">
              {[
                generatedAtLabel,
                suggestionsOutputLocale
                  ? t('suggestions.outputLocale', {
                      locale: t(`language:names.${suggestionsOutputLocale}`),
                    })
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton
              onRefresh={generate}
              isRefreshing={suggestionsGenerating}
              cooldownUntil={suggestionsCooldownUntil}
              labelKey="aiVisibility:suggestions.generate"
              cooldownKey="aiVisibility:suggestions.cooldown"
              data-testid="ai-visibility-generate-suggestions"
            />
            {untrackedSuggestions.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={addingAll}
                loadingLabel={t('suggestions.trackingAll')}
                disabled={capReached}
                data-testid="ai-visibility-track-all"
                onClick={trackAll}
              >
                <ListPlus aria-hidden="true" />
                {t('suggestions.trackAll')}
              </Button>
            ) : null}
          </div>
        </div>
        {suggestionsLoading ? (
          <div className="px-4 py-3" aria-busy="true">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : suggestionsError ? (
          <Alert variant="destructive" role="alert" className="m-4">
            <AlertDescription>{suggestionsError}</AlertDescription>
          </Alert>
        ) : suggestions.length === 0 ? (
          <div className="px-4 py-3">
            {/* Two distinct empties: never generated (the button is the next
                step) vs generated but nothing came back (the seeds are the
                problem). `generatedAt === null` is the discriminator. */}
            <Empty data-testid="ai-visibility-suggestions-empty">
              <EmptyHeader>
                <EmptyTitle>{t('suggestions.emptyTitle')}</EmptyTitle>
                <EmptyDescription>
                  {suggestionsGeneratedAt === null
                    ? t('onboarding.needKeywords')
                    : t('suggestions.emptyGenerated')}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
                  variant="outline"
                  data-testid="ai-visibility-suggestions-empty-cta"
                  onClick={focusPromptInput}
                >
                  {t('suggestions.emptyCta')}
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : (
          <div className="divide-y">
            {suggestions.map((item) => (
              <div key={item.prompt} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {item.prompt}
                    {item.source === 'ai' ? (
                      <StatusChip tone="info" className="ms-2">
                        {t('suggestions.aiGenerated')}
                      </StatusChip>
                    ) : null}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={capReached || adding || addingAll}
                  onClick={() => void dispatch(addPrompt({ siteId, prompt: item.prompt }))}
                >
                  {t('suggestions.track')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingRemove ? (
        <AlertDialog open onOpenChange={() => setPendingRemove(null)}>
          <AlertDialogContent data-testid="ai-visibility-remove-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('prompts.confirmRemove.title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('prompts.confirmRemove.body')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('prompts.confirmRemove.cancel')}</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                loading={removingId === pendingRemove.id}
                data-testid="ai-visibility-confirm-remove"
                onClick={() => void confirmRemove(pendingRemove.id)}
              >
                {t('prompts.confirmRemove.confirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
};
