import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { History, Loader2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { parseKeywordLines } from '@features/ranks';
import { ReportExportControl } from '@features/report-export';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { Textarea } from '@shared/ui/textarea';
import { DeltaPill } from '@shared/ui/delta-pill';
import {
  CountryCombobox,
  formatCountryFromLocation,
  languageName,
  useMarketCatalog,
} from '@shared/markets';
import { appKeywordResearchInputSchema, type AppKeywordResearchInput } from '../../research-types';
import { selectAppSeoResearch } from '../../store/research-selectors';
import { clearAppResearchPreview } from '../../store/research-slice';
import { previewAppResearchSpend, runAppKeywordResearch } from '../../store/research-thunks';
import { selectAppProfiles } from '../../store/selectors';
import { selectAppSeoTracking } from '../../store/tracking-selectors';
import { clearAppSeoTrackingPreview, selectTrackedAppKeyword } from '../../store/tracking-slice';
import {
  confirmTrackedAppKeywordRecheck,
  deleteTrackedAppKeyword,
  loadTrackedAppKeywordHistory,
  loadTrackedAppKeywords,
  mintTrackedAppKeyword,
  previewTrackedAppKeywordMint,
  previewTrackedAppKeywordRecheck,
} from '../../store/tracking-thunks';
import type { AppProfile } from '../../types';
import type { AppStoreKind, MintAppKeywordInput } from '../../tracking-types';
import { ResearchSpendDialog } from '../research/ResearchSpendDialog';
import { AppKeywordHistoryChart } from './AppKeywordHistoryChart';

const profileLabel = (profile: AppProfile) =>
  profile.playPackageId ?? profile.appStoreId ?? profile.id;

export function AppKeywordTrackingPanel({ siteId }: { siteId: string }) {
  const { t, i18n } = useTranslation('appSeoTracking');
  const dispatch = useAppDispatch();
  const profiles = useAppSelector(selectAppProfiles);
  const tracking = useAppSelector(selectAppSeoTracking);
  const [params, setParams] = useSearchParams();
  const profileId = params.get('profile') ?? profiles[0]?.id ?? '';
  const selectedKeywordId = params.get('keyword');
  const action = params.get('action');
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
  const selectedKeyword = tracking.items.find((item) => item.id === selectedKeywordId) ?? null;
  const [phrase, setPhrase] = useState('');
  const [store, setStore] = useState<AppStoreKind>('google_play');
  const [countryCode, setCountryCode] = useState('US');
  const [languageCode, setLanguageCode] = useState('en');
  const [pendingMint, setPendingMint] = useState<MintAppKeywordInput[]>([]);
  // Discovery reuses the app keyword research surface (US/English only) as the suggestion source.
  const research = useAppSelector(selectAppSeoResearch);
  const storedDiscovery = research.results.keywords;
  const discovery =
    storedDiscovery?.profileId === profileId && storedDiscovery.store === store
      ? storedDiscovery
      : null;
  const [pendingDiscovery, setPendingDiscovery] = useState<AppKeywordResearchInput | null>(null);
  const [selectedDiscovery, setSelectedDiscovery] = useState<Set<string>>(() => new Set());
  const discoveryBusy = research.mutationStatus === 'loading';
  const busy = tracking.mutationStatus === 'loading';
  const hasQueuedCheck = tracking.items.some((item) => item.checkStatus === 'queued');
  const marketCatalog = useMarketCatalog(store === 'google_play' ? 'app-google-play' : 'app-store');
  const selectedMarket =
    marketCatalog.markets.find((market) => market.countryCode === countryCode) ?? null;

  const setUrl = useCallback(
    (values: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(values)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    if (!params.get('profile') && profiles[0]) setUrl({ profile: profiles[0].id });
  }, [profiles, params, setUrl]);

  useEffect(() => {
    if (profileId) void dispatch(loadTrackedAppKeywords({ siteId, profileId }));
  }, [dispatch, profileId, siteId]);

  useEffect(() => {
    if (!profileId || !hasQueuedCheck) return;
    const timer = window.setInterval(() => {
      void dispatch(loadTrackedAppKeywords({ siteId, profileId }));
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [dispatch, hasQueuedCheck, profileId, siteId]);

  useEffect(() => {
    dispatch(selectTrackedAppKeyword(selectedKeywordId));
    if (selectedKeywordId) {
      void dispatch(loadTrackedAppKeywordHistory({ siteId, keywordId: selectedKeywordId }));
    }
  }, [dispatch, selectedKeywordId, siteId]);

  useEffect(() => {
    if (!profile) return;
    if (store === 'google_play' && !profile.playPackageId && profile.appStoreId)
      setStore('app_store');
    if (store === 'app_store' && !profile.appStoreId && profile.playPackageId)
      setStore('google_play');
  }, [profile, store]);

  useEffect(() => {
    setCountryCode('US');
    setLanguageCode('en');
  }, [store]);

  useEffect(() => {
    if (marketCatalog.loading || marketCatalog.error || marketCatalog.markets.length === 0) return;
    const market =
      marketCatalog.markets.find((candidate) => candidate.countryCode === countryCode) ??
      marketCatalog.markets.find((candidate) => candidate.countryCode === 'US') ??
      marketCatalog.markets[0]!;
    if (market.countryCode !== countryCode) setCountryCode(market.countryCode);
    if (!market.languageCodes.includes(languageCode)) {
      setLanguageCode(
        market.languageCodes.includes('en') ? 'en' : (market.languageCodes[0] ?? 'en'),
      );
    }
  }, [
    countryCode,
    languageCode,
    marketCatalog.error,
    marketCatalog.loading,
    marketCatalog.markets,
  ]);

  const storeOptions = useMemo(
    () => [
      ...(profile?.playPackageId
        ? [{ value: 'google_play' as const, label: t('stores.googlePlay') }]
        : []),
      ...(profile?.appStoreId
        ? [{ value: 'app_store' as const, label: t('stores.appStore') }]
        : []),
    ],
    [profile, t],
  );

  const trackedPhrases = useMemo(
    () =>
      new Set(
        tracking.items
          .filter((item) => item.store === store)
          .map((item) => item.phrase.toLocaleLowerCase()),
      ),
    [store, tracking.items],
  );
  const discoveryRows = discovery?.rows ?? [];
  const isTracked = (keyword: string) => trackedPhrases.has(keyword.toLocaleLowerCase());
  const selectableDiscovery = discoveryRows.filter((row) => !isTracked(row.keyword));
  const selectedDiscoveryRows = selectableDiscovery.filter((row) =>
    selectedDiscovery.has(row.keyword),
  );
  const allDiscoverySelected =
    selectableDiscovery.length > 0 && selectedDiscoveryRows.length === selectableDiscovery.length;

  const requestDiscovery = async () => {
    setPendingDiscovery(
      appKeywordResearchInputSchema.parse({
        profileId,
        store,
        locationCode: 2840,
        languageCode: 'en',
        cursor: 0,
        pageSize: 25,
      }),
    );
    setSelectedDiscovery(new Set());
    try {
      await dispatch(
        previewAppResearchSpend({ siteId, profileId, store, surface: 'keywords' }),
      ).unwrap();
    } catch {
      setPendingDiscovery(null);
    }
  };

  const closeDiscovery = () => {
    setPendingDiscovery(null);
    dispatch(clearAppResearchPreview());
  };

  const confirmDiscovery = async (input: AppKeywordResearchInput) => {
    try {
      await dispatch(runAppKeywordResearch({ siteId, input })).unwrap();
      setPendingDiscovery(null);
    } catch {
      /* Redux owns localized error state. */
    }
  };

  const toggleDiscovery = (keyword: string, checked: boolean) => {
    setSelectedDiscovery((previous) => {
      const next = new Set(previous);
      if (checked) next.add(keyword);
      else next.delete(keyword);
      return next;
    });
  };

  const startMint = async (phrases: string[]) => {
    const locationCode = selectedMarket?.locationCode ?? 0;
    const inputs = phrases.map((line) => ({
      phrase: line,
      store,
      locationCode,
      languageCode: languageCode.trim(),
    }));
    const input = inputs[0];
    if (!input || !Number.isInteger(locationCode) || locationCode <= 0) return;
    setPendingMint(inputs);
    try {
      // Every phrase costs the same, so one preview prices the whole batch.
      await dispatch(previewTrackedAppKeywordMint({ siteId, profileId, input })).unwrap();
      setUrl({ action: 'mint' });
    } catch {
      /* Error text is stored by the thunk. */
    }
  };

  // Selected discovery rows go straight to the mint preview; no detour through the phrase field.
  const trackSelectedDiscovery = () =>
    void startMint(selectedDiscoveryRows.map((row) => row.keyword));

  const closeDialog = () => {
    dispatch(clearAppSeoTrackingPreview());
    setPendingMint([]);
    setUrl({ action: null });
  };

  const previewMint = (event: FormEvent) => {
    event.preventDefault();
    // Pasted lists arrive comma- or newline-separated; each phrase mints its own row.
    void startMint(parseKeywordLines(phrase));
  };

  const confirmMint = async () => {
    if (pendingMint.length === 0) return;
    try {
      // Sequential: stop at the first rejection so the error refers to one phrase.
      for (const input of pendingMint) {
        await dispatch(mintTrackedAppKeyword({ siteId, profileId, input })).unwrap();
      }
      const minted = new Set(pendingMint.map((input) => input.phrase.toLocaleLowerCase()));
      setPhrase(
        parseKeywordLines(phrase)
          .filter((line) => !minted.has(line.toLocaleLowerCase()))
          .join('\n'),
      );
      setSelectedDiscovery(new Set());
      closeDialog();
    } catch {
      /* Error text is stored by the thunk. */
    }
  };

  const previewRecheck = async (keywordId: string) => {
    setUrl({ keyword: keywordId, action: 'recheck' });
    try {
      await dispatch(previewTrackedAppKeywordRecheck({ siteId, keywordId })).unwrap();
    } catch {
      /* Error text is stored by the thunk. */
    }
  };

  const confirmRecheck = async () => {
    if (!selectedKeywordId) return;
    try {
      await dispatch(
        confirmTrackedAppKeywordRecheck({ siteId, keywordId: selectedKeywordId }),
      ).unwrap();
      closeDialog();
    } catch {
      /* Error text is stored by the thunk. */
    }
  };

  if (profiles.length === 0) {
    return (
      <Empty data-testid="app-seo-view-keywords">
        <EmptyHeader>
          <EmptyTitle>{t('empty.noProfileTitle')}</EmptyTitle>
          <EmptyDescription>{t('empty.noProfileDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (tracking.listStatus === 'loading' && tracking.profileId !== profileId) {
    return <Skeleton className="h-72 w-full" data-testid="app-seo-view-keywords" />;
  }

  if (!tracking.trackingEnabled) {
    return (
      <Empty data-testid="app-seo-view-keywords">
        <EmptyHeader>
          <EmptyTitle>{t('disabled.title')}</EmptyTitle>
          <EmptyDescription>{t('disabled.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }


  return (
    <div className="flex flex-col gap-6" data-testid="app-seo-view-keywords">
      {tracking.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t('errors.title')}</AlertTitle>
          <AlertDescription>{tracking.error}</AlertDescription>
        </Alert>
      ) : null}
      {research.researchEnabled ? (
        <Card data-testid="app-keyword-discovery">
          <CardHeader>
            <CardTitle>{t('discover.title')}</CardTitle>
            <CardDescription>{t('discover.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {research.error ? (
              <Alert variant="destructive">
                <AlertTitle>{t('errors.title')}</AlertTitle>
                <AlertDescription>{research.error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm">{t('discover.marketNote')}</p>
              <Button
                type="button"
                variant="outline"
                loading={discoveryBusy}
                loadingLabel={t('discover.loading')}
                disabled={storeOptions.length === 0}
                onClick={() => void requestDiscovery()}
              >
                <Search aria-hidden="true" />
                {t('discover.find')}
              </Button>
            </div>
            {discovery && discoveryRows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('discover.empty')}</p>
            ) : null}
            {discoveryRows.length > 0 ? (
              <div className="flex flex-col gap-2" aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground text-sm" role="status">
                    {t('discover.selectedCount', { count: selectedDiscoveryRows.length })}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={selectedDiscoveryRows.length === 0}
                    onClick={trackSelectedDiscovery}
                  >
                    {t('discover.trackSelected', { count: selectedDiscoveryRows.length })}
                  </Button>
                </div>
                <Table data-testid="app-keyword-discovery-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label={t('discover.selectAll')}
                          checked={
                            allDiscoverySelected
                              ? true
                              : selectedDiscoveryRows.length > 0
                                ? 'indeterminate'
                                : false
                          }
                          disabled={selectableDiscovery.length === 0}
                          onCheckedChange={(checked) =>
                            setSelectedDiscovery(
                              checked === true
                                ? new Set(selectableDiscovery.map((row) => row.keyword))
                                : new Set(),
                            )
                          }
                        />
                      </TableHead>
                      <TableHead>{t('discover.keyword')}</TableHead>
                      <TableHead className="text-end">{t('discover.rank')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discoveryRows.map((row) => {
                      const tracked = isTracked(row.keyword);
                      return (
                        <TableRow key={`${row.keyword}-${row.rank ?? 'none'}`}>
                          <TableCell>
                            <Checkbox
                              aria-label={t('discover.selectRow', { keyword: row.keyword })}
                              checked={!tracked && selectedDiscovery.has(row.keyword)}
                              disabled={tracked}
                              onCheckedChange={(checked) =>
                                toggleDiscovery(row.keyword, checked === true)
                              }
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {row.keyword}
                            {tracked ? (
                              <Badge variant="secondary" className="ms-2">
                                {t('discover.tracked')}
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-end">
                            {row.rank ?? t('discover.notRanked')}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('form.title')}</CardTitle>
          <CardDescription>{t('form.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void previewMint(event)}>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="app-keyword-profile">{t('form.profile')}</Label>
              <Select
                value={profileId}
                onValueChange={(value) => setUrl({ profile: value, keyword: null })}
              >
                <SelectTrigger id="app-keyword-profile" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {profileLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="app-keyword-phrase">{t('form.phrase')}</Label>
              <Textarea
                id="app-keyword-phrase"
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
                aria-describedby="app-keyword-phrase-hint"
                required
              />
              <p id="app-keyword-phrase-hint" className="text-muted-foreground text-sm">
                {t('form.phraseHint')}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="app-keyword-store">{t('form.store')}</Label>
              <Select value={store} onValueChange={(value) => setStore(value as AppStoreKind)}>
                <SelectTrigger id="app-keyword-store" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {storeOptions.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="app-keyword-location">{t('form.location')}</Label>
              <CountryCombobox
                id="app-keyword-location"
                value={countryCode}
                markets={marketCatalog.markets}
                loading={marketCatalog.loading}
                disabled={marketCatalog.error}
                onValueChange={(nextCountry, market) => {
                  setCountryCode(nextCountry!);
                  setLanguageCode(
                    market!.languageCodes.includes('en')
                      ? 'en'
                      : (market!.languageCodes[0] ?? 'en'),
                  );
                }}
              />
              {marketCatalog.error ? (
                <p className="text-destructive text-sm">{t('common:market.loadError')}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="app-keyword-language">{t('form.language')}</Label>
              <Select
                value={languageCode}
                onValueChange={setLanguageCode}
                disabled={!selectedMarket || marketCatalog.error}
              >
                <SelectTrigger id="app-keyword-language" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(selectedMarket?.languageCodes ?? []).map((code) => (
                    <SelectItem key={code} value={code}>
                      {languageName(code, i18n.language) ?? code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-end gap-4">
              <Button
                type="submit"
                loading={busy}
                loadingLabel={t('form.previewing')}
                disabled={!selectedMarket || marketCatalog.error}
              >
                <Plus aria-hidden="true" />
                {t('form.add')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t('list.title')}</CardTitle>
              <CardDescription>{t('list.description')}</CardDescription>
            </div>
            <ReportExportControl
              kind="app.keyword_tracking"
              target={{ scope: 'site_resource', siteId, resourceId: profileId }}
              selection={selectedKeywordId ? { keywordIds: [selectedKeywordId] } : {}}
            />
          </div>
        </CardHeader>
        <CardContent>
          {tracking.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('empty.noKeywords')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('list.keyword')}</TableHead>
                  <TableHead>{t('list.store')}</TableHead>
                  <TableHead>{t('form.location')}</TableHead>
                  <TableHead>{t('list.position')}</TableHead>
                  <TableHead>{t('list.change')}</TableHead>
                  <TableHead className="text-end">{t('list.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tracking.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.phrase}</TableCell>
                    <TableCell>
                      {item.store === 'google_play' ? t('stores.googlePlay') : t('stores.appStore')}
                    </TableCell>
                    <TableCell>
                      {formatCountryFromLocation(
                        item.locationCode,
                        i18n.language,
                        t('common:market.unknownCountry'),
                      )}
                      {' · '}
                      {languageName(item.languageCode, i18n.language) ??
                        t('common:market.unknownLanguage')}
                    </TableCell>
                    <TableCell>
                      {item.checkStatus === 'queued' ? (
                        <span className="inline-flex items-center gap-2" role="status">
                          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                          {t('list.checking')}
                        </span>
                      ) : item.checkStatus === 'failed' ? (
                        <span className="text-destructive">{t('list.checkFailed')}</span>
                      ) : item.lastCheckedAt ? (
                        (item.latestPosition ?? t('list.notInDepth'))
                      ) : (
                        t('list.neverChecked')
                      )}
                    </TableCell>
                    <TableCell>
                      {item.checkStatus === 'queued' ? (
                        t('list.checking')
                      ) : item.checkStatus === 'failed' ? (
                        t('list.checkFailed')
                      ) : item.delta === null ? (
                        t(item.lastCheckedAt ? 'list.noPreviousCheck' : 'list.neverChecked')
                      ) : (
                        <DeltaPill value={item.delta} />
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={t('list.historyLabel', { phrase: item.phrase })}
                          onClick={() => setUrl({ keyword: item.id, action: null })}
                        >
                          <History aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={t('list.recheckLabel', { phrase: item.phrase })}
                          disabled={item.checkStatus === 'queued'}
                          onClick={() => void previewRecheck(item.id)}
                        >
                          <RefreshCw aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('list.deleteLabel', { phrase: item.phrase })}
                          loading={busy}
                          onClick={() =>
                            void dispatch(deleteTrackedAppKeyword({ siteId, keywordId: item.id }))
                          }
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedKeyword ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('history.title', { phrase: selectedKeyword.phrase })}</CardTitle>
            <CardDescription>{t('history.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {tracking.historyStatus === 'loading' ? (
              <Skeleton className="h-52 w-full" />
            ) : (
              <AppKeywordHistoryChart keyword={selectedKeyword} points={tracking.history} />
            )}
          </CardContent>
        </Card>
      ) : null}

      <ResearchSpendDialog
        open={pendingDiscovery !== null && research.preview?.surface === 'keywords'}
        loading={discoveryBusy}
        onClose={closeDiscovery}
        onConfirm={() => void confirmDiscovery(pendingDiscovery!)}
      />

      <Dialog open={action === 'mint'} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('mintPreview.title')}</DialogTitle>
            <DialogDescription>{t('mintPreview.description')}</DialogDescription>
          </DialogHeader>
          {pendingMint.length > 1 ? (
            <p className="text-sm">{t('mintPreview.count', { count: pendingMint.length })}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('common:cancel')}
            </Button>
            <Button
              loading={busy}
              loadingLabel={t('mintPreview.confirming')}
              onClick={() => void confirmMint()}
            >
              {t('mintPreview.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={action === 'recheck'} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('recheck.title')}</DialogTitle>
            <DialogDescription>
              {t('recheck.description', { phrase: selectedKeyword?.phrase ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('common:cancel')}
            </Button>
            <Button
              loading={busy}
              loadingLabel={t('recheck.confirming')}
              onClick={() => void confirmRecheck()}
            >
              {t('recheck.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
