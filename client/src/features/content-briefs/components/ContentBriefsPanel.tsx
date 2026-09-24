import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, FilePenLine, RefreshCw } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@shared/api/client';
import { apiErrorMessage } from '@shared/api/errorMessage';
import { safeExternalHref } from '@shared/security';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { Separator } from '@shared/ui/separator';
import {
  createContentBrief,
  getContentBrief,
  listContentBriefs,
  previewContentBrief,
} from '../api';
import {
  CONTENT_BRIEF_STATUSES,
  contentBriefStatusFilter,
  isContentBriefTerminal,
  type ContentBriefDetail,
  type ContentBriefListItem,
  type ContentBriefListResponse,
  type ContentBriefPreview,
  type ContentBriefStatusFilter,
} from '../types';

const STATUS_PARAM = 'briefStatus';
const DETAIL_PARAM = 'brief';
const ABSTENTION_KEYS = new Set([
  'noSerpResults',
  'noDocuments',
  'outline',
  'questions',
  'malformedEvidence',
]);

type ErrorKind = 'disabled' | 'failed';

function errorKind(error: unknown): ErrorKind {
  if (error instanceof ApiError && error.status === 503) return 'disabled';
  return 'failed';
}

function localeDate(locale: string, value: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
}

function abstentionTranslationKey(value: string): string {
  const parts = value.split('.');
  const candidate = parts[parts.length - 1]!;
  return ABSTENTION_KEYS.has(candidate) ? candidate : 'unknown';
}

function replaceSearchValue(
  location: ReturnType<typeof useLocation>,
  navigate: ReturnType<typeof useNavigate>,
  key: string,
  value: string | null,
): void {
  const next = new URLSearchParams(location.search);
  if (value) next.set(key, value);
  else next.delete(key);
  navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
}

function CitationChips({ citations }: { citations: readonly string[] }) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <div className="flex flex-wrap gap-1" aria-label={t('briefs.detail.citations')}>
      {citations.map((citation) => (
        <Badge key={citation} variant="outline" data-testid={`brief-citation-${citation}`}>
          {citation}
        </Badge>
      ))}
    </div>
  );
}

function BriefStateAlert({ kind, message }: { kind: ErrorKind; message?: string }) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Alert variant={kind === 'failed' ? 'destructive' : 'default'} data-testid={`brief-state-${kind}`}>
      <AlertTitle>{t(`briefs.states.${kind}.title`)}</AlertTitle>
      <AlertDescription>
        <p>{message || t(`briefs.states.${kind}.description`)}</p>
      </AlertDescription>
    </Alert>
  );
}

