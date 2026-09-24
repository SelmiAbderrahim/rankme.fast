import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { GenerationList } from './GenerationList';
import { GenerationResult } from './GenerationResult';
import { PagePicker } from './PagePicker';
import { SpendDisclosure } from './SpendDisclosure';
import { StateNotice } from './StateNotice';
import { TypePicker } from './TypePicker';
import {
  clearSchemaPreview,
  setSchemaPageUrl,
  setSchemaSiteId,
  setSchemaSource,
  setSchemaType,
} from '../store/slice';
import {
  createSchemaGenerationThunk,
  loadSchemaGeneration,
  loadSchemaGenerations,
  loadSchemaSources,
  loadSchemaTypes,
  previewSchemaGenerationThunk,
} from '../store/thunks';
import {
  selectSchemaDetail,
  selectSchemaDetailGate,
  selectSchemaDetailStatus,
  selectSchemaForm,
  selectSchemaGenerateGate,
  selectSchemaGenerateStatus,
  selectSchemaGenerations,
  selectSchemaListGate,
  selectSchemaListStatus,
  selectSchemaPreview,
  selectSchemaPreviewGate,
  selectSchemaPreviewStatus,
  selectSchemaSiteId,
  selectSchemaSources,
  selectSchemaSourcesGate,
  selectSchemaSourcesStatus,
  selectSchemaTypes,
  selectSchemaTypesStatus,
} from '../store/selectors';
import { useSchemaUrlState } from '../urlState';
import { isValidPastedPageUrl } from '../validation';

export interface SchemaGeneratorPanelProps {
  siteId: string;
}

/**
 * Host for the schema markup generator. Owns the URL-backed
 * `?view=` / `?generation=` / `?page=` state, the stored work lists, and the
 * preview → confirm order that keeps a paid action from being one unlabelled
 * click away.
 */
