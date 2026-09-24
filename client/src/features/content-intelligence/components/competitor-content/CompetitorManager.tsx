import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { StatusChip } from '@shared/ui/status-chip';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { clearCompetitorAddError } from '../../store/slice';
import {
  addCompetitorThunk,
  archiveCompetitorThunk,
  loadCompetitorProfiles,
  loadCompetitorSuggestions,
  restoreCompetitorThunk,
} from '../../store/thunks';
import {
  selectCompetitorAddError,
  selectCompetitorAddingKey,
  selectCompetitorMutateError,
  selectCompetitorMutating,
  selectCompetitorProfiles,
  selectCompetitorProfilesError,
  selectCompetitorProfilesLoaded,
  selectCompetitorProfilesLoading,
  selectCompetitorSuggestions,
  selectCompetitorSuggestionsError,
  selectCompetitorSuggestionsLoaded,
  selectCompetitorSuggestionsLoading,
} from '../../store/selectors';
import {
  COMPETITOR_PORTFOLIO_MAX_COMPETITORS,
  type CompetitorProfile,
  type CompetitorSuggestion,
} from '../../types';

interface CompetitorManagerProps {
  siteId: string;
}

/** Client-side URL guard — the server re-validates via `assertPublicUrlSafe`. */
function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Confirmed-competitor portfolio manager. Lists DataForSEO-backed suggestions
 * to confirm, a manual-add form (client URL guard), and the confirmed portfolio
 * with provenance badges + archive/restore. Management spends no vendor budget.
 */
