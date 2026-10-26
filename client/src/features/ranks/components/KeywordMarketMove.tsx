import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, X } from 'lucide-react';
import { ApiError } from '@shared/api/client';
import { Bdi } from '@shared/components/Bdi';
import { formatCountryFromLocation, languageName } from '@shared/markets';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@shared/ui/dialog';
import { fetchKeywordMarketMoveRequest, moveKeywordsToSiteMarketRequest } from '../api';
import { ranksErrorMessage } from '../errorMessage';
import type { KeywordMarketMovePreview } from '../types';

export interface KeywordMarketMoveProps {
  siteId: string;
  keywordCount: number;
  onMoved: () => void;
}

const DISMISS_PREFIX = 'rmf.marketMove.dismissed.';
const dismissKey = (siteId: string, target: KeywordMarketMovePreview['target']): string =>
  `${DISMISS_PREFIX}${siteId}.${target.locationCode}.${target.languageCode}.${target.device}`;

function readDismissed(key: string): boolean {
  try { return window.localStorage.getItem(key) === '1'; }
  catch { return false; }
}
function writeDismissed(key: string): void {
  try { window.localStorage.setItem(key, '1'); }
  catch { /* The in-memory dismissal still lasts for this visit. */ }
}

/** Review an existing market mismatch before any keyword changes are made. */
export function KeywordMarketMove({ siteId, keywordCount, onMoved }: KeywordMarketMoveProps) {
  const { t, i18n } = useTranslation('ranks');
  const [preview, setPreview] = useState<KeywordMarketMovePreview | null>(null);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [dismissedNow, setDismissedNow] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [moved, setMoved] = useState<number | null>(null);
  const currentSite = useRef(siteId);
  currentSite.current = siteId;

  useEffect(() => {
    setPreview(null);
    setOpen(false);
    setMoving(false);
    setRefreshing(false);
    setError('');
    setMoved(null);
  }, [siteId]);

  useEffect(() => {
    if (keywordCount === 0) { setPreview(null); return; }
    const controller = new AbortController();
    void fetchKeywordMarketMoveRequest(siteId, controller.signal).then(
      ({ preview: next }) => { if (!controller.signal.aborted) setPreview(next); },
      () => { if (!controller.signal.aborted) setPreview(null); },
    ).finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [generation, keywordCount, siteId]);

  if (!preview || (preview.movable === 0 && moved === null)) return null;
  const key = dismissKey(siteId, preview.target);
  const dismissed = dismissedNow === key || readDismissed(key);
  if (dismissed && moved === null) return null;
  const locale = i18n.language;
  const market = [
    formatCountryFromLocation(preview.target.locationCode, locale, t('common:market.unknownCountry')),
    languageName(preview.target.languageCode, locale) ?? preview.target.languageCode,
    t(preview.target.device === 'mobile' ? 'deviceMobile' : 'deviceDesktop'),
  ].join(' · ');
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  const confirm = async () => {
    const requestedSite = siteId;
    setMoving(true);
    setError('');
    try {
      const result = await moveKeywordsToSiteMarketRequest(requestedSite, preview.token);
      if (currentSite.current !== requestedSite) return;
      setPreview(result.preview);
      setMoved(result.moved);
      setOpen(false);
      onMoved();
    } catch (err) {
      if (currentSite.current !== requestedSite) return;
      if (err instanceof ApiError && err.status === 409) {
        setError(t('marketMove.stale'));
        setOpen(false);
        setRefreshing(true);
        setGeneration((value) => value + 1);
      } else {
        setError(ranksErrorMessage(err, 'ranks:marketMove.failed'));
      }
    } finally {
      if (currentSite.current === requestedSite) setMoving(false);
    }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!moving) setOpen(next); }}>
    {moved !== null ? <p className="text-success text-sm" role="status" data-testid="keyword-market-move-done">
      {t('marketMove.success', { count: moved })}
    </p> : null}
    {preview.movable > 0 && !dismissed ? <Alert role="status" data-testid="keyword-market-move" className="pe-12">
      <Globe aria-hidden="true" />
      <Button type="button" variant="ghost" size="icon" className="absolute end-2 top-2 size-8"
        aria-label={t('marketMove.dismiss')} onClick={() => { writeDismissed(key); setDismissedNow(key); }}
        data-testid="keyword-market-move-dismiss"><X aria-hidden="true" /></Button>
      <AlertTitle>{t('marketMove.title')}</AlertTitle>
      <AlertDescription>
        <p>{t('marketMove.body', { market, n: number(preview.movable) })}</p>
        {error && !open ? <p role="alert" className="text-destructive mt-2 text-sm">{error}</p> : null}
        <DialogTrigger asChild><Button type="button" variant="outline" size="sm" className="mt-2"
          disabled={refreshing} onClick={() => setError('')} data-testid="keyword-market-move-review">
          {t('marketMove.review')}
        </Button></DialogTrigger>
      </AlertDescription>
    </Alert> : null}
    <DialogContent data-testid="keyword-market-move-dialog">
      <DialogHeader>
        <DialogTitle>{t('marketMove.dialogTitle')}</DialogTitle>
        <DialogDescription>{t('marketMove.dialogDescription')}</DialogDescription>
      </DialogHeader>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('marketMove.target')}</dt>
        <dd className="text-end font-medium"><Bdi>{market}</Bdi></dd>
        <dt className="text-muted-foreground">{t('marketMove.movable')}</dt>
        <dd className="text-end font-medium tabular-nums" data-testid="keyword-market-move-count">{number(preview.movable)}</dd>
        <dt className="text-muted-foreground">{t('marketMove.alreadyTracked')}</dt>
        <dd className="text-end tabular-nums">{number(preview.alreadyTracked)}</dd>
        <dt className="text-muted-foreground">{t('marketMove.withHistory')}</dt>
        <dd className="text-end tabular-nums">{number(preview.withHistory)}</dd>
        <dt className="text-muted-foreground">{t('marketMove.resumesHistory')}</dt>
        <dd className="text-end tabular-nums">{number(preview.resumesHistory)}</dd>
      </dl>
      <p className="text-muted-foreground text-sm">{t('marketMove.historyNote')}</p>
      <p className="text-muted-foreground text-sm">{t('marketMove.nextCheckNote')}</p>
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={moving} onClick={() => setOpen(false)}>{t('marketMove.cancel')}</Button>
        <Button type="button" loading={moving} loadingLabel={t('marketMove.moving')}
          onClick={() => void confirm()} data-testid="keyword-market-move-confirm">{t('marketMove.confirm')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
