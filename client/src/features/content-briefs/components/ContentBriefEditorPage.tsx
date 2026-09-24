import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { apiErrorMessage } from '@shared/api/errorMessage';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Label } from '@shared/ui/label';
import { Skeleton } from '@shared/ui/skeleton';
import { Textarea } from '@shared/ui/textarea';
import { getContentBrief, rescoreContentBrief } from '../api';
import type { ContentBriefDetail, ContentBriefScoreVersion } from '../types';

function editorError(error: unknown, fallback: string): string {
  return apiErrorMessage(error, fallback);
}

function editorHttpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

function ScoreCard({ version }: { version: ContentBriefScoreVersion }) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Card data-testid={`content-brief-score-${version.version}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('briefs.editor.version', { version: version.version })}</CardTitle>
          <Badge variant="outline">{t('briefs.editor.deterministicScore', { score: version.comparison.deterministicScore })}</Badge>
        </div>
        <CardDescription>{t('briefs.guidance')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">{t('briefs.editor.words')}</dt><dd className="font-medium">{version.comparison.wordCount}</dd></div>
          <div><dt className="text-muted-foreground">{t('briefs.editor.headings')}</dt><dd className="font-medium">{version.comparison.headingCount}</dd></div>
          <div><dt className="text-muted-foreground">{t('briefs.editor.entities')}</dt><dd className="font-medium">{version.comparison.matchedEntities}/{version.comparison.totalEntities}</dd></div>
        </dl>
        {version.aiScore === null ? (
          <Alert>
            <AlertTitle>{t('briefs.editor.deterministicOnly')}</AlertTitle>
            <AlertDescription>{t(`briefs.editor.disclosure.${version.aiDisclosure}`)}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            <p className="font-medium">{t('briefs.editor.aiScore', { score: version.aiScore })}</p>
            <p className="text-sm text-muted-foreground">{version.aiRationale}</p>
            <div className="flex flex-wrap gap-1" aria-label={t('briefs.detail.citations')}>
              {version.aiCitations.map((citation) => <Badge key={citation} variant="outline">{citation}</Badge>)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ContentBriefEditorPage() {
  const { siteId = '', briefId = '' } = useParams<{ siteId: string; briefId: string }>();
  const { t, i18n } = useTranslation('contentIntelligence');
  const [detail, setDetail] = useState<ContentBriefDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getContentBrief(siteId, briefId, { signal: controller.signal })
      .then((value) => {
        setDetail(value);
        setDraft(value.scoreHistory.at(-1)?.draft ?? '');
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            editorHttpStatus(requestError) === 503
              ? t('briefs.states.disabled.description')
              : editorError(requestError, 'contentIntelligence:briefs.errors.load'),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [briefId, siteId, t]);

  const score = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail?.creationEnabled || !draft.trim()) return;
    setScoring(true);
    setError(null);
    try {
      const updated = await rescoreContentBrief(siteId, briefId, {
        draft,
        locale: i18n.language,
      });
      setDetail(updated);
      requestAnimationFrame(() => latestRef.current?.focus());
    } catch (requestError) {
      setError(editorError(requestError, 'contentIntelligence:briefs.errors.rescore'));
    } finally {
      setScoring(false);
    }
  };

  const backHref = `/sites/${encodeURIComponent(siteId)}?tab=content&view=briefs&brief=${encodeURIComponent(briefId)}`;
  if (loading) return <main className="mx-auto w-full max-w-6xl p-6" aria-busy="true" aria-label={t('briefs.detail.loading')}><Skeleton className="h-64 w-full" /></main>;
  if (!detail) return <main className="mx-auto w-full max-w-3xl space-y-4 p-6"><Alert variant="destructive"><AlertTitle>{t('briefs.states.failed.title')}</AlertTitle><AlertDescription>{error || t('briefs.errors.load')}</AlertDescription></Alert><Button asChild variant="outline"><Link to={backHref}>{t('briefs.actions.back')}</Link></Button></main>;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6" data-testid="content-brief-editor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" className="px-0"><Link to={backHref}>{t('briefs.actions.back')}</Link></Button>
          <h1 className="text-3xl font-semibold tracking-tight">{t('briefs.editor.title', { keyword: detail.keyword })}</h1>
          <p className="mt-2 text-muted-foreground">{t('briefs.editor.description')}</p>
        </div>
        <ReportExportControl
          kind="content.brief"
          target={{ scope: 'site_resource', siteId, resourceId: briefId }}
          selection={detail.latestDraftVersion ? { draftVersion: detail.latestDraftVersion } : {}}
        />
      </div>
      {!detail.creationEnabled ? (
        <Alert data-testid="brief-state-disabled">
          <AlertTitle>{t('briefs.states.disabled.title')}</AlertTitle>
          <AlertDescription>{t('briefs.states.disabled.description')}</AlertDescription>
        </Alert>
      ) : null}
      <form onSubmit={score} className="space-y-3">
        <Label htmlFor="content-brief-draft">{t('briefs.editor.draft')}</Label>
        <Textarea id="content-brief-draft" value={draft} maxLength={50_000} rows={18} required disabled={!detail.creationEnabled} onChange={(event) => setDraft(event.target.value)} aria-describedby="content-brief-draft-help" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="content-brief-draft-help" className="text-xs text-muted-foreground">{t('briefs.editor.characters', { count: draft.length })}</p>
          <Button type="submit" disabled={!detail.creationEnabled || scoring || !draft.trim()}>{scoring ? t('briefs.editor.scoring') : t('briefs.editor.score')}</Button>
        </div>
      </form>
      {error ? <Alert variant="destructive"><AlertTitle>{t('briefs.states.failed.title')}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <section className="space-y-3" aria-labelledby="content-brief-history-title">
        <h2 id="content-brief-history-title" className="text-2xl font-semibold">{t('briefs.editor.history')}</h2>
        {detail.scoreHistory.length ? detail.scoreHistory.slice().reverse().map((version, index) => <div key={version.version} ref={index === 0 ? latestRef : undefined} tabIndex={index === 0 ? -1 : undefined}><ScoreCard version={version} /></div>) : <p className="text-sm text-muted-foreground">{t('briefs.editor.empty')}</p>}
      </section>
    </main>
  );
}
