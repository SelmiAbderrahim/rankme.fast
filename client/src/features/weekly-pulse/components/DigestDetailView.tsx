/**
 * Weekly Pulse — digest detail view.
 *
 * Renders the stored `weekly_pulse_digest_projection.payload` verbatim.
 * Sections match fixed order; empty states are honest.
 */
import { useTranslation } from 'react-i18next';
import type { DigestBrandDelta, DigestProjectionPayload } from '../types';

interface DigestDetailViewProps {
  projection: DigestProjectionPayload;
  onClose?: () => void;
}

export function DigestDetailView({ projection, onClose }: DigestDetailViewProps) {
  const { t } = useTranslation('weeklyPulse');
  const header = projection.header;
  const coverage = projection.coverage;
  const gsc = projection.gsc_appearance;
  const brandDeltas = projection.brand_deltas ?? [];
  return (
    <article
      aria-labelledby="digest-detail-title"
      className="flex flex-col gap-4 rounded-xl border p-4"
      data-testid="digest-detail-view"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="digest-detail-title" className="text-lg font-semibold">
            {t('detail.title', { isoWeek: header.isoWeek })}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('detail.coverage', {
              supported: coverage.supported,
              total: coverage.total,
            })}
          </p>
          {coverage.partial ? (
            <p className="text-muted-foreground text-sm">{t('detail.partial')}</p>
          ) : null}
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground text-sm underline"
            aria-label={t('detail.closeLabel')}
            data-testid="digest-detail-close"
          >
            ×
          </button>
        ) : null}
      </header>

      <Section title={t('detail.sections.newCitations')}>
        {projection.citations_new.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('detail.empty.newCitations')}
          </p>
        ) : (
          <ul>
            {projection.citations_new.map((c) => (
              <li key={c.canonicalUrl}>
                {c.host} — {c.engine}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('detail.sections.lostCitations')}>
        {projection.citations_lost.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('detail.empty.lostCitations')}
          </p>
        ) : (
          <ul>
            {projection.citations_lost.map((c) => (
              <li key={c.canonicalUrl}>
                {c.host} — {c.engine}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('detail.sections.unknownPartial')}>
        {projection.citations_unknown_partial.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('detail.empty.unknownPartial')}
          </p>
        ) : (
          <ul>
            {projection.citations_unknown_partial.map((c) => (
              <li key={c.canonicalUrl}>
                {c.host} — {c.engine}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('detail.sections.confirmedDrops')}>
        {projection.confirmed_rank_drops.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('detail.empty.confirmedDrops')}
          </p>
        ) : (
          <ul>
            {projection.confirmed_rank_drops.map((r) => (
              <li key={`${r.keyword}-${r.confirmedAt}`}>
                {r.keyword} — {r.priorRank ?? '?'} → {r.currentRank ?? '?'}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('detail.sections.actionsChanged')}>
        {projection.actions_completed.length + projection.actions_regressed.length ===
        0 ? (
          <p className="text-muted-foreground text-sm">
            {t('detail.empty.actionsChanged')}
          </p>
        ) : (
          <ul>
            {projection.actions_completed.map((a) => (
              <li key={a.actionId}>{a.verb} {a.target}</li>
            ))}
            {projection.actions_regressed.map((a) => (
              <li key={a.actionId}>{a.verb} {a.target}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('detail.sections.top3')}>
        {projection.next_actions_top3.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('detail.empty.top3')}</p>
        ) : (
          <ul>
            {projection.next_actions_top3.map((a) => (
              <li key={a.actionId}>{a.verb} {a.target}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('detail.sections.gscGenerative')}>
        {gsc.status === 'available' && gsc.rows.some((r) => r.isGenerative) ? (
          <ul>
            {gsc.rows
              .filter((r) => r.isGenerative)
              .map((r) => (
                <li key={r.rawAppearance}>
                  {t('gsc.row', {
                    appearance: r.rawAppearance,
                    clicks: r.clicks,
                    impressions: r.impressions,
                  })}
                </li>
              ))}
          </ul>
        ) : gsc.status === 'reconnect_required' ? (
          <p className="text-muted-foreground text-sm">{t('gsc.reconnect')}</p>
        ) : gsc.status === 'partial' ? (
          <p className="text-muted-foreground text-sm">{t('detail.partial')}</p>
        ) : (
          <p className="text-muted-foreground text-sm">{t('gsc.empty')}</p>
        )}
      </Section>

      <Section title={t('detail.sections.brandDeltas')}>
        <p className="text-muted-foreground text-sm">{t('brandDeltas.scopeNote')}</p>
        {brandDeltas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('brandDeltas.empty')}</p>
        ) : (
          <ul data-testid="digest-brand-deltas">
            {brandDeltas.map((delta) => (
              <li key={delta.queryHash}>{brandDeltaLine(t, delta)}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('detail.sections.deepLinks')}>
        <ul>
          <li>
            <a href={projection.deep_links.aiVisibility} className="underline">
              {t('detail.sections.gscGenerative')}
            </a>
          </li>
          <li>
            <a href={projection.deep_links.google} className="underline">
              {t('gsc.title')}
            </a>
          </li>
          <li>
            <a href={projection.deep_links.contentIntelligence} className="underline">
              {t('detail.sections.newCitations')}
            </a>
          </li>
        </ul>
      </Section>
    </article>
  );
}

/** Signed whole number, e.g. `+3` / `-2` / `0`. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

type TranslateFn = (key: string, vars?: Record<string, string>) => string;

/**
 * Every line is a plain text node — the stored brand query is untrusted
 * user input and never becomes markup.
 */
function brandDeltaLine(t: TranslateFn, delta: DigestBrandDelta): string {
  if (!delta.hasNewScan) {
    return t('brandDeltas.noNewScan', { query: delta.brandQuerySafe });
  }
  if (delta.newMentionCount === null || delta.sentimentShift === null) {
    return t('brandDeltas.firstScan', { query: delta.brandQuerySafe });
  }
  const head = t('brandDeltas.queryLine', {
    query: delta.brandQuerySafe,
    delta: signed(delta.newMentionCount),
  });
  const tail = t('brandDeltas.sentimentLine', {
    positive: signed(delta.sentimentShift.positive),
    neutral: signed(delta.sentimentShift.neutral),
    negative: signed(delta.sentimentShift.negative),
    unknown: signed(delta.sentimentShift.unknown),
  });
  return `${head} ${tail}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-1 text-sm">{children}</div>
    </section>
  );
}
