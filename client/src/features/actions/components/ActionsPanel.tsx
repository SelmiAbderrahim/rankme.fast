/**
 * Next Actions workspace panel — the `?tab=actions` surface.
 *
 * data-testid contract:
 *   - actions-panel                       root
 *   - actions-filter-<key>                filter select triggers
 *   - actions-filters-reset               reset button
 *   - actions-list                        server-ordered card list
 *   - action-card                         one per action (ActionCard)
 *   - actions-loading                     initial skeleton state
 *   - actions-error                       load-failure alert
 *   - actions-not-found                   generic localized not-found
 *   - actions-empty-clear                 true all-clear empty state
 *   - actions-empty-unavailable           sources-unavailable empty state
 *   - actions-partial-warning             inline degraded-sources warning
 *   - actions-prev / actions-next         cursor pagination
 *
 * The server's order is authoritative — the panel never re-sorts. Filters
 * live in the URL (`tabState.ts` grammar); pagination uses the server
 * cursor. Every read on this surface is spend-free.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, CloudOff, SearchX } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/ui/empty';
import { Label } from '@shared/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  selectActions,
  selectActionsListError,
  selectActionsListStatus,
  selectActionsNextCursor,
  selectAllSourcesUnavailable,
  selectAnyPartialSource,
} from '../store/selectors';
import { loadActions } from '../store/thunks';
import type { ListActionsFilters } from '../api';
import {
  ACTIONS_CONFIDENCE_FILTERS,
  ACTIONS_EFFORT_FILTERS,
  ACTIONS_FILTER_KEYS,
  ACTIONS_SEVERITY_FILTERS,
  ACTIONS_SOURCE_FILTERS,
  ACTIONS_STATE_FILTERS,
  DEFAULT_ACTIONS_QUERY,
  nextActionsRequestSeq,
  useActionsQuery,
  type ActionsQueryState,
} from '../tabState';
import { ActionCard } from './ActionCard';
import { translateApiMessageKey } from '@shared/api/errorMessage';
import {
  presentationRequestIdentity,
  usePresentationRefreshSignal,
} from '@shared/i18n';

interface ActionsPanelProps {
  siteId: string;
}

const FILTER_OPTIONS: Record<
  (typeof ACTIONS_FILTER_KEYS)[number],
  readonly string[]
> = {
  state: ACTIONS_STATE_FILTERS,
  source: ACTIONS_SOURCE_FILTERS,
  severity: ACTIONS_SEVERITY_FILTERS,
  confidence: ACTIONS_CONFIDENCE_FILTERS,
  effort: ACTIONS_EFFORT_FILTERS,
};

/** Map the URL grammar onto the API's array-shaped filters. */
export function filtersFromQuery(query: ActionsQueryState): ListActionsFilters {
  return {
    ...(query.state !== 'all' ? { state: [query.state] } : {}),
    ...(query.source !== 'all' ? { source: [query.source] } : {}),
    ...(query.severity !== 'all' ? { severity: [query.severity] } : {}),
    ...(query.confidence !== 'all' ? { confidence: [query.confidence] } : {}),
    ...(query.effort !== 'all' ? { effort: [query.effort] } : {}),
  };
}

/** i18n leaf for a filter option — `all` shares one key across filters. */
function optionKey(key: string, value: string): string {
  if (value === 'all') return 'filters.all';
  if (key === 'confidence') return `confidence.${value}`;
  if (key === 'effort') return `effort.${value}`;
  return `${key}.${value}`;
}