export const SchemaGeneratorPanel = ({ siteId }: SchemaGeneratorPanelProps) => {
  const { t } = useTranslation('schemaGenerator');
  const dispatch = useAppDispatch();
  const [url, setUrl] = useSchemaUrlState();

  const activeSiteId = useAppSelector(selectSchemaSiteId);
  const types = useAppSelector(selectSchemaTypes);
  const typesStatus = useAppSelector(selectSchemaTypesStatus);
  const sources = useAppSelector(selectSchemaSources);
  const sourcesStatus = useAppSelector(selectSchemaSourcesStatus);
  const sourcesGate = useAppSelector(selectSchemaSourcesGate);
  const generations = useAppSelector(selectSchemaGenerations);
  const listStatus = useAppSelector(selectSchemaListStatus);
  const listGate = useAppSelector(selectSchemaListGate);
  const detail = useAppSelector(selectSchemaDetail);
  const detailStatus = useAppSelector(selectSchemaDetailStatus);
  const detailGate = useAppSelector(selectSchemaDetailGate);
  const preview = useAppSelector(selectSchemaPreview);
  const previewStatus = useAppSelector(selectSchemaPreviewStatus);
  const previewGate = useAppSelector(selectSchemaPreviewGate);
  const generateStatus = useAppSelector(selectSchemaGenerateStatus);
  const generateGate = useAppSelector(selectSchemaGenerateGate);
  const form = useAppSelector(selectSchemaForm);

  useEffect(() => {
    dispatch(setSchemaSiteId(siteId));
  }, [dispatch, siteId]);

  useEffect(() => {
    if (typesStatus === 'idle') void dispatch(loadSchemaTypes());
  }, [dispatch, typesStatus]);

  useEffect(() => {
    if (activeSiteId !== siteId) return;
    if (sourcesStatus === 'idle') void dispatch(loadSchemaSources(siteId));
    if (listStatus === 'idle') void dispatch(loadSchemaGenerations(siteId));
  }, [activeSiteId, dispatch, listStatus, siteId, sourcesStatus]);

  // Report CTA deep link: `?page=` preselects the page. Keyed on the deep link
  // alone, so a later selection by the user is never overwritten — the effect
  // re-runs only when the link itself changes.
  useEffect(() => {
    if (!url.page) return;
    dispatch(setSchemaSource('audited-page'));
    dispatch(setSchemaPageUrl(url.page));
  }, [dispatch, url.page]);

  // One fetch per generation id. `detailStatus` deliberately stays OUT of the
  // dependency list: a refused read leaves `detail` null, so keying on the
  // status would re-dispatch the same failing request forever.
  useEffect(() => {
    if (url.view !== 'detail' || !url.generationId) return;
    if (detail?.id === url.generationId) return;
    void dispatch(loadSchemaGeneration(url.generationId));
  }, [detail?.id, dispatch, url.generationId, url.view]);

  // A free stored re-open also restores the page/type form. Returning from the
  // detail therefore lets the user switch schema type on the same page without
  // finding it again in the work list (including pasted-URL generations).
  useEffect(() => {
    if (!detail) return;
    dispatch(setSchemaSource(detail.source));
    dispatch(setSchemaPageUrl(detail.pageUrl));
    dispatch(setSchemaType(detail.schemaType));
  }, [detail, dispatch]);

  const request = {
    siteId,
    source: form.source,
    pageUrl: form.pageUrl,
    schemaType: form.schemaType,
  };

  const pageChosen =
    form.pageUrl.trim() !== '' &&
    (form.source !== 'url' || isValidPastedPageUrl(form.pageUrl));
  const typeAvailable = types.some((entry) => entry.type === form.schemaType);
  const canPreview = pageChosen && typesStatus === 'ready' && typeAvailable;

  const alreadyDeclared =
    sources?.inventoryPages.find((page) => page.url === form.pageUrl)?.schemaTypes ?? [];

  const onPreview = () => {
    void dispatch(previewSchemaGenerationThunk(request));
  };

  const onGenerate = async () => {
    const result = await dispatch(createSchemaGenerationThunk(request));
    if (createSchemaGenerationThunk.fulfilled.match(result)) {
      setUrl({ view: 'detail', generationId: result.payload.id });
    }
  };

  const onOpen = (generationId: string) => {
    setUrl({ view: 'detail', generationId });
  };

  const onBack = () => {
    dispatch(clearSchemaPreview());
    setUrl({ view: 'list', generationId: null });
  };

  return (
    <section className="flex flex-col gap-4" data-testid="schema-generator-panel">
      <header>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </header>

      {url.view === 'detail' ? (
        <div className="flex flex-col gap-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={onBack}
            data-testid="schema-back"
          >
            <ArrowLeft aria-hidden="true" data-icon="inline-start" className="rtl:rotate-180" />
            {t('result.back')}
          </Button>
          {detail ? (
            <ReportExportControl
              kind="schema.generation"
              target={{ scope: 'site_resource', siteId, resourceId: detail.id }}
              selection={{}}
            />
          ) : null}
          {detailStatus === 'loading' ? (
            <Skeleton className="h-40 w-full" data-testid="schema-detail-loading" />
          ) : null}
          {detailGate ? (
            <StateNotice kind={detailGate.kind} message={detailGate.message} />
          ) : null}
          {detail ? <GenerationResult detail={detail} /> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('new.title')}</CardTitle>
              <CardDescription>{t('new.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {sourcesStatus === 'loading' ? (
                <Skeleton className="h-24 w-full" data-testid="schema-sources-loading" />
              ) : null}
              {sourcesGate ? (
                <StateNotice kind={sourcesGate.kind} message={sourcesGate.message} />
              ) : null}
              {sourcesStatus === 'ready' && sources?.runId === null ? (
                <StateNotice kind="empty" />
              ) : null}
              <PagePicker
                source={form.source}
                pageUrl={form.pageUrl}
                sources={sources}
                onSourceChange={(next) => dispatch(setSchemaSource(next))}
                onPageUrlChange={(next) => dispatch(setSchemaPageUrl(next))}
              />
              {typesStatus === 'loading' ? (
                <Skeleton className="h-24 w-full" data-testid="schema-types-loading" />
              ) : typesStatus === 'error' ? (
                <StateNotice kind="failed" />
              ) : (
                <TypePicker
                  types={types}
                  value={form.schemaType}
                  alreadyDeclared={alreadyDeclared}
                  onChange={(next) => dispatch(setSchemaType(next))}
                />
              )}
              {preview ? <SpendDisclosure /> : null}
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onPreview}
                disabled={!canPreview}
                loading={previewStatus === 'loading'}
                loadingLabel={t('preview.show')}
                data-testid="schema-preview-button"
              >
                {t('preview.show')}
              </Button>
              {preview ? (
                <Button
                  type="button"
                  onClick={() => void onGenerate()}
                  loading={generateStatus === 'loading'}
                  loadingLabel={t('preview.confirm')}
                  data-testid="schema-generate-button"
                >
                  {t('preview.confirm')}
                </Button>
              ) : null}
            </CardFooter>
          </Card>

          {previewGate ? (
            <StateNotice kind={previewGate.kind} message={previewGate.message} />
          ) : null}
          {generateGate ? (
            <StateNotice kind={generateGate.kind} message={generateGate.message} />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t('list.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {listStatus === 'loading' ? (
                <Skeleton className="h-24 w-full" data-testid="schema-list-loading" />
              ) : null}
              {listGate ? (
                <StateNotice kind={listGate.kind} message={listGate.message} />
              ) : null}
              {listStatus === 'ready' && generations.length === 0 ? (
                <p className="text-muted-foreground text-sm" data-testid="schema-list-empty">
                  {t('list.empty')}
                </p>
              ) : null}
              {generations.length > 0 ? (
                <GenerationList generations={generations} onOpen={onOpen} />
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
};
