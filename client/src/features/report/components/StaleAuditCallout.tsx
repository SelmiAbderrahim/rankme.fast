/**
 * Prominent "Last audited N days ago" prompt for an audit older than the
 * server's freshness window. The Overview links to the Report page's
 * confirmation. On the Report page itself the header's "Run a new audit" is
 * the one action, so the callout only informs. Nothing here starts an audit
 * by itself.
 */
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { useWorkspaceSiteCapabilities } from '@shared/site/capabilities';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@shared/ui/tooltip';
import { formatAbsoluteDate } from '@shared/lib/datetime';
import { auditAge } from '../auditAge';

interface StaleAuditCalloutBaseProps {
  /** When the newest audit finished; null when the site was never audited. */
  runAt: string | null | undefined;
  /** A run is queued or running right now. */
  running: boolean;
  /** Server-owned freshness window in days. */
  freshDays: number | undefined;
  /** Injectable clock for tests; defaults to the current time. */
  now?: number;
}

/**
 * Links to the page that owns the confirmation, or — with no `to` — shows no
 * action because the page already offers it.
 */
export type StaleAuditCalloutProps = StaleAuditCalloutBaseProps & { to?: string };

export const StaleAuditCallout = ({
  runAt,
  running,
  freshDays,
  to,
  now = Date.now(),
}: StaleAuditCalloutProps) => {
  const { t, i18n } = useTranslation('report');
  // A paused site cannot run an audit; say so instead.
  const { canRun, blockedReason } = useWorkspaceSiteCapabilities();
  const age = auditAge({ runAt, running, freshDays, now });
  // Never audited has its own first-audit empty state, and a running audit is
  // already doing what this prompt would ask for.
  if (age.state !== 'stale' || age.days === null) return null;
  // A stale age always comes from a parsed `runAt`.
  const absolute = formatAbsoluteDate(runAt!, i18n.language, { withTime: true });

  return (
    <section
      data-testid="stale-audit-callout"
      aria-labelledby="stale-audit-title"
      className="border-border bg-card flex flex-wrap items-center gap-4 rounded-xl border p-4"
    >
      <span className="bg-warning/10 text-warning flex size-10 shrink-0 items-center justify-center rounded-full">
        <CalendarClock aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="stale-audit-title" className="text-base font-semibold" data-testid="stale-audit-title">
          {/* Same calendar-day count as every relative date in the app; the
              exact date and time are one hover or focus away. */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  data-absolute={absolute}
                  className="focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-[3px]"
                >
                  {t('stale.title', { count: age.days })}
                </span>
              </TooltipTrigger>
              <TooltipContent>{absolute}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h2>
        {/* Without its own action, a paused site's reason already sits
            under the page's disabled "Run a new audit". */}
        {canRun ? (
          <p className="text-muted-foreground text-sm" id="stale-audit-body">
            {t('stale.body')}
          </p>
        ) : to ? (
          <p className="text-muted-foreground text-sm" id="stale-audit-body">
            {blockedReason}
          </p>
        ) : null}
      </div>
      {!to ? null : !canRun ? (
        <Button
          type="button"
          variant="outline"
          disabled
          aria-describedby="stale-audit-body"
          data-testid="stale-audit-run"
        >
          {t('stale.cta')}
        </Button>
      ) : (
        <Button asChild variant="outline" data-testid="stale-audit-run">
          <Link to={to}>{t('stale.cta')}</Link>
        </Button>
      )}
    </section>
  );
};
