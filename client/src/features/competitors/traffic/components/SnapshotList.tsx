import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@shared/ui/field';
import { Input } from '@shared/ui/input';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import {
  trafficSnapshotDomainSchema,
  type AsyncStatus,
  type TrafficSnapshotListFilters,
  type TrafficSnapshotListResponse,
} from '../types';
import { CoverageNote } from './CoverageNote';

const readTrafficDate = (value: string | null): string | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
};

export const readTrafficFilters = (params: URLSearchParams): TrafficSnapshotListFilters => {
  const parsedDomain = trafficSnapshotDomainSchema.safeParse(params.get('domain') ?? '');
  const from = readTrafficDate(params.get('from'));
  const to = readTrafficDate(params.get('to'));
  const validRange = from === null || to === null || from <= to;
  const cursor = params.get('cursor');
  return {
    ...(parsedDomain.success ? { domain: parsedDomain.data } : {}),
    ...(validRange && from !== null ? { from } : {}),
    ...(validRange && to !== null ? { to } : {}),
    ...(cursor && cursor.length <= 500 ? { cursor } : {}),
  };
};

export const normalizeTrafficFilters = (params: URLSearchParams): URLSearchParams => {
  const filters = readTrafficFilters(params);
  const next = new URLSearchParams(params);
  for (const key of ['domain', 'from', 'to', 'cursor'] as const) {
    const value = filters[key];
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
};

interface SnapshotListProps {
  data: TrafficSnapshotListResponse | null;
  status: AsyncStatus;
  error?: string;
  onOpen: (id: string) => void;
}

export const SnapshotList = ({ data, status, error = '', onOpen }: SnapshotListProps) => {
  const { t, i18n } = useTranslation('competitorsTraffic');
  const [params, setParams] = useSearchParams();
  const domainRef = useRef<HTMLInputElement>(null);
  const filters = readTrafficFilters(params);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const number = new Intl.NumberFormat(i18n.language);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionWarning, setSelectionWarning] = useState('');

  const normalizeUrlFilters = useCallback(() => {
    const normalized = normalizeTrafficFilters(params);
    if (normalized.toString() !== params.toString()) {
      setParams(normalized, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    // Domain filtering is live while the user types. Do not erase an
    // intermediate value such as `new.`; blur canonicalizes the completed
    // entry, while direct links normalize immediately.
    if (document.activeElement === domainRef.current) return;
    normalizeUrlFilters();
  }, [normalizeUrlFilters]);

  const setFilter = (key: 'domain' | 'from' | 'to', value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('cursor');
    setParams(next, { replace: false });
  };

  const setCursor = (cursor: string | null) => {
    const next = new URLSearchParams(params);
    if (cursor) next.set('cursor', cursor);
    else next.delete('cursor');
    setParams(next, { replace: false });
  };

  const toggleSelected = (id: string, selected: boolean) => {
    if (!selected) {
      setSelectedIds((current) => current.filter((candidate) => candidate !== id));
      setSelectionWarning('');
      return;
    }
    if (selectedIds.length >= 5) {
      setSelectionWarning(t('compare.clamped', { count: 5 }));
      return;
    }
    setSelectionWarning('');
    setSelectedIds([...selectedIds, id]);
  };

  const openCompare = () => {
    const next = new URLSearchParams(params);
    next.set('ids', selectedIds.join(','));
    setParams(next, { replace: false });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('list.title')}</CardTitle>
        <CardDescription>{t('list.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup className="grid gap-4 md:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="traffic-filter-domain">{t('list.filters.domain')}</FieldLabel>
            <Input
              ref={domainRef}
              id="traffic-filter-domain"
              value={params.get('domain') ?? ''}
              onChange={(event) => setFilter('domain', event.target.value)}
              onBlur={normalizeUrlFilters}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="traffic-filter-from">{t('list.filters.from')}</FieldLabel>
            <Input
              id="traffic-filter-from"
              type="date"
              value={filters.from ?? ''}
              onChange={(event) => setFilter('from', event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="traffic-filter-to">{t('list.filters.to')}</FieldLabel>
            <Input
              id="traffic-filter-to"
              type="date"
              value={filters.to ?? ''}
              onChange={(event) => setFilter('to', event.target.value)}
            />
          </Field>
        </FieldGroup>

        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {selectionWarning ? (
          <Alert role="alert" data-testid="traffic-compare-selection-warning">
            <AlertDescription>{selectionWarning}</AlertDescription>
          </Alert>
        ) : null}

        {status === 'loading' && !data ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : null}

        {data && data.snapshots.length === 0 ? (
          <Empty data-testid="traffic-list-empty">
            <EmptyHeader>
              <EmptyTitle>{t('states.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('states.empty.description')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex flex-row gap-2">
              <Button type="button" variant="outline" onClick={() => domainRef.current?.focus()}>
                {t('states.empty.cta')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        {data && data.snapshots.length > 0 ? (
          <Table>
            <caption className="sr-only">{t('list.title')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <span className="sr-only">{t('compare.select')}</span>
                </TableHead>
                <TableHead>{t('list.columns.domain')}</TableHead>
                <TableHead>{t('list.columns.captured')}</TableHead>
                <TableHead className="text-end">
                  <TableHeaderHelp
                    label={t('list.columns.visits')}
                    description={t('common:tableHelp.estimatedTraffic')}
                  />
                </TableHead>
                <TableHead className="text-end">{t('list.columns.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.snapshots.map((snapshot) => (
                <TableRow key={snapshot.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.includes(snapshot.id)}
                      aria-label={t('compare.selectSnapshot', {
                        domain: snapshot.targetDomain,
                      })}
                      onCheckedChange={(checked) => toggleSelected(snapshot.id, checked === true)}
                    />
                  </TableCell>
                  <TableCell>{snapshot.targetDomain}</TableCell>
                  <TableCell>{date.format(new Date(snapshot.capturedAt))}</TableCell>
                  <TableCell className="text-end">
                    <span className="flex flex-col items-end gap-1">
                      <span className="tabular-nums">
                        {number.format(snapshot.payload.monthlyOrganicVisits.value)}
                      </span>
                      <CoverageNote
                        observation={snapshot.payload.monthlyOrganicVisits.observation}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onOpen(snapshot.id)}
                    >
                      {t('list.open')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
      {data && (selectedIds.length >= 2 || data.nextCursor || filters.cursor) ? (
        <CardFooter className="flex-wrap justify-between gap-3">
          <div className="flex items-center gap-2">
            {data.nextCursor || filters.cursor ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!filters.cursor}
                  onClick={() => setCursor(null)}
                >
                  {t('list.previous')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!data.nextCursor}
                  onClick={() => setCursor(data.nextCursor)}
                >
                  {t('list.next')}
                </Button>
              </>
            ) : null}
          </div>
          {selectedIds.length >= 2 ? (
            <Button type="button" variant="outline" onClick={openCompare}>
              {t('compare.button', { count: selectedIds.length })}
            </Button>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
};
