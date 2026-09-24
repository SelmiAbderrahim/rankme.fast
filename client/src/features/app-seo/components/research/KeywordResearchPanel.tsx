import { type FormEvent, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Button } from '@shared/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
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
import { toast } from 'sonner';
import {
  appKeywordResearchInputSchema,
  type AppKeywordResearchInput,
  type AppKeywordResearchResult,
  type AppResearchStore,
} from '../../research-types';
import { selectAppSeoResearch } from '../../store/research-selectors';
import { clearAppResearchPreview } from '../../store/research-slice';
import { previewAppResearchSpend, runAppKeywordResearch } from '../../store/research-thunks';
import { buildResearchCsv, downloadResearchCsv } from './research-csv';
import { ResearchSpendDialog } from './ResearchSpendDialog';

export function KeywordResearchPanel({
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
  const storedResult = research.results.keywords;
  const result =
    storedResult?.profileId === profileId && storedResult.store === store ? storedResult : null;
  const [pending, setPending] = useState<AppKeywordResearchInput | null>(null);
  const busy = research.mutationStatus === 'loading';

  const requestPreview = async (event?: FormEvent, cursor = 0) => {
    event?.preventDefault();
    const parsed = appKeywordResearchInputSchema.safeParse({
      profileId,
      store,
      locationCode: 2840,
      languageCode: 'en',
      cursor,
      pageSize: 25,
    });
    if (!parsed.success) return;
    setPending(parsed.data);
    try {
      await dispatch(
        previewAppResearchSpend({ siteId, profileId, store, surface: 'keywords' }),
      ).unwrap();
    } catch {
      setPending(null);
    }
  };
  const confirm = async () => {
    try {
      await dispatch(runAppKeywordResearch({ siteId, input: pending! })).unwrap();
      setPending(null);
    } catch {
      /* Redux owns localized error state. */
    }
  };
  const close = () => {
    setPending(null);
    dispatch(clearAppResearchPreview());
  };
  const exportRows = (current: AppKeywordResearchResult) => {
    const csv = buildResearchCsv(
      current.rows.map((row) => ({
        rank: row.rank ?? '',
        keyword: row.keyword,
        appId: row.appId,
        updatedAt: row.lastUpdatedAt ?? '',
      })),
      [
        { key: 'rank', header: 'rank' },
        { key: 'keyword', header: 'keyword' },
        { key: 'appId', header: 'app_id' },
        { key: 'updatedAt', header: 'updated_at' },
      ],
    );
    if (!downloadResearchCsv('app-keywords.csv', csv)) toast.error(t('errors.downloadFailed'));
  };

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertTitle>{t('gap.marketTitle')}</AlertTitle>
        <AlertDescription>{t('gap.marketNote')}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>{t('keywords.title')}</CardTitle>
          <CardDescription>{t('keywords.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => void requestPreview(event)}
            className="flex flex-wrap items-end justify-between gap-4"
          >
            <p className="text-muted-foreground max-w-2xl text-sm">{t('keywords.limitNote')}</p>
            <Button
              type="submit"
              loading={busy}
              loadingLabel={t('common.previewing')}
              disabled={disabled}
            >
              <Search aria-hidden="true" />
              {t('keywords.run')}
            </Button>
          </form>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle role="heading" aria-level={4}>{t('keywords.results')}</CardTitle>
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
            {result.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('keywords.empty')}</p>
            ) : (
              <Table>
                <TableCaption>{t('keywords.caption')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.rank')}</TableHead>
                    <TableHead>{t('columns.keyword')}</TableHead>
                    <TableHead>{t('columns.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={`${row.keyword}-${row.rank ?? 'none'}`}>
                      <TableCell>{row.rank ?? t('common.notRanked')}</TableCell>
                      <TableCell className="font-medium">{row.keyword}</TableCell>
                      <TableCell>
                        {row.lastUpdatedAt
                          ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                              new Date(row.lastUpdatedAt),
                            )
                          : t('common.unknown')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex flex-wrap justify-between gap-3">
              <Button variant="outline" asChild>
                <Link
                  to={`/sites/${siteId}?tab=apps&view=keywords&profile=${encodeURIComponent(profileId)}`}
                >
                  {t('keywords.trackLink')}
                </Link>
              </Button>
              {result.nextCursor !== null ? (
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void requestPreview(undefined, result.nextCursor!)}
                >
                  {t('common.nextPage')}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <ResearchSpendDialog
        open={pending !== null && research.preview?.surface === 'keywords'}
        loading={busy}
        onClose={close}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
