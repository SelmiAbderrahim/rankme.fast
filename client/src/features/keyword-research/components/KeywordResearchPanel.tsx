/**
 * Keyword-research panel.
 *
 * data-testid contract (Playwright):
 *   - keyword-research-panel        root
 *   - keyword-research-form         search form
 *   - keyword-research-input        seed chips input
 *   - keyword-research-submit       submit button
 *   - keyword-research-loading      loading skeleton
 *   - keyword-research-error        top-level error alert
 *   - keyword-research-table        results table
 *   - keyword-research-row-<slug>   one per keyword
 *   - keyword-research-row-menu-<slug>  per-row ⋯ actions trigger
 *   - keyword-research-copy-<slug>      copy action (inside the row menu)
 *   - keyword-research-ideas-<slug>     ideas-from-row action (inside the row menu)
 *   - keyword-research-track-<slug>     track action (inside the row menu; site-scoped only)
 *   - keyword-research-history-link     link to /keyword-research/history
 *   - keyword-research-related      related expansion panel
 *   - keyword-research-related-loading
 *   - keyword-research-empty        empty state (searched, zero results)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  History,
  Lightbulb,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  addKeyword,
  loadKeywords,
  selectKeywords,
  selectRanksError,
  selectRanksLoaded,
  selectRanksLoading,
  selectRanksSiteId,
  type Keyword,
} from '@features/ranks';
import { toast } from 'sonner';
import { PageHeader } from '@shared/components/PageHeader';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/ui/empty';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { Input } from '@shared/ui/input';
import { Skeleton } from '@shared/ui/skeleton';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import { cn } from '@shared/lib/utils';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { contentAnalysisHref } from '@shared/navigation/contentIntelligenceHref';
import { fetchIdeas, fetchIntent, fetchLongTail, loadMetrics, loadRelated } from '../store/thunks';
import {
  setExpanded,
  clearMessages,
  beginAddToTracking,
  resolveAddToTracking,
  relatedCacheKey,
} from '../store/slice';
import {
  selectAddToTrackingError,
  selectAddingToTrackingKeyword,
  selectError,
  selectExpanded,
  selectHistory,
  selectHistoryError,
  selectHistoryLoaded,
  selectHistoryLoading,
  selectIdeas,
  selectIdeasError,
  selectIdeasLoading,
  selectIdeasSeed,
  selectLoaded,
  selectLoading,
  selectLongTail,
  selectMetrics,
  selectRelatedByKeyword,
  selectRelatedError,
  selectRelatedLoading,
} from '../store/selectors';
import {
  MAX_KEYWORDS,
  MAX_PHRASE_LENGTH,
  difficultyBand,
  parsePrefillParams,
} from '../validation';
import { ResearchHistoryTable } from './ResearchHistoryTable';
import { MarketSelects } from './MarketSelects';
import type { KeywordMetric, RelatedKeyword, ResearchHistoryItem, SearchIntent } from '../types';

/** Four distinct soft-tint status tones (SPEC-A1/A2), one per intent. `null`
 * intent renders no badge — absence is honest, not a fifth "unknown" chip. */
const INTENT_TONE: Record<SearchIntent, StatusTone> = {
  informational: 'info',
  commercial: 'warning',
  transactional: 'success',
  navigational: 'primary',
};

export const IntentBadge = ({ intent }: { intent: SearchIntent | null | undefined }) => {
  const { t } = useTranslation();
  if (!intent) return null;
  return (
    <StatusChip tone={INTENT_TONE[intent]} data-testid={`keyword-research-intent-${intent}`}>
      {t(`keywordResearch:intent.${intent}`)}
    </StatusChip>
  );
};

/** One shared candidate-keyword list for related, broad-idea, and long-tail results. */
const KeywordCandidateList = ({ items, testId }: { items: RelatedKeyword[]; testId?: string }) => {
  const { t, i18n } = useTranslation();
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid={testId}>
      {items.map((r) => (
        <li
          key={r.keyword}
          className={cn('flex items-center justify-between rounded-md border px-3 py-2')}
        >
          <span className="text-sm">{r.keyword}</span>
          <span className="flex items-center gap-2">
            <span
              className="text-muted-foreground text-xs tabular-nums"
              title={t('keywordResearch:columnVolume')}
            >
              {formatVolume(r.searchVolume, t, i18n.language)}
            </span>
            <DifficultyBadge difficulty={r.difficulty} />
          </span>
        </li>
      ))}
    </ul>
  );
};