export const ActionsPanel = ({ siteId }: ActionsPanelProps) => {
  const { t } = useTranslation('actions');
  const presentation = usePresentationRefreshSignal();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useActionsQuery();

  const items = useAppSelector(selectActions);
  const listStatus = useAppSelector(selectActionsListStatus);
  const listError = useAppSelector(selectActionsListError);
  const nextCursor = useAppSelector(selectActionsNextCursor);
  const allUnavailable = useAppSelector(selectAllSourcesUnavailable);
  const anyPartial = useAppSelector(selectAnyPartialSource);

  // One in-flight list request at a time: the effect aborts the previous
  // dispatch on every (siteId, filter, cursor) change, and the slice's
  // requestSeq guard drops any stale fulfillment that slips through.
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    const promise = dispatch(
      loadActions({
        siteId,
        requestSeq: nextActionsRequestSeq(),
        presentationLocale: presentation.locale,
        presentationGeneration: presentation.generation,
        filters: filtersFromQuery(queryRef.current),
        ...(queryRef.current.cursor ? { cursor: queryRef.current.cursor } : {}),
      }),
    );
    return () => {
      promise.abort();
    };
  }, [
    dispatch,
    siteId,
    query.state,
    query.source,
    query.severity,
    query.confidence,
    query.effort,
    query.cursor,
    presentation.generation,
    presentation.locale,
    presentation.refreshGeneration,
  ]);

  const reload = () => {
    void dispatch(
      loadActions({
        siteId,
        requestSeq: nextActionsRequestSeq(),
        ...presentationRequestIdentity(),
        filters: filtersFromQuery(queryRef.current),
        ...(queryRef.current.cursor ? { cursor: queryRef.current.cursor } : {}),
      }),
    );
  };

  const filtersActive = ACTIONS_FILTER_KEYS.some(
    (key) => query[key] !== DEFAULT_ACTIONS_QUERY[key],
  );

  const loadingInitial = listStatus === 'loading' || listStatus === 'idle';
  const refreshing = listStatus === 'refreshing';

  const statusLine = loadingInitial
    ? t('status.loading')
    : refreshing
      ? t('status.refreshing')
      : listStatus === 'ready'
        ? t('status.showing', { count: items.length })
        : '';

  return (
    <section
      className="flex flex-col gap-4"
      data-testid="actions-panel"
      aria-labelledby="actions-panel-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="actions-panel-title" className="text-lg font-semibold">
            {t('title')}
          </h2>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <ReportExportControl
          kind="actions.plan"
          target={{ scope: 'site', siteId }}
          selection={filtersFromQuery(query)}
        />
      </div>

      <div
        role="group"
        aria-label={t('filters.label')}
        className="flex flex-wrap items-end gap-3"
      >
        {ACTIONS_FILTER_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1">
            <Label htmlFor={`actions-filter-${key}`} className="text-xs">
              {t(`filters.${key}`)}
            </Label>
            <Select
              value={query[key]}
              onValueChange={(value) =>
                setQuery({ [key]: value } as Partial<ActionsQueryState>)
              }
            >
              <SelectTrigger
                size="sm"
                id={`actions-filter-${key}`}
                data-testid={`actions-filter-${key}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_OPTIONS[key].map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(optionKey(key, value))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        {filtersActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setQuery({
                state: 'all',
                source: 'all',
                severity: 'all',
                confidence: 'all',
                effort: 'all',
              })
            }
            data-testid="actions-filters-reset"
          >
            {t('filters.reset')}
          </Button>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {statusLine}
      </p>

      {loadingInitial ? (
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          data-testid="actions-loading"
        >
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-2/3" />
        </div>
      ) : listStatus === 'error' ? (
        listError.notFound ? (
          <Empty className="border py-8" data-testid="actions-not-found">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t('notFound.title')}</EmptyTitle>
              <EmptyDescription>{t('notFound.body')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Alert variant="destructive" role="alert" data-testid="actions-error">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>
              {listError.unauthorized
                ? t('errors.unauthorized')
                : (translateApiMessageKey(listError.messageKey) ?? listError.message)}
            </AlertTitle>
            <AlertDescription>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reload}
                data-testid="actions-retry"
              >
                {t('common:retry')}
              </Button>
            </AlertDescription>
          </Alert>
        )
      ) : items.length === 0 ? (
        allUnavailable || anyPartial ? (
          <Empty className="border py-8" data-testid="actions-empty-unavailable">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CloudOff aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t('sources.unavailableTitle')}</EmptyTitle>
              <EmptyDescription>{t('sources.unavailableBody')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Empty className="border py-8" data-testid="actions-empty-clear">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckCircle2 aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t('sources.clearTitle')}</EmptyTitle>
              <EmptyDescription>{t('sources.clearBody')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <>
          {anyPartial ? (
            <Alert role="status" data-testid="actions-partial-warning">
              <CloudOff aria-hidden="true" />
              <AlertDescription>{t('sources.partial')}</AlertDescription>
            </Alert>
          ) : null}
          <ol
            className="flex flex-col gap-3"
            data-testid="actions-list"
            aria-busy={refreshing || undefined}
          >
            {items.map((item) => (
              <li key={item.id}>
                <ActionCard item={item} siteId={siteId} onReload={reload} />
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={query.cursor === null}
              onClick={() => setQuery({ cursor: null })}
              data-testid="actions-prev"
            >
              {t('pagination.previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={nextCursor === null}
              onClick={() => setQuery({ cursor: nextCursor })}
              data-testid="actions-next"
            >
              {t('pagination.next')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
};
