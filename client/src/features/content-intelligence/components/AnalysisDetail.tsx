import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { StatusChip } from '@shared/ui/status-chip';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { Textarea } from '@shared/ui/textarea';
import { Progress } from '@shared/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import { safeExternalHref } from '@shared/security';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import type {
  AnalysisBriefSection,
  AnalysisBriefVersion,
  AnalysisDraftVersion,
} from '../types';
import { saveBriefVersion, saveDraftVersion } from '../api';
import {
  isContentAnalysisCancellable,
  isContentAnalysisTerminal,
} from '../types';
import {
  cancelAnalysisThunk,
  loadAnalysis,
  regenerateAnalysisThunk,
} from '../store/thunks';
import {
  selectAnalysisById,
  selectCancelling,
  selectDetailError,
  selectDetailLoading,
  selectRegenerating,
} from '../store/selectors';
import { RecommendationWorkflow } from './RecommendationWorkflow';
import { AnalysisProgress } from './AnalysisProgress';
import { analysisStatusTone } from './status';

const POLL_INTERVAL_MS = 4000;

function DataRouterUnsavedGuard({ when }: { when: boolean }) {
  const { t } = useTranslation('contentIntelligence');
  const blocker = useBlocker(when);
  if (blocker.state !== 'blocked') return null;
  return (
    <AlertDialog
      open
      onOpenChange={() => blocker.reset()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirm.discard.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('confirm.discard.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('confirm.discard.back')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => blocker.proceed()}
          >
            {t('confirm.discard.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** MemoryRouter-based component harnesses have no data-router blocker API. */
function UnsavedChangesGuard({ when }: { when: boolean }) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  return dataRouter ? <DataRouterUnsavedGuard when={when} /> : null;
}

interface AnalysisDetailProps {
  siteId: string;
  analysisId: string;
  onBack: () => void;
  /** Switch the workspace to a freshly regenerated run (updates `?analysis=`). */
  onRegenerated: (newAnalysisId: string) => void;
}

export function AnalysisDetail({
  siteId,
  analysisId,
  onBack,
  onRegenerated,
}: AnalysisDetailProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const analysis = useAppSelector(selectAnalysisById(siteId, analysisId));
  const loading = useAppSelector(selectDetailLoading(siteId, analysisId));
  const error = useAppSelector(selectDetailError(siteId, analysisId));
  const cancelling = useAppSelector(selectCancelling(analysisId));
  const regenerating = useAppSelector(selectRegenerating(analysisId));

  const [draftValue, setDraftValue] = useState<string>('');
  const [dirty, setDirty] = useState<boolean>(false);
  const [savedNote, setSavedNote] = useState<boolean>(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedVersions, setSavedVersions] = useState<AnalysisDraftVersion[]>([]);
  const [briefSections, setBriefSections] = useState<AnalysisBriefSection[]>([]);
  const [briefDirty, setBriefDirty] = useState(false);
  const [savingBrief, setSavingBrief] = useState(false);
  const [briefSaveError, setBriefSaveError] = useState(false);
  const [briefSavedNote, setBriefSavedNote] = useState(false);
  const [briefVersions, setBriefVersions] = useState<AnalysisBriefVersion[]>([]);
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'success' | 'error'>('idle');
  const savedNoteTimer = useRef<number | null>(null);
  const savingDraftRef = useRef(false);
  const savingBriefRef = useRef(false);
  const analysisStatus = analysis?.status;

  // Load once and poll while not terminal.
  useEffect(() => {
    const promise = dispatch(loadAnalysis({ siteId, analysisId }));
    return () => promise.abort();
  }, [analysisId, dispatch, siteId]);

  // Bounded poll while non-terminal: schedule the next fetch only while the
  // tab is visible, and re-fetch immediately when the tab returns to view —
  // matching the app's other pollers (RunStatusCard) so a backgrounded tab
  // stops hammering the `content_intelligence_poll` bucket.
  useEffect(() => {
    if (!analysisStatus || isContentAnalysisTerminal(analysisStatus)) return undefined;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let activeRequest: { abort: () => void } | null = null;
    const poll = () => {
      const request = dispatch(loadAnalysis({ siteId, analysisId }));
      activeRequest = request;
      void request.finally(() => {
        activeRequest = null;
        schedule();
      });
    };
    const schedule = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      timer = setTimeout(() => {
        timer = null;
        poll();
      }, POLL_INTERVAL_MS);
    };
    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        timer === null &&
        activeRequest === null
      ) {
        poll();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      activeRequest?.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [analysisStatus, analysisId, dispatch, siteId]);

  useEffect(() => () => {
    if (savedNoteTimer.current !== null) window.clearTimeout(savedNoteTimer.current);
  }, []);

  useEffect(() => {
    if (analysis?.draft?.markdown && !dirty) {
      setDraftValue(analysis.draft.markdown);
    }
  }, [analysis?.draft?.markdown, dirty]);

  useEffect(() => {
    setSavedVersions(analysis?.draftVersions ?? []);
  }, [analysis?.draftVersions]);

  useEffect(() => {
    if (analysis?.brief?.sections && !briefDirty) {
      setBriefSections(
        analysis.brief.sections.map((section) => ({
          heading: section.heading,
          body: section.body,
        })),
      );
    }
  }, [analysis?.brief?.sections, briefDirty]);

  useEffect(() => {
    setBriefVersions(analysis?.briefVersions ?? []);
  }, [analysis?.briefVersions]);

  useEffect(() => {
    if (!dirty && !briefDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [briefDirty, dirty]);

  const onSave = useCallback(async () => {
    if (savingDraftRef.current) return;
    savingDraftRef.current = true;
    setSavingDraft(true);
    setSaveError(false);
    try {
      const clientKey = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const response = await saveDraftVersion(analysisId, draftValue, clientKey);
      setSavedVersions((versions) => [
        ...versions.filter((version) => version.versionId !== response.version.versionId),
        response.version,
      ]);
      setDirty(false);
      setSavedNote(true);
      if (savedNoteTimer.current !== null) window.clearTimeout(savedNoteTimer.current);
      savedNoteTimer.current = window.setTimeout(() => {
        savedNoteTimer.current = null;
        setSavedNote(false);
      }, 2500);
    } catch {
      setSaveError(true);
    } finally {
      savingDraftRef.current = false;
      setSavingDraft(false);
    }
  }, [analysisId, draftValue]);

  const onSaveBrief = useCallback(async () => {
    if (savingBriefRef.current) return;
    savingBriefRef.current = true;
    setSavingBrief(true);
    setBriefSaveError(false);
    setBriefSavedNote(false);
    try {
      const clientKey = `brief-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const response = await saveBriefVersion(analysisId, briefSections, clientKey);
      setBriefVersions((versions) => [
        ...versions.filter((version) => version.versionId !== response.version.versionId),
        response.version,
      ]);
      setBriefSections(response.version.sections);
      setBriefDirty(false);
      setBriefSavedNote(true);
    } catch {
      setBriefSaveError(true);
    } finally {
      savingBriefRef.current = false;
      setSavingBrief(false);
    }
  }, [analysisId, briefSections]);

  const onCopy = useCallback(async () => {
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(draftValue);
      setCopyState('success');
    } catch {
      setCopyState('error');
    }
  }, [draftValue]);

  const onCancel = useCallback(() => {
    void dispatch(cancelAnalysisThunk({ analysisId }));
  }, [analysisId, dispatch]);

  // Regenerate mints a NEW analysis id (a fresh paid run). Switch the
  // workspace to it so the URL's `?analysis=` follows the new run — that both
  // surfaces live progress and survives a page refresh. Mirrors the
  // new-analysis submit path (NewAnalysisForm → onSubmitted → onOpen).
  const onRegenerate = useCallback(async () => {
    const result = await dispatch(regenerateAnalysisThunk({ analysisId }));
    if (regenerateAnalysisThunk.fulfilled.match(result)) {
      onRegenerated(result.payload.analysisId);
    }
  }, [analysisId, dispatch, onRegenerated]);

  const onRecommendationChanged = useCallback(() => {
    void dispatch(loadAnalysis({ siteId, analysisId }));
  }, [analysisId, dispatch, siteId]);

  const onRetryLoad = useCallback(() => {
    void dispatch(loadAnalysis({ siteId, analysisId }));
  }, [analysisId, dispatch, siteId]);

  const onDiscardAndBack = useCallback(() => {
    setDirty(false);
    setBriefDirty(false);
    window.setTimeout(onBack, 0);
  }, [onBack]);

  const wordCount = useMemo(() => {
    const trimmed = draftValue.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }, [draftValue]);
  const briefIsValid = briefSections.length > 0 && briefSections.every(
    (section) => section.heading.trim().length > 0 && section.body.trim().length > 0,
  );
  const hasUnsavedChanges = dirty || briefDirty;

  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );

  if (loading && !analysis) {
    return (
      <Card aria-busy="true" data-testid="content-detail-loading">
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-64" />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error && !analysis) {
    return (
      <Alert variant="destructive" data-testid="content-detail-error">
        <AlertTitle>{t('errors.loadOneFailed')}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <div className="mt-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRetryLoad}>{t('errors.retry')}</Button>
            <Button size="sm" variant="outline" onClick={onBack}>{t('detail.back')}</Button>
          </div>
        </div>
      </Alert>
    );
  }

  if (!analysis) {
    return null;
  }

  const scorecard = analysis.scorecard;
  const brief = analysis.brief;
  const draft = analysis.draft;
  const isPartial = analysis.status === 'partial';
  const scorecardV2 = analysis.scorecardV2;
  const overallConfidence = scorecardV2
    ? scorecardV2.sections.reduce(
        (sum, section) => sum + section.confidence * section.weight,
        0,
      ) / 100
    : null;
  const warningLabels = analysis.warnings.map((warning) => warning.message);
  const ownedSourceUrl = analysis.owned?.url ?? analysis.ownedUrl;
  const comparisonSources = analysis.citations
    .filter((citation) => citation.url !== ownedSourceUrl)
    .filter(
      (citation, index, all) => all.findIndex((item) => item.url === citation.url) === index,
    )
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-4" data-testid="content-detail">
      <UnsavedChangesGuard when={hasUnsavedChanges} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hasUnsavedChanges ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="content-detail-back">
                {t('detail.back')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('confirm.discard.title')}</AlertDialogTitle>
                <AlertDialogDescription>{t('confirm.discard.description')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('confirm.discard.back')}</AlertDialogCancel>
                <AlertDialogAction onClick={onDiscardAndBack}>{t('confirm.discard.confirm')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button variant="outline" size="sm" onClick={onBack} data-testid="content-detail-back">
            {t('detail.back')}
          </Button>
        )}
        <ReportExportControl
          kind="content.analysis"
          target={{ scope: 'site_resource', siteId, resourceId: analysisId }}
          selection={{}}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{analysis.keyword}</CardTitle>
          <CardDescription>{analysis.ownedUrl}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="text-muted-foreground">{t('detail.meta.locale')}: </span>
              {analysis.locale}
            </div>
            <div>
              <span className="text-muted-foreground">{t('detail.meta.requested')}: </span>
              {analysis.requestedAt ? dateTime.format(new Date(analysis.requestedAt)) : t('list.notAvailable')}
            </div>
            {analysis.completedAt ? (
              <div>
                <span className="text-muted-foreground">{t('detail.meta.completed')}: </span>
                {dateTime.format(new Date(analysis.completedAt))}
              </div>
            ) : null}
            <div>
              <StatusChip tone={analysisStatusTone(analysis.status)} aria-live="polite">
                {t(`status.${analysis.status}`)}
              </StatusChip>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">{t('detail.explanation')}</p>
        </CardContent>
      </Card>

      {!isContentAnalysisTerminal(analysis.status) ? (
        <AnalysisProgress analysis={analysis} />
      ) : null}

      {analysis.error ? (
        <Alert variant="destructive" data-testid="content-detail-failed">
          <AlertTitle>{t('detail.progress.errorTitle')}</AlertTitle>
          <AlertDescription>
            {t(`detail.errorCategory.${analysis.error.category}`, {
              defaultValue: t('detail.progress.errorGeneric'),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {isPartial ? (
        <Alert data-testid="content-detail-partial">
          <AlertTitle>{t('partial.title')}</AlertTitle>
          <AlertDescription>
            <p>{t('partial.description')}</p>
            {warningLabels.length > 0 ? (
              <ul className="mt-2 flex list-disc flex-col gap-1 ps-5">
                {warningLabels.map((label, index) => <li key={`${label}-${index}`}>{label}</li>)}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {scorecardV2 || scorecard ? (
        <Card data-testid="content-detail-scorecard">
          <CardHeader>
            <CardTitle>{t('detail.score.title')}</CardTitle>
            <CardDescription>{t('detail.explanation')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {scorecardV2 ? (
              <>
                <div className="flex flex-wrap gap-6">
                  <p><span className="text-muted-foreground">{t('detail.score.overall')}: </span>{Math.round(scorecardV2.total)}</p>
                  <p><span className="text-muted-foreground">{t('detail.score.confidence')}: </span>{new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(overallConfidence!)}</p>
                </div>
                <figure className="flex flex-col gap-3" aria-labelledby="content-score-chart-title">
                  <figcaption id="content-score-chart-title" className="font-medium">
                    {t('detail.score.breakdown')}
                  </figcaption>
                  {scorecardV2.sections.map((section) => (
                    <div key={section.key} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span>{t(`detail.sections.${section.key}`)}</span>
                        <span>{Math.round(section.score)}</span>
                      </div>
                      <Progress value={section.score} aria-label={t('detail.score.sectionProgress', { section: t(`detail.sections.${section.key}`), score: Math.round(section.score) })} />
                    </div>
                  ))}
                </figure>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('detail.score.section')}</TableHead>
                      <TableHead className="text-end">{t('list.columns.score')}</TableHead>
                      <TableHead className="text-end">{t('detail.score.weight')}</TableHead>
                      <TableHead className="text-end">{t('detail.score.confidence')}</TableHead>
                      <TableHead>{t('detail.score.reason')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scorecardV2.sections.map((section) => {
                      return (
                        <TableRow key={section.key}>
                          <TableCell>{t(`detail.sections.${section.key}`)}</TableCell>
                          <TableCell className="text-end">{Math.round(section.score)}</TableCell>
                          <TableCell className="text-end">{section.weight}%</TableCell>
                          <TableCell className="text-end">{new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(section.confidence)}</TableCell>
                          <TableCell className="whitespace-normal">{section.reasonText}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            ) : (
              <Table>
                <TableBody>
                <tr>
                  <th scope="row" className="text-start font-medium">
                    {t('detail.sections.readability')}
                  </th>
                  <td className="text-end">{scorecard!.readabilityScore}</td>
                </tr>
                <tr>
                  <th scope="row" className="text-start font-medium">
                    {t('detail.sections.coverage')}
                  </th>
                  <td className="text-end">{scorecard!.coverageScore}</td>
                </tr>
                <tr>
                  <th scope="row" className="text-start font-medium">
                    {t('detail.sections.structure')}
                  </th>
                  <td className="text-end">{scorecard!.structureScore}</td>
                </tr>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {analysis.warnings.length > 0 ? (
        <Card data-testid="content-detail-warnings">
          <CardHeader>
            <CardTitle>{t('detail.warnings.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
              {analysis.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <RecommendationWorkflow
        analysis={analysis}
        onChanged={onRecommendationChanged}
      />

      <Card data-testid="content-detail-brief">
        <CardHeader>
          <CardTitle>{t('detail.brief.title')}</CardTitle>
          <CardDescription>{t('detail.brief.editHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {brief && brief.sections.length > 0 ? (
            <div className="flex flex-col gap-4">
              <FieldGroup>
                {briefSections.map((section, index) => (
                  <Field key={`${brief.versionId}-${index}`}>
                    <FieldLabel htmlFor={`brief-heading-${index}`}>
                      {t('detail.brief.sectionHeading', { count: index + 1 })}
                    </FieldLabel>
                    <Input
                      id={`brief-heading-${index}`}
                      value={section.heading}
                      maxLength={300}
                      onChange={(event) => {
                        const heading = event.target.value;
                        setBriefSections((sections) => sections.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, heading } : item,
                        ));
                        setBriefDirty(true);
                        setBriefSavedNote(false);
                      }}
                    />
                    <FieldLabel htmlFor={`brief-body-${index}`}>
                      {t('detail.brief.sectionBody')}
                    </FieldLabel>
                    <Textarea
                      id={`brief-body-${index}`}
                      value={section.body}
                      maxLength={20_000}
                      rows={5}
                      onChange={(event) => {
                        const body = event.target.value;
                        setBriefSections((sections) => sections.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, body } : item,
                        ));
                        setBriefDirty(true);
                        setBriefSavedNote(false);
                      }}
                    />
                  </Field>
                ))}
                <Field>
                  <FieldDescription>
                    {briefDirty ? t('detail.brief.unsavedGuard') : t('detail.brief.savedHint')}
                  </FieldDescription>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onSaveBrief}
                      disabled={!briefDirty || !briefIsValid || savingBrief}
                      loading={savingBrief}
                      loadingLabel={t('detail.brief.saving')}
                    >
                      {t('detail.brief.save')}
                    </Button>
                    {briefSavedNote ? (
                      <span className="text-muted-foreground text-xs" role="status">
                        {t('detail.brief.saved')}
                      </span>
                    ) : null}
                  </div>
                  {briefSaveError ? (
                    <p className="text-destructive text-sm" role="alert">
                      {t('detail.brief.saveFailed')}
                    </p>
                  ) : null}
                </Field>
              </FieldGroup>
              <section aria-labelledby="content-brief-versions-title">
                <h4 id="content-brief-versions-title" className="text-sm font-semibold">
                  {t('detail.brief.versionHistory')}
                </h4>
                {briefVersions.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('detail.brief.noVersions')}</p>
                ) : (
                  <ol className="mt-1 flex list-decimal flex-col gap-1 ps-5 text-sm">
                    {briefVersions.map((version) => (
                      <li key={version.versionId}>
                        {t('detail.brief.versionMeta', {
                          count: version.sections.length,
                          date: dateTime.format(new Date(version.savedAt)),
                        })}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t('detail.brief.empty')}</p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="content-detail-draft">
        <CardHeader>
          <CardTitle>{t('detail.draft.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {draft ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={draftValue}
                onChange={(e) => {
                  setDraftValue(e.target.value);
                  setDirty(true);
                  setCopyState('idle');
                }}
                rows={12}
                aria-label={t('detail.draft.title')}
                data-testid="content-draft-textarea"
              />
              <p className="text-muted-foreground text-xs">
                {t('detail.draft.wordCount', { count: wordCount })}
                {dirty ? ` — ${t('detail.draft.unsavedGuard')}` : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={!dirty || savingDraft}
                  loading={savingDraft}
                  loadingLabel={t('detail.draft.saving')}
                  data-testid="content-draft-save"
                >
                  {t('detail.draft.save')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCopy}
                  loading={copyState === 'copying'}
                  loadingLabel={t('detail.draft.copying')}
                >
                  {t('detail.draft.copy')}
                </Button>
                <ReportExportControl
                  kind="content.analysis"
                  target={{ scope: 'site_resource', siteId, resourceId: analysisId }}
                  selection={{ sections: ['draft'] }}
                />
                {savedNote ? (
                  <span className="text-muted-foreground text-xs" role="status">
                    {t('detail.draft.saved')}
                  </span>
                ) : null}
                {copyState === 'success' ? (
                  <span className="text-muted-foreground text-xs" role="status">
                    {t('detail.draft.copied')}
                  </span>
                ) : null}
              </div>
              {saveError ? (
                <p className="text-destructive text-sm" role="alert">
                  {t('detail.draft.saveFailed')}
                </p>
              ) : null}
              {copyState === 'error' ? (
                <div className="flex flex-wrap items-center gap-2" role="alert">
                  <p className="text-destructive text-sm">{t('detail.draft.copyFailed')}</p>
                  <Button size="sm" variant="outline" onClick={onCopy}>
                    {t('detail.draft.copyRetry')}
                  </Button>
                </div>
              ) : null}
              <section aria-labelledby="content-draft-versions-title" className="mt-2">
                <h4 id="content-draft-versions-title" className="text-sm font-semibold">
                  {t('detail.draft.versionHistory')}
                </h4>
                {savedVersions.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('detail.draft.noVersions')}</p>
                ) : (
                  <ol className="mt-1 flex list-decimal flex-col gap-1 ps-5 text-sm">
                    {savedVersions.map((version) => (
                      <li key={version.versionId}>
                        {t('detail.draft.versionMeta', {
                          count: version.wordCount,
                          date: new Intl.DateTimeFormat(i18n.language, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(version.savedAt)),
                        })}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t('detail.draft.empty')}</p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="content-detail-sources">
        <CardHeader>
          <CardTitle>{t('detail.sources.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2 ps-5 text-sm">
            {[{ sourceId: 'owned', url: ownedSourceUrl, title: t('detail.sources.owned') }, ...comparisonSources].map((c, index) => {
              const href = safeExternalHref(c.url);
              return (
                <li key={`${c.sourceId}-${c.url}`}>
                  <span className="font-medium">{index === 0 ? t('detail.sources.owned') : t('detail.sources.comparison', { count: index })}: </span>
                  {href === '#' ? (
                    <span>{c.title ?? c.url}</span>
                  ) : (
                    <a
                      href={href}
                      rel="nofollow ugc noopener noreferrer"
                      target="_blank"
                    >
                      {c.title ?? c.url}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {isContentAnalysisCancellable(analysis.status) ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={cancelling}
                data-testid="content-detail-cancel"
              >
                {t('detail.actions.cancel')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('confirm.cancel.title')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('confirm.cancel.description')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('confirm.cancel.back')}</AlertDialogCancel>
                <AlertDialogAction onClick={onCancel}>
                  {t('confirm.cancel.confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {isContentAnalysisTerminal(analysis.status) && (analysis.status !== 'failed' || analysis.error?.retryable) ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={hasUnsavedChanges || regenerating}
                loading={regenerating}
                loadingLabel={t('detail.progress.regenerating')}
                data-testid="content-detail-regenerate"
              >
                {t('detail.actions.regenerate')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('confirm.regenerate.title')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('confirm.regenerate.description')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('confirm.regenerate.back')}</AlertDialogCancel>
                <AlertDialogAction onClick={onRegenerate}>
                  {t('confirm.regenerate.confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </div>
  );
}