export function keywordSlug(k: string): string {
  return k.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

export function formatVolume(v: number | null, t: (k: string) => string, locale: string): string {
  if (v === null) return t('keywordResearch:unavailable');
  return new Intl.NumberFormat(locale).format(v);
}

export function formatCpc(cpc: string | null): string {
  if (cpc === null) return '—';
  const num = Number(cpc);
  /* v8 ignore next -- Number(a decimal string emitted by the server) is always finite; defence only. */
  if (!Number.isFinite(num)) return '—';
  return `$${num.toFixed(2)}`;
}

export function normalizeKeywordPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Research is device-agnostic, so tracked desktop/mobile variants collapse
 * to one phrase while the active location + language remain exact. */
export function trackedKeywordPhrases(
  keywords: Keyword[],
  locationCode: number,
  languageCode: string,
): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const keyword of keywords) {
    const phrase = keyword.phrase.trim().replace(/\s+/g, ' ');
    const key = normalizeKeywordPhrase(phrase);
    if (
      !keyword.active ||
      keyword.locationCode !== locationCode ||
      keyword.languageCode.toLowerCase() !== languageCode.toLowerCase() ||
      phrase.length > MAX_PHRASE_LENGTH ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    phrases.push(phrase);
  }
  return phrases;
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(1, max - min);
  const width = 80;
  const height = 24;
  const stepX = width / (points.length - 1);
  const pathData = points
    .map((p, i) => {
      const y = height - ((p - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg
      role="img"
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      className="text-primary inline-block h-6 w-20"
    >
      <path d={pathData} stroke="currentColor" strokeWidth="1.5" fill="none" />
      {points.map((p, i) => {
        const y = height - ((p - min) / range) * height;
        return <circle key={i} cx={i * stepX} cy={y} r="1.5" fill="currentColor" />;
      })}
    </svg>
  );
}

interface Props {
  siteId?: string | null;
}

export const KeywordResearchPanel = ({ siteId }: Props) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const metrics = useAppSelector(selectMetrics);
  const loading = useAppSelector(selectLoading);
  const loaded = useAppSelector(selectLoaded);
  const error = useAppSelector(selectError);
  const expanded = useAppSelector(selectExpanded);
  const relatedByKeyword = useAppSelector(selectRelatedByKeyword);
  const relatedLoading = useAppSelector(selectRelatedLoading);
  const relatedError = useAppSelector(selectRelatedError);
  const addToTrackingError = useAppSelector(selectAddToTrackingError);
  const addingToTracking = useAppSelector(selectAddingToTrackingKeyword);
  const ideas = useAppSelector(selectIdeas);
  const ideasLoading = useAppSelector(selectIdeasLoading);
  const ideasError = useAppSelector(selectIdeasError);
  const ideasSeed = useAppSelector(selectIdeasSeed);
  const longTail = useAppSelector(selectLongTail);
  const history = useAppSelector(selectHistory);
  const historyLoading = useAppSelector(selectHistoryLoading);
  const historyLoaded = useAppSelector(selectHistoryLoaded);
  const historyError = useAppSelector(selectHistoryError);
  const trackedKeywords = useAppSelector(selectKeywords);
  const trackedSiteId = useAppSelector(selectRanksSiteId);
  const trackedLoading = useAppSelector(selectRanksLoading);
  const trackedLoaded = useAppSelector(selectRanksLoaded);
  const trackedError = useAppSelector(selectRanksError);

  // "Search again" deep link (?q=a,b,c&location=&lang=) prefills the form ONCE
  // via lazy initializers — it never auto-submits and never spends quota.
  const [searchParams] = useSearchParams();
  const [chips, setChips] = useState<string[]>(() => parsePrefillParams(searchParams).chips);
  const [draft, setDraft] = useState('');
  const [locationCode, setLocationCode] = useState<number>(
    () => parsePrefillParams(searchParams).locationCode,
  );
  const [languageCode, setLanguageCode] = useState<string>(
    () => parsePrefillParams(searchParams).languageCode,
  );
  const matchingTrackedKeywords = useMemo(
    () =>
      siteId && trackedSiteId === siteId
        ? trackedKeywordPhrases(trackedKeywords, locationCode, languageCode)
        : [],
    [languageCode, locationCode, siteId, trackedKeywords, trackedSiteId],
  );
  const selectedKeywordKeys = useMemo(() => new Set(chips.map(normalizeKeywordPhrase)), [chips]);
  const trackedSuggestions = useMemo(
    () =>
      matchingTrackedKeywords.filter(
        (phrase) => !selectedKeywordKeys.has(normalizeKeywordPhrase(phrase)),
      ),
    [matchingTrackedKeywords, selectedKeywordKeys],
  );
  const remainingKeywordSlots = Math.max(0, MAX_KEYWORDS - chips.length);
  // Empty-state CTA focuses the seed input so the next lookup is one keypress away.
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      dispatch(clearMessages());
    };
  }, [dispatch]);

  const commitChip = () => {
    const v = draft.trim().replace(/\s+/g, ' ');
    if (v.length === 0) return;
    if (chips.some((chip) => normalizeKeywordPhrase(chip) === normalizeKeywordPhrase(v))) {
      setDraft('');
      return;
    }
    /* v8 ignore next -- MAX_KEYWORDS is 50; typing 50 chips per test is not cost-effective. */
    if (chips.length >= MAX_KEYWORDS) return;
    setChips([...chips, v]);
    setDraft('');
  };

  const removeChip = (idx: number) => {
    setChips(chips.filter((_, i) => i !== idx));
  };

  const addTrackedKeyword = (phrase: string) => {
    setChips((current) => {
      // Suggestion buttons are hidden when full or already selected; this keeps
      // rapid/stale events idempotent as a final defensive check.
      /* v8 ignore start */
      if (
        current.length >= MAX_KEYWORDS ||
        current.some((chip) => normalizeKeywordPhrase(chip) === normalizeKeywordPhrase(phrase))
      ) {
        return current;
      }
      /* v8 ignore stop */
      return [...current, phrase];
    });
  };

  const addAllTrackedKeywords = () => {
    setChips((current) => {
      const slots = Math.max(0, MAX_KEYWORDS - current.length);
      const selected = new Set(current.map(normalizeKeywordPhrase));
      const additions = matchingTrackedKeywords
        .filter((phrase) => !selected.has(normalizeKeywordPhrase(phrase)))
        .slice(0, slots);
      return [...current, ...additions];
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    /* v8 ignore next -- submit button is disabled when chips.length === 0; belt-and-braces guard. */
    if (chips.length === 0) return;
    void dispatch(loadMetrics({ keywords: chips, locationCode, languageCode }));
    // Classify intent for the same set — badges merge onto the rows as they
    // resolve. Rides the same `keyword_lookups` metering as /metrics.
    void dispatch(fetchIntent({ keywords: chips, locationCode, languageCode }));
  };

  // "Search again" on a Recent-research row re-runs the lookup IN PLACE (unlike
  // the standalone history page, which navigates). Prefills the form to match
  // and rides the same metering as a manual submit — a user-initiated spend.
  const handleSearchAgain = (item: ResearchHistoryItem) => {
    setChips(item.phrases);
    setLocationCode(item.locationCode);
    setLanguageCode(item.languageCode);
    if (item.kind === 'long_tail') {
      const seed = item.phrases[0];
      /* v8 ignore next -- persisted research history always contains at least one phrase. */
      if (seed) {
        void dispatch(
          fetchLongTail({
            seed,
            locationCode: item.locationCode,
            languageCode: item.languageCode,
          }),
        );
      }
    } else {
      void dispatch(
        loadMetrics({
          keywords: item.phrases,
          locationCode: item.locationCode,
          languageCode: item.languageCode,
        }),
      );
      void dispatch(
        fetchIntent({
          keywords: item.phrases,
          locationCode: item.locationCode,
          languageCode: item.languageCode,
        }),
      );
    }
  };

  // Seed for the "get ideas" action: the in-progress draft, else the first chip.
  const ideaSeed = draft.trim() || chips[0] || '';
  const longTailSeed = ideaSeed.length <= MAX_PHRASE_LENGTH ? ideaSeed : '';

  const handleGetIdeas = () => {
    /* v8 ignore next -- button is disabled when ideaSeed is empty; belt-and-braces guard. */
    if (ideaSeed.length === 0) return;
    void dispatch(fetchIdeas({ seed: ideaSeed, locationCode, languageCode }));
  };

  // The button is disabled without a valid seed, so no guard is needed here.
  const handleFindLongTail = () => {
    void dispatch(fetchLongTail({ seed: longTailSeed, locationCode, languageCode }));
  };

  // Empty-state CTA: put the cursor back in the seed input for the next lookup.
  const focusSeedInput = () => {
    /* v8 ignore next -- the seed input is always mounted when the empty-state CTA renders. */
    inputRef.current?.focus();
  };

  const toggleExpanded = (keyword: string) => {
    if (expanded === keyword) {
      dispatch(setExpanded(null));
      return;
    }
    const cacheKey = relatedCacheKey(keyword, locationCode, languageCode);
    if (!relatedByKeyword[cacheKey]) {
      void dispatch(loadRelated({ keyword, locationCode, languageCode }));
    } else {
      dispatch(setExpanded(keyword));
    }
  };

  const handleCopy = async (keyword: string) => {
    try {
      await navigator.clipboard.writeText(keyword);
      toast.success(t('keywordResearch:copied'));
    } catch {
      toast.error(t('keywordResearch:copyFailed'));
    }
  };

  const handleIdeasFromRow = (keyword: string) => {
    void dispatch(fetchIdeas({ seed: keyword, locationCode, languageCode }));
  };

  const handleAddToTracking = async (keyword: string) => {
    /* v8 ignore next -- track button is not rendered without siteId; belt-and-braces guard. */
    if (!siteId) return;
    dispatch(beginAddToTracking(keyword));
    const result = await dispatch(
      addKeyword({
        siteId,
        phrase: keyword,
        locationCode,
        languageCode,
        device: 'desktop',
      }),
    );
    if (addKeyword.rejected.match(result)) {
      /* v8 ignore next -- addKeyword's thunk always populates payload via rejectWithValue; the 'error' fallback is defence. */
      dispatch(resolveAddToTracking({ error: result.payload ?? 'error' }));
    } else {
      dispatch(resolveAddToTracking({}));
    }
  };

  const retryTrackedKeywords = () => {
    // Retry is only rendered inside the site-scoped suggestions block.
    /* v8 ignore start */
    if (!siteId) return;
    /* v8 ignore stop */
    void dispatch(loadKeywords({ siteId, direction: 'initial' }));
  };

  const renderTrackedKeywordSuggestions = () => {
    if (!siteId || !historyLoaded) return null;

    const ready =
      trackedSiteId === siteId && trackedLoaded && !trackedLoading && trackedError.length === 0;
    // loadKeywords.pending switches the ranks slice to siteId before this renders.
    /* v8 ignore start */
    const errorForSite = trackedSiteId === siteId ? trackedError : '';
    /* v8 ignore stop */
    const addCount = Math.min(remainingKeywordSlots, trackedSuggestions.length);

    let content: React.ReactNode;
    if (!ready && !errorForSite) {
      content = (
        <div
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-live="polite"
          data-testid="keyword-research-tracked-loading"
        >
          <p className="text-muted-foreground text-sm">{t('keywordResearch:tracked.loading')}</p>
          <Skeleton className="h-9 w-full sm:w-2/3" />
        </div>
      );
    } else if (errorForSite) {
      content = (
        <Alert variant="destructive" role="alert" data-testid="keyword-research-tracked-error">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('keywordResearch:tracked.loadFailed')}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={trackedLoading}
              loadingLabel={t('keywordResearch:tracked.loading')}
              onClick={retryTrackedKeywords}
            >
              {t('keywordResearch:tracked.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      );
    } else if (trackedKeywords.length === 0) {
      content = (
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-testid="keyword-research-tracked-empty"
        >
          <p className="text-muted-foreground text-sm">{t('keywordResearch:tracked.empty')}</p>
          <Button type="button" size="sm" variant="outline" asChild>
            <Link to={`/sites/${siteId}?tab=keywords`}>
              {t('keywordResearch:tracked.emptyCta')}
            </Link>
          </Button>
        </div>
      );
    } else if (matchingTrackedKeywords.length === 0) {
      content = (
        <p
          className="text-muted-foreground text-sm"
          data-testid="keyword-research-tracked-no-match"
        >
          {t('keywordResearch:tracked.noMatch')}
        </p>
      );
    } else if (remainingKeywordSlots === 0) {
      content = (
        <p className="text-muted-foreground text-sm" data-testid="keyword-research-tracked-limit">
          {t('keywordResearch:tracked.limitReached', { max: MAX_KEYWORDS })}
        </p>
      );
    } else if (trackedSuggestions.length === 0) {
      content = (
        <p
          className="text-muted-foreground text-sm"
          data-testid="keyword-research-tracked-all-selected"
        >
          {t('keywordResearch:tracked.allSelected')}
        </p>
      );
    } else {
      content = (
        <div className="flex flex-wrap gap-2">
          {trackedSuggestions.map((phrase) => (
            <Button
              key={normalizeKeywordPhrase(phrase)}
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 max-w-full whitespace-normal text-start sm:min-h-8"
              aria-label={t('keywordResearch:tracked.addKeyword', { phrase })}
              onClick={() => addTrackedKeyword(phrase)}
              data-testid={`keyword-research-tracked-${keywordSlug(phrase)}`}
            >
              <Plus aria-hidden="true" />
              {phrase}
            </Button>
          ))}
        </div>
      );
    }

    return (
      <div
        className="bg-muted/30 flex flex-col gap-3 rounded-md border p-3"
        role="group"
        aria-labelledby="tracked-keywords-title"
        data-testid="keyword-research-tracked"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 id="tracked-keywords-title" className="text-sm font-medium">
              {t('keywordResearch:tracked.title')}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t('keywordResearch:tracked.description')}
            </p>
          </div>
          {ready && trackedSuggestions.length > 0 && remainingKeywordSlots > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-8"
              onClick={addAllTrackedKeywords}
              data-testid="keyword-research-tracked-add-all"
            >
              {t('keywordResearch:tracked.addAll', { count: addCount })}
            </Button>
          ) : null}
        </div>
        {content}
      </div>
    );
  };

  const showEmpty = loaded && !loading && !error && metrics.length === 0 && chips.length > 0;
  const showRecentLoading = historyLoading && history.length === 0;
  const showRecentEmpty = historyLoaded && !historyLoading && !historyError && history.length === 0;

  return (
    <div className="flex flex-col gap-6 px-4 py-8" data-testid="keyword-research-panel">
      <PageHeader
        icon={APP_PAGE_ICONS.keywordResearch}
        title={t('keywordResearch:panelTitle')}
        description={t('keywordResearch:panelDescription')}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" asChild>
              <Link to="/keyword-research/history" data-testid="keyword-research-history-link">
                <History className="me-1 h-4 w-4" aria-hidden="true" />
                {t('keywordResearch:historyLink')}
              </Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('keywordResearch:searchTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={handleSubmit}
            data-testid="keyword-research-form"
          >
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              {chips.map((c, i) => (
                <Button
                  key={`${c}-${i}`}
                  variant="secondary"
                  size="sm"
                  type="button"
                  className="min-h-11 max-w-full whitespace-normal text-start sm:min-h-8"
                  aria-label={t('keywordResearch:removeKeyword', { phrase: c })}
                  onClick={() => removeChip(i)}
                  data-testid={`keyword-research-chip-${keywordSlug(c)}`}
                >
                  {c}
                  <X aria-hidden="true" />
                </Button>
              ))}
              <Input
                ref={inputRef}
                data-testid="keyword-research-input"
                aria-label={t('keywordResearch:inputLabel')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitChip();
                  }
                }}
                onBlur={commitChip}
                placeholder={t('keywordResearch:inputPlaceholder')}
                className="w-40 flex-1 border-none shadow-none focus-visible:ring-0"
              />
            </div>
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {t('keywordResearch:selectionCount', {
                count: chips.length,
                max: MAX_KEYWORDS,
              })}
            </p>
            <MarketSelects
              locationCode={locationCode}
              languageCode={languageCode}
              onLocationChange={setLocationCode}
              onLanguageChange={setLanguageCode}
              testIdPrefix="keyword-research"
            />
            {renderTrackedKeywordSuggestions()}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                loading={loading}
                loadingLabel={t('keywordResearch:submitting')}
                disabled={chips.length === 0}
                data-testid="keyword-research-submit"
              >
                {loading ? null : <Sparkles className="me-1 h-4 w-4" />}
                {t('keywordResearch:submit')}
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={ideasLoading}
                loadingLabel={t('keywordResearch:gettingIdeas')}
                disabled={ideaSeed.length === 0}
                onClick={handleGetIdeas}
                data-testid="keyword-research-get-ideas"
              >
                {ideasLoading ? null : <Lightbulb className="me-1 h-4 w-4" />}
                {t('keywordResearch:getIdeas')}
              </Button>
              <Button
                type="button"
                variant="outline"
                loading={longTail.loading}
                loadingLabel={t('keywordResearch:longTail.finding')}
                disabled={!longTailSeed}
                onClick={handleFindLongTail}
                data-testid="keyword-research-find-long-tail"
              >
                {longTail.loading ? null : <Search className="me-1 h-4 w-4" />}
                {t('keywordResearch:longTail.find')}
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">
              {t('keywordResearch:longTail.explanation')}
            </p>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive" role="alert" data-testid="keyword-research-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {addToTrackingError ? (
        <Alert variant="destructive" role="alert" data-testid="keyword-research-track-error">
          <AlertDescription>{addToTrackingError}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-live="polite"
          data-testid="keyword-research-loading"
        >
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : null}

      {showEmpty ? (
        <Empty className="w-full" data-testid="keyword-research-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t('keywordResearch:emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('keywordResearch:emptyResults')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={focusSeedInput}
              data-testid="keyword-research-empty-cta"
            >
              {t('keywordResearch:emptyCta')}
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}

      {metrics.length > 0 && !loading ? (
        <ResultsTable
          metrics={metrics}
          expanded={expanded}
          relatedByKeyword={relatedByKeyword}
          locationCode={locationCode}
          languageCode={languageCode}
          relatedLoading={relatedLoading}
          relatedError={relatedError}
          onToggle={toggleExpanded}
          onAdd={handleAddToTracking}
          onCopy={handleCopy}
          onIdeas={handleIdeasFromRow}
          canAdd={Boolean(siteId)}
          siteId={siteId ?? undefined}
          addingToTracking={addingToTracking}
        />
      ) : null}

      {ideasSeed !== null ? (
        <Card data-testid="keyword-research-ideas">
          <CardHeader>
            <CardTitle className="text-base">
              {t('keywordResearch:ideasTitle', { seed: ideasSeed })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ideasLoading ? (
              <div aria-busy="true" aria-live="polite" data-testid="keyword-research-ideas-loading">
                <Skeleton className="h-8 w-full" />
              </div>
            ) : ideasError ? (
              <Alert variant="destructive" role="alert" data-testid="keyword-research-ideas-error">
                <AlertDescription>{ideasError}</AlertDescription>
              </Alert>
            ) : ideas.length > 0 ? (
              <KeywordCandidateList items={ideas} testId="keyword-research-ideas-list" />
            ) : (
              <p
                className="text-muted-foreground text-sm"
                data-testid="keyword-research-ideas-empty"
              >
                {t('keywordResearch:ideasEmpty')}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {longTail.seed !== null &&
      longTail.locationCode === locationCode &&
      longTail.languageCode === languageCode ? (
        <Card data-testid="keyword-research-long-tail">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">
              {t('keywordResearch:longTail.title', { seed: longTail.seed })}
            </CardTitle>
            {longTail.cached !== null ? (
              <StatusChip tone={longTail.cached ? 'muted' : 'success'}>
                {t(
                  longTail.cached
                    ? 'keywordResearch:longTail.cached'
                    : 'keywordResearch:longTail.fresh',
                )}
              </StatusChip>
            ) : null}
          </CardHeader>
          <CardContent>
            {longTail.loading ? (
              <div aria-busy="true" aria-live="polite" data-testid="keyword-research-long-tail-loading">
                <Skeleton className="h-8 w-full" />
              </div>
            ) : longTail.error ? (
              <Alert variant="destructive" role="alert" data-testid="keyword-research-long-tail-error">
                <AlertDescription>{longTail.error}</AlertDescription>
              </Alert>
            ) : longTail.suggestions.length > 0 ? (
              <KeywordCandidateList
                items={longTail.suggestions}
                testId="keyword-research-long-tail-list"
              />
            ) : (
              <p className="text-muted-foreground text-sm" data-testid="keyword-research-long-tail-empty">
                {t('keywordResearch:longTail.empty')}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Recent research. On first
          load (before any search) this is the primary content: the account's
          recent lookups, newest-first, from a free un-metered history read.
          "Search again" re-runs a lookup in place (user-initiated spend). */}
      <div className="flex flex-col gap-3" data-testid="keyword-research-recent">
        <div>
          <h2 className="text-lg font-semibold">{t('keywordResearch:recentTitle')}</h2>
          <p className="text-muted-foreground text-sm">{t('keywordResearch:recentDescription')}</p>
        </div>
        {historyError ? (
          <Alert variant="destructive" role="alert" data-testid="keyword-research-recent-error">
            <AlertDescription>{historyError}</AlertDescription>
          </Alert>
        ) : null}
        {showRecentLoading ? (
          <div
            className="flex flex-col gap-2"
            aria-busy="true"
            aria-live="polite"
            data-testid="keyword-research-recent-loading"
          >
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : null}
        {showRecentEmpty ? (
          <p className="text-muted-foreground text-sm" data-testid="keyword-research-recent-empty">
            {t('keywordResearch:history.empty')}
          </p>
        ) : null}
        {history.length > 0 ? (
          <ResearchHistoryTable
            items={history}
            onSearchAgain={handleSearchAgain}
            testIdPrefix="keyword-research-recent"
          />
        ) : null}
      </div>
    </div>
  );
};

interface ResultsTableProps {
  metrics: KeywordMetric[];
  expanded: string | null;
  relatedByKeyword: Record<string, import('../types').RelatedKeyword[]>;
  locationCode: number;
  languageCode: string;
  relatedLoading: boolean;
  relatedError: string;
  onToggle: (keyword: string) => void;
  onAdd: (keyword: string) => void;
  onCopy: (keyword: string) => void;
  onIdeas: (keyword: string) => void;
  canAdd: boolean;
  addingToTracking: string | null;
  siteId?: string | undefined;
}

const ResultsTable = ({
  metrics,
  expanded,
  relatedByKeyword,
  locationCode,
  languageCode,
  relatedLoading,
  relatedError,
  onToggle,
  onAdd,
  onCopy,
  onIdeas,
  canAdd,
  addingToTracking,
  siteId,
}: ResultsTableProps) => {
  const { t } = useTranslation();
  return (
    <Card data-testid="keyword-research-table">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>{t('keywordResearch:columnKeyword')}</TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('keywordResearch:columnVolume')}
                  description={t('common:tableHelp.searchVolume')}
                />
              </TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('keywordResearch:columnDifficulty')}
                  description={t('common:tableHelp.keywordDifficulty')}
                />
              </TableHead>
              <TableHead>
                <TableHeaderHelp
                  label={t('keywordResearch:columnIntent')}
                  description={t('common:tableHelp.intent')}
                />
              </TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('keywordResearch:columnCpc')}
                  description={t('common:tableHelp.cpc')}
                />
              </TableHead>
              <TableHead className="w-24 text-end">
                <TableHeaderHelp
                  label={t('keywordResearch:columnTrend')}
                  description={t('common:tableHelp.trend')}
                />
              </TableHead>
              <TableHead className="w-24 text-end">{t('keywordResearch:columnActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.map((m) => (
              <RowGroup
                key={m.keyword}
                metric={m}
                expanded={expanded === m.keyword}
                related={relatedByKeyword[relatedCacheKey(m.keyword, locationCode, languageCode)]}
                relatedLoading={relatedLoading && expanded === m.keyword}
                relatedError={relatedError}
                onToggle={onToggle}
                onAdd={onAdd}
                onCopy={onCopy}
                onIdeas={onIdeas}
                canAdd={canAdd}
                adding={addingToTracking === m.keyword}
                siteId={siteId}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

interface RowGroupProps {
  metric: KeywordMetric;
  expanded: boolean;
  related: import('../types').RelatedKeyword[] | undefined;
  relatedLoading: boolean;
  relatedError: string;
  onToggle: (keyword: string) => void;
  onAdd: (keyword: string) => void;
  onCopy: (keyword: string) => void;
  onIdeas: (keyword: string) => void;
  canAdd: boolean;
  adding: boolean;
  siteId?: string | undefined;
}

const RowGroup = ({
  metric,
  expanded,
  related,
  relatedLoading,
  relatedError,
  onToggle,
  onAdd,
  onCopy,
  onIdeas,
  canAdd,
  adding,
  siteId,
}: RowGroupProps) => {
  const { t, i18n } = useTranslation();
  const slug = keywordSlug(metric.keyword);
  const points = useMemo(
    () => metric.monthlySearches.map((m) => m.searchVolume),
    [metric.monthlySearches],
  );

  return (
    <>
      <TableRow data-testid={`keyword-research-row-${slug}`}>
        <TableCell>
          <button
            type="button"
            aria-label={t('keywordResearch:toggleRelated', { phrase: metric.keyword })}
            aria-expanded={expanded}
            onClick={() => onToggle(metric.keyword)}
            className="inline-flex items-center justify-center"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rtl:rotate-180" />}
          </button>
        </TableCell>
        <TableCell>{metric.keyword}</TableCell>
        <TableCell className="text-end tabular-nums">
          {formatVolume(metric.searchVolume, t, i18n.language)}
        </TableCell>
        <TableCell className="text-end">
          <DifficultyBadge difficulty={metric.difficulty} />
        </TableCell>
        <TableCell>
          <IntentBadge intent={metric.intent} />
        </TableCell>
        <TableCell className="text-end tabular-nums">{formatCpc(metric.cpc)}</TableCell>
        <TableCell className="text-end">
          <Sparkline points={points} />
        </TableCell>
        <TableCell className="text-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('keywordResearch:rowActions', { phrase: metric.keyword })}
                data-testid={`keyword-research-row-menu-${slug}`}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => onCopy(metric.keyword)}
                data-testid={`keyword-research-copy-${slug}`}
              >
                <Copy aria-hidden="true" />
                {t('keywordResearch:copyKeyword')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onIdeas(metric.keyword)}
                data-testid={`keyword-research-ideas-${slug}`}
              >
                <Lightbulb aria-hidden="true" />
                {t('keywordResearch:ideasFromRow')}
              </DropdownMenuItem>
              {canAdd ? (
                <DropdownMenuItem
                  disabled={adding}
                  onSelect={() => onAdd(metric.keyword)}
                  data-testid={`keyword-research-track-${slug}`}
                >
                  <Plus aria-hidden="true" />
                  {adding ? t('keywordResearch:tracking') : t('keywordResearch:track')}
                </DropdownMenuItem>
              ) : null}
              {siteId ? (
                <DropdownMenuItem asChild data-testid={`keyword-research-content-${slug}`}>
                  <Link to={contentAnalysisHref({ siteId, keyword: metric.keyword, source: 'keyword' })}>
                    <FileText aria-hidden="true" />
                    {t('contentIntelligence:form.title')}
                  </Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="bg-muted/30" data-testid="keyword-research-related">
          <TableCell colSpan={8}>
            {relatedLoading ? (
              <div
                aria-busy="true"
                aria-live="polite"
                data-testid="keyword-research-related-loading"
              >
                <Skeleton className="h-4 w-full" />
              </div>
            ) : relatedError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{relatedError}</AlertDescription>
              </Alert>
            ) : related && related.length > 0 ? (
              <KeywordCandidateList items={related} />
            ) : (
              <p className="text-muted-foreground text-sm">{t('keywordResearch:relatedEmpty')}</p>
            )}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
};

const DifficultyBadge = ({ difficulty }: { difficulty: number | null }) => {
  const { t } = useTranslation();
  const band = difficultyBand(difficulty);
  const label = t(`keywordResearch:difficulty.${band}`);
  const numeric = difficulty === null ? '—' : String(difficulty);
  return (
    <StatusChip
      tone={band === 'hard' ? 'destructive' : band === 'medium' ? 'warning' : 'success'}
      title={numeric}
    >
      {label}
    </StatusChip>
  );
};
