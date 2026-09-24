import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { StatusChip } from '@shared/ui/status-chip';
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@shared/ui/empty';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security';
import type { ContentMonitor, MonitorFeedEvent } from '../../types';
import { monitorFeedTone } from './status';

interface ChangeFeedProps {
  monitor: ContentMonitor;
  feed: MonitorFeedEvent[];
  nextCursor: string | null;
  loading: boolean;
  onLoadMore: () => void;
}

/**
 * The ordered change feed for one monitor. Every derived diff fragment is
 * UNTRUSTED page-derived text — rendered ONLY as React text nodes, never as
 * markup. The monitored page URL goes through `safeExternalHref` +
 * `rel="nofollow ugc noopener noreferrer"`.
 */
export function ChangeFeed({ monitor, feed, nextCursor, loading, onLoadMore }: ChangeFeedProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  return (
    <Card data-testid="monitor-change-feed">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t('monitoring.feed.title')}</CardTitle>
            <CardDescription>{t('monitoring.feed.description')}</CardDescription>
          </div>
          <ReportExportControl
            kind="content.monitor_feed"
            target={{ scope: 'site_resource', siteId: monitor.siteId, resourceId: monitor.monitorId }}
            selection={{}}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL contains "noopener noreferrer" */}
        <a
          href={safeExternalHref(monitor.targetUrl)}
          target="_blank"
          rel={SAFE_EXTERNAL_REL}
          className="text-primary inline-flex w-fit items-center gap-1 text-sm hover:underline"
          data-testid="monitor-feed-source-link"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          {monitor.targetUrl}
        </a>

        {feed.length === 0 ? (
          <Empty data-testid="monitor-feed-empty">
            <EmptyMedia />
            <EmptyContent>
              <EmptyTitle>{t('monitoring.feed.empty.title')}</EmptyTitle>
              <EmptyDescription>{t('monitoring.feed.empty.description')}</EmptyDescription>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {feed.map((event) => (
                <li
                  key={event.eventKey}
                  className="border-border flex flex-col gap-2 rounded-md border p-3"
                  data-testid={`monitor-feed-${event.eventKey}`}
                  data-kind={event.kind}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={monitorFeedTone(event.kind)}>
                      {t(`monitoring.feed.kinds.${event.kind}`, {
                        defaultValue: t('monitoring.feed.kinds.unknown'),
                      })}
                    </StatusChip>
                    {event.isoWeek ? (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {event.isoWeek}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground text-xs">
                      {new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(event.recordedAt))}
                    </span>
                  </div>
                  {event.diffText ? (
                    <blockquote
                      className="text-muted-foreground border-border border-s-2 ps-3 text-sm whitespace-pre-wrap"
                      data-testid={`monitor-feed-diff-${event.eventKey}`}
                    >
                      {event.diffText}
                    </blockquote>
                  ) : null}
                </li>
              ))}
            </ul>
            {nextCursor ? (
              <div>
                <Button
                  variant="outline"
                  onClick={onLoadMore}
                  disabled={loading}
                  data-testid="monitor-feed-load-more"
                >
                  {t('monitoring.feed.loadMore')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
