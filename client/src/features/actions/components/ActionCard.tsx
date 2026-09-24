/**
 * One flat bordered card per unified action.
 *
 * Everything the server sent — problem, why, next step, retest reason,
 * note-bearing evidence — renders as inert React text nodes. The internal
 * `sourceLink` is revalidated (`safeInternalHref`) before it becomes a
 * router link; evidence URLs pass `safeExternalHref` + the required `rel`.
 * The card owns its confirmation dialog, history drawer and retest dialog
 * so Radix returns focus to the triggering control on close.
 */
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, History, RefreshCw } from 'lucide-react';
import { Button } from '@shared/ui/button';
import {
  CodeFixPromptButton,
  type CodeFixPromptInput,
} from '@shared/components/CodeFixPromptButton';
import { StatusChip } from '@shared/ui/status-chip';
import { SAFE_EXTERNAL_REL, safeExternalHref, UNSAFE_HREF_PLACEHOLDER } from '@shared/security';
import { ACTION_ALLOWED_TRANSITIONS, type ActionItem, type ActionState } from '../types';
import { safeInternalHref } from '../tabState';
import { StateChangeDialog } from './StateChangeDialog';
import { HistoryDrawer } from './HistoryDrawer';
import { RetestDialog } from './RetestDialog';
import {
  ACTION_FRESHNESS_TONES,
  ACTION_SEVERITY_TONES,
  ACTION_STATE_TONES,
} from './tones';

export interface ActionCardProps {
  item: ActionItem;
  siteId: string;
  /** Refetch the authoritative list (read, no spend) — 409 recovery path. */
  onReload: () => void;
}

