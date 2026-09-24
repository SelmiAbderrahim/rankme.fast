/**
 * SERP overview section — a URL-addressable section of the
 * research tab (`?tab=research`, no fifth tab value by locked decision).
 *
 * One-to-twenty phrases → server preview → confirm (`POST /overview`, one
 * keyword_lookups unit per deduped phrase). Positions/SERP features are
 * provider observations ("observed in the provider's index, not a live
 * search"); volume/difficulty/CPC are estimates. Chips are static badges —
 * one per closed-enum member including `other`.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { fetchKeywordPreview, runOverview } from '../store/thunks';
import { clearPreview } from '../store/slice';
import { selectOverview, selectPreview } from '../store/selectors';
import {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_CODE,
  OVERVIEW_PHRASE_MAX,
  difficultyBand,
  overviewFormSchema,
} from '../validation';
import { KeywordSpendPreviewCard } from './KeywordSpendPreviewCard';
import { IntentBadge, keywordSlug } from './KeywordResearchPanel';
import { MarketSelects } from './MarketSelects';
import { PhraseChipsInput } from './PhraseChipsInput';
import { ProvenanceBadge } from './ProvenanceBadge';
import { SerpFeatureChips } from './SerpFeatureChips';
import type { OverviewRequestBody } from '../api';
import type { KeywordOverviewRow } from '../types';

const OverviewRow = ({ row }: { row: KeywordOverviewRow }) => {
  const { t, i18n } = useTranslation();
  const slug = keywordSlug(row.keyword);
  const format = (v: number | null): string =>
    v === null ? t('keywordResearch:unavailable') : new Intl.NumberFormat(i18n.language).format(v);
  const formatDate = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <TableRow data-testid={`kw-overview-row-${slug}`}>
      <TableCell className="max-w-56 truncate" title={row.keyword}>
        {row.keyword}
      </TableCell>
      <TableCell className="text-end tabular-nums">{format(row.searchVolume)}</TableCell>
      <TableCell>
        {row.difficulty === null
          ? t('keywordResearch:unavailable')
          : t(`keywordResearch:difficulty.${difficultyBand(row.difficulty)}`)}
      </TableCell>
      <TableCell className="text-end tabular-nums">
        {row.cpc ?? t('keywordResearch:unavailable')}
      </TableCell>
      <TableCell>
        <IntentBadge intent={row.intent} />
      </TableCell>
      <TableCell>
        <SerpFeatureChips features={row.serpFeatures} />
      </TableCell>
      <TableCell className="text-end tabular-nums">{format(row.resultsCount)}</TableCell>
      <TableCell
        className="text-muted-foreground text-xs"
        data-testid={`kw-overview-observed-${slug}`}
      >
        {row.observedAt
          ? t('keywordResearch:overview.observedOn', {
              date: formatDate(row.observedAt),
            })
          : t('keywordResearch:unavailable')}
      </TableCell>
    </TableRow>
  );
};

export const OverviewSection = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const preview = useAppSelector(selectPreview);
  const overview = useAppSelector(selectOverview);

  const [chips, setChips] = useState<string[]>([]);
  const [locationCode, setLocationCode] = useState(DEFAULT_LOCATION_CODE);
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE_CODE);
  const [formError, setFormError] = useState('');
  const [pendingBody, setPendingBody] = useState<OverviewRequestBody | null>(null);

  const requestPreview = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = overviewFormSchema.safeParse({
      keywords: chips,
      locationCode,
      languageCode,
    });
    if (!parsed.success) {
      setFormError(t(parsed.error.issues[0]?.message ?? ''));
      return;
    }
    setFormError('');
    setPendingBody(parsed.data);
    void dispatch(fetchKeywordPreview({ operation: 'overview', ...parsed.data }));
  };

  const previewOpen =
    preview.forOperation === 'overview' && (preview.loading || preview.data !== null);

  return (
    <section
      id="overview"
      className="flex flex-col gap-5"
      aria-labelledby="kw-overview-heading"
      data-testid="kw-overview-section"
    >
      <Card>
        <CardHeader>
          <CardTitle id="kw-overview-heading">{t('keywordResearch:overview.title')}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {t('keywordResearch:overview.description')}
          </p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={requestPreview}
            className="flex flex-col gap-4"
            data-testid="kw-overview-form"
          >
            <PhraseChipsInput
              id="kw-overview-keywords"
              label={t('keywordResearch:inputLabel')}
              placeholder={t('keywordResearch:inputPlaceholder')}
              chips={chips}
              onChange={setChips}
              max={OVERVIEW_PHRASE_MAX}
              testIdPrefix="kw-overview"
            />
            <MarketSelects
              locationCode={locationCode}
              languageCode={languageCode}
              onLocationChange={setLocationCode}
              onLanguageChange={setLanguageCode}
              testIdPrefix="kw-overview"
            />
            {formError ? (
              <p
                role="alert"
                className="text-destructive text-sm"
                data-testid="kw-overview-form-error"
              >
                {formError}
              </p>
            ) : null}
            <div>
              <Button
                type="submit"
                loading={preview.loading && preview.forOperation === 'overview'}
                loadingLabel={t('keywordResearch:preview.loading')}
                data-testid="kw-overview-preview-cta"
              >
                {t('keywordResearch:preview.cta')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {preview.error && preview.forOperation === 'overview' ? (
        <Alert variant="destructive" role="alert" data-testid="kw-overview-preview-error">
          <AlertDescription>{preview.error}</AlertDescription>
        </Alert>
      ) : null}

      {previewOpen ? (
        <div className="flex flex-col gap-3">
          <KeywordSpendPreviewCard preview={preview.data} loading={preview.loading} />
          {preview.data ? (
            <div className="flex gap-2">
              <Button
                onClick={() => pendingBody && void dispatch(runOverview(pendingBody))}
                loading={overview.loading}
                loadingLabel={t('keywordResearch:overview.submitting')}
                data-testid="kw-overview-confirm"
              >
                {t('keywordResearch:preview.confirm')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPendingBody(null);
                  dispatch(clearPreview());
                }}
                disabled={overview.loading}
                data-testid="kw-overview-cancel"
              >
                {t('keywordResearch:preview.cancel')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {overview.error ? (
        <Alert variant="destructive" role="alert" data-testid="kw-overview-error">
          <AlertDescription>{overview.error}</AlertDescription>
        </Alert>
      ) : null}

      {overview.loading && overview.rows.length === 0 ? (
        <div aria-busy="true" aria-live="polite" data-testid="kw-overview-loading">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {overview.rows.length > 0 ? (
        <Card data-testid="kw-overview-results">
          <CardHeader className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <ProvenanceBadge meta={overview.rows[0]!.meta} withTimestamps />
            </div>
            <p className="text-muted-foreground text-xs" data-testid="kw-overview-index-note">
              {t('keywordResearch:overview.indexFreshness')}
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table data-testid="kw-overview-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('keywordResearch:overview.columnKeyword')}</TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('keywordResearch:overview.columnVolume')}
                      description={t('common:tableHelp.searchVolume')}
                    />
                  </TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('keywordResearch:overview.columnDifficulty')}
                      description={t('common:tableHelp.keywordDifficulty')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('keywordResearch:overview.columnCpc')}
                      description={t('common:tableHelp.cpc')}
                    />
                  </TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('keywordResearch:overview.columnIntent')}
                      description={t('common:tableHelp.intent')}
                    />
                  </TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('keywordResearch:overview.columnSerpFeatures')}
                      description={t('common:tableHelp.serpFeatures')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('keywordResearch:overview.columnResultsCount')}
                      description={t('common:tableHelp.results')}
                    />
                  </TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('keywordResearch:overview.columnObserved')}
                      description={t('common:tableHelp.observed')}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.rows.map((row) => (
                  <OverviewRow key={row.keyword} row={row} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : overview.loaded && !overview.loading && !overview.error ? (
        <p className="text-muted-foreground text-sm" data-testid="kw-overview-empty">
          {t('keywordResearch:overview.empty')}
        </p>
      ) : null}
    </section>
  );
};
