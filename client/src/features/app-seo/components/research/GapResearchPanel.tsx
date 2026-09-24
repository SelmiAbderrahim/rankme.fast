import { type FormEvent, useState } from 'react';
import { Download, GitCompareArrows } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Textarea } from '@shared/ui/textarea';
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
  appGapResearchInputSchema,
  type AppGapResearchInput,
  type AppGapResearchResult,
  type AppResearchStore,
} from '../../research-types';
import { selectAppSeoResearch } from '../../store/research-selectors';
import { clearAppResearchPreview } from '../../store/research-slice';
import { previewAppResearchSpend, runAppGapResearch } from '../../store/research-thunks';
import { buildResearchCsv, downloadResearchCsv } from './research-csv';
import { ResearchSpendDialog } from './ResearchSpendDialog';

export function GapResearchPanel({
  siteId,
  profileId,
  store,
  ownAppId,
  disabled,
}: {
  siteId: string;
  profileId: string;
  store: AppResearchStore;
  ownAppId: string;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation('appSeoResearch');
  const dispatch = useAppDispatch();
  const research = useAppSelector(selectAppSeoResearch);
  const storedResult = research.results.gap;
  const result =
    storedResult?.profileId === profileId && storedResult.store === store ? storedResult : null;
  const [competitorIds, setCompetitorIds] = useState('');
  const [validationError, setValidationError] = useState('');
  const [pending, setPending] = useState<AppGapResearchInput | null>(null);
  const busy = research.mutationStatus === 'loading';

  const preview = async (event: FormEvent) => {
    event.preventDefault();
    const entered = competitorIds
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean);
    const parsed = appGapResearchInputSchema.safeParse({
      profileId,
      store,
      locationCode: 2840,
      languageCode: 'en',
      appIds: [ownAppId, ...entered],
    });
    if (!parsed.success) {
      setValidationError(t('gap.invalidIds'));
      return;
    }
    setValidationError('');
    setPending(parsed.data);
    try {
      await dispatch(
        previewAppResearchSpend({
          siteId,
          profileId,
          store,
          surface: 'gap',
          appIds: parsed.data.appIds,
        }),
      ).unwrap();
    } catch {
      setPending(null);
    }
  };
  const confirm = async () => {
    try {
      await dispatch(runAppGapResearch({ siteId, input: pending! })).unwrap();
      setPending(null);
    } catch {
      /* Redux owns localized error state. */
    }
  };
  const close = () => {
    setPending(null);
    dispatch(clearAppResearchPreview());
  };
  const exportRows = (current: AppGapResearchResult) => {
    const columns = [
      { key: 'keyword', header: 'keyword' },
      ...current.appIds.map((appId, index) => ({ key: `app${index}`, header: `${appId}_rank` })),
      { key: 'updatedAt', header: 'updated_at' },
    ];
    const csv = buildResearchCsv(
      current.rows.map((row) => ({
        keyword: row.keyword,
        ...Object.fromEntries(
          current.appIds.map((appId, index) => [
            `app${index}`,
            row.ranksByAppId[appId]?.rank ?? '',
          ]),
        ),
        updatedAt: row.lastUpdatedAt ?? '',
      })),
      columns,
    );
    if (!downloadResearchCsv('app-keyword-gap.csv', csv)) toast.error(t('errors.downloadFailed'));
  };

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertTitle>{t('gap.marketTitle')}</AlertTitle>
        <AlertDescription>{t('gap.marketNote')}</AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>{t('gap.title')}</CardTitle>
          <CardDescription>{t('gap.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void preview(event)}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="app-gap-location">{t('gap.location')}</Label>
              <Input id="app-gap-location" value={t('gap.unitedStates')} disabled />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="app-gap-language">{t('gap.language')}</Label>
              <Input id="app-gap-language" value={t('gap.english')} disabled />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="app-gap-ids">{t('gap.competitorIds')}</Label>
              <Textarea
                id="app-gap-ids"
                value={competitorIds}
                onChange={(event) => setCompetitorIds(event.target.value)}
                placeholder={t('gap.placeholder')}
                rows={4}
                required
                aria-describedby="app-gap-help"
              />
              <p id="app-gap-help" className="text-muted-foreground text-sm">
                {t('gap.idHelp', { ownAppId })}
              </p>
              {validationError ? (
                <p role="alert" className="text-destructive text-sm">
                  {validationError}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end md:col-span-2">
              <Button
                type="submit"
                loading={busy}
                loadingLabel={t('common.previewing')}
                disabled={disabled}
              >
                <GitCompareArrows aria-hidden="true" />
                {t('gap.run')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle role="heading" aria-level={4}>{t('gap.results')}</CardTitle>
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
          <CardContent>
            {result.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('gap.empty')}</p>
            ) : (
              <Table>
                <TableCaption>{t('gap.caption')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.keyword')}</TableHead>
                    {result.appIds.map((appId) => (
                      <TableHead key={appId}>{appId}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={row.keyword}>
                      <TableCell className="font-medium">{row.keyword}</TableCell>
                      {result.appIds.map((appId) => (
                        <TableCell key={appId}>
                          {row.ranksByAppId[appId]?.rank ?? t('common.notRanked')}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
      <ResearchSpendDialog
        open={pending !== null && research.preview?.surface === 'gap'}
        loading={busy}
        onClose={close}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
