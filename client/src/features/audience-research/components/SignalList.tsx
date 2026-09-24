import { useCallback, useMemo, useState } from 'react';
import { safeInternalHref } from '@shared/utils/internalHref';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Empty } from '@shared/ui/empty';
import { useAppSelector } from '@shared/hooks/redux';
import { useAudienceResearchQuery } from '../tabState';
import type { RunResultSignal, RunResultView } from '../types';
import { selectSignalTerminalDecision } from '../store/selectors';
import { AcceptDecisionDialog } from './AcceptDecisionDialog';
import { DismissDecisionDialog } from './DismissDecisionDialog';
import { SignalCard } from './SignalCard';
import { SignalEvidenceDrawer } from './SignalEvidenceDrawer';

interface SignalListProps {
  siteId: string;
  runId: string;
  result: RunResultView;
}

const CONFIDENCE_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
  anecdotal: 3,
};

function deterministicOrder(signals: readonly RunResultSignal[]): RunResultSignal[] {
  return [...signals].sort((a, b) => {
    const ac = CONFIDENCE_RANK[a.confidence] ?? 99;
    const bc = CONFIDENCE_RANK[b.confidence] ?? 99;
    if (ac !== bc) return ac - bc;
    if (b.independentDomainCount !== a.independentDomainCount) {
      return b.independentDomainCount - a.independentDomainCount;
    }
    const ad = a.mostRecentSourceObservedAt ?? '';
    const bd = b.mostRecentSourceObservedAt ?? '';
    if (ad !== bd) return bd.localeCompare(ad);
    return a.signalId.localeCompare(b.signalId);
  });
}

/**
 * Read-only render of a run's retained signals. Filters/drawer are URL-backed
 * via `useAudienceResearchQuery`. Read/filter/drawer never enqueue a vendor
 * call.
 */
export function SignalList({ siteId, runId, result }: SignalListProps) {
  const { t } = useTranslation('audienceResearch');
  const navigate = useNavigate();
  const [query, setQuery] = useAudienceResearchQuery();

  const ordered = useMemo(
    () => deterministicOrder(result.signals),
    [result.signals],
  );

  const filtered = useMemo(() => {
    return ordered.filter((s) => {
      if (query.signalType !== 'all' && s.type !== query.signalType) return false;
      if (query.confidence !== 'all' && s.confidence !== query.confidence) return false;
      return true;
    });
  }, [ordered, query.confidence, query.signalType]);

  // Filter by decision using the terminal cache — the store owns terminal
  // state, so we look up per signal at render time.
  const decisionByIdSelector = useAppSelector((state) => state);
  const decisionFiltered = useMemo(() => {
    if (query.decision === 'all') return filtered;
    return filtered.filter((s) => {
      const terminal = selectSignalTerminalDecision(s.signalId)(decisionByIdSelector);
      const state = terminal ? terminal.terminalDecision : 'pending';
      return state === query.decision;
    });
  }, [decisionByIdSelector, filtered, query.decision]);

  const openSignal = useMemo(() => {
    if (!query.signal) return null;
    return result.signals.find((s) => s.signalId === query.signal) ?? null;
  }, [query.signal, result.signals]);

  const [acceptTarget, setAcceptTarget] = useState<RunResultSignal | null>(null);
  const [dismissTarget, setDismissTarget] = useState<RunResultSignal | null>(null);

  const onOpenEvidence = useCallback(
    (signalId: string) => {
      setQuery({ signal: signalId });
    },
    [setQuery],
  );

  const onCloseEvidence = useCallback(() => {
    setQuery({ signal: null });
  }, [setQuery]);

  const onAccept = useCallback((signal: RunResultSignal) => {
    setAcceptTarget(signal);
  }, []);
  const onDismiss = useCallback((signal: RunResultSignal) => {
    setDismissTarget(signal);
  }, []);

  const onAcceptClose = useCallback(() => setAcceptTarget(null), []);
  const onDismissClose = useCallback(() => setDismissTarget(null), []);

  const onOpenDeepLink = useCallback(
    (deepLinkPath: string) => {
      const target = safeInternalHref(deepLinkPath);
      if (target) navigate(target);
    },
    [navigate],
  );

  const partial = result.terminal.state === 'partial';

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col gap-3" data-testid="audience-research-signals">
        {partial ? (
          <Alert data-testid="audience-research-signals-partial">
            <AlertTitle>{t('progress.partial.title')}</AlertTitle>
            <AlertDescription>{t('progress.partial.body')}</AlertDescription>
          </Alert>
        ) : null}
        <Empty data-testid="audience-research-signals-empty">
          {t('signals.empty.title')}
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="audience-research-signals">
      {partial ? (
        <Alert data-testid="audience-research-signals-partial">
          <AlertTitle>{t('progress.partial.title')}</AlertTitle>
          <AlertDescription>{t('progress.partial.body')}</AlertDescription>
        </Alert>
      ) : null}

      {decisionFiltered.length === 0 ? (
        <Empty data-testid="audience-research-signals-filter-empty">
          {t('signals.empty.filtered')}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {decisionFiltered.map((signal) => (
            <li key={signal.signalId}>
              <SignalCard
                signal={signal}
                onOpenEvidence={onOpenEvidence}
                onAccept={onAccept}
                onDismiss={onDismiss}
                onOpenDeepLink={(decision) =>
                  decision.deepLinkPath && onOpenDeepLink(decision.deepLinkPath)
                }
              />
            </li>
          ))}
        </ul>
      )}

      <SignalEvidenceDrawer
        open={Boolean(openSignal)}
        signal={openSignal}
        sources={result.sources}
        onClose={onCloseEvidence}
      />

      {acceptTarget ? (
        <AcceptDecisionDialog
          siteId={siteId}
          runId={runId}
          signal={acceptTarget}
          onClose={onAcceptClose}
          onOpenDeepLink={onOpenDeepLink}
        />
      ) : null}

      {dismissTarget ? (
        <DismissDecisionDialog
          siteId={siteId}
          runId={runId}
          signal={dismissTarget}
          onClose={onDismissClose}
        />
      ) : null}
    </div>
  );
}