export function CompetitorManager({ siteId }: CompetitorManagerProps) {
  const { t } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();

  const suggestions = useAppSelector(selectCompetitorSuggestions);
  const suggestionsLoading = useAppSelector(selectCompetitorSuggestionsLoading);
  const suggestionsLoaded = useAppSelector(selectCompetitorSuggestionsLoaded);
  const suggestionsError = useAppSelector(selectCompetitorSuggestionsError);
  const profiles = useAppSelector(selectCompetitorProfiles);
  const profilesLoading = useAppSelector(selectCompetitorProfilesLoading);
  const profilesLoaded = useAppSelector(selectCompetitorProfilesLoaded);
  const profilesError = useAppSelector(selectCompetitorProfilesError);
  const addingKey = useAppSelector(selectCompetitorAddingKey);
  const addError = useAppSelector(selectCompetitorAddError);
  const mutateError = useAppSelector(selectCompetitorMutateError);

  const [manualUrl, setManualUrl] = useState('');
  const [inlineErrorKey, setInlineErrorKey] = useState<string | null>(null);
  const manualId = useId();

  useEffect(() => {
    const p1 = dispatch(loadCompetitorProfiles({ siteId, status: 'all' }));
    const p2 = dispatch(loadCompetitorSuggestions({ siteId }));
    return () => {
      p1.abort();
      p2.abort();
    };
  }, [dispatch, siteId]);

  const activeCount = useMemo(
    () => profiles.filter((p) => p.status === 'active').length,
    [profiles],
  );
  const portfolioFull = activeCount >= COMPETITOR_PORTFOLIO_MAX_COMPETITORS;

  const reload = useCallback(() => {
    void dispatch(loadCompetitorProfiles({ siteId, status: 'all' }));
    void dispatch(loadCompetitorSuggestions({ siteId }));
  }, [dispatch, siteId]);

  const confirmSuggestion = useCallback(
    async (suggestion: CompetitorSuggestion) => {
      const result = await dispatch(
        addCompetitorThunk({ siteId, url: suggestion.origin, source: 'suggested' }),
      );
      if (addCompetitorThunk.fulfilled.match(result)) reload();
    },
    [dispatch, reload, siteId],
  );

  const onManualSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (addingKey !== null) return;
      const trimmed = manualUrl.trim();
      if (!isValidHttpUrl(trimmed)) {
        setInlineErrorKey('competitorContent.manager.errors.invalidUrl');
        return;
      }
      if (portfolioFull) {
        setInlineErrorKey('competitorContent.manager.errors.portfolioFull');
        return;
      }
      const result = await dispatch(addCompetitorThunk({ siteId, url: trimmed, source: 'manual' }));
      if (addCompetitorThunk.fulfilled.match(result)) {
        setManualUrl('');
        reload();
      }
    },
    [addingKey, dispatch, manualUrl, portfolioFull, reload, siteId],
  );

  const onManualField = useCallback(
    (value: string) => {
      setManualUrl(value);
      setInlineErrorKey(null);
      if (addError) dispatch(clearCompetitorAddError());
    },
    [addError, dispatch],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="competitor-manager">
      <SuggestionsCard
        suggestions={suggestions}
        loading={suggestionsLoading}
        loaded={suggestionsLoaded}
        error={suggestionsError}
        addingKey={addingKey}
        portfolioFull={portfolioFull}
        onConfirm={confirmSuggestion}
        onRetry={reload}
      />

      <Card data-testid="competitor-manual-add">
        <CardHeader>
          <CardTitle>{t('competitorContent.manager.manualTitle')}</CardTitle>
          <CardDescription>{t('competitorContent.manager.manualDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onManualSubmit} className="flex flex-col gap-3" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor={manualId}>{t('competitorContent.manager.manualLabel')}</Label>
              <Input
                id={manualId}
                type="url"
                inputMode="url"
                value={manualUrl}
                placeholder="https://competitor.com/"
                onChange={(e) => onManualField(e.target.value)}
                data-testid="competitor-manual-url"
              />
              <p className="text-muted-foreground text-xs">
                {t('competitorContent.manager.manualHint', {
                  max: COMPETITOR_PORTFOLIO_MAX_COMPETITORS,
                })}
              </p>
            </div>
            {inlineErrorKey ? (
              <p
                className="text-destructive text-sm"
                role="alert"
                data-testid="competitor-manual-inline-error"
              >
                {t(inlineErrorKey, { max: COMPETITOR_PORTFOLIO_MAX_COMPETITORS })}
              </p>
            ) : null}
            {addError ? (
              <Alert variant="destructive" data-testid="competitor-manual-server-error">
                <AlertTitle>{t('competitorContent.manager.errors.addFailed')}</AlertTitle>
                <AlertDescription>{addError}</AlertDescription>
              </Alert>
            ) : null}
            {portfolioFull ? (
              <p className="text-muted-foreground text-xs" data-testid="competitor-portfolio-full">
                {t('competitorContent.manager.portfolioFull', {
                  max: COMPETITOR_PORTFOLIO_MAX_COMPETITORS,
                })}
              </p>
            ) : null}
            <div>
              <Button
                type="submit"
                loading={addingKey === manualUrl.trim()}
                loadingLabel={t('competitorContent.manager.adding')}
                disabled={portfolioFull || addingKey !== null}
                data-testid="competitor-manual-submit"
              >
                <Plus aria-hidden="true" className="me-2 size-4" />
                {t('competitorContent.manager.add')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <PortfolioCard
        siteId={siteId}
        profiles={profiles}
        loading={profilesLoading}
        loaded={profilesLoaded}
        error={profilesError}
        mutateError={mutateError}
        onRetry={reload}
      />
    </div>
  );
}

interface SuggestionsCardProps {
  suggestions: CompetitorSuggestion[];
  loading: boolean;
  loaded: boolean;
  error: string;
  addingKey: string | null;
  portfolioFull: boolean;
  onConfirm: (suggestion: CompetitorSuggestion) => void;
  onRetry: () => void;
}

function SuggestionsCard({
  suggestions,
  loading,
  loaded,
  error,
  addingKey,
  portfolioFull,
  onConfirm,
  onRetry,
}: SuggestionsCardProps) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="competitor-suggestions">
      <CardHeader>
        <CardTitle>{t('competitorContent.manager.suggestionsTitle')}</CardTitle>
        <CardDescription>{t('competitorContent.manager.suggestionsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && !loaded ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive" data-testid="competitor-suggestions-error">
            <AlertTitle>{t('competitorContent.errors.loadFailed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={onRetry}>
                {t('competitorContent.errors.retry')}
              </Button>
            </div>
          </Alert>
        ) : suggestions.length === 0 ? (
          <Empty data-testid="competitor-suggestions-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('competitorContent.manager.suggestionsEmpty.title')}</EmptyTitle>
              <EmptyDescription>
                {t('competitorContent.manager.suggestionsEmpty.description')}
              </EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('competitorContent.manager.columns.domain')}</TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('competitorContent.manager.columns.avgPosition')}
                      description={t('common:tableHelp.averagePosition')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('competitorContent.manager.columns.overlap')}
                      description={t('common:tableHelp.keywordOverlap')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    {t('competitorContent.manager.columns.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suggestions.map((s) => (
                  <TableRow
                    key={s.registrableDomain}
                    data-testid={`competitor-suggestion-${s.registrableDomain}`}
                  >
                    <TableCell className="font-medium">{s.registrableDomain}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {s.avgPosition === null ? '—' : s.avgPosition}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{s.intersections}</TableCell>
                    <TableCell className="text-end">
                      {s.alreadyConfirmed ? (
                        <StatusChip
                          tone="success"
                          data-testid={`competitor-confirmed-${s.registrableDomain}`}
                        >
                          {t('competitorContent.manager.confirmed')}
                        </StatusChip>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={addingKey === s.origin}
                          loadingLabel={t('competitorContent.manager.adding')}
                          disabled={portfolioFull || addingKey !== null}
                          onClick={() => onConfirm(s)}
                          data-testid={`competitor-confirm-${s.registrableDomain}`}
                        >
                          {t('competitorContent.manager.confirm')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface PortfolioCardProps {
  siteId: string;
  profiles: CompetitorProfile[];
  loading: boolean;
  loaded: boolean;
  error: string;
  mutateError: string;
  onRetry: () => void;
}

function PortfolioCard({
  siteId,
  profiles,
  loading,
  loaded,
  error,
  mutateError,
  onRetry,
}: PortfolioCardProps) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="competitor-portfolio">
      <CardHeader>
        <CardTitle>{t('competitorContent.manager.portfolioTitle')}</CardTitle>
        <CardDescription>{t('competitorContent.manager.portfolioDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && !loaded ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive" data-testid="competitor-portfolio-error">
            <AlertTitle>{t('competitorContent.errors.loadFailed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={onRetry}>
                {t('competitorContent.errors.retry')}
              </Button>
            </div>
          </Alert>
        ) : profiles.length === 0 ? (
          <Empty data-testid="competitor-portfolio-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('competitorContent.manager.portfolioEmpty.title')}</EmptyTitle>
              <EmptyDescription>
                {t('competitorContent.manager.portfolioEmpty.description')}
              </EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            {mutateError ? (
              <Alert
                variant="destructive"
                className="mb-4"
                data-testid="competitor-portfolio-mutate-error"
              >
                <AlertTitle>{t('competitorContent.manager.errors.mutateFailed')}</AlertTitle>
                <AlertDescription>{mutateError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('competitorContent.manager.columns.domain')}</TableHead>
                    <TableHead>
                      <TableHeaderHelp
                        label={t('competitorContent.manager.columns.source')}
                        description={t('common:tableHelp.competitorSource')}
                      />
                    </TableHead>
                    <TableHead>{t('competitorContent.manager.columns.status')}</TableHead>
                    <TableHead className="text-end">
                      {t('competitorContent.manager.columns.actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((p) => (
                    <PortfolioRow key={p.id} siteId={siteId} profile={p} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface PortfolioRowProps {
  siteId: string;
  profile: CompetitorProfile;
}

function PortfolioRow({ siteId, profile }: PortfolioRowProps) {
  const { t } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const mutating = useAppSelector(selectCompetitorMutating(profile.id));
  const isActive = profile.status === 'active';

  const onToggle = useCallback(() => {
    const thunk = isActive ? archiveCompetitorThunk : restoreCompetitorThunk;
    void dispatch(thunk({ siteId, competitorId: profile.id }));
  }, [dispatch, isActive, profile.id, siteId]);

  return (
    <TableRow data-testid={`competitor-profile-${profile.id}`} data-status={profile.status}>
      <TableCell className="font-medium">{profile.registrableDomain}</TableCell>
      <TableCell>
        <StatusChip tone={profile.source === 'suggested' ? 'info' : 'primary'}>
          {t(`competitorContent.manager.source.${profile.source}`)}
        </StatusChip>
      </TableCell>
      <TableCell>
        <StatusChip tone={isActive ? 'success' : 'muted'}>
          {t(`competitorContent.manager.profileStatus.${profile.status}`)}
        </StatusChip>
      </TableCell>
      <TableCell className="text-end">
        <Button
          size="sm"
          variant="outline"
          loading={mutating}
          loadingLabel={t('competitorContent.manager.updating')}
          onClick={onToggle}
          data-testid={`competitor-toggle-${profile.id}`}
        >
          {isActive
            ? t('competitorContent.manager.archive')
            : t('competitorContent.manager.restore')}
        </Button>
      </TableCell>
    </TableRow>
  );
}
