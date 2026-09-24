import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { useAppSelector } from '@shared/hooks/redux';
import { safeInternalHref } from '@shared/utils/internalHref';
import {
  selectSignalDecisionConflict,
  selectSignalDecisionError,
  selectSignalDecisionPending,
  selectSignalTerminalDecision,
} from '../store/selectors';
import type { RunResultSignal, SignalDecisionResult } from '../types';

const CONFIDENCE_KEYS: Record<string, string> = {
  high: 'signals.confidence.high',
  medium: 'signals.confidence.medium',
  low: 'signals.confidence.low',
  anecdotal: 'signals.confidence.anecdotal',
};

const SIGNAL_TYPE_KEYS: Record<string, string> = {
  complaint: 'signals.type.complaint',
  request: 'signals.type.request',
  question: 'signals.type.question',
  competitor_gap: 'signals.type.competitor_gap',
};

const ROUTE_KEYS: Record<string, string> = {
  content: 'signals.route.content',
  comparison_page: 'signals.route.comparison_page',
  product: 'signals.route.product',
  seo: 'signals.route.seo',
};

interface SignalCardProps {
  signal: RunResultSignal;
  onOpenEvidence: (signalId: string) => void;
  onAccept: (signal: RunResultSignal) => void;
  onDismiss: (signal: RunResultSignal) => void;
  onOpenDeepLink: (decision: SignalDecisionResult) => void;
}

export function SignalCard({
  signal,
  onOpenEvidence,
  onAccept,
  onDismiss,
  onOpenDeepLink,
}: SignalCardProps) {
  const { t } = useTranslation('audienceResearch');
  const terminal = useAppSelector(selectSignalTerminalDecision(signal.signalId));
  const pending = useAppSelector(selectSignalDecisionPending(signal.signalId));
  const error = useAppSelector(selectSignalDecisionError(signal.signalId));
  const conflict = useAppSelector(selectSignalDecisionConflict(signal.signalId));

  const confidenceKey = CONFIDENCE_KEYS[signal.confidence] ?? CONFIDENCE_KEYS.low!;
  const typeKey = SIGNAL_TYPE_KEYS[signal.type] ?? 'signals.type.other';
  const routeKey = ROUTE_KEYS[signal.suggestedRoute] ?? 'signals.route.other';

  const onEvidence = useCallback(() => onOpenEvidence(signal.signalId), [
    onOpenEvidence,
    signal.signalId,
  ]);
  const onAcceptClick = useCallback(() => onAccept(signal), [onAccept, signal]);
  const onDismissClick = useCallback(() => onDismiss(signal), [onDismiss, signal]);

  const isPending = Boolean(pending);
  const state: 'pending' | 'accepted' | 'dismissed' = terminal
    ? terminal.terminalDecision
    : 'pending';
  const safeDeepLinkPath = terminal?.deepLinkPath
    ? safeInternalHref(terminal.deepLinkPath)
    : null;

  return (
    <Card
      data-testid={`audience-research-signal-${signal.signalId}`}
      data-signal-type={signal.type}
      data-signal-state={state}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge data-testid={`signal-type-${signal.signalId}`}>
            {t(typeKey)}
          </Badge>
          <Badge
            variant="outline"
            data-testid={`signal-confidence-${signal.signalId}`}
          >
            {t(confidenceKey)}
          </Badge>
          <Badge
            variant="secondary"
            data-testid={`signal-route-${signal.signalId}`}
            title={t('signals.route.aiInterpretationHint')}
          >
            {t('signals.route.aiInterpretation')}: {t(routeKey)}
          </Badge>
        </div>
        <CardTitle
          className="mt-2 text-base"
          data-testid={`signal-title-${signal.signalId}`}
        >
          {signal.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p data-testid={`signal-summary-${signal.signalId}`}>{signal.summary}</p>

        <p
          className="text-muted-foreground text-xs"
          data-testid={`signal-rationale-${signal.signalId}`}
        >
          {t('signals.rationale.summary', {
            independentDomainCount: signal.independentDomainCount,
            sourceTypeCount: signal.sourceTypeCount,
            recent: signal.mostRecentSourceObservedAt
              ? t('signals.rationale.recent', {
                  date: signal.mostRecentSourceObservedAt.slice(0, 10),
                })
              : t('signals.rationale.recentUnknown'),
          })}
        </p>

        <p
          className="text-muted-foreground text-xs"
          data-testid={`signal-citation-count-${signal.signalId}`}
        >
          {t('signals.citationCount', { count: signal.citedSourceIds.length })}
        </p>

        {conflict ? (
          <p
            role="status"
            className="text-destructive text-xs"
            data-testid={`signal-conflict-${signal.signalId}`}
          >
            {t('signals.decision.conflict')}
          </p>
        ) : null}

        {error && !conflict ? (
          <p
            role="alert"
            className="text-destructive text-xs"
            data-testid={`signal-error-${signal.signalId}`}
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onEvidence}
            data-testid={`signal-evidence-${signal.signalId}`}
          >
            {t('signals.actions.evidence')}
          </Button>

          {state === 'pending' ? (
            <>
              <Button
                type="button"
                size="sm"
                onClick={onAcceptClick}
                disabled={isPending}
                data-testid={`signal-accept-${signal.signalId}`}
              >
                {t('signals.actions.accept')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onDismissClick}
                disabled={isPending}
                data-testid={`signal-dismiss-${signal.signalId}`}
              >
                {t('signals.actions.dismiss')}
              </Button>
            </>
          ) : null}

          {state === 'accepted' && terminal && safeDeepLinkPath ? (
            // Navigation, not an action: render a real link whose href IS the
            // server's deepLinkPath (carries the stable `?action=` /
            // `?recommendation=` source id — shareable, middle-clickable, and
            // provable from the DOM). The click still routes through the
            // shared handler so SPA navigation stays consistent.
            <Button asChild size="sm" variant="secondary">
              <Link
                to={safeDeepLinkPath}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenDeepLink(terminal);
                }}
                data-testid={`signal-deep-link-${signal.signalId}`}
              >
                {terminal.destination === 'content' ||
                terminal.destination === 'comparison_page'
                  ? t('signals.decision.openRecommendation')
                  : t('signals.decision.openAction')}
              </Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