function BriefPreviewCard() {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="content-brief-preview">
      <CardHeader>
        <CardTitle>{t('briefs.preview.title')}</CardTitle>
        <CardDescription>{t('common:capacity.selfHost')}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function NewBriefForm({
  siteId,
  disabled,
  onCreated,
}: {
  siteId: string;
  disabled: boolean;
  onCreated: (briefId: string) => void;
}) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const [keyword, setKeyword] = useState('');
  const [preview, setPreview] = useState<ContentBriefPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<{ kind: ErrorKind; message: string } | null>(null);
  const keywordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const clientKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    if (preview) confirmRef.current?.focus();
  }, [preview]);

  const requestPreview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    const normalized = keyword.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (!normalized) return;
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await previewContentBrief(siteId, { keyword: normalized, locale: i18n.language }));
    } catch (requestError) {
      setError({
        kind: errorKind(requestError),
        message: apiErrorMessage(requestError, 'contentIntelligence:briefs.errors.preview'),
      });
    } finally {
      setPreviewing(false);
    }
  };

  const confirm = async () => {
    if (disabled) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createContentBrief(siteId, {
        keyword: keyword.normalize('NFKC').replace(/\s+/gu, ' ').trim(),
        locale: i18n.language,
        clientKey: clientKeyRef.current,
      });
      onCreated(result.briefId);
    } catch (requestError) {
      setError({
        kind: errorKind(requestError),
        message: apiErrorMessage(requestError, 'contentIntelligence:briefs.errors.create'),
      });
    } finally {
      setCreating(false);
    }
  };

  const cancel = () => {
    setPreview(null);
    setError(null);
    clientKeyRef.current = crypto.randomUUID();
    requestAnimationFrame(() => keywordRef.current?.focus());
  };

  return (
    <Card data-testid="content-brief-new">
      <CardHeader>
        <CardTitle>{t('briefs.form.title')}</CardTitle>
        <CardDescription>{t('briefs.form.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={requestPreview}>
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="content-brief-keyword">{t('briefs.form.keyword')}</Label>
            <Input
              ref={keywordRef}
              id="content-brief-keyword"
              value={keyword}
              maxLength={200}
              required
              disabled={disabled || Boolean(preview) || previewing || creating}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('briefs.form.placeholder')}
            />
          </div>
          <Button type="submit" disabled={disabled || Boolean(preview) || previewing || creating || !keyword.trim()}>
            {previewing ? t('briefs.form.previewing') : t('briefs.form.preview')}
          </Button>
        </form>
        {preview ? <BriefPreviewCard /> : null}
        {error ? <BriefStateAlert kind={error.kind} message={error.message} /> : null}
      </CardContent>
      {preview ? (
        <CardFooter className="flex flex-wrap gap-2">
          <Button ref={confirmRef} type="button" onClick={() => void confirm()} disabled={disabled} loading={creating} loadingLabel={t('briefs.form.creating')}>
            {t('briefs.form.confirm')}
          </Button>
          <Button type="button" variant="outline" onClick={cancel} disabled={disabled || creating}>
            {t('briefs.form.cancel')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function BriefStatusBadge({ status }: { status: ContentBriefListItem['status'] }) {
  const { t } = useTranslation('contentIntelligence');
  const variant = status === 'failed' ? 'destructive' : status === 'completed' ? 'default' : 'secondary';
  return <Badge variant={variant}>{t(`briefs.status.${status}`)}</Badge>;
}

function BriefList({
  page,
  loading,
  error,
  status,
  onStatus,
  onOpen,
  onMore,
  onRetry,
}: {
  page: ContentBriefListResponse | null;
  loading: boolean;
  error: ErrorKind | null;
  status: ContentBriefStatusFilter;
  onStatus: (status: ContentBriefStatusFilter) => void;
  onOpen: (id: string) => void;
  onMore: () => void;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="content-brief-list">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{t('briefs.list.title')}</CardTitle>
          <CardDescription>{t('briefs.list.description')}</CardDescription>
        </div>
        <div className="w-full space-y-2 sm:w-48">
          <Label htmlFor="brief-status-filter">{t('briefs.list.filter')}</Label>
          <Select value={status} onValueChange={(value) => onStatus(contentBriefStatusFilter(value))}>
            <SelectTrigger id="brief-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('briefs.list.all')}</SelectItem>
              {CONTENT_BRIEF_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>{t(`briefs.status.${value}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !page ? (
          <div className="space-y-2" aria-busy="true" aria-label={t('briefs.list.loading')}>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <BriefStateAlert kind={error} />
            {error === 'failed' ? <Button variant="outline" onClick={onRetry}>{t('briefs.actions.retry')}</Button> : null}
          </div>
        ) : page?.items.length ? (
          <ul className="divide-y" aria-label={t('briefs.list.title')}>
            {page.items.map((brief) => (
              <li key={brief.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid={`content-brief-row-${brief.id}`}>
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-medium">{brief.keyword}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('briefs.list.meta', {
                      date: localeDate(i18n.language, brief.requestedAt),
                      count: brief.retainedDocumentCount,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <BriefStatusBadge status={brief.status} />
                  <Button size="sm" variant="outline" onClick={() => onOpen(brief.id)}>
                    {t('briefs.actions.open')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('briefs.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('briefs.empty.description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
      {page?.nextCursor ? (
        <CardFooter>
          <Button variant="outline" onClick={onMore} disabled={loading}>
            {loading ? t('briefs.list.loading') : t('briefs.actions.more')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function HaltAlert({ detail }: { detail: ContentBriefDetail }) {
  const { t } = useTranslation('contentIntelligence');
  if (!detail.halt) return null;
  return (
    <Alert data-testid={`content-brief-halt-${detail.halt.stage}`}>
      <AlertTitle>{t('briefs.halt.title')}</AlertTitle>
      <AlertDescription>
        {t('briefs.halt.message', {
          stage: t(`briefs.halt.stage.${detail.halt.stage}`),
          reason: t(`briefs.halt.reason.${detail.halt.reason}`),
        })}
      </AlertDescription>
    </Alert>
  );
}

function CorpusCard({ detail }: { detail: ContentBriefDetail }) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const stats = detail.corpusStats;
  if (!stats) return null;
  const dates = stats.scrapeDates.map((date) => localeDate(i18n.language, date)).join(', ');
  return (
    <Card data-testid="content-brief-corpus">
      <CardHeader>
        <CardTitle>{t('briefs.corpus.title')}</CardTitle>
        <CardDescription>
          <CalendarDays className="me-1 inline size-4" aria-hidden="true" />
          {t('briefs.corpus.scrapeDates', { dates: dates || t('briefs.corpus.noDates') })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div><dt className="text-sm text-muted-foreground">{t('briefs.corpus.range')}</dt><dd className="text-xl font-semibold">{stats.wordCount.min ?? '—'}–{stats.wordCount.max ?? '—'}</dd></div>
          <div><dt className="text-sm text-muted-foreground">{t('briefs.corpus.average')}</dt><dd className="text-xl font-semibold">{stats.wordCount.average ?? '—'}</dd></div>
          <div><dt className="text-sm text-muted-foreground">{t('briefs.corpus.pages')}</dt><dd className="text-xl font-semibold">{stats.wordCount.documentCount}</dd></div>
        </dl>
        <div>
          <h3 className="mb-2 font-medium">{t('briefs.corpus.headings')}</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.headingHistogram).map(([level, count]) => <Badge key={level} variant="outline">{level.toUpperCase()}: {count}</Badge>)}
          </div>
        </div>
        <div>
          <h3 className="mb-2 font-medium">{t('briefs.corpus.entities')}</h3>
          {stats.entities.length ? <div className="flex flex-wrap gap-2">{stats.entities.map((entity) => <Badge key={entity.label} variant="secondary">{entity.label} · {entity.documentCount}</Badge>)}</div> : <p className="text-sm text-muted-foreground">{t('briefs.corpus.noEntities')}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function EvidenceCard({ detail }: { detail: ContentBriefDetail }) {
  const { t, i18n } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="content-brief-evidence">
      <CardHeader>
        <CardTitle>{t('briefs.sources.title')}</CardTitle>
        <CardDescription>{t('briefs.sources.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {detail.documents.length ? (
          <ul className="space-y-3">
            {detail.documents.map((document) => (
              <li key={document.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{document.id}</Badge>
                  {document.sourceUrl ? <a className="min-h-11 break-all py-2 text-sm underline underline-offset-4" href={safeExternalHref(document.sourceUrl)} target="_blank" rel="nofollow ugc noopener noreferrer">{document.title || document.sourceUrl}</a> : <span className="text-sm">{document.title}</span>}
                </div>
                <p className="text-sm text-muted-foreground">{t('briefs.sources.meta', { date: localeDate(i18n.language, document.capturedAt), count: document.wordCount })}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t('briefs.sources.empty')}</p>}
      </CardContent>
    </Card>
  );
}

function BriefDetailView({ detail, onBack }: { detail: ContentBriefDetail; onBack: () => void }) {
  const { t } = useTranslation('contentIntelligence');
  const editorHref = `/sites/${encodeURIComponent(detail.siteId)}/content-briefs/${encodeURIComponent(detail.id)}/editor`;
  return (
    <div className="space-y-4" data-testid="content-brief-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" className="px-0" onClick={onBack}>{t('briefs.actions.back')}</Button>
          <h2 className="text-2xl font-semibold tracking-tight">{detail.keyword}</h2>
        </div>
        <div className="flex items-center gap-2">
          <BriefStatusBadge status={detail.status} />
          {isContentBriefTerminal(detail.status) ? (
            <Button asChild><Link to={editorHref}><FilePenLine aria-hidden="true" />{t('briefs.actions.editor')}</Link></Button>
          ) : null}
        </div>
      </div>
      {!detail.creationEnabled ? <BriefStateAlert kind="disabled" /> : null}
      {!isContentBriefTerminal(detail.status) ? (
        <Alert data-testid="content-brief-running">
          <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <AlertTitle>{t('briefs.running.title')}</AlertTitle>
          <AlertDescription>{t('briefs.running.description')}</AlertDescription>
        </Alert>
      ) : null}
      {detail.status === 'failed' ? <BriefStateAlert kind="failed" /> : null}
      <HaltAlert detail={detail} />
      <CorpusCard detail={detail} />
      <EvidenceCard detail={detail} />
      <Card>
        <CardHeader><CardTitle>{t('briefs.outline.title')}</CardTitle><CardDescription>{t('briefs.guidance')}</CardDescription></CardHeader>
        <CardContent>
          {detail.outline.length ? <ol className="space-y-4">{detail.outline.map((node) => <li key={node.id} className="space-y-2"><h3 className="font-semibold">{node.heading}</h3><p className="text-sm text-muted-foreground">{node.purpose}</p><CitationChips citations={node.citations} /></li>)}</ol> : <p className="text-sm text-muted-foreground">{t('briefs.outline.empty')}</p>}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('briefs.questions.title')}</CardTitle></CardHeader>
          <CardContent>{detail.questions.length ? <ul className="space-y-3">{detail.questions.map((question, index) => <li key={`${question.question}-${index}`} className="space-y-2"><p>{question.question}</p><CitationChips citations={question.citations} /></li>)}</ul> : <p className="text-sm text-muted-foreground">{t('briefs.questions.empty')}</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('briefs.terms.title')}</CardTitle></CardHeader>
          <CardContent>{detail.secondaryTerms.length ? <div className="flex flex-wrap gap-2">{detail.secondaryTerms.map((term) => <Badge key={term.id} variant="secondary">{term.term}</Badge>)}</div> : <p className="text-sm text-muted-foreground">{t('briefs.terms.empty')}</p>}</CardContent>
        </Card>
      </div>
      {detail.serp.paaRows.length ? (
        <Card>
          <CardHeader><CardTitle>{t('briefs.paa.title')}</CardTitle></CardHeader>
          <CardContent><ul className="space-y-2">{detail.serp.paaRows.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-2"><Badge variant="outline">{row.id}</Badge><span>{row.question}</span></li>)}</ul></CardContent>
        </Card>
      ) : null}
      {detail.abstentions.length ? (
        <Alert data-testid="content-brief-abstentions">
          <AlertTitle>{t('briefs.abstentions.title')}</AlertTitle>
          <AlertDescription><ul className="list-disc ps-5">{detail.abstentions.map((key) => <li key={key}>{t(`briefs.abstentions.${abstentionTranslationKey(key)}`)}</li>)}</ul></AlertDescription>
        </Alert>
      ) : null}
      <Separator />
      <p className="text-xs text-muted-foreground">{t('briefs.cost', { used: detail.cost.initialMicros + detail.cost.editorAiMicros, ceiling: detail.cost.ceilingMicros })}</p>
    </div>
  );
}

export function ContentBriefsPanel({ siteId }: { siteId: string }) {
  const { t } = useTranslation('contentIntelligence');
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const rawStatus = params.get(STATUS_PARAM);
  const status = contentBriefStatusFilter(rawStatus);
  const briefId = params.get(DETAIL_PARAM);
  const [page, setPage] = useState<ContentBriefListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<ErrorKind | null>(null);
  const [detail, setDetail] = useState<ContentBriefDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<ErrorKind | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (rawStatus && status === 'all') replaceSearchValue(location, navigate, STATUS_PARAM, null);
  }, [location, navigate, rawStatus, status]);

  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true);
    setListError(null);
    void listContentBriefs(siteId, status, undefined, { signal: controller.signal })
      .then(setPage)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListError(errorKind(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [reload, siteId, status]);

  useEffect(() => {
    if (!briefId) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const load = async () => {
      controller = new AbortController();
      setDetailLoading(true);
      setDetailError(null);
      try {
        const value = await getContentBrief(siteId, briefId, { signal: controller.signal });
        if (!active) return;
        setDetail(value);
        if (!isContentBriefTerminal(value.status)) timer = setTimeout(() => void load(), 3_000);
      } catch (error) {
        if (active && !controller.signal.aborted) setDetailError(errorKind(error));
      } finally {
        if (active) setDetailLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [briefId, siteId]);

  const open = useCallback((id: string) => replaceSearchValue(location, navigate, DETAIL_PARAM, id), [location, navigate]);
  const back = useCallback(() => {
    replaceSearchValue(location, navigate, DETAIL_PARAM, null);
    setReload((value) => value + 1);
  }, [location, navigate]);
  const changeStatus = useCallback((value: ContentBriefStatusFilter) => replaceSearchValue(location, navigate, STATUS_PARAM, value === 'all' ? null : value), [location, navigate]);
  const created = useCallback((id: string) => {
    open(id);
    setReload((value) => value + 1);
  }, [open]);
  const more = async () => {
    setListLoading(true);
    try {
      const next = await listContentBriefs(siteId, status, page!.nextCursor!);
      setPage({
        creationEnabled: next.creationEnabled,
        items: [...page!.items, ...next.items],
        nextCursor: next.nextCursor,
      });
    } catch (error) {
      setListError(errorKind(error));
    } finally {
      setListLoading(false);
    }
  };

  if (!briefId && listError === 'disabled' && !page) {
    return <BriefStateAlert kind="disabled" />;
  }
  if (briefId) {
    if (detailLoading && !detail) return <div aria-busy="true" aria-label={t('briefs.detail.loading')}><Skeleton className="h-40 w-full" /></div>;
    if (detailError) return <BriefStateAlert kind={detailError} />;
    if (detail) return <BriefDetailView detail={detail} onBack={back} />;
  }

  return (
    <div className="space-y-4" data-testid="content-briefs-panel">
      {page && !page.creationEnabled ? <BriefStateAlert kind="disabled" /> : null}
      <NewBriefForm siteId={siteId} disabled={page?.creationEnabled !== true} onCreated={created} />
      <BriefList
        page={page}
        loading={listLoading}
        error={listError}
        status={status}
        onStatus={changeStatus}
        onOpen={open}
        onMore={() => void more()}
        onRetry={() => setReload((value) => value + 1)}
      />
    </div>
  );
}
