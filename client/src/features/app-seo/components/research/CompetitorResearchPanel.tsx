import { type FormEvent, useState } from 'react';
import { Download, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { safeExternalHref } from '@shared/security';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import {
  appCompetitorResearchInputSchema,
  type AppCompetitorResearchInput,
  type AppCompetitorResearchResult,
  type AppResearchStore,
} from '../../research-types';
import { selectAppSeoResearch } from '../../store/research-selectors';
import { clearAppResearchPreview } from '../../store/research-slice';
import { previewAppResearchSpend, runAppCompetitorResearch } from '../../store/research-thunks';
import { buildResearchCsv, downloadResearchCsv } from './research-csv';
import { ResearchSpendDialog } from './ResearchSpendDialog';

const storeHref = (store: AppResearchStore, appId: string) =>
  safeExternalHref(
    store === 'google_play'
      ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`
      : `https://apps.apple.com/app/id${encodeURIComponent(appId)}`,
  );

export function CompetitorResearchPanel({
  siteId,
  profileId,
  store,
  disabled,
}: {
  siteId: string;
  profileId: string;
  store: AppResearchStore;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation('appSeoResearch');
  const dispatch = useAppDispatch();
  const research = useAppSelector(selectAppSeoResearch);
  const storedResult = research.results.competitors;
  const result =
    storedResult?.profileId === profileId && storedResult.store === store ? storedResult : null;
  const [pending, setPending] = useState<AppCompetitorResearchInput | null>(null);
  const busy = research.mutationStatus === 'loading';
  const preview = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = appCompetitorResearchInputSchema.safeParse({
      profileId,
      store,
      locationCode: 2840,
      languageCode: 'en',
    });
    if (!parsed.success) return;
    setPending(parsed.data);
    try {
      await dispatch(
        previewAppResearchSpend({ siteId, profileId, store, surface: 'competitors' }),
      ).unwrap();
    } catch {
      setPending(null);
    }
  };
  const confirm = async () => {
    try {
      await dispatch(runAppCompetitorResearch({ siteId, input: pending! })).unwrap();
      setPending(null);
    } catch {
      /* Redux owns localized error state. */
    }
  };
  const close = () => {
    setPending(null);
    dispatch(clearAppResearchPreview());
  };
  const exportRows = (current: AppCompetitorResearchResult) => {
    const csv = buildResearchCsv(
      current.rows.map(({ competitor, metrics }) => ({
        appId: competitor.appId,
        averagePosition: competitor.averagePosition ?? '',
        sharedKeywords: competitor.sharedKeywordCount,
        rankedKeywords: metrics?.metrics.rankedKeywordCount ?? '',
        firstPositions: metrics?.metrics.firstPositionCount ?? '',
      })),
      [
        { key: 'appId', header: 'app_id' },
        { key: 'averagePosition', header: 'average_position' },
        { key: 'sharedKeywords', header: 'shared_keywords' },
        { key: 'rankedKeywords', header: 'ranked_keywords' },
        { key: 'firstPositions', header: 'first_positions' },
      ],
    );
    if (!downloadResearchCsv('app-competitors.csv', csv)) toast.error(t('errors.downloadFailed'));
  };
  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertTitle>{t('gap.marketTitle')}</AlertTitle>
        <AlertDescription>{t('gap.marketNote')}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>{t('competitors.title')}</CardTitle>
          <CardDescription>{t('competitors.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex justify-end" onSubmit={(event) => void preview(event)}>
            <Button
              type="submit"
              loading={busy}
              loadingLabel={t('common.previewing')}
              disabled={disabled}
            >
              <Users aria-hidden="true" />
              {t('competitors.run')}
            </Button>
          </form>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle role="heading" aria-level={4}>{t('competitors.results')}</CardTitle>
                <CardDescription>
                  {t('common.observedAt', {
                    date: new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(result.fetchedAt)),
                  })}
                </CardDescription>
              </div>
              <Button variant="outline" onClick={() => exportRows(result)}>
                <Download aria-hidden="true" />
                {t('common.exportCsv')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {result.partial ? (
              <Alert>
                <AlertTitle>{t('competitors.partialTitle')}</AlertTitle>
                <AlertDescription>{t('competitors.partialNote')}</AlertDescription>
              </Alert>
            ) : null}
            {result.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('competitors.empty')}</p>
            ) : (
              <Table>
                <TableCaption>{t('competitors.caption')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.app')}</TableHead>
                    <TableHead>{t('columns.averagePosition')}</TableHead>
                    <TableHead>{t('columns.sharedKeywords')}</TableHead>
                    <TableHead>{t('columns.rankedKeywords')}</TableHead>
                    <TableHead>{t('columns.firstPositions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map(({ competitor, metrics }) => (
                    <TableRow key={competitor.appId}>
                      <TableCell>
                        <a
                          className="underline underline-offset-4"
                          href={storeHref(store, competitor.appId)}
                          target="_blank"
                          rel="nofollow ugc noopener noreferrer"
                        >
                          {competitor.appId}
                        </a>
                      </TableCell>
                      <TableCell>
                        {competitor.averagePosition?.toFixed(1) ?? t('common.unknown')}
                      </TableCell>
                      <TableCell>{competitor.sharedKeywordCount}</TableCell>
                      <TableCell>
                        {metrics?.metrics.rankedKeywordCount ?? t('common.unknown')}
                      </TableCell>
                      <TableCell>
                        {metrics?.metrics.firstPositionCount ?? t('common.unknown')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
      <ResearchSpendDialog
        open={pending !== null && research.preview?.surface === 'competitors'}
        loading={busy}
        onClose={close}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