export function ActionCard({ item, siteId, onReload }: ActionCardProps) {
  const { t, i18n } = useTranslation('actions');
  const urlsRegionId = useId();
  const [targetState, setTargetState] = useState<ActionState | null>(null);
  // `transitionTargetRef` remembers WHICH transition button opened the dialog;
  // `transitionTriggerRef` is kept pointing at that button's CURRENT DOM node
  // by the callback ref below. Capturing the node once in `onClick` was not
  // enough: a list refetch landing while the dialog is open re-renders the row
  // and the captured node goes stale, so the close restore focused a detached
  // element and `document.activeElement` fell back to <body>.
  const transitionTargetRef = useRef<ActionState | null>(null);
  const transitionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [retestOpen, setRetestOpen] = useState(false);
  const [urlsExpanded, setUrlsExpanded] = useState(false);

  const formatDate = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
      new Date(iso),
    );

  const internalHref = safeInternalHref(item.sourceLink);
  const freshness = item.evidence[0]?.observation.freshness;
  const affectedCount = item.affectedUrls.length;
  const transitions = ACTION_ALLOWED_TRANSITIONS[item.state];
  const codeFixPrompt: CodeFixPromptInput | null = item.codeFixPrompt
    ? {
        reference: item.codeFixPrompt.reference,
        severity: item.severity,
        confidence: item.confidence,
        problem: item.problem,
        whyItMatters: item.whyItMatters,
        recommendedFix: item.codeFixPrompt.recommendedFix,
        affectedUrls: item.affectedUrls,
        affectedUrlCount: item.codeFixPrompt.affectedUrlCount,
      }
    : null;

  return (
    <article
      className="bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm"
      data-testid="action-card"
      data-action-id={item.id}
      aria-label={item.problem}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={ACTION_STATE_TONES[item.state]} dot data-testid="action-state-chip">
          {t(`state.${item.state}`)}
        </StatusChip>
        <StatusChip
          tone={ACTION_SEVERITY_TONES[item.severity]}
          data-testid="action-severity-chip"
        >
          {t(`severity.${item.severity}`)}
        </StatusChip>
        <StatusChip tone="muted" data-testid="action-source-chip">
          {t(`source.${item.sourceType}`)}
        </StatusChip>
        {/* Marked done, yet a later observation still reports it. */}
        {item.reappearedAfterFix ? (
          <StatusChip tone="destructive" data-testid="action-reappeared-chip">
            {t('report.reappearedLabel')}
          </StatusChip>
        ) : null}
        {freshness ? (
          <StatusChip
            tone={ACTION_FRESHNESS_TONES[freshness]}
            data-testid="action-freshness-chip"
          >
            {t(`freshness.${freshness}`)}
          </StatusChip>
        ) : null}
        <span className="text-muted-foreground text-xs">
          {t('card.observedAt', { date: formatDate(item.observedAt) })}
        </span>
      </div>

      <div className="min-w-0 space-y-1.5">
        <h3 className="font-medium" data-testid="action-problem">
          {item.problem}
        </h3>
        <p className="text-muted-foreground text-sm" data-testid="action-why">
          {item.whyItMatters}
        </p>
        <p className="text-sm" data-testid="action-next-step">
          <span className="text-muted-foreground">{t('card.nextStep')}: </span>
          {item.nextStep}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground" data-testid="action-impact">
          {t(`impact.${item.firstPartyImpact}`)}
        </span>
        <span className="text-muted-foreground" data-testid="action-confidence">
          {t(`confidence.${item.confidence}`)}
        </span>
        <span className="text-muted-foreground" data-testid="action-effort">
          {t(`effort.${item.effort}`)}
        </span>
      </div>

      {affectedCount > 0 ? (
        <div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
            aria-expanded={urlsExpanded}
            aria-controls={urlsRegionId}
            onClick={() => setUrlsExpanded((value) => !value)}
            data-testid="action-urls-toggle"
          >
            {urlsExpanded ? (
              <ChevronDown aria-hidden="true" className="size-3" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-3 rtl:rotate-180" />
            )}
            {affectedCount === 1
              ? t('card.affectedOne')
              : t('card.affectedCount', { count: affectedCount })}
          </button>
          {urlsExpanded ? (
            <ul
              id={urlsRegionId}
              className="text-muted-foreground mt-1 flex flex-col gap-0.5 ps-4 text-xs"
              data-testid="action-urls-list"
            >
              {item.affectedUrls.map((url) => (
                <li key={url} className="break-all">
                  {url}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs" data-testid="action-site-wide">
          {t('card.affectedNone')}
        </p>
      )}

      {item.evidence.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="action-evidence">
          <p className="text-muted-foreground text-xs font-medium">
            {t('card.evidence')}
          </p>
          <ul className="flex flex-col gap-0.5 text-xs">
            {item.evidence.map((entry) => {
              const external = entry.url ? safeExternalHref(entry.url) : null;
              const linkable = external !== null && external !== UNSAFE_HREF_PLACEHOLDER;
              return (
                <li key={entry.sourceRef} className="flex flex-wrap items-center gap-2">
                  <span className="break-all">{entry.sourceRef}</span>
                  <StatusChip
                    tone={ACTION_FRESHNESS_TONES[entry.observation.freshness]}
                  >
                    {t(`freshness.${entry.observation.freshness}`)}
                  </StatusChip>
                  {linkable ? (
                    /* eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL contains "noopener noreferrer" */
                    <a
                      href={external}
                      rel={SAFE_EXTERNAL_REL}
                      target="_blank"
                      className="underline underline-offset-2"
                      data-testid="action-evidence-link"
                    >
                      {t('card.evidenceLink')}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {internalHref ? (
          <Button asChild variant="link" size="sm" className="px-0">
            <Link to={internalHref} data-testid="action-source-link">
              {t('card.openSource')}
              <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
            </Link>
          </Button>
        ) : null}
        {codeFixPrompt ? <CodeFixPromptButton input={codeFixPrompt} /> : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {transitions.map((target) => (
            <Button
              key={target}
              type="button"
              variant="outline"
              size="sm"
              ref={(node) => {
                if (transitionTargetRef.current === target) {
                  transitionTriggerRef.current = node;
                }
              }}
              onClick={(event) => {
                transitionTargetRef.current = target;
                transitionTriggerRef.current = event.currentTarget;
                setTargetState(target);
              }}
              data-testid={`action-transition-${target}`}
            >
              {t(`transitions.${target}`)}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setHistoryOpen(true)}
            data-testid="action-history-open"
          >
            <History aria-hidden="true" />
            {t('card.history')}
          </Button>
          {item.retest.available ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRetestOpen(true)}
              data-testid="action-retest-open"
            >
              <RefreshCw aria-hidden="true" />
              {t('card.retest')}
            </Button>
          ) : null}
        </div>
      </div>
      {!item.retest.available && item.retest.reason ? (
        <p className="text-muted-foreground text-xs" data-testid="action-retest-reason">
          {item.retest.reason}
        </p>
      ) : null}

      {targetState ? (
        <StateChangeDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setTargetState(null);
            }
          }}
          // The dialog mounts without a Radix DialogTrigger and unmounts on
          // close, so Radix has no trigger to restore focus to. A
          // `setTimeout(focus, 0)` from onOpenChange looked right in jsdom
          // (no exit animation → teardown is synchronous) but lost in real
          // Chromium: Radix's close teardown finishes AFTER the exit
          // animation and moves focus to <body>, clobbering the early manual
          // restore. `onCloseAutoFocus` is Radix's sanctioned end-of-teardown
          // hook — prevent its default (focus wrapper/body) and restore the
          // captured trigger.
          // Radix strips the `inert` / `aria-hidden` guards it applied to the
          // rest of the tree AFTER this hook returns, so a restore that lands
          // while the card is still inert is dropped by the browser and
          // `document.activeElement` stays on <body>. Focus once here (the
          // fast path, and the only one jsdom needs) and re-assert on the next
          // frame, once the teardown has flushed. Chromium can defer the
          // final body-focus write until that first paint under load, so keep
          // the same idempotent restore alive through the following paint as
          // well. This is bounded to two frames and never steals focus after
          // the close lifecycle has settled.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const restoreFocus = () => transitionTriggerRef.current?.focus();
            restoreFocus();
            requestAnimationFrame(() => {
              restoreFocus();
              requestAnimationFrame(restoreFocus);
            });
          }}
          siteId={siteId}
          actionId={item.id}
          actionTitle={item.problem}
          targetState={targetState}
          expectedVersion={item.version}
          onConflictReload={onReload}
        />
      ) : null}
      <HistoryDrawer
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        siteId={siteId}
        actionId={item.id}
        actionTitle={item.problem}
      />
      {item.retest.available ? (
        <RetestDialog
          open={retestOpen}
          onOpenChange={setRetestOpen}
          siteId={siteId}
          actionId={item.id}
          actionTitle={item.problem}
        />
      ) : null}
    </article>
  );
}
